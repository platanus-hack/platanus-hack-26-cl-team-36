import { createServer } from "node:http";
import { temaParaUrl } from "./temas.js";

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

const servidor = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    return responderJson(res, 200, { mensaje: "Hola mundo" });
  }

  if (req.method === "POST" && req.url === "/temas/buscar") {
    return buscarTema(req, res);
  }

  responderJson(res, 404, { error: "No encontrado" });
});

servidor.listen(PUERTO, () => {
  console.log(`API escuchando en http://localhost:${PUERTO}`);
});
