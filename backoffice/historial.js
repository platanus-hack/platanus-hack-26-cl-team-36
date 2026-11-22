// Lista las revisiones que otra más nueva de la misma página reemplazó (las no vigentes, ver revisionesVigentes en
// lib/revisiones.js): las que se podrían archivar. Solo lee la tabla; no tiene un modo que escriba o borre.
//   AWS_PROFILE=<perfil> node historial.js [--dry-run] [--tabla <nombre>]

import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { crearRevisiones } from "./lib/revisiones.js";

/** Una línea por revisión del historial (URL, revisión, estado, fecha), de la más nueva a la más vieja, y el total. */
export function informe(historial) {
  const filas = historial.map((r) => [r.url ?? "?", r.revision, r.estado, r.creada ?? "?"]);
  const anchos = [0, 1, 2].map((i) => Math.max(0, ...filas.map((fila) => fila[i].length)));
  const lineas = filas.map((fila) => fila.map((valor, i) => (i < 3 ? valor.padEnd(anchos[i]) : valor)).join("  "));
  return [...lineas, `${historial.length} revisiones no vigentes (dry-run: no se archivó nada)`].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ allowNegative: true, options: { "dry-run": { type: "boolean", default: true }, tabla: { type: "string", default: "chameleon-revisiones" } } });
  if (!values["dry-run"]) {
    console.error("✘ Este script solo lista (dry-run): archivar queda para cuando se decida cómo.");
    process.exit(1);
  }
  const aws = await (await import("./lib/aws.js")).conectarAws();
  const { historial } = await crearRevisiones({ tabla: values.tabla, ...aws.dynamo }).listar();
  console.log(informe(historial));
}
