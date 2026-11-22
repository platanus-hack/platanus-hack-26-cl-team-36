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
//   GET /backoffice/api/tandas            → { carpeta, tandas: resumen de cada tanda, de la más nueva a la más
//                                           vieja }
//   GET /backoffice/api/tandas/<host>/visitor/<objetivo>/<corrida>  → la tanda completa, ya derivada para las pantallas
//   GET /backoffice/archivos/<host>/visitor/<objetivo>/<corrida>/<perfil>/<step_NN.png | video.webm>
//   GET /backoffice/api/revisiones        → { disponible, revisiones, historial }: la vigente de cada página y las que
//                                           reemplazó (DynamoDB; solo con BACKOFFICE_FUENTE=s3)
//   GET /backoffice/api/revisiones/<revision>  → el avance de una revisión por etapa y por goal
//   GET /backoffice/api/resumen           → { ahora, roles }: las corridas de los cuatro agentes por rol y estado, y los
//                                           visitantes por dispositivo (lib/panel.js; contrato del Overview v3, §1)
//   GET /backoffice/api/overview[?pestana=<recent|live|delivered|failed>&pagina=<n>&link=<texto>]
//                                         → { ahora, disponible, umbralDetenidaMin, busqueda, cuentas, pestanas,
//                                           tarjetas }: las revisiones del Overview, cada tarjeta con todo lo que dibuja
//                                           (§2); una página de 6 ids por pestaña: la 1, o la `pagina` pedida en la
//                                           pestaña pedida (§7.4); con `link`, solo las revisiones cuyo link calza; sin
//                                           tabla, { ahora, disponible: false }
//   GET /backoffice/api/vivo/<revision>/<goal>  → los pasos de los agentes del goal en vivo (SSE, lib/transmision.js)
//   GET /backoffice/resultados/<corrida>/<manifest.json | goals.json | route.json | tema.css>
//   GET /backoffice/api/propuestas/<host>/visitor/<objetivo>/<corrida>  → la propuesta del Diseñador para esa tanda
//   GET /backoffice/propuestas/<host>/improver/<corrida>/vistas/<nombre>.png  → una captura antes/después del tema
//   GET /backoffice/<ruta>.{html,js,css,svg,woff2}  → archivos de public/ (también public/vendor/<lib>@<versión>/)
//   GET /backoffice/v/<versión>/<ruta>    → lo mismo; inmutable si es la versión actual (lib/estaticos.js)
//   GET /salud                            → { ok: true }, con cualquier Host (el health check del balanceador)
//
// Solo responde a pedidos dirigidos a este computador (Host localhost, 127.0.0.1 o [::1] con el puerto del
// servidor): así una página ajena no puede leer las corridas apuntando su dominio a 127.0.0.1 (DNS rebinding).
// BACKOFFICE_HOSTS="otro.host:8080,…" agrega hosts permitidos (en AWS, el dominio: infra/app/backoffice.tf).
// Escucha en 127.0.0.1; BACKOFFICE_ESCUCHA="0.0.0.0" lo abre a la red (en el contenedor).
//
// `ahora` de /api/resumen y /api/overview sale del reloj del servidor (`reloj` de crearServidor, por defecto la
// hora real): contra él se decide qué revisión está detenida, y la página calcula "12 min" y "5 h ago" contra ese
// valor, nunca contra su propio reloj. El servidor de los datos de prueba lo fija en el momento en que se generaron.
//
// Caché y compresión: JS, CSS, JSON, SVG y HTML van con brotli o gzip si el navegador los acepta (Vary:
// Accept-Encoding); nunca una respuesta con Range ni el SSE de /api/vivo. La página (index.html) y los archivos sin
// versión se revalidan con ETag (304); v/<versión>/ y vendor/<lib>@<x.y.z>/ no cambian nunca (inmutables).

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { coincide, etiquetaDe } from "./lib/etiqueta.js";
import {
  MINIMO_PARA_COMPRIMIR,
  PREFIJO_DE_VERSION,
  comprimir,
  crearEstaticos,
  cuerpoDe,
  elegirCodificacion,
  esComprimible,
  etagDe,
  sigueVigente,
} from "./lib/estaticos.js";
import { crearFuente } from "./lib/fuente.js";
import { RANCIO_MS, crearPanel } from "./lib/panel.js";
import { ARCHIVO_DE_VISTA, crearPropuestas } from "./lib/propuestas.js";
import { crearRevisiones, partesDeResultado } from "./lib/revisiones.js";
import { esArchivoDeIntento, leerTanda, listarTandas } from "./lib/tandas.js";
import { partesDeCorrida, partesDeTanda } from "./public/nucleo/almacen.js";
import { crearTransmisor } from "./lib/transmision.js";

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
// Lo que se sirve de public/: cualquier archivo con estas extensiones, en minúsculas, a cualquier profundidad; y las
// bibliotecas copiadas tal cual en public/vendor/<nombre>@<versión>/, con sus nombres de archivo.
const RUTA_PUBLICA =
  /^(?:(?:[a-z0-9-]+\/)*[a-z0-9-]+|vendor\/[a-z0-9-]+@\d+\.\d+\.\d+\/[a-z0-9-]+(?:\.[a-z0-9-]+)*)\.(?:html|js|css|svg|woff2)$/;
