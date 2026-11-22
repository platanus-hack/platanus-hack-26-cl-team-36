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
