// Ítems de la tabla de revisiones y el orden de sus estados: una escritura solo
// avanza, porque los eventos de S3 llegan repetidos y desordenados.

export const ORDEN_META = { queued: 0, running: 1, done: 2, failed: 2 };
// `skipped`: el Visitante de un goal cuya Guía falló, que no va a correr.
export const ORDEN_ETAPA = { pending: 0, running: 1, succeeded: 2, failed: 2, skipped: 2 };

// Estados desde los que se puede pasar a `estado`.
export function previos(orden, estado) {
  return Object.keys(orden).filter((otro) => orden[otro] < orden[estado]);
}

export const claveUrl = (url) => ({ PK: `URL#${url}`, SK: "URL" });
export const claveRevision = (revision, SK = "META") => ({ PK: `REV#${revision}`, SK });
