// Clientes falsos de S3 y DynamoDB (lib-dynamodb) en memoria: responden con la forma del SDK v3, sin red.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

class Comando {
  constructor(input) {
    this.input = input;
  }
}
export const comandosS3 = {
  ListObjectsV2Command: class ListObjectsV2Command extends Comando {},
  GetObjectCommand: class GetObjectCommand extends Comando {},
  HeadObjectCommand: class HeadObjectCommand extends Comando {},
};
export const comandosDynamo = {
  QueryCommand: class QueryCommand extends Comando {},
  ScanCommand: class ScanCommand extends Comando {},
};

const falta = (nombre) => Object.assign(new Error(nombre), { name: nombre, $metadata: { httpStatusCode: 404 } });

function cuerpo(bytes) {
  const flujo = Readable.from([bytes]);
  flujo.transformToString = async () => bytes.toString("utf8");
  return flujo;
}

/** Los archivos de una carpeta como { "<prefijo><ruta relativa>": Buffer }. */
export function objetosDeCarpeta(carpeta, prefijo = "") {
  const objetos = {};
  const recorrer = (actual) => {
    for (const nombre of readdirSync(actual)) {
      const ruta = path.join(actual, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else objetos[prefijo + path.relative(carpeta, ruta).split(path.sep).join("/")] = readFileSync(ruta);
    }
  };
  recorrer(carpeta);
  return objetos;
}

/** S3 falso sobre `objetos` ({ clave: Buffer | string }); `porPagina` chico para probar la paginación. */
export function clienteS3Falso(bucket, objetos, { porPagina = 2 } = {}) {
  const llamadas = [];
  const leer = (clave) => {
    const valor = objetos[clave];
    return valor === undefined ? undefined : Buffer.from(valor);
  };
  return {
    llamadas,
    contar: (nombre) => llamadas.filter((comando) => comando.constructor.name === nombre).length,
    async send(comando) {
      llamadas.push(comando);
      const { input } = comando;
      if (input.Bucket !== bucket) throw falta("NoSuchBucket");
      if (comando instanceof comandosS3.ListObjectsV2Command) {
        const prefijo = input.Prefix ?? "";
        const entradas = [];
        for (const clave of Object.keys(objetos).filter((c) => c.startsWith(prefijo)).sort()) {
          const resto = clave.slice(prefijo.length);
          const corte = input.Delimiter ? resto.indexOf(input.Delimiter) : -1;
          const entrada = corte >= 0 ? { carpeta: prefijo + resto.slice(0, corte + 1) } : { clave };
          if (!entradas.some((otra) => otra.carpeta && otra.carpeta === entrada.carpeta)) entradas.push(entrada);
        }
        const desde = Number(input.ContinuationToken ?? 0);
        const pagina = entradas.slice(desde, desde + porPagina);
        const truncada = desde + porPagina < entradas.length;
        return {
          CommonPrefixes: pagina.filter((e) => e.carpeta).map((e) => ({ Prefix: e.carpeta })),
          Contents: pagina.filter((e) => e.clave).map((e) => ({ Key: e.clave, Size: leer(e.clave).length })),
          IsTruncated: truncada,
          NextContinuationToken: truncada ? String(desde + porPagina) : undefined,
        };
      }
      const bytes = leer(input.Key);
      if (comando instanceof comandosS3.HeadObjectCommand) {
        if (!bytes) throw falta("NotFound");
        return { ContentLength: bytes.length };
      }
      if (comando instanceof comandosS3.GetObjectCommand) {
        if (!bytes) throw falta("NoSuchKey");
        const rango = /^bytes=(\d+)-(\d+)$/.exec(input.Range ?? "");
        const parte = rango ? bytes.subarray(Number(rango[1]), Number(rango[2]) + 1) : bytes;
        return { Body: cuerpo(parte), ContentLength: parte.length };
      }
      throw new Error(`comando inesperado: ${comando.constructor.name}`);
    },
  };
}

/** getSignedUrl falso: la URL virtual-hosted del bucket con lo firmado a la vista. */
export async function firmarFalso(cliente, comando, { expiresIn, signingDate }) {
  const { input } = comando;
  const url = new URL(`https://${input.Bucket}.s3.us-east-2.amazonaws.com/${input.Key}`);
  if (input.ResponseContentType) url.searchParams.set("tipo", input.ResponseContentType);
  if (input.ResponseCacheControl) url.searchParams.set("cache", input.ResponseCacheControl);
  url.searchParams.set("vence", String(expiresIn));
  url.searchParams.set("firmada", signingDate.toISOString());
  return url.href;
}

/** DynamoDB falso (lib-dynamodb: ítems planos) con Query por PK y Scan por SK, paginados. */
export function clienteDynamoFalso(tabla, items, { porPagina = 2 } = {}) {
  const llamadas = [];
  return {
    llamadas,
    async send(comando) {
      llamadas.push(comando);
      const { input } = comando;
      if (input.TableName !== tabla) throw Object.assign(new Error("tabla"), { name: "ResourceNotFoundException" });
      const valores = input.ExpressionAttributeValues ?? {};
      let encontrados;
      if (comando instanceof comandosDynamo.QueryCommand) {
        if (input.KeyConditionExpression !== "PK = :pk") throw new Error("consulta inesperada");
        encontrados = items.filter((item) => item.PK === valores[":pk"]);
      } else if (comando instanceof comandosDynamo.ScanCommand) {
        const sks = { "SK = :meta": [":meta"], "SK IN (:meta, :url)": [":meta", ":url"] }[input.FilterExpression]?.map((nombre) => valores[nombre]);
        encontrados = sks ? items.filter((item) => sks.includes(item.SK)) : items;
      } else {
        throw new Error(`comando inesperado: ${comando.constructor.name}`);
      }
      const desde = input.ExclusiveStartKey?.indice ?? 0;
      const fin = desde + porPagina;
      return { Items: encontrados.slice(desde, fin), LastEvaluatedKey: fin < encontrados.length ? { indice: fin } : undefined };
    },
  };
}
