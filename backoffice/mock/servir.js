// Backoffice con datos de prueba (mock/generar.py), solo en local: las corridas de backoffice/.mock/corridas por la
// fuente de archivos y las revisiones de backoffice/.mock/revisiones.json en memoria. Nada de AWS ni de red. Es el
// mismo servidor de servidor.js: solo cambia de dónde lee. Para ver el diseño con mucho volumen sin AWS ni Claude.
//
//   npm --prefix backoffice run mock              en http://localhost:4849/backoffice/ (4848 queda para el de verdad)
//   PORT=<puerto>                                 otro puerto
//   BACKOFFICE_MOCK=<carpeta>                     otra salida de generar.py (por defecto backoffice/.mock)
//   BACKOFFICE_MOCK_LATENCIA_MS=400               demora cada lectura de revisiones, para ver los estados de carga

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { crearFuente } from "../lib/fuente.js";
import { crearRevisiones } from "../lib/revisiones.js";
import { crearServidor } from "../servidor.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(process.env.BACKOFFICE_MOCK ?? path.join(AQUI, "..", ".mock"));
const LATENCIA_MS = Number(process.env.BACKOFFICE_MOCK_LATENCIA_MS) || 0;

class Comando {
  constructor(input) {
    this.input = input;
  }
}
const comandos = { QueryCommand: class QueryCommand extends Comando {}, ScanCommand: class ScanCommand extends Comando {} };

/**
 * Las revisiones de revisiones.json, en memoria: nada de AWS ni de red. Responde con la misma forma que el SDK
 * para que lib/revisiones.js funcione sin cambios: entiende su Scan (`SK IN (:meta, :url)`) y su Query (`PK = :pk`) y
 * pagina con LastEvaluatedKey, como la tabla real.
 */
export function tablaEnMemoria(items, { porPagina = 100, latenciaMs = 0 } = {}) {
  const filtro = (expresion, valores) => {
    const partes = /^(PK|SK) (?:= (:\w+)|IN \((:\w+(?:, :\w+)*)\))$/.exec(expresion ?? "");
    if (!partes) throw new Error(`Expresión no soportada por la tabla de prueba: ${expresion}`);
    const aceptados = (partes[2] ?? partes[3]).split(", ").map((nombre) => valores[nombre]);
    return (item) => aceptados.includes(item[partes[1]]);
  };
  return {
    async send(comando) {
      if (latenciaMs) await esperar(latenciaMs);
      const { input } = comando;
      const expresion = comando instanceof comandos.QueryCommand ? input.KeyConditionExpression : input.FilterExpression;
      const coinciden = items.filter(filtro(expresion, input.ExpressionAttributeValues ?? {}));
      const desde = input.ExclusiveStartKey?.indice ?? 0;
      const pagina = coinciden.slice(desde, desde + porPagina);
      const siguiente = desde + porPagina < coinciden.length ? { indice: desde + porPagina } : undefined;
      return { Items: structuredClone(pagina), Count: pagina.length, LastEvaluatedKey: siguiente };
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const corridas = path.join(RAIZ, "corridas");
  const archivoRevisiones = path.join(RAIZ, "revisiones.json");
  if (!existsSync(corridas) || !existsSync(archivoRevisiones)) {
    console.error(
      `✘ No hay datos de prueba en ${RAIZ}.\n` +
        "  Genéralos con: npm --prefix backoffice run mock:generar",
    );
    process.exit(1);
  }
  const { items, generado } = JSON.parse(readFileSync(archivoRevisiones, "utf8"));
  const revisiones = crearRevisiones({
    tabla: "chameleon-revisiones (mock)",
    cliente: tablaEnMemoria(items, { latenciaMs: LATENCIA_MS }),
    comandos,
  });
  const fuente = crearFuente({ tipo: "archivos", raiz: corridas });
  const puerto = Number(process.env.PORT) || 4849;
  // Los datos de prueba son estáticos: el reloj del servidor queda en el momento en que se generaron. Con la hora
  // real, las revisiones en curso se verían detenidas y los tiempos del Overview crecerían sin parar.
  const servidor = crearServidor({ fuente, revisiones, reloj: () => new Date(generado) });
  servidor.on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(`✘ El puerto ${puerto} ya está ocupado (¿otro backoffice?). Usa otro con PORT=4850.`);
    process.exit(1);
  });
  servidor.listen(puerto, "127.0.0.1", () => {
    const latencia = LATENCIA_MS ? ` · latencia de la tabla ${LATENCIA_MS} ms` : "";
    console.log(
      `Backoffice (datos de prueba del ${generado}) en http://localhost:${puerto}/backoffice/ · corridas de ${fuente.descripcion}` +
        ` · ${items.filter((item) => item.SK === "META").length} revisiones en memoria${latencia}`,
    );
  });
}
