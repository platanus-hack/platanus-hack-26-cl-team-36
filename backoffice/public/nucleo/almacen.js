// Layout de las corridas del Visitante en el almacén de los agentes. La definición está en
// agents/shared/src/shared/store/keys.py; aquí se repite solo lo que el backoffice necesita para leerlas.

export const AGENTE = "visitor";
const ETIQUETA = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
export const HOST = new RegExp(`^${ETIQUETA}(?:\\.${ETIQUETA})*(?::[1-9]\\d{0,4})?$`);
export const OBJETIVO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CORRIDA = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:_(?:0[1-9]|[1-9]\d))?$/;
export const MANIFIESTO = "manifest.json";

/** "<host>/visitor/<objetivo>/<corrida>" */
export const idDeTanda = (host, objetivo, corrida) => `${host}/${AGENTE}/${objetivo}/${corrida}`;

/** Las partes de un id de tanda, o null si el id no sigue el layout. */
export function partesDeTanda(id) {
  const [host, agente, objetivo, corrida, ...resto] = String(id).split("/");
  const valido = resto.length === 0 && agente === AGENTE && HOST.test(host ?? "") && OBJETIVO.test(objetivo ?? "")
    && CORRIDA.test(corrida ?? "");
  return valido ? { host, objetivo, corrida } : null;
}

export const REVISION = /^(?=.{1,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Segmentos entre el agente y la corrida. improver y conductor son las etapas del flujo por revisión en AWS.
const PROFUNDIDAD = { cataloger: 0, improver: 0, conductor: 0, summary: 0, visitor: 1, guide: 2 };
const VIEWPORT = /^(?:desktop|mobile)$/;

/** Las partes de la clave de una corrida de cualquier agente ("wom.cl/guide/baja-fibra/desktop/<corrida>"), o null. */
export function partesDeCorrida(clave) {
  const [host, agente, ...resto] = String(clave).split("/");
  const profundidad = Object.hasOwn(PROFUNDIDAD, agente ?? "") ? PROFUNDIDAD[agente] : -1;
  if (profundidad < 0 || resto.length !== profundidad + 1 || !HOST.test(host ?? "")) return null;
  const corrida = resto.at(-1);
  const objetivo = profundidad >= 1 ? resto[0] : null;
  if (!CORRIDA.test(corrida) || (objetivo !== null && !OBJETIVO.test(objetivo))) return null;
  if (profundidad === 2 && !VIEWPORT.test(resto[1])) return null;
  return { host, agente, objetivo, corrida };
}
