import { createServer } from "node:http";
import { temaParaUrl } from "./temas.js";
import { crearRevisiones } from "./revisiones.js";
import { normalizarUrl } from "./urls.js";

const PUERTO = Number(process.env.PORT) || 4747;

function responderJson(res, estado, datos) {
  res.writeHead(estado, { "Content-Type": "application/json" });
  res.end(JSON.stringify(datos));
}

async function leerJson(req) {
  let cuerpo = "";
  for await (const trozo of req) cuerpo += trozo;
  return cuerpo ? JSON.parse(cuerpo) : {};
}

// POST /temas/buscar  { "url": "https://www.youtube.com" }
// La extensión lo llama en cada página para saber si debe aplicar un tema.
//   200 { success: true,  tema: "youtube" }  → la extensión aplica ese tema
//   404 { success: false, error: "..." }     → el sitio no tiene tema
//   400 { success: false, error: "..." }     → request inválida
async function buscarTema(req, res) {
  let url;
  try {
    ({ url } = await leerJson(req));
    if (typeof url !== "string") throw new Error();
    new URL(url); // valida
  } catch {
    return responderJson(res, 400, { success: false, error: 'Se espera { "url": "<url válida>" }' });
  }

  const tema = temaParaUrl(url);
  console.log(`${tema ? "✔" : "✖"} ${url}${tema ? ` → tema "${tema}"` : ""}`);

  if (!tema) return responderJson(res, 404, { success: false, error: `Sin tema para ${url}` });
  responderJson(res, 200, { success: true, tema });
}

// Sin tabla configurada (en local) no hay revisiones.
let servicio;
function revisiones() {
  if (!process.env.REVISIONES_TABLA) return null;
  servicio ??= (async () => {
    const { almacenS3, runtimeAgentes, tablaDynamo } = await import("./aws.js");
    return crearRevisiones({
      db: await tablaDynamo(process.env.REVISIONES_TABLA),
      almacen: await almacenS3(process.env.ALMACEN_BUCKET),
      agentes: await runtimeAgentes(process.env.AGENTE_RUNTIME),
    });
  })().catch((error) => {
    servicio = undefined;
    throw error;
  });
  return servicio;
}

// POST /revisiones  { "url": "<url completa>", "force"?: true }  (force: revisión nueva aunque ya se haya visto)
// GET  /revisiones?url=<url>
//   202 { success: true, revision, status: "queued" }       → página nueva, revisión disparada
//   200 { success: true, revision, status, css? }           → ya vista; css cuando status es "done"
//   404 { success: false }                                  → GET de una página no vista
//   400 { success: false, error: "..." }                    → request inválida
async function atenderRevisiones(req, res, consulta) {
  const pendiente = revisiones();
  if (!pendiente) return responderJson(res, 404, { success: false });

  let url;
  let force = false;
  try {
    if (req.method === "POST") ({ url, force } = await leerJson(req));
    else url = consulta.get("url");
    if (typeof url !== "string") throw new Error();
    normalizarUrl(url); // valida
  } catch {
    return responderJson(res, 400, { success: false, error: 'Se espera { "url": "<url http(s) válida>" }' });
  }

  try {
    const servicio = await pendiente;
    const { estado, datos } =
      req.method === "POST" ? await servicio.solicitar(url, { force: force === true }) : await servicio.consultar(url);
    responderJson(res, estado, datos);
  } catch (error) {
    console.error(`✖ /revisiones ${url}`, error);
    responderJson(res, 500, { success: false, error: "Error interno" });
  }
}

const servidor = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://localhost");

  if (req.method === "GET" && pathname === "/") {
    return responderJson(res, 200, { mensaje: "Hola mundo" });
  }

  if (req.method === "POST" && pathname === "/temas/buscar") {
    return buscarTema(req, res);
  }

  if ((req.method === "POST" || req.method === "GET") && pathname === "/revisiones") {
    return atenderRevisiones(req, res, searchParams);
  }

  responderJson(res, 404, { error: "No encontrado" });
});

servidor.listen(PUERTO, () => {
  console.log(`API escuchando en http://localhost:${PUERTO}`);
});
