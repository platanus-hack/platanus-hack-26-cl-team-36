// Cuentas de la telaraña para el panel y el vecindario de una estación para aislarla (diseño §10.5.2). Puro: no
// toca document ni window.

export const RESULTADOS = ["logrado", "fallido", "abandonado", "error"];

const valido = (intento) => intento?.resultado !== "error";

/** Finales por página (los de la API, pagina.finales). → Map<paginaId, { logrado, fallido, abandonado, error }>. */
export function finalesPorPagina(tanda) {
  const vacio = () => Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  return new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, { ...vacio(), ...(pagina.finales ?? {}) }]));
}

/** Totales por resultado a partir de finalesPorPagina(). */
export function totalesDeFinales(finales) {
  const totales = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  for (const cuenta of finales.values()) for (const r of RESULTADOS) totales[r] += Number(cuenta[r] ?? 0);
  return totales;
}

/** Vecindario de una estación en la distribución: ella, sus tramos y lo que está al otro lado. */
export function vecindario(distribucion, id) {
  const ids = new Set([id]);
  for (const tramo of distribucion?.tramos ?? []) {
    if (tramo.origen !== id && tramo.destino !== id) continue;
    ids.add(tramo.id);
    ids.add(tramo.origen);
    ids.add(tramo.destino);
  }
  return ids;
}

/** Hitos de la ruta con cuántos intentos válidos llegaron a cada uno: [{ pagina, n, de }]. */
export function hitosDeRuta(tanda) {
  const ruta = tanda?.telarana?.ruta?.paginas ?? [];
  const intentos = (tanda?.intentos ?? []).filter(valido);
  return ruta.map((pagina) => ({
    pagina,
    n: intentos.filter((intento) => intento.hitos?.some((hito) => hito.pagina === pagina && hito.alcanzado)).length,
    de: intentos.length,
  }));
}

/** Primer paso (numero) en que el intento está en la página (llega o parte de ella). null si nunca pasó. */
export function pasoDeLlegada(intento, paginaId) {
  for (const paso of intento?.pasos ?? []) {
    if (paso.paginaAntes === paginaId || paso.pagina === paginaId) return paso.numero;
  }
  return null;
}

/** Intentos que pasaron por la página, con el paso en que llegaron: [{ intento, paso }]. */
export function intentosPorPagina(tanda, paginaId) {
  return (tanda?.intentos ?? [])
    .filter((intento) => intento.camino?.includes(paginaId))
    .map((intento) => ({ intento, paso: pasoDeLlegada(intento, paginaId) }));
}

/** Ramas que salen de la página, de más a menos intentos. */
export function salidasDePagina(tanda, paginaId) {
  return (tanda?.telarana?.ramas ?? [])
    .filter((rama) => rama.origen === paginaId)
    .sort((a, b) => (b.intentos ?? 0) - (a.intentos ?? 0) || String(a.id).localeCompare(String(b.id)));
}
