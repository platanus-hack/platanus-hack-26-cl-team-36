// Clientes de AWS de la API y la proyectora. DynamoDB y S3 usan el SDK v3 que trae el
// runtime nodejs22.x de Lambda, importado recién al usarlo para que el servidor local y
// las pruebas no lo necesiten; AgentCore no viene garantizado ahí y se firma a mano.

import { randomUUID } from "node:crypto";
import { credencialesDelEntorno, firmar } from "./firma.js";

// `previos`: solo escribe si `status` no existe o es uno de ellos. `existente`: solo si el ítem existe.
// `hasta`: { atributo: valor }, solo si el atributo no existe o no es mayor que ese valor.
export function expresionActualizar(atributos, { previos, existente = false, hasta = {} } = {}) {
  const nombres = {};
  const valores = {};
  const sets = [];
  Object.entries(atributos)
    .filter(([, valor]) => valor !== undefined)
    .forEach(([nombre, valor], i) => {
      nombres[`#a${i}`] = nombre;
      valores[`:a${i}`] = valor;
      sets.push(`#a${i} = :a${i}`);
    });

  const condiciones = [];
  if (previos) {
    nombres["#status"] = "status";
    const lista = previos.map((estado, i) => ((valores[`:p${i}`] = estado), `:p${i}`));
    condiciones.push(
      lista.length ? `(attribute_not_exists(#status) OR #status IN (${lista.join(", ")}))` : "attribute_not_exists(#status)",
    );
  }
  Object.entries(hasta).forEach(([nombre, valor], i) => {
    nombres[`#h${i}`] = nombre;
    valores[`:h${i}`] = valor;
    condiciones.push(`(attribute_not_exists(#h${i}) OR #h${i} <= :h${i})`);
  });
  if (existente) condiciones.push("attribute_exists(PK)");

  return {
    UpdateExpression: `SET ${sets.join(", ")}`,
    ExpressionAttributeNames: nombres,
    ExpressionAttributeValues: valores,
    ...(condiciones.length && { ConditionExpression: condiciones.join(" AND ") }),
  };
}

export function condicionRegistro(reemplaza) {
  if (reemplaza == null) return { ConditionExpression: "attribute_not_exists(PK)" };
  return {
    ConditionExpression: "#revision = :revision",
    ExpressionAttributeNames: { "#revision": "revision" },
    ExpressionAttributeValues: { ":revision": reemplaza },
  };
}

export function filtroEnCurso(estados, desde) {
  const valores = { ":meta": "META", ":desde": desde };
  const lista = estados.map((estado, i) => ((valores[`:e${i}`] = estado), `:e${i}`));
  return {
    FilterExpression: `SK = :meta AND #status IN (${lista.join(", ")}) AND updated_at >= :desde`,
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: valores,
  };
}

export async function tablaDynamo(tabla) {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } = await import(
    "@aws-sdk/lib-dynamodb"
  );
  const cliente = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // true si escribió; false si una condición no se cumplió.
  async function condicional(comando) {
    try {
      await cliente.send(comando);
      return true;
    } catch (error) {
      if (error.name === "ConditionalCheckFailedException") return false;
      // TransactionConflict: otra transacción tocaba el mismo ítem; quien llama vuelve a mirar.
      if (error.CancellationReasons?.some(({ Code }) => Code === "ConditionalCheckFailed" || Code === "TransactionConflict")) {
        return false;
      }
      throw error;
    }
  }

  return {
    obtener: async (Key) => (await cliente.send(new GetCommand({ TableName: tabla, Key, ConsistentRead: true }))).Item ?? null,
    // Puts atómicos; cada uno exige que el ítem no exista (`reemplaza` null) o que apunte a esa revisión.
    registrar: (puts) =>
      condicional(
        new TransactWriteCommand({
          TransactItems: puts.map(({ item, reemplaza }) => ({
            Put: { TableName: tabla, Item: item, ...condicionRegistro(reemplaza) },
          })),
        }),
      ),
    // Scan de la tabla entera: barato mientras sea chica (una demo); con más tráfico, un índice por status.
    async contarEnCurso(estados, desde) {
      let total = 0;
      let ExclusiveStartKey;
      do {
        const pagina = await cliente.send(
          new ScanCommand({ TableName: tabla, Select: "COUNT", ExclusiveStartKey, ...filtroEnCurso(estados, desde) }),
        );
        total += pagina.Count;
        ExclusiveStartKey = pagina.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return total;
    },
    async listar(PK) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const pagina = await cliente.send(
          new QueryCommand({
            TableName: tabla,
            KeyConditionExpression: "PK = :pk",
            ExpressionAttributeValues: { ":pk": PK },
            ConsistentRead: true,
            ExclusiveStartKey,
          }),
        );
        items.push(...pagina.Items);
        ExclusiveStartKey = pagina.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },
    actualizar: (Key, atributos, opciones) =>
      condicional(new UpdateCommand({ TableName: tabla, Key, ...expresionActualizar(atributos, opciones) })),
  };
}

