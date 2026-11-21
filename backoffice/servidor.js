// Backoffice: visor de solo lectura de las corridas del evaluador (.specs/backoffice-v0.md).
// Sirve la página de public/ y una API que lee las corridas a través de una fuente (lib/fuente.js;
// por defecto, la carpeta agents/.runs/). No gatilla nada ni llama a Claude.
//
//   GET /api/tandas                       → { carpeta, tandas: resumen de cada tanda, de la más nueva a la más vieja }
//   GET /api/tandas/<tarea>/<fecha-hora>  → la tanda completa, ya derivada para las pantallas
//   GET /archivos/<tarea>/<fecha-hora>/<perfil>/<step_NN.png | video.webm>
//   GET /<ruta>.{html,js,css,svg,woff2}   → archivos de public/

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { crearFuente } from "./lib/fuente.js";
import { abrirArchivoDeIntento, leerTanda, listarTandas } from "./lib/tandas.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, "public");
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
};
// Lo que se sirve de public/: cualquier archivo con estas extensiones, en minúsculas, a cualquier profundidad.
const RUTA_PUBLICA = /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:html|js|css|svg|woff2)$/;

// Las capturas muestran páginas de terceros y a veces datos de quien corrió la prueba: la página
// solo carga lo propio (más las fuentes de Google) y nada de lo leído de una corrida se ejecuta.
const CABECERAS_DE_SEGURIDAD = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function responder(res, estado, tipo, cuerpo) {
  res.writeHead(estado, { "Content-Type": tipo, "Cache-Control": "no-store", ...CABECERAS_DE_SEGURIDAD });
  res.end(cuerpo);
}

const responderJson = (res, estado, datos) =>
  responder(res, estado, "application/json; charset=utf-8", JSON.stringify(datos));

// Lee la cabecera Range ("bytes=0-99", "bytes=100-", "bytes=-500"); null si no hay o no se entiende.
export function leerRango(cabecera) {
  const partes = /^bytes=(\d*)-(\d*)$/.exec(String(cabecera ?? "").trim());
  if (!partes || (!partes[1] && !partes[2])) return null;
  return {
    ...(partes[1] ? { inicio: Number(partes[1]) } : {}),
    ...(partes[2] ? { fin: Number(partes[2]) } : {}),
  };
}

const tipoDe = (nombre) => TIPOS[path.extname(nombre)] ?? "application/octet-stream";

// Envía un archivo abierto (de una fuente o de public/), con 206 si se pidió un rango.
async function enviar(req, res, nombre, { cuerpo, tamano, rango }) {
  const cabeceras = { "Content-Type": tipoDe(nombre), "Cache-Control": "no-store", "Accept-Ranges": "bytes", ...CABECERAS_DE_SEGURIDAD };
  if (!cuerpo) {
    res.writeHead(416, { ...CABECERAS_DE_SEGURIDAD, "Content-Range": `bytes */${tamano}` });
    return res.end();
  }
  if (rango) {
    res.writeHead(206, { ...cabeceras, "Content-Range": `bytes ${rango.inicio}-${rango.fin}/${tamano}`, "Content-Length": rango.fin - rango.inicio + 1 });
  } else {
    res.writeHead(200, { ...cabeceras, "Content-Length": tamano });
  }
  if (req.method === "HEAD") {
    cuerpo.destroy();
    return res.end();
  }
  try {
    await pipeline(cuerpo, res);
  } catch {
    // El navegador cortó la descarga (por ejemplo, al saltar en un video): no es un error del servidor.
  }
}

async function servirPublico(req, res, ruta) {
  const info = await stat(ruta);
  if (!info.isFile()) return responderJson(res, 404, { error: "No encontrado" });
  const size = info.size;
  return enviar(req, res, ruta, { cuerpo: createReadStream(ruta), tamano: size, rango: null });
}

/**
 * @param {{ fuente?: import("./lib/fuente.js").Fuente, raizCorridas?: string }} opciones
 *        `fuente` de donde leer las corridas; o `raizCorridas`, una carpeta (fuente de archivos).
 */
export function crearServidor({ fuente, raizCorridas } = {}) {
  const origen = fuente ?? crearFuente({ tipo: "archivos", raiz: raizCorridas });
  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return responderJson(res, 405, { error: "Solo lectura" });
      }
      const { pathname } = new URL(req.url, "http://localhost");
      let partes;
      try {
        partes = pathname.split("/").filter(Boolean).map(decodeURIComponent);
      } catch {
        return responderJson(res, 400, { error: "Ruta inválida" });
      }

      if (partes[0] === "api" && partes[1] === "tandas") {
        if (partes.length === 2) return responderJson(res, 200, await listarTandas(origen));
        const tanda = await leerTanda(origen, partes.slice(2).join("/"));
        return tanda ? responderJson(res, 200, tanda) : responderJson(res, 404, { error: "No existe esa tanda" });
      }

      if (partes[0] === "archivos" && partes.length >= 4) {
        const archivo = partes.at(-1);
        const abierto = await abrirArchivoDeIntento(origen, {
          id: partes.slice(1, -2).join("/"),
          perfil: partes.at(-2),
          archivo,
          rango: leerRango(req.headers.range) ?? undefined,
        });
        return abierto ? enviar(req, res, archivo, abierto) : responderJson(res, 404, { error: "No existe ese archivo" });
      }

      const relativa = partes.length === 0 ? "index.html" : partes.join("/");
      if (RUTA_PUBLICA.test(relativa)) {
        const ruta = path.join(PUBLICO, relativa);
        if (ruta.startsWith(PUBLICO + path.sep) && existsSync(ruta)) return servirPublico(req, res, ruta);
      }
      return responderJson(res, 404, { error: "No encontrado" });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) responderJson(res, 500, { error: "Error interno" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const puerto = Number(process.env.PORT) || 4848;
  const fuente = crearFuente({
    raiz: path.resolve(process.env.BACKOFFICE_CORRIDAS ?? path.join(AQUI, "..", "agents", ".runs")),
  });
  // Solo en este computador: las corridas pueden mostrar datos de quien corrió la prueba.
  const servidor = crearServidor({ fuente });
  servidor.on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(
      `✘ El puerto ${puerto} ya está ocupado: probablemente el backoffice ya está corriendo en http://localhost:${puerto}.\n` +
        `  Ábrelo ahí, mira qué proceso lo usa con: lsof -nP -iTCP:${puerto} -sTCP:LISTEN, o usa otro puerto con PORT=4849.`,
    );
    process.exit(1);
  });
  servidor.listen(puerto, "127.0.0.1", () => {
    console.log(`Backoffice en http://localhost:${puerto} · corridas de ${fuente.descripcion}`);
  });
}
