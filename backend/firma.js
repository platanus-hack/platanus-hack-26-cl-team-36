// Firma SigV4 de una request, con node:crypto. Para AgentCore, cuyos clientes del SDK no
// vienen garantizados en el runtime de Lambda.

import { createHash, createHmac } from "node:crypto";

const sha256 = (datos) => createHash("sha256").update(datos).digest("hex");
const hmac = (llave, datos) => createHmac("sha256", llave).update(datos).digest();
const escapar = (texto) =>
  encodeURIComponent(texto).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Cabeceras firmadas para `url`; el path ya viene codificado y se vuelve a codificar (todo servicio salvo S3).
export function firmar({ metodo, url, cabeceras = {}, cuerpo = "", region, servicio, credenciales, fecha = new Date() }) {
  const { host, pathname, searchParams } = new URL(url);
  const amzDate = fecha.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const dia = amzDate.slice(0, 8);
  const todas = {
    ...Object.fromEntries(Object.entries(cabeceras).map(([nombre, valor]) => [nombre.toLowerCase(), String(valor).trim()])),
    host,
    "x-amz-date": amzDate,
    ...(credenciales.sessionToken && { "x-amz-security-token": credenciales.sessionToken }),
  };
  const nombres = Object.keys(todas).sort();
  const firmadas = nombres.join(";");
  const consulta = [...searchParams]
    .map(([k, v]) => `${escapar(k)}=${escapar(v)}`)
    .sort()
    .join("&");
  const canonica = [
    metodo,
    pathname.split("/").map(escapar).join("/"),
    consulta,
    nombres.map((nombre) => `${nombre}:${todas[nombre]}\n`).join(""),
    firmadas,
    sha256(cuerpo),
  ].join("\n");

  const alcance = `${dia}/${region}/${servicio}/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", amzDate, alcance, sha256(canonica)].join("\n");
  const llave = [dia, region, servicio, "aws4_request"].reduce(hmac, `AWS4${credenciales.secretAccessKey}`);
  const firma = createHmac("sha256", llave).update(aFirmar).digest("hex");

  const { host: _, ...resto } = todas;
  return {
    ...resto,
    authorization: `AWS4-HMAC-SHA256 Credential=${credenciales.accessKeyId}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}`,
  };
}

// Lambda entrega las credenciales de su rol en variables de entorno.
export const credencialesDelEntorno = (env = process.env) => ({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  sessionToken: env.AWS_SESSION_TOKEN,
});
