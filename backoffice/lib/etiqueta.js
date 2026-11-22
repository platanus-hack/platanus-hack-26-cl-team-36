// JSON con ETag (hash del cuerpo): con un If-None-Match que la nombra responde 304 sin cuerpo.

import { createHash } from "node:crypto";

export const etiquetaDe = (cuerpo) => `"${createHash("sha1").update(cuerpo).digest("base64url")}"`;

/** ¿El If-None-Match (una o varias, débiles o no) nombra la etiqueta? */
export function coincide(cabecera, etiqueta) {
  return String(cabecera ?? "")
    .split(",")
    .some((valor) => valor.trim().replace(/^W\//, "") === etiqueta);
}

export function responderJsonConEtiqueta(req, res, datos, cabeceras = {}) {
  const cuerpo = JSON.stringify(datos);
  const etiqueta = etiquetaDe(cuerpo);
  const comunes = { ETag: etiqueta, "Cache-Control": "no-store", ...cabeceras };
  if (coincide(req.headers["if-none-match"], etiqueta)) {
    res.writeHead(304, comunes);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...comunes });
  res.end(cuerpo);
}
