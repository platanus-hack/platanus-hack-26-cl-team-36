// Clientes de AWS de la API y la proyectora. El SDK v3 viene en el runtime nodejs22.x
// de Lambda, así que no se empaqueta; se importa recién al usarlo para que el
// servidor local y las pruebas no lo necesiten.

import { randomUUID } from "node:crypto";

// `previos`: solo escribe si `status` no existe o es uno de ellos. `existente`: solo si el ítem existe.
export function expresionActualizar(atributos, { previos, existente = false } = {}) {
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

export async function tablaDynamo(tabla) {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand } = await import("@aws-sdk/lib-dynamodb");
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

// El runtime corre en modo async: responde al aceptar la tarea, sin esperar a que termine.
export async function runtimeAgentes(nombre, { timeoutMs = 10_000 } = {}) {
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import("@aws-sdk/client-bedrock-agentcore");
  const { BedrockAgentCoreControlClient, ListAgentRuntimesCommand } = await import(
    "@aws-sdk/client-bedrock-agentcore-control"
  );
  const cliente = new BedrockAgentCoreClient({});
  const control = new BedrockAgentCoreControlClient({});
  let arn;

  // Por nombre y no por ARN: el ARN cambia si el runtime se recrea o se renombra.
  async function resolver() {
    let nextToken;
    do {
      const pagina = await control.send(new ListAgentRuntimesCommand({ nextToken }));
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
        const respuesta = await cliente.send(
          new InvokeAgentRuntimeCommand({
            agentRuntimeArn: arn,
            runtimeSessionId: randomUUID(),
            contentType: "application/json",
            accept: "application/json",
            payload: new TextEncoder().encode(JSON.stringify(payload)),
          }),
          { abortSignal: AbortSignal.timeout(timeoutMs) },
        );
        respuesta.response?.destroy?.();
      } catch (error) {
        arn = undefined;
        throw error;
      }
    },
  };
}
