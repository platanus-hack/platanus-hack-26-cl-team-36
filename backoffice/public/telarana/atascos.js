// Dónde se trabaron los intentos, por página, para marcarlo en la telaraña: el mapa muestra caminos y una página
// donde alguien da vueltas sin avanzar se ve igual que una que se cruza de un clic. Puro: node:test lo importa.
//
// Se traba en una página quien tiene ahí una demora (pasos seguidos de más, lib/hallazgos.js), un paso con
// tropiezo (sin efecto, volvió atrás o error visible) o repite la misma acción (el mismo clic, texto o tecla) sin
// salir. Los intentos con error de la herramienta no cuentan: no son el usuario.

/**
 * @typedef {Object} Atasco   Lo de un intento en una página.
 * @property {string} intento
 * @property {number | null} demora    pasos seguidos de la demora más larga ahí, o null
 * @property {number} tropiezos        pasos con tropiezo hechos en la página
 * @property {number} repetidos        acciones que repiten la anterior en la página
 */

const ACCIONES_QUE_SE_REPITEN = new Set(["clic", "clic_coordenadas", "doble_clic", "triple_clic", "escribir", "tecla"]);

/** El paso repite al anterior: la misma acción sobre lo mismo, en la misma página, sin que la anterior la dejara. */
export function repiteAlAnterior(anterior, paso) {
  if (!anterior || anterior.salePagina || !paso.firma || !anterior.firma) return false;
  if (!ACCIONES_QUE_SE_REPITEN.has(paso.firma.tipo)) return false;
  const donde = paso.paginaAntes ?? null;
  if (!donde || donde !== (anterior.pagina ?? null)) return false;
  const a = anterior.firma;
  const b = paso.firma;
  if (a.tipo !== b.tipo) return false;
  if (b.tipo === "clic_coordenadas") return Math.abs((a.x ?? 0) - (b.x ?? 0)) <= 8 && Math.abs((a.y ?? 0) - (b.y ?? 0)) <= 8;
  return (a.objetivo ?? null) === (b.objetivo ?? null);
}

/**
 * @param {{ intentos?: object[] }} tanda
 * @returns {Map<string, Atasco[]>}   página → lo de cada intento que se trabó ahí, en el orden de los intentos
 */
export function atascosPorPagina(tanda) {
  const porPagina = new Map();
  for (const intento of tanda?.intentos ?? []) {
    if (intento.resultado === "error") continue;
    const suyos = new Map();
    const de = (pagina) => {
      if (!suyos.has(pagina)) suyos.set(pagina, { intento: intento.id, demora: null, tropiezos: 0, repetidos: 0 });
      return suyos.get(pagina);
    };
    for (const demora of intento.demoras ?? []) {
      if (!demora.pagina) continue;
      const atasco = de(demora.pagina);
      atasco.demora = Math.max(atasco.demora ?? 0, demora.pasos ?? 0);
    }
    let anterior = null;
    for (const paso of intento.pasos ?? []) {
      // El paso se hizo en la página de antes (un clic que no hace nada, o que vuelve atrás).
      const donde = paso.paginaAntes ?? paso.pagina;
      if (donde && paso.estado && paso.estado !== "sin_evaluar") de(donde).tropiezos += 1;
      else if (donde && repiteAlAnterior(anterior, paso)) de(donde).repetidos += 1;
      anterior = paso;
    }
    for (const [pagina, atasco] of suyos) {
      if (!porPagina.has(pagina)) porPagina.set(pagina, []);
      porPagina.get(pagina).push(atasco);
    }
  }
  return porPagina;
}
