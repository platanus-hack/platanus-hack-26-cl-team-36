import { createServer } from "node:http";

const PUERTO = Number(process.env.PORT) || 3000;

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
// La extensión lo llama al entrar a un sitio para pedir su tema.
//   - 204 (sin cuerpo): no hay tema; la extensión usa sus temas locales.
//   - 200 + tema (ver extension/src/background/temas.js): la extensión usa ese tema.
async function buscarTema(req, res) {
  let url;
  try {
    ({ url } = await leerJson(req));
  } catch {
    return responderJson(res, 400, { error: "El cuerpo debe ser JSON" });
  }
  if (typeof url !== "string") {
    return responderJson(res, 400, { error: "Falta `url`" });
  }

  console.log(`Tema pedido para ${url}`);
  res.writeHead(204).end(); // de momento nunca hay tema
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
