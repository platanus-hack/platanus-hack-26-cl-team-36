// Backoffice v0: visor de solo lectura de las corridas del evaluador (.specs/backoffice-v0.md).
// Sirve la página de public/ y una API que lee agents/.runs/. No gatilla nada ni llama a Claude.
//
//   GET /api/tandas                       → resumen de cada tanda, de la más nueva a la más vieja
//   GET /api/tandas/<tarea>/<fecha-hora>  → la tanda completa, ya derivada para las pantallas
//   GET /archivos/<tarea>/<fecha-hora>/<perfil>/<step_NN.png | video.webm>

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leerTanda, listarTandas, rutaDeArchivo } from "./lib/tandas.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, "public");
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webm": "video/webm",
};
const ARCHIVOS_PUBLICOS = new Set(["index.html", "app.js", "dom.js", "estilos.css", "telarana.js", "huella.js", "icono.svg"]);

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

async function servirArchivo(req, res, ruta) {
  const tipo = TIPOS[path.extname(ruta)] ?? "application/octet-stream";
  const { size } = await stat(ruta);
  const cabeceras = { "Content-Type": tipo, "Cache-Control": "no-store", "Accept-Ranges": "bytes", ...CABECERAS_DE_SEGURIDAD };
  // Los videos se piden por rangos para poder saltar al minuto de un paso.
  const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (rango && (rango[1] || rango[2])) {
    const inicio = rango[1] ? Number(rango[1]) : Math.max(0, size - Number(rango[2]));
    const fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), size - 1) : size - 1;
    if (inicio > fin || inicio >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...cabeceras, "Content-Range": `bytes ${inicio}-${fin}/${size}`, "Content-Length": fin - inicio + 1 });
    return createReadStream(ruta, { start: inicio, end: fin }).pipe(res);
  }
  res.writeHead(200, { ...cabeceras, "Content-Length": size });
  createReadStream(ruta).pipe(res);
}

export function crearServidor({ raizCorridas }) {
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
        if (partes.length === 2) return responderJson(res, 200, await listarTandas(raizCorridas));
        const tanda = await leerTanda(raizCorridas, partes.slice(2).join("/"));
        return tanda ? responderJson(res, 200, tanda) : responderJson(res, 404, { error: "No existe esa tanda" });
      }

      if (partes[0] === "archivos" && partes.length >= 4) {
        const archivo = partes.at(-1);
        const perfil = partes.at(-2);
        const id = partes.slice(1, -2).join("/");
        const ruta = await rutaDeArchivo(raizCorridas, id, perfil, archivo);
        return ruta ? servirArchivo(req, res, ruta) : responderJson(res, 404, { error: "No existe ese archivo" });
      }

      const nombre = partes.length === 0 ? "index.html" : partes.length === 1 ? partes[0] : null;
      if (nombre && ARCHIVOS_PUBLICOS.has(nombre)) return servirArchivo(req, res, path.join(PUBLICO, nombre));
      return responderJson(res, 404, { error: "No encontrado" });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) responderJson(res, 500, { error: "Error interno" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const puerto = Number(process.env.PORT) || 4848;
  const raizCorridas = path.resolve(
    process.env.BACKOFFICE_CORRIDAS ?? path.join(AQUI, "..", "agents", ".runs"),
  );
  // Solo en este computador: las corridas pueden mostrar datos de quien corrió la prueba.
  const servidor = crearServidor({ raizCorridas });
  servidor.on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(
      `✘ El puerto ${puerto} ya está ocupado: probablemente el backoffice ya está corriendo en http://localhost:${puerto}.\n` +
        `  Ábrelo ahí, mira qué proceso lo usa con: lsof -nP -iTCP:${puerto} -sTCP:LISTEN, o usa otro puerto con PORT=4849.`,
    );
    process.exit(1);
  });
  servidor.listen(puerto, "127.0.0.1", () => {
    console.log(`Backoffice en http://localhost:${puerto} · corridas de ${raizCorridas}`);
  });
}
