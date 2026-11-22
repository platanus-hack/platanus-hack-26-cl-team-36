import { createServer } from "node:http";
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

// Sin tabla configurada (en local) no hay revisiones.
let servicio;
function revisiones() {
  if (!process.env.REVISIONES_TABLA) return null;
  servicio ??= (async () => {
    const { almacenS3, runtimeAgentes, tablaDynamo } = await import("./aws.js");
    return crearRevisiones({
      db: await tablaDynamo(process.env.REVISIONES_TABLA),
      almacen: await almacenS3(process.env.ALMACEN_BUCKET),
      agentes: runtimeAgentes(process.env.AGENTE_RUNTIME),
      ...(process.env.REVISIONES_EN_CURSO_MAX && { maxEnCurso: Number(process.env.REVISIONES_EN_CURSO_MAX) }),
    });
  })().catch((error) => {
    servicio = undefined;
    throw error;
  });
  return servicio;
}

// POST /revisiones  { "url": "<url completa>", "force"?: true }  (force: revisión nueva si la anterior terminó)
// GET  /revisiones?url=<url>
//   202 { success: true, revision, status: "queued" }       → página nueva o anterior failed/abandonada (>1 h), disparada
//   429 { success: false, error: "..." }                    → POST con REVISIONES_EN_CURSO_MAX (5) revisiones en curso
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

  if ((req.method === "POST" || req.method === "GET") && pathname === "/revisiones") {
    return atenderRevisiones(req, res, searchParams);
  }

  responderJson(res, 404, { error: "No encontrado" });
});

servidor.listen(PUERTO, () => {
  console.log(`API escuchando en http://localhost:${PUERTO}`);
});
