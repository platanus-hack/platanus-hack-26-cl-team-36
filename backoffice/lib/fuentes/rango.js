// El rango de bytes que se sirve de un archivo de `tamano` bytes, igual en todas las fuentes.

/**
 * @param {import("../fuente.js").RangoPedido | undefined} rango
 * @param {number} tamano
 * @returns {{ inicio: number, fin: number } | null | undefined}  undefined: el archivo entero; null: no se puede servir (416)
 */
export function resolverRango(rango, tamano) {
  if (!rango || (rango.inicio === undefined && rango.fin === undefined)) return undefined;
  const inicio = rango.inicio !== undefined ? rango.inicio : Math.max(0, tamano - rango.fin);
  const fin = rango.inicio !== undefined && rango.fin !== undefined ? Math.min(rango.fin, tamano - 1) : tamano - 1;
  return inicio > fin || inicio >= tamano ? null : { inicio, fin };
}
