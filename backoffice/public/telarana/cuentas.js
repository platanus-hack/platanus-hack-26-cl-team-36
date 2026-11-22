// Cuentas de la telaraña (finales, hitos, entradas y salidas de una página), vecindarios para aislar y el recorrido de una
// historia (diseño §10.5.2–10.5.3). Puro: no toca document ni window.

import { RESULTADOS, idDeTerminal, idDeTramoFinal } from "./distribuir.js";

const valido = (intento) => intento?.resultado !== "error";

/** Finales por página, los de la API (pagina.finales). → Map<paginaId, { logrado, fallido, abandonado, error }>. */
export function finalesPorPagina(tanda) {
  const vacio = () => Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  return new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, { ...vacio(), ...(pagina.finales ?? {}) }]));
}

/** Totales por resultado a partir de finalesPorPagina(). */
export function totalesDeTerminales(finales) {
  const totales = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  for (const cuenta of finales.values()) for (const r of RESULTADOS) totales[r] += Number(cuenta[r] ?? 0);
  return totales;
}

/**
 * Vecindario de una estación o terminal en la distribución: ella, sus tramos y lo que está al otro lado.
 */
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

/**
 * Recorrido de un intento para la historia: un elemento por paso con la página donde queda y el tramo que recorre
 * si cambia de página; `ids` = lo que se aísla (páginas del camino, sus tramos y el final).
 * → { pasos: [{ numero, pagina, paginaAntes, tramo }], ids: Set<string> }
 */
export function recorridoDeHistoria(intento, tramosExistentes = null) {
  const ids = new Set(intento?.camino ?? []);
  const pasos = (intento?.pasos ?? []).map((paso) => {
    const cambia = paso.paginaAntes && paso.pagina && paso.paginaAntes !== paso.pagina;
    const tramo = cambia ? `${paso.paginaAntes}>${paso.pagina}` : null;
    if (tramo && (!tramosExistentes || tramosExistentes.has(tramo))) ids.add(tramo);
    if (paso.pagina) ids.add(paso.pagina);
    return { numero: paso.numero, pagina: paso.pagina ?? paso.paginaAntes ?? null, paginaAntes: paso.paginaAntes ?? null, tramo };
  });
  const ultima = intento?.camino?.at(-1);
  if (ultima && RESULTADOS.includes(intento.resultado)) {
    ids.add(idDeTramoFinal(ultima, intento.resultado));
    ids.add(idDeTerminal(intento.resultado));
  }
  return { pasos, ids };
}

/** Duración de un paso de la historia en ms: clamp(duracion / 2, 0.4 s, 2.5 s). */
export function duracionDePaso(paso) {
  const segundos = Number(paso?.duracion);
  const mitad = Number.isFinite(segundos) ? segundos / 2 : 1;
  return Math.round(Math.min(2.5, Math.max(0.4, mitad)) * 1000);
}