export async function almacenS3(bucket) {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const cliente = new S3Client({});
  const leerTexto = async (Key) =>
    (await cliente.send(new GetObjectCommand({ Bucket: bucket, Key }))).Body.transformToString();
  return { leerTexto, leerJson: async (Key) => JSON.parse(await leerTexto(Key)) };
}

// La CLI de AgentCore nombra el runtime `<proyecto>_<destino>_<nombre>`.
export function coincideRuntime(nombreRuntime, nombre) {
  return nombreRuntime === nombre || nombreRuntime.endsWith(`_${nombre}`);
}

// Llama a AgentCore firmando a mano (ver firma.js). Lanza si la respuesta no es 2xx.
export function clienteAgentCore({ region = process.env.AWS_REGION, credenciales = credencialesDelEntorno, fetch = globalThis.fetch } = {}) {
  return async function llamar(servicio, path, { cuerpo = "", cabeceras = {}, timeoutMs = 10_000 } = {}) {
    const url = `https://${servicio}.${region}.amazonaws.com${path}`;
    const firmadas = firmar({
      metodo: "POST",
      url,
      cabeceras,
      cuerpo,
      region,
      servicio: "bedrock-agentcore",
      credenciales: credenciales(),
    });
    const respuesta = await fetch(url, { method: "POST", headers: firmadas, body: cuerpo, signal: AbortSignal.timeout(timeoutMs) });
    if (!respuesta.ok) {
      const detalle = (await respuesta.text()).slice(0, 300);
      throw Object.assign(new Error(`${servicio} ${path}: ${respuesta.status} ${detalle}`), { name: `AgentCore${respuesta.status}` });
    }
    return respuesta;
  };
}

// El runtime corre en modo async: responde al aceptar la tarea, sin esperar a que termine.
export function runtimeAgentes(nombre, { llamar = clienteAgentCore() } = {}) {
  let arn;

  // Por nombre y no por ARN: el ARN cambia si el runtime se recrea o se renombra.
  async function resolver() {
    let nextToken;
    do {
      const respuesta = await llamar("bedrock-agentcore-control", "/runtimes/", {
        cuerpo: JSON.stringify({ maxResults: 100, ...(nextToken && { nextToken }) }),
        cabeceras: { "content-type": "application/json" },
      });
      const pagina = await respuesta.json();
      const runtime = pagina.agentRuntimes?.find((r) => coincideRuntime(r.agentRuntimeName, nombre));
      if (runtime) return runtime.agentRuntimeArn;
      nextToken = pagina.nextToken;
    } while (nextToken);
    throw new Error(`No hay un runtime de AgentCore llamado ${nombre}`);
  }

  return {
    async invocar(payload) {
      arn ??= await resolver();
      try {
        const respuesta = await llamar("bedrock-agentcore", `/runtimes/${encodeURIComponent(arn)}/invocations`, {
          cuerpo: JSON.stringify(payload),
          cabeceras: {
            "content-type": "application/json",
            accept: "application/json",
            "x-amzn-bedrock-agentcore-runtime-session-id": randomUUID(),
          },
        });
        await respuesta.body?.cancel();
      } catch (error) {
        arn = undefined;
        throw error;
      }
    },
  };
}
