// Backoffice: visor de solo lectura de las corridas del Visitante (.specs/backoffice-v0.md).
// Sirve la página de public/ y una API que lee las corridas a través de una fuente (lib/fuente.js;
// por defecto, la carpeta agents/.runs/). No gatilla nada ni llama a Claude.
//
// La raíz es una portada pública ("work in progress", de portada/) que no enlaza al backoffice: el backoffice
// entero (página, API y archivos) vive bajo /backoffice/.
//
//   GET /                                 → la portada; GET /<archivo>.{html,css,svg} → archivos de portada/
//   GET /backoffice                       → 301 a /backoffice/ (la página pide lo suyo con rutas relativas)
//   GET /backoffice/                      → la página del backoffice (public/index.html)
//   GET /backoffice/api/tandas            → { carpeta, tandas: resumen de cada tanda, de la más nueva a la más vieja }
//   GET /backoffice/api/tandas/<host>/visitor/<objetivo>/<corrida>  → la tanda completa, ya derivada para las pantallas
//   GET /backoffice/archivos/<host>/visitor/<objetivo>/<corrida>/<perfil>/<step_NN.png | video.webm>
//   GET /backoffice/api/revisiones        → { disponible, revisiones } (DynamoDB; solo con BACKOFFICE_FUENTE=s3)
//   GET /backoffice/api/revisiones/<revision>  → el avance de una revisión por etapa y por goal
//   GET /backoffice/resultados/<corrida>/<manifest.json | goals.json | route.json | tema.css>
//   GET /backoffice/api/propuestas/<host>/visitor/<objetivo>/<corrida>  → la propuesta del Diseñador para esa tanda
//   GET /backoffice/propuestas/<host>/improver/<corrida>/vistas/<nombre>.png  → una captura antes/después del tema
//   GET /backoffice/<ruta>.{html,js,css,svg,woff2}  → archivos de public/
//   GET /salud                            → { ok: true }, con cualquier Host (el health check del balanceador)
//
// Solo responde a pedidos dirigidos a este computador (Host localhost, 127.0.0.1 o [::1] con el puerto del
// servidor): así una página ajena no puede leer las corridas apuntando su dominio a 127.0.0.1 (DNS rebinding).
// BACKOFFICE_HOSTS="otro.host:8080,…" agrega hosts permitidos (en AWS, el dominio: infra/app/backoffice.tf).
// Escucha en 127.0.0.1; BACKOFFICE_ESCUCHA="0.0.0.0" lo abre a la red (en el contenedor).

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { crearFuente } from "./lib/fuente.js";
import { ARCHIVO_DE_VISTA, crearPropuestas } from "./lib/propuestas.js";
import { crearRevisiones, partesDeResultado } from "./lib/revisiones.js";
import { abrirArchivoDeIntento, idsDeTandas, leerTanda, listarTandas } from "./lib/tandas.js";
import { partesDeCorrida, partesDeTanda } from "./public/nucleo/almacen.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, "public");
const PORTADA = path.join(AQUI, "portada");
// El backoffice cuelga de /<PREFIJO>/; todo lo demás es la portada.
const PREFIJO = "/backoffice";
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};
// Un tema de un resultado se muestra como texto: no es una hoja de estilos de esta página.
const TIPOS_DE_RESULTADO = { ".css": "text/plain; charset=utf-8" };
// Lo que se sirve de public/: cualquier archivo con estas extensiones, en minúsculas, a cualquier profundidad.
const RUTA_PUBLICA = /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:html|js|css|svg|woff2)$/;
// De portada/ solo se sirven archivos sueltos, sin subcarpetas.
const RUTA_DE_PORTADA = /^[a-z0-9-]+\.(?:html|css|svg)$/;

