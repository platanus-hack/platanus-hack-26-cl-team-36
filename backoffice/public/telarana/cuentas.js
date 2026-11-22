// Cuentas de la telaraña que dependen del filtro de perfil, vecindarios para aislar y el recorrido de una
// historia (diseño §10.5.2–10.5.3). Puro: no toca document ni window.

import { RESULTADOS, idDeTerminal, idDeTramoFinal } from "./distribuir.js";

const valido = (intento) => intento?.resultado !== "error";

/** Intentos de un perfil (o todos con perfil null). */
export function intentosDePerfil(tanda, perfil = null) {
  const intentos = tanda?.intentos ?? [];
  return perfil ? intentos.filter((intento) => intento.perfil === perfil) : intentos;
}

/**
 * Finales por página para un perfil. Sin perfil, los de la API (pagina.finales); con perfil, se cuentan desde la
 * última página del camino de cada intento del perfil. → Map<paginaId, { logrado, fallido, abandonado, sin_medir, error }>.
 */
export function finalesPorPagina(tanda, perfil = null) {
  const resultado = new Map();
  const vacio = () => Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  if (!perfil) {
    for (const pagina of tanda?.telarana?.paginas ?? []) resultado.set(pagina.id, { ...vacio(), ...(pagina.finales ?? {}) });
    return resultado;
  }
  for (const intento of intentosDePerfil(tanda, perfil)) {
    const ultima = intento.camino?.at(-1);
    if (!ultima || !RESULTADOS.includes(intento.resultado)) continue;
    if (!resultado.has(ultima)) resultado.set(ultima, vacio());
    resultado.get(ultima)[intento.resultado] += 1;
  }
  return resultado;
}

/** Totales por resultado a partir de finalesPorPagina(). */
export function totalesDeTerminales(finales) {
  const totales = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  for (const cuenta of finales.values()) for (const r of RESULTADOS) totales[r] += Number(cuenta[r] ?? 0);
  return totales;
}

/**
 * Lo que toca un perfil: páginas, ramas, tramos finales y terminales. null sin perfil (todo activo).
 * → { ids: Set<string> } con ids de estaciones, tramos y terminales.
 */
export function activosDePerfil(tanda, perfil) {
  if (!perfil) return null;
  const ids = new Set();
  for (const pagina of tanda?.telarana?.paginas ?? []) if (pagina.perfiles?.includes(perfil)) ids.add(pagina.id);
  for (const rama of tanda?.telarana?.ramas ?? []) if (rama.perfiles?.includes(perfil)) ids.add(rama.id);
  for (const [pagina, cuenta] of finalesPorPagina(tanda, perfil)) {
    for (const r of RESULTADOS) {
      if (cuenta[r] > 0) {
        ids.add(idDeTramoFinal(pagina, r));
        ids.add(idDeTerminal(r));
      }
    }
  }
  return ids;
}

/**
 * Vecindario de una estación o terminal en la distribución: ella, sus tramos y lo que está al otro lado.
 * `limite` (Set o null) restringe a lo que el filtro de perfil deja activo.
 */
export function vecindario(distribucion, id, limite = null) {
  const ids = new Set([id]);
  for (const tramo of distribucion?.tramos ?? []) {
    if (tramo.origen !== id && tramo.destino !== id) continue;
    if (limite && !limite.has(tramo.id)) continue;
    ids.add(tramo.id);
    ids.add(tramo.origen);
    ids.add(tramo.destino);
  }
  return ids;
}

/** Hitos de la ruta con cuántos intentos válidos (del perfil) llegaron a cada uno: [{ pagina, n, de }]. */
export function hitosDeRuta(tanda, perfil = null) {
  const ruta = tanda?.telarana?.ruta?.paginas ?? [];
  const intentos = intentosDePerfil(tanda, perfil).filter(valido);
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

/** Intentos (del perfil) que pasaron por la página, con el paso en que llegaron: [{ intento, paso }]. */
export function intentosPorPagina(tanda, paginaId, perfil = null) {
  return intentosDePerfil(tanda, perfil)
    .filter((intento) => intento.camino?.includes(paginaId))
    .map((intento) => ({ intento, paso: pasoDeLlegada(intento, paginaId) }));
}

/** Ramas que salen de la página (del perfil), de más a menos intentos. */
export function salidasDePagina(tanda, paginaId, perfil = null) {
  return (tanda?.telarana?.ramas ?? [])
    .filter((rama) => rama.origen === paginaId && (!perfil || rama.perfiles?.includes(perfil)))
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

/** El perfil siguiente (dir 1) o anterior (dir −1) en el ciclo [null (todos), ...perfiles]. */
export function perfilVecino(perfiles, actual, dir = 1) {
  const ciclo = [null, ...perfiles];
  const indice = Math.max(0, ciclo.indexOf(actual ?? null));
  return ciclo[(indice + dir + ciclo.length) % ciclo.length];
}

/** Duración de un paso de la historia en ms: clamp(duracion / 2, 0.4 s, 2.5 s). */
export function duracionDePaso(paso) {
  const segundos = Number(paso?.duracion);
  const mitad = Number.isFinite(segundos) ? segundos / 2 : 1;
  return Math.round(Math.min(2.5, Math.max(0.4, mitad)) * 1000);
}
