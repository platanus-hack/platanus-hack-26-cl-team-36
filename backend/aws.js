// Clientes de AWS de la API y la proyectora. El SDK v3 viene en el runtime nodejs22.x
// de Lambda, así que no se empaqueta; se importa recién al usarlo para que el
// servidor local y las pruebas no lo necesiten.

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
      if (error.CancellationReasons?.some((razon) => razon.Code === "ConditionalCheckFailed")) return false;
      throw error;
    }
  }

  return {
    obtener: async (Key) => (await cliente.send(new GetCommand({ TableName: tabla, Key, ConsistentRead: true }))).Item ?? null,
    // Puts atómicos; los `nueva` fallan si el ítem ya existe.
    registrar: (puts) =>
      condicional(
        new TransactWriteCommand({
          TransactItems: puts.map(({ item, nueva }) => ({
            Put: { TableName: tabla, Item: item, ...(nueva && { ConditionExpression: "attribute_not_exists(PK)" }) },
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