// Las capturas muestran páginas de terceros y a veces datos de quien corrió la prueba: la página
// solo carga lo propio (más las fuentes de Google) y nada de lo leído de una corrida se ejecuta.
const CABECERAS_DE_SEGURIDAD = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
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
async function enviar(req, res, nombre, { cuerpo, tamano, rango }, tipo = tipoDe(nombre)) {
  const cabeceras = { "Content-Type": tipo, "Cache-Control": "no-store", "Accept-Ranges": "bytes", ...CABECERAS_DE_SEGURIDAD };
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

// La portada de la raíz: index.html y los archivos que pide, nada más.
function servirPortada(req, res, partes) {
  const archivo = partes.length === 0 ? "index.html" : partes.length === 1 ? partes[0] : "";
  const ruta = path.join(PORTADA, archivo);
  if (RUTA_DE_PORTADA.test(archivo) && existsSync(ruta)) return servirPublico(req, res, ruta);
  return responderJson(res, 404, { error: "No encontrado" });
}

const NOMBRES_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * true si la cabecera Host apunta a este computador en `puerto` (o es uno de `extra`, en minúsculas).
 * @param {string | undefined} host
 * @param {number} puerto
 * @param {Set<string>} [extra]
 */
export function hostPermitido(host, puerto, extra = new Set()) {
  const texto = String(host ?? "").trim().toLowerCase();
  if (!texto) return false;
  if (extra.has(texto)) return true;
  const partes = /^(\[[0-9a-f:.]+\]|[^:]+)(?::(\d+))?$/.exec(texto);
  if (!partes || !NOMBRES_LOCALES.has(partes[1])) return false;
  return partes[2] === undefined ? puerto === 80 : Number(partes[2]) === puerto;
}

const hostsDelEntorno = () =>
  new Set(String(process.env.BACKOFFICE_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));

/**
 * @param {{ fuente?: import("./lib/fuente.js").Fuente, raizCorridas?: string, hostsPermitidos?: string[],
 *           revisiones?: ReturnType<typeof crearRevisiones> | null }} opciones
 *        `fuente` de donde leer las corridas; o `raizCorridas`, una carpeta (fuente de archivos).
 *        `hostsPermitidos`: hosts extra ("otro.host:8080") además de localhost; por defecto, BACKOFFICE_HOSTS.
 *        `revisiones`: la tabla de revisiones (lib/revisiones.js); sin ella, /api/revisiones dice que no está disponible.
 */
export function crearServidor({ fuente, raizCorridas, hostsPermitidos, revisiones = null } = {}) {
  const origen = fuente ?? crearFuente({ tipo: "archivos", raiz: raizCorridas });
  const extra = hostsPermitidos ? new Set(hostsPermitidos.map((host) => host.toLowerCase())) : hostsDelEntorno();
  const propuestas = crearPropuestas(origen);
  return createServer(async (req, res) => {
    try {
      // El balanceador revisa la tarea con su IP privada como Host: esta ruta no pasa por el chequeo y no lee nada.
      if (req.url === "/salud" && (req.method === "GET" || req.method === "HEAD")) {
        return responderJson(res, 200, { ok: true });
      }
      if (!hostPermitido(req.headers.host, req.socket.localPort, extra)) {
        return responderJson(res, 403, { error: "Host no permitido" });
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        return responderJson(res, 405, { error: "Solo lectura" });
      }
      const { pathname, search } = new URL(req.url, "http://localhost");
      // Sin la barra final, las rutas relativas de la página (app.js, api/…) apuntarían a la raíz.
      if (pathname === PREFIJO) {
        res.writeHead(301, { Location: `${PREFIJO}/${search}`, "Cache-Control": "no-store", ...CABECERAS_DE_SEGURIDAD });
        return res.end();
      }
      const enBackoffice = pathname.startsWith(`${PREFIJO}/`);
      let partes;
      try {
        partes = (enBackoffice ? pathname.slice(PREFIJO.length) : pathname).split("/").filter(Boolean).map(decodeURIComponent);
      } catch {
        return responderJson(res, 400, { error: "Ruta inválida" });
      }
      if (!enBackoffice) return servirPortada(req, res, partes);

      if (partes[0] === "api" && partes[1] === "tandas") {
        if (partes.length === 2) return responderJson(res, 200, await listarTandas(origen));
        const tanda = await leerTanda(origen, partes.slice(2).join("/"));
        return tanda ? responderJson(res, 200, tanda) : responderJson(res, 404, { error: "No existe esa tanda" });
      }

      if (partes[0] === "api" && partes[1] === "revisiones" && partes.length <= 3) {
        if (partes.length === 2) {
          return responderJson(res, 200, revisiones ? { disponible: true, revisiones: await revisiones.listar() } : { disponible: false, revisiones: [] });
        }
        const avance = revisiones ? await revisiones.leer(partes[2]) : null;
        return avance ? responderJson(res, 200, avance) : responderJson(res, 404, { error: "No existe esa revisión" });
      }

      if (partes[0] === "api" && partes[1] === "propuestas") {
        const id = partes.slice(2).join("/");
        if (!partesDeTanda(id) || !(await idsDeTandas(origen)).includes(id)) return responderJson(res, 404, { error: "No existe esa tanda" });
        return responderJson(res, 200, await propuestas.deTanda(id));
      }

      if (partes[0] === "propuestas") {
        const runKey = partes.slice(1, 4).join("/");
        const relativa = partes.slice(4).join("/");
        const valida = partesDeCorrida(runKey)?.agente === "improver" && ARCHIVO_DE_VISTA.test(relativa);
        const abierto = valida ? await origen.abrirArchivo(runKey, relativa, leerRango(req.headers.range) ?? undefined) : null;
        return abierto ? enviar(req, res, relativa, abierto) : responderJson(res, 404, { error: "No existe esa captura" });
      }

      if (partes[0] === "resultados") {
        const resultado = partesDeResultado(partes.slice(1).join("/"));
        const abierto = resultado ? await origen.abrirArchivo(resultado.runKey, resultado.archivo) : null;
        if (!abierto) return responderJson(res, 404, { error: "No existe ese resultado" });
        const archivo = resultado.archivo;
        return enviar(req, res, archivo, abierto, TIPOS_DE_RESULTADO[path.extname(archivo)] ?? tipoDe(archivo));
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
  const escucha = process.env.BACKOFFICE_ESCUCHA || "127.0.0.1";
  const tipo = process.env.BACKOFFICE_FUENTE ?? "archivos";
  const aws = tipo === "s3" ? await (await import("./lib/aws.js")).conectarAws() : null;
  const fuente = crearFuente({
    tipo,
    raiz: path.resolve(process.env.BACKOFFICE_CORRIDAS ?? path.join(AQUI, "..", "agents", ".runs")),
    almacen: process.env.BACKOFFICE_ALMACEN,
    s3: aws?.s3,
  });
  const revisiones = aws ? crearRevisiones({ tabla: process.env.BACKOFFICE_TABLA || "chameleon-revisiones", ...aws.dynamo, fuente }) : null;
  // Por defecto, solo en este computador: las corridas pueden mostrar datos de quien corrió la prueba.
  const servidor = crearServidor({ fuente, revisiones });
  servidor.on("error", (error) => {
    if (error.code !== "EADDRINUSE") throw error;
    console.error(
      `✘ El puerto ${puerto} ya está ocupado: probablemente el backoffice ya está corriendo en http://localhost:${puerto}${PREFIJO}/.\n` +
        `  Ábrelo ahí, mira qué proceso lo usa con: lsof -nP -iTCP:${puerto} -sTCP:LISTEN, o usa otro puerto con PORT=4849.`,
    );
    process.exit(1);
  });
  servidor.listen(puerto, escucha, () => {
    const conRevisiones = revisiones ? ` · revisiones de ${revisiones.descripcion} (${aws.region})` : "";
    const abierto = escucha === "127.0.0.1" ? "" : ` · escucha en ${escucha}:${puerto}`;
    console.log(`Backoffice en http://localhost:${puerto}${PREFIJO}/${abierto} · corridas de ${fuente.descripcion}${conRevisiones}`);
  });
}
