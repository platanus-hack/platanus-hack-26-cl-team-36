// Estado del riel de trazas, común al Mapa y al Replay: qué fila está elegida según ?intento= y adónde llevan ↑ ↓.
// Puro.

import { grupoDe } from "./priorizar.js";

/**
 * La fila elegida por `intentoId` (cualquier intento de un grupo la elige). Sin id o con uno que no existe: null,
 * salvo `porDefecto`, que elige la primera (el Replay siempre muestra una traza).
 * @returns {{ grupo: object, intento: object, valido: boolean } | null}  valido: el id existía
 */
export function seleccion(grupos, intentoId, { porDefecto = false } = {}) {
  const grupo = intentoId ? grupoDe(grupos, intentoId) : null;
  if (grupo) return { grupo, intento: grupo.intentos.find((intento) => intento.id === intentoId), valido: true };
  if (!porDefecto || !grupos.length) return null;
  return { grupo: grupos[0], intento: grupos[0].intentos[0], valido: !intentoId };
}

/** El id del representante de la fila `delta` filas más abajo (o arriba), sin dar la vuelta; null sin filas. */
export function vecina(grupos, intentoId, delta) {
  if (!grupos.length) return null;
  const actual = intentoId ? grupos.indexOf(grupoDe(grupos, intentoId)) : -1;
  const destino = actual === -1 ? (delta > 0 ? 0 : grupos.length - 1) : Math.min(grupos.length - 1, Math.max(0, actual + delta));
  return grupos[destino].representante;
}

/** Las otras tandas de la misma tarea, de la más nueva a la más vieja, a lo más `max`. */
export function otrasDeLaTarea(vecinas, max = 5) {
  return [...(vecinas?.mismaTarea ?? [])].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)).slice(0, max);
}

/** «2026-11-20T00-46-11Z» (la carpeta de la corrida) → «2026-11-20T00:46:11Z». */
export const fechaDeCorrida = (corrida) => String(corrida ?? "").replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3").replace(/_\d+$/, "");
