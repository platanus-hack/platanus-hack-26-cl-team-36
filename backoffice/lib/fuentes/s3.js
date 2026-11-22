// Fuente de corridas en S3: el mismo layout que agents/.runs/ (public/nucleo/almacen.js) bajo s3://<bucket>/<prefijo>.
// Recibe el cliente y las clases de comando del SDK (lib/aws.js), así las pruebas usan un cliente falso sin red.

import { AGENTE, CORRIDA, HOST, MANIFIESTO, OBJETIVO, idDeTanda } from "../../public/nucleo/almacen.js";
import { listarCorridasCon } from "./corridas.js";
import { resolverRango } from "./rango.js";

const CERRADA = new Set(["succeeded", "failed"]);

/** "s3://bucket/prefijo" → { bucket, prefijo: "prefijo/" } (prefijo "" si no hay). */
export function parsearAlmacen(uri) {
  const partes = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])(?:\/(.*))?$/.exec(String(uri ?? "").trim());
  if (!partes) throw new Error(`BACKOFFICE_ALMACEN debe ser s3://<bucket>/<prefijo>, no «${uri ?? ""}»`);
  const prefijo = (partes[2] ?? "").replace(/^\/+|\/+$/g, "");
  return { bucket: partes[1], prefijo: prefijo ? `${prefijo}/` : "" };
}

const noExiste = (error) =>
  error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404;

async function textoDe(cuerpo) {
  if (typeof cuerpo?.transformToString === "function") return cuerpo.transformToString("utf8");
  return Buffer.concat(await cuerpo.toArray()).toString("utf8");
}

/**
 * @param {{ bucket: string, prefijo?: string, cliente: { send: Function },
 *           comandos: { ListObjectsV2Command: Function, GetObjectCommand: Function, HeadObjectCommand: Function } }} opciones
 * @returns {import("../fuente.js").Fuente}
 */
