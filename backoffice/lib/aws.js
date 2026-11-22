// Clientes del SDK de AWS. Se importan solo con BACKOFFICE_FUENTE=s3: la fuente local no necesita el SDK ni
// credenciales. Credenciales por la cadena estándar (AWS_PROFILE, variables, SSO…).

export const REGION_POR_DEFECTO = "us-east-2";

/** → { region, s3: { cliente, comandos, firmar, region }, dynamo: { cliente, comandos } } */
export async function conectarAws({ region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || REGION_POR_DEFECTO } = {}) {
  let s3, firmas, dynamo, documentos;
  try {
    [s3, firmas, dynamo, documentos] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
      import("@aws-sdk/client-dynamodb"),
      import("@aws-sdk/lib-dynamodb"),
    ]);
  } catch (error) {
    throw new Error(`Falta el SDK de AWS: corre «npm --prefix backoffice install» (${error.message})`);
  }
  return {
    region,
    s3: {
      cliente: new s3.S3Client({ region }),
      comandos: { ListObjectsV2Command: s3.ListObjectsV2Command, GetObjectCommand: s3.GetObjectCommand, HeadObjectCommand: s3.HeadObjectCommand },
      firmar: firmas.getSignedUrl,
      region,
    },
    dynamo: {
      cliente: documentos.DynamoDBDocumentClient.from(new dynamo.DynamoDBClient({ region })),
      comandos: { QueryCommand: documentos.QueryCommand, ScanCommand: documentos.ScanCommand },
    },
  };
}