// De portada/ solo se sirven archivos sueltos, sin subcarpetas.
const RUTA_DE_PORTADA = /^[a-z0-9-]+\.(?:html|css|svg)$/;

// Las capturas muestran páginas de terceros y a veces datos de quien corrió la prueba: la página
// solo carga lo propio (más las fuentes de Google y, con S3, las capturas y videos firmados del bucket) y nada de lo
// leído de una corrida se ejecuta.
const cabecerasDeSeguridad = (descargas = "") => ({
  "Content-Security-Policy":
    `default-src 'self'; img-src 'self' data:${descargas && ` ${descargas}`}; media-src 'self'${descargas && ` ${descargas}`}; ` +
    "style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});
const CABECERAS_DE_SEGURIDAD = cabecerasDeSeguridad();

// La codificación para responder a `req` con `tipo`, o null: sin compresión si el tipo no lo vale o se pidió un rango.
function codificacionPara(req, tipo) {
  if (!esComprimible(tipo) || req?.headers.range) return null;
  return elegirCodificacion(req?.headers["accept-encoding"]);
}

// Vary: Accept-Encoding en todo lo que podría ir comprimido, aunque esta vez no vaya (un caché no lo confunde).
const variaSegun = (tipo) => (esComprimible(tipo) ? { Vary: "Accept-Encoding" } : {});

async function responder(res, estado, tipo, cuerpo, extra = {}) {
  const datos = Buffer.from(cuerpo ?? "");
  const codificacion = datos.length >= MINIMO_PARA_COMPRIMIR ? codificacionPara(res.req, tipo) : null;
  const enviado = codificacion ? await comprimir(datos, codificacion) : datos;
  res.writeHead(estado, {
    "Content-Type": tipo,
    "Cache-Control": "no-store",
    ...variaSegun(tipo),
    ...(codificacion ? { "Content-Encoding": codificacion } : {}),
    "Content-Length": enviado.length,
    ...CABECERAS_DE_SEGURIDAD,
    ...extra,
  });
  res.end(enviado);
}

const responderJson = (res, estado, datos) =>
  responder(res, estado, "application/json; charset=utf-8", JSON.stringify(datos));

// JSON con ETag (lib/etiqueta.js): 304 si If-None-Match la nombra; si no, comprimido como cualquier JSON. La etiqueta
// es la del JSON sin comprimir, igual en cualquier codificación (no-store: nadie lo guarda, solo lo compara).
function responderJsonConEtiqueta(req, res, datos) {
  const cuerpo = JSON.stringify(datos);
  const etiqueta = etiquetaDe(cuerpo);
  if (coincide(req.headers["if-none-match"], etiqueta)) {
    res.writeHead(304, { ETag: etiqueta, "Cache-Control": "no-store", ...CABECERAS_DE_SEGURIDAD });
    return res.end();
  }
  return responder(res, 200, "application/json; charset=utf-8", cuerpo, { ETag: etiqueta });
}

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

// Una captura o un video de /archivos/ es de una tanda listada, o sea de una corrida que ya terminó: no cambia más, y
// el navegador la guarda en vez de volver a pedirla al cambiar de paso o de intento. `private`: solo ese navegador,
// ningún caché compartido (pueden mostrar datos de quien corrió la prueba). Todo lo demás, no-store.
const INMUTABLE = "private, max-age=31536000, immutable";
// La redirección a una URL firmada (lib/fuentes/s3.js) se guarda menos de lo que le queda de validez a la firma.
const REDIRECCION_INMUTABLE = "private, max-age=60";

// Una captura que la página lee con canvas (el color de marca del Overview, con crossorigin) sigue llegando por aquí:
// del bucket, sin CORS, quedaría inleíble.
const pideMismoOrigen = (req) => req.headers["sec-fetch-mode"] === "cors";

// Envía un archivo abierto (de una fuente o de public/), con 206 si se pidió un rango.
async function enviar(req, res, nombre, { cuerpo, tamano, rango }, { tipo = tipoDe(nombre), cache = "no-store", seguridad = CABECERAS_DE_SEGURIDAD } = {}) {
  const cabeceras = { "Content-Type": tipo, "Cache-Control": cache, "Accept-Ranges": "bytes", ...seguridad };
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

// Caché de lo estático: lo versionado no cambia nunca; lo demás se guarda pero se revalida siempre con su ETag.
const INMUTABLE_PUBLICO = "public, max-age=31536000, immutable";
const REVALIDAR = "no-cache";
// public/vendor/<lib>@<x.y.z>/: una biblioteca con su versión en la ruta.
const VENDOR = /^vendor\/[a-z0-9-]+@\d+\.\d+\.\d+\//;

/**
 * Envía un archivo estático en memoria (lib/estaticos.js): comprimido según Accept-Encoding, con su ETag y 304 si
 * If-None-Match lo nombra. Un Range se ignora (va el archivo entero, sin comprimir).
 * @param {import("./lib/estaticos.js").Estatico} archivo
 */
async function enviarEstatico(req, res, archivo, { tipo, cache, seguridad = CABECERAS_DE_SEGURIDAD }) {
  const codificacion = archivo.cuerpo.length >= MINIMO_PARA_COMPRIMIR ? codificacionPara(req, tipo) : null;
  const cabeceras = { "Cache-Control": cache, ETag: etagDe(archivo, codificacion), ...variaSegun(tipo), ...seguridad };
  if (sigueVigente(req.headers["if-none-match"], archivo, codificacion)) {
    res.writeHead(304, cabeceras);
    return res.end();
  }
  const cuerpo = await cuerpoDe(archivo, codificacion);
  res.writeHead(200, {
    "Content-Type": tipo,
    ...cabeceras,
    ...(codificacion ? { "Content-Encoding": codificacion } : {}),
    "Content-Length": cuerpo.length,
  });
  res.end(req.method === "HEAD" ? undefined : cuerpo);
}

const PUBLICOS = crearEstaticos(PUBLICO);
const DE_PORTADA = crearEstaticos(PORTADA);

async function servirEstatico(req, res, estaticos, ruta, cache, seguridad) {
  const archivo = await estaticos.leer(ruta);
  if (!archivo) return responderJson(res, 404, { error: "No encontrado" });
  return enviarEstatico(req, res, archivo, { tipo: tipoDe(ruta), cache, seguridad });
}

// La portada de la raíz: index.html y los archivos que pide, nada más.
function servirPortada(req, res, partes) {
  const archivo = partes.length === 0 ? "index.html" : partes.length === 1 ? partes[0] : "";
  const ruta = path.join(PORTADA, archivo);
  if (RUTA_DE_PORTADA.test(archivo) && existsSync(ruta)) return servirEstatico(req, res, DE_PORTADA, ruta, REVALIDAR);
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
 *           revisiones?: ReturnType<typeof crearRevisiones> | null, reloj?: () => Date }} opciones
 *        `fuente` de donde leer las corridas; o `raizCorridas`, una carpeta (fuente de archivos).
 *        `hostsPermitidos`: hosts extra ("otro.host:8080") además de localhost; por defecto, BACKOFFICE_HOSTS.
 *        `revisiones`: la tabla de revisiones (lib/revisiones.js); sin ella, /api/revisiones y /api/overview dicen que
 *        no está disponible y /api/resumen cuenta 0 en cola.
 *        `reloj`: la hora de referencia del Overview (`ahora`); por defecto, la real.
 *        `vivo`: opciones de lib/transmision.js (intervaloMs, latidoMs, tope).
 *        `publico`: otra carpeta en lugar de public/ (pruebas de versiones). `rancioMs`: lib/panel.js (RANCIO_MS).
 */
export function crearServidor({
  fuente,
  raizCorridas,
  hostsPermitidos,
  revisiones = null,
  reloj = () => new Date(),
  vivo = {},
  publico = null,
  rancioMs = RANCIO_MS,
} = {}) {
  const origen = fuente ?? crearFuente({ tipo: "archivos", raiz: raizCorridas });
  const panel = crearPanel({ fuente: origen, revisiones, reloj, rancioMs });
  const raizPublica = publico ?? PUBLICO;
  const estaticos = publico ? crearEstaticos(publico) : PUBLICOS;
  const transmitir = crearTransmisor({ revisiones, cabeceras: CABECERAS_DE_SEGURIDAD, ...vivo });
  const extra = hostsPermitidos ? new Set(hostsPermitidos.map((host) => host.toLowerCase())) : hostsDelEntorno();
  const propuestas = crearPropuestas(origen);
  const seguridad = cabecerasDeSeguridad(origen.origenDeDescargas);

  // Un archivo ya validado: con S3, un 302 a una URL firmada; si no, se envía desde la fuente. false si no existe.
  async function servirDeCorrida(req, res, clave, relativa, { tipo = tipoDe(relativa), cache = "no-store", redireccion = "no-store", redirigir = true, rango } = {}) {
    if (redirigir && origen.urlDeDescarga && !pideMismoOrigen(req)) {
      const url = await origen.urlDeDescarga(clave, relativa, { tipo, cache });
      // Vary: un pedido con crossorigin no reutiliza esta redirección guardada.
      res.writeHead(302, { Location: url, "Cache-Control": redireccion, Vary: "Sec-Fetch-Mode", ...CABECERAS_DE_SEGURIDAD });
      res.end();
      return true;
    }
    const abierto = await origen.abrirArchivo(clave, relativa, rango);
    if (!abierto) return false;
    await enviar(req, res, relativa, abierto, { tipo, cache });
    return true;
  }

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
          const lista = revisiones ? { disponible: true, ...(await revisiones.listar()) } : { disponible: false, revisiones: [], historial: [] };
          return responderJsonConEtiqueta(req, res, lista);
        }
        const avance = revisiones ? await revisiones.leer(partes[2]) : null;
        return avance ? responderJsonConEtiqueta(req, res, avance) : responderJson(res, 404, { error: "No existe esa revisión" });
      }

      if (partes[0] === "api" && partes[1] === "vivo" && partes.length === 4) {
        return transmitir(req, res, partes[2], partes[3], responderJson);
      }

      if (partes[0] === "api" && partes.length === 2 && partes[1] === "resumen") return responderJson(res, 200, await panel.resumen());
      if (partes[0] === "api" && partes.length === 2 && partes[1] === "overview") {
        const consulta = new URLSearchParams(search);
        return responderJson(res, 200, await panel.overview({ pestana: consulta.get("pestana"), pagina: consulta.get("pagina"), link: consulta.get("link") }));
      }

      if (partes[0] === "api" && partes[1] === "propuestas") {
        const id = partes.slice(2).join("/");
        if (!partesDeTanda(id) || !(await panel.esTandaListada(id))) return responderJson(res, 404, { error: "No existe esa tanda" });
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
        if (!resultado) return responderJson(res, 404, { error: "No existe ese resultado" });
        const { runKey, archivo } = resultado;
        const tipo = TIPOS_DE_RESULTADO[path.extname(archivo)] ?? tipoDe(archivo);
        if (!(await servirDeCorrida(req, res, runKey, archivo, { tipo }))) return responderJson(res, 404, { error: "No existe ese resultado" });
        return;
      }

      if (partes[0] === "archivos" && partes.length >= 4) {
        const pedido = { id: partes.slice(1, -2).join("/"), perfil: partes.at(-2), archivo: partes.at(-1) };
        // Solo de tandas listadas (esTandaListada: las ya vistas en la lista no se vuelven a listar; si el id no está,
        // se busca en una lista nueva).
        const servido =
          (await esArchivoDeIntento(origen, pedido, { esListada: panel.esTandaListada })) &&
          (await servirDeCorrida(req, res, pedido.id, `${pedido.perfil}/${pedido.archivo}`, {
            cache: INMUTABLE,
            redireccion: REDIRECCION_INMUTABLE,
            // El video se pide por rangos durante minutos: una firma podría vencer a mitad de camino.
            redirigir: pedido.archivo !== "video.webm",
            rango: leerRango(req.headers.range) ?? undefined,
          }));
        if (!servido) return responderJson(res, 404, { error: "No existe ese archivo" });
        return;
      }

      if (partes.length === 0 || (partes.length === 1 && partes[0] === "index.html")) {
        const { archivo } = await estaticos.pagina();
        if (archivo) return enviarEstatico(req, res, archivo, { tipo: TIPOS[".html"], cache: REVALIDAR, seguridad });
        return responderJson(res, 404, { error: "No encontrado" });
      }

      // v/<versión>/<ruta>: inmutable solo en la versión actual. Otra (una pestaña de antes de un despliegue, o el
      // ALB que reparte entre la tarea vieja y la nueva) recibe el archivo actual sin guardarse, no un 404.
      const versionada = partes[0] === PREFIJO_DE_VERSION && partes.length >= 3;
      const actual = versionada && partes[1] === (await estaticos.version());
      const relativa = (versionada ? partes.slice(2) : partes).join("/");
      if (RUTA_PUBLICA.test(relativa)) {
        const ruta = path.join(raizPublica, relativa);
        const cache = actual || VENDOR.test(relativa) ? INMUTABLE_PUBLICO : versionada ? "no-store" : REVALIDAR;
        if (ruta.startsWith(raizPublica + path.sep)) return servirEstatico(req, res, estaticos, ruta, cache, seguridad);
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
    // Lee y comprime public/ de una vez (unos segundos, por detrás): el primer pedido no espera el brotli de three.js.
    PUBLICOS.calentar((relativa) => tipoDe(relativa));
    const conRevisiones = revisiones ? ` · revisiones de ${revisiones.descripcion} (${aws.region})` : "";
    const abierto = escucha === "127.0.0.1" ? "" : ` · escucha en ${escucha}:${puerto}`;
    console.log(`Backoffice en http://localhost:${puerto}${PREFIJO}/${abierto} · corridas de ${fuente.descripcion}${conRevisiones}`);
  });
}