export function crearFuenteS3({ bucket, prefijo = "", cliente, comandos }) {
  const { ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } = comandos;
  const claveDe = (id, relativa = "") => `${prefijo}${[id, relativa].filter(Boolean).join("/")}`;
  const enviar = (Comando, entrada) => cliente.send(new Comando({ Bucket: bucket, ...entrada }));

  // Una corrida cerrada no cambia (finish_run sube la carpeta y escribe el manifiesto al final): se guarda lo leído,
  // porque /api/tandas deriva todas las tandas en cada pedido.
  const cerradas = new Map();
  const memoria = new Map();
  const avisados = new Set();
  const recordar = async (id, clave, leer) => {
    if (memoria.has(clave)) return memoria.get(clave);
    const valor = await leer();
    if (cerradas.has(id)) memoria.set(clave, valor);
    return valor;
  };

  async function listar(carpeta) {
    const base = claveDe(carpeta) + (carpeta ? "/" : "");
    const carpetas = [];
    const archivos = [];
    let token;
    do {
      const pagina = await enviar(ListObjectsV2Command, { Prefix: base, Delimiter: "/", ContinuationToken: token });
      for (const { Prefix } of pagina.CommonPrefixes ?? []) carpetas.push(Prefix.slice(base.length, -1));
      for (const { Key } of pagina.Contents ?? []) archivos.push(Key.slice(base.length));
      token = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
    } while (token);
    return { carpetas, archivos };
  }

  async function textoDeLaClave(clave) {
    try {
      return await textoDe((await enviar(GetObjectCommand, { Key: clave })).Body);
    } catch (error) {
      if (noExiste(error)) return null;
      throw error;
    }
  }

  // El manifiesto primero: si dice que terminó, la carpeta ya está completa al listarla.
  async function corrida(id) {
    if (cerradas.has(id)) return cerradas.get(id);
    let estado = null;
    try {
      estado = JSON.parse((await textoDeLaClave(claveDe(id, MANIFIESTO))) ?? "null")?.status ?? null;
    } catch {
      // Manifiesto ilegible: como si no hubiera terminado.
    }
    const { carpetas, archivos } = await listar(id);
    const info = { estado, perfiles: carpetas, archivos: new Set(archivos) };
    if (CERRADA.has(estado)) cerradas.set(id, info);
    return info;
  }

  const subcarpetas = async (carpeta, patron) => (await listar(carpeta)).carpetas.filter((nombre) => patron.test(nombre));

  return {
    descripcion: `s3://${bucket}/${prefijo}`,

    async listarIds() {
      const porHost = await Promise.all(
        (await subcarpetas("", HOST)).map(async (host) => {
          const porObjetivo = await Promise.all(
            (await subcarpetas(`${host}/${AGENTE}`, OBJETIVO)).map(async (objetivo) => {
              const ids = (await subcarpetas(`${host}/${AGENTE}/${objetivo}`, CORRIDA)).map((run) => idDeTanda(host, objetivo, run));
              const infos = await Promise.all(ids.map(corrida));
              return ids.filter((_, i) => infos[i].estado === "succeeded" && infos[i].archivos.has("route_tree.json"));
            }),
          );
          return porObjetivo.flat();
        }),
      );
      return porHost.flat();
    },

    // Cada pedido vuelve a listar (puede haber corridas nuevas); lo que se lee de las cerradas queda guardado.
    listarCorridas: () => listarCorridasCon(async (carpeta) => (await listar(carpeta)).carpetas),

    listarPerfiles: async (id) => (await corrida(id)).perfiles,

    async leerJson(id, relativa) {
      return (await this.leerJsonDetallado(id, relativa)).datos;
    },

    async leerJsonDetallado(id, relativa) {
      const clave = claveDe(id, relativa);
      const leer = async () => {
        const texto = await textoDeLaClave(clave);
        if (texto === null) return { datos: null, estado: "falta" };
        try {
          return { datos: JSON.parse(texto), estado: "ok" };
        } catch (error) {
          if (!avisados.has(clave)) {
            avisados.add(clave);
            console.error(`corridas: «s3://${bucket}/${clave}» está dañado (no es JSON válido: ${error.message}).`);
          }
          return { datos: null, estado: "danado" };
        }
      };
      return relativa === MANIFIESTO ? leer() : recordar(id, clave, leer);
    },

    // El manifiesto primero (corrida()): el texto de una corrida cerrada se lee una sola vez.
    async leerTexto(id, relativa) {
      const clave = claveDe(id, relativa);
      await corrida(id);
      return recordar(id, `texto:${clave}`, () => textoDeLaClave(clave));
    },

    async existe(id, relativa) {
      const clave = claveDe(id, relativa);
      // De una corrida cerrada ya se listó su carpeta: un archivo suelto en ella se sabe sin pedir nada.
      if (cerradas.has(id) && !relativa.includes("/")) return cerradas.get(id).archivos.has(relativa);
      return recordar(id, `existe:${clave}`, async () => {
        try {
          await enviar(HeadObjectCommand, { Key: clave });
          return true;
        } catch (error) {
          if (noExiste(error)) return false;
          throw error;
        }
      });
    },

    async abrirArchivo(id, relativa, rango) {
      const clave = claveDe(id, relativa);
      let tamano;
      try {
        tamano = Number((await enviar(HeadObjectCommand, { Key: clave })).ContentLength ?? 0);
      } catch (error) {
        if (noExiste(error)) return null;
        throw error;
      }
      const servido = resolverRango(rango, tamano);
      if (servido === null) return { cuerpo: null, tamano, rango: null };
      const { Body } = await enviar(GetObjectCommand, {
        Key: clave,
        ...(servido ? { Range: `bytes=${servido.inicio}-${servido.fin}` } : {}),
      });
      return { cuerpo: Body, tamano, rango: servido ?? null };
    },
  };
}
