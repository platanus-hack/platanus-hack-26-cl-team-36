// Las trazas de una tanda ordenadas por interés: primero las que no llegaron, las que vieron errores o bloqueos, las
// que se desviaron solas o se atascaron; al final las que siguieron la ruta sin novedad. Las idénticas (mismo
// resultado, mismas páginas en el mismo orden y los mismos motivos) se agrupan en una fila. Puro: los motivos son
// claves del diccionario (comun.traza.motivo.*) con su página como id; motivoATexto los nombra.

const ORDEN = { abandonado: 0, fallido: 1, logrado: 2, sin_medir: 3, error: 4 };
const FINES = new Set(["blocked", "gave_up", "step_limit", "time_limit"]);
const MAX_DEMORAS = 2;

const cuenta = (intento, senal) => (intento.pasos ?? []).filter((paso) => (paso.senales ?? []).includes(senal)).length;
const firmaDeCamino = (intento) => (intento.camino ?? []).join(">");
const contar = (valores) => valores.reduce((mapa, valor) => mapa.set(valor, (mapa.get(valor) ?? 0) + 1), new Map());

/**
 * @typedef {{ clave: string, pagina?: string | null, n?: number, peso: number }} Motivo
 * @typedef {{ valor: number, motivos: Motivo[] }} Puntaje
 */

/** El puntaje de un intento y sus motivos, de más a menos peso. */
export function puntaje(intento, { ruta = null, separanEn = new Map(), caminos = new Map() } = {}) {
  const motivos = [];
  const sumar = (peso, clave, extra = {}) => motivos.push({ clave, peso, ...extra });
  if (intento.resultado === "error") return { valor: 0, motivos: [{ clave: "herramienta", peso: 0 }] };
  const dondeQueda = intento.seSepara?.pagina ?? intento.camino?.at(-1) ?? null;
  if (intento.resultado === "abandonado") sumar(40, FINES.has(intento.motivoDeFin) ? `fin_${intento.motivoDeFin}` : "abandono", { pagina: dondeQueda });
  if (intento.resultado === "fallido") sumar(40, intento.logro === "declaro_sin_llegar" ? "creyoTerminar" : "noLlego");
  if (cuenta(intento, "security_block")) sumar(30, "bloqueo");
  const conError = (intento.pasos ?? []).find((paso) => (paso.senales ?? []).includes("visible_error"));
  if (conError) sumar(25, "error", { pagina: conError.pagina ?? null });
  for (const demora of (intento.demoras ?? []).slice(0, MAX_DEMORAS)) sumar(20, "atasco", { pagina: demora.pagina ?? null });
  const separa = intento.seSepara;
  if (separa && !separa.seDetuvo && separa.pagina) {
    const unico = (separanEn.get(separa.pagina) ?? 0) === 1;
    sumar(unico ? 15 : 5, unico ? "desvioUnico" : "desvio", { pagina: separa.pagina });
  }
  if (intento.logro === "indirecto") sumar(15, "otroCamino");
  const salioDeLaRuta = !!ruta && (intento.camino ?? []).some((pagina) => !(ruta.paginas ?? []).includes(pagina));
  if (caminos.size > 1 && caminos.get(firmaDeCamino(intento)) === 1 && salioDeLaRuta) sumar(10, "caminoUnico");
  const veces = ruta?.pasosIdeales ? (intento.pasos?.length ?? 0) / ruta.pasosIdeales : 0;
  if (veces >= 2) sumar(Math.min(15, Math.round(5 * (veces - 1))), "veces", { n: Math.round(veces) });
  const sinEfecto = cuenta(intento, "no_effect");
  const atras = cuenta(intento, "went_back");
  if (sinEfecto) sumar(Math.min(9, 3 * sinEfecto), "sinEfecto", { n: sinEfecto });
  if (atras) sumar(Math.min(9, 3 * atras), "atras");
  motivos.sort((a, b) => b.peso - a.peso);
  return { valor: motivos.reduce((suma, motivo) => suma + motivo.peso, 0), motivos };
}

const claveDeMotivo = (motivo) => `${motivo.clave}:${motivo.pagina ?? ""}:${motivo.n ?? ""}`;

/**
 * @typedef {Object} Grupo
 * @property {number} valor
 * @property {Motivo[]} motivos         nunca vacío: sin motivos, «siguió la ruta» o «sin novedades»
 * @property {object[]} intentos        los intentos idénticos, el representante primero
 * @property {number} n
 * @property {string} representante     id del primer intento
 * @property {string} resultado
 */

/**
 * @param {object[]} intentos         los de la tanda (GET /api/tandas/<id>)
 * @param {{ paginas: string[], pasosIdeales?: number } | null} ruta   tanda.telarana.ruta
 * @returns {Grupo[]}
 */
export function priorizar(intentos = [], ruta = null) {
  const separanEn = contar(intentos.map((intento) => intento.seSepara?.pagina).filter(Boolean));
  const caminos = contar(intentos.map(firmaDeCamino));
  const grupos = new Map();
  for (const intento of intentos) {
    const p = puntaje(intento, { ruta, separanEn, caminos });
    const clave = [intento.resultado, firmaDeCamino(intento), ...p.motivos.map(claveDeMotivo)].join("|");
    if (!grupos.has(clave)) grupos.set(clave, { ...p, intentos: [] });
    grupos.get(clave).intentos.push(intento);
  }
  return [...grupos.values()]
    .map((grupo) => {
      const [primero] = grupo.intentos;
      const motivos = grupo.motivos.length ? grupo.motivos : [{ clave: primero.logro === "directo" ? "siguioRuta" : "sinNovedades", peso: 0 }];
      return { ...grupo, motivos, n: grupo.intentos.length, representante: primero.id, resultado: primero.resultado };
    })
    .sort(
      (a, b) =>
        b.valor - a.valor ||
        (ORDEN[a.resultado] ?? 9) - (ORDEN[b.resultado] ?? 9) ||
        (b.intentos[0].pasos?.length ?? 0) - (a.intentos[0].pasos?.length ?? 0) ||
        (a.representante < b.representante ? -1 : 1),
    );
}

/** El grupo que contiene el intento `id`, o null. */
export const grupoDe = (grupos, id) => grupos.find((grupo) => grupo.intentos.some((intento) => intento.id === id)) ?? null;

/**
 * Un motivo en palabras: t("comun.traza.motivo.<clave>", { pagina: «nombre», n }).
 * @param {Motivo} motivo
 * @param {{ t: Function, nombre: (id: string) => string }} ayudas
 */
export function motivoATexto(motivo, { t, nombre }) {
  const pagina = motivo.pagina ? `«${nombre(motivo.pagina)}»` : t("comun.traza.elInicio");
  return t(`comun.traza.motivo.${motivo.clave}`, { pagina, n: motivo.n ?? 0 });
}
