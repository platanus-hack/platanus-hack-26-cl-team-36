// Entrada de la API en AWS Lambda (ver infra/app/).
//
// Importar index.js levanta el mismo servidor que en local, dentro de la Lambda.
// Cada evento de la function URL se reenvía a ese servidor por localhost y su
// respuesta se devuelve tal cual, así index.js no sabe que corre en Lambda.

import { request } from "node:http";
import "./index.js";

const PUERTO = Number(process.env.PORT) || 4747;

// Cabeceras de la conexión entre cliente y servidor: no se reenvían.
const POR_CONEXION = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "host",
  "upgrade",
]);

function sinCabecerasDeConexion(cabeceras) {
  return Object.fromEntries(Object.entries(cabeceras).filter(([nombre]) => !POR_CONEXION.has(nombre)));
}

// Una conexión nueva por request (agent: false): si se reusara, la Lambda puede
// congelarse con la conexión abierta y al volver el servidor ya la cerró.
function enviar(opciones, cuerpo) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PUERTO, agent: false, ...opciones }, (res) => {
      const trozos = [];
      res.on("data", (trozo) => trozos.push(trozo));
      res.on("end", () => resolve({ estado: res.statusCode, cabeceras: res.headers, cuerpo: Buffer.concat(trozos) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(cuerpo);
  });
}

// En un arranque en frío el servidor puede no estar escuchando todavía.
async function enviarCuandoEscuche(opciones, cuerpo, intentos = 40) {
  try {
    return await enviar(opciones, cuerpo);
  } catch (error) {
    if (error.code !== "ECONNREFUSED" || intentos <= 1) throw error;
    await new Promise((listo) => setTimeout(listo, 25));
    return enviarCuandoEscuche(opciones, cuerpo, intentos - 1);
  }
}

// Evento y respuesta: formato 2.0 de las function URLs de Lambda.
export async function handler(evento) {
  const cabeceras = sinCabecerasDeConexion(evento.headers ?? {});
  if (evento.cookies?.length) cabeceras.cookie = evento.cookies.join("; ");

  const cuerpo = evento.body ? Buffer.from(evento.body, evento.isBase64Encoded ? "base64" : "utf8") : undefined;
  const consulta = evento.rawQueryString ? `?${evento.rawQueryString}` : "";

  const respuesta = await enviarCuandoEscuche(
    { method: evento.requestContext.http.method, path: `${evento.rawPath}${consulta}`, headers: cabeceras },
    cuerpo,
  );

  const { "set-cookie": cookies, ...resto } = sinCabecerasDeConexion(respuesta.cabeceras);
  return {
    statusCode: respuesta.estado,
    headers: Object.fromEntries(Object.entries(resto).map(([nombre, valor]) => [nombre, [].concat(valor).join(", ")])),
    cookies,
    body: respuesta.cuerpo.toString("base64"),
    isBase64Encoded: true,
  };
}
