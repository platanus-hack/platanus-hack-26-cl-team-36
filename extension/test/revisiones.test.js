// Tests de las revisiones (src/background/revisiones.js + pedirRevision/consultarRevision de api.js) con fetch simulado.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { consultarRevision, pedirRevision } from "../src/background/api.js";
import { API_URL_AWS } from "../src/background/config.js";
import { leerRevision, resolverRevision, urlDePagina } from "../src/background/revisiones.js";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

// fetch que responde, en orden, cada elemento de `respuestas` (un Error se lanza) y registra las llamadas.
function simularFetch(...respuestas) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    llamadas.push({ url, metodo: opciones.method ?? "GET", cuerpo: opciones.body && JSON.parse(opciones.body) });
    const respuesta = respuestas.shift();
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  };
  return llamadas;
}

const silencioso = { debug() {}, warn() {} };
const PAGINA = "https://example.com/tienda/carro?token=secreto#arriba";
const CSS = "body { color: #222 }";

test("urlDePagina quita query y hash", () => {
  assert.equal(urlDePagina(PAGINA), "https://example.com/tienda/carro");
});

test("página nueva: 202 queued, luego running y luego done con css", async () => {
  const llamadas = simularFetch(
    Response.json({ success: true, revision: "r1a2", status: "queued" }, { status: 202 }),
    Response.json({ success: true, revision: "r1a2", status: "running" }),
    Response.json({ success: true, revision: "r1a2", status: "done", css: CSS }),
  );
  assert.deepEqual(await resolverRevision(PAGINA, { consultar: pedirRevision, log: silencioso }), {
    estado: "esperando",
    revision: "r1a2",
  });
  assert.equal((await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso })).estado, "esperando");
  const listo = await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso });

  assert.equal(listo.estado, "listo");
  assert.deepEqual(listo.tema, {
    id: "rev-r1a2",
    nombre: "Revisión r1a2",
    css: "html.mi-tema body {\n  color: #222;\n}\n",
    features: {},
    eventosNavegacion: [],
  });
  assert.equal(llamadas[0].url, `${API_URL_AWS}/revisiones`);
  assert.equal(llamadas[0].metodo, "POST");
  assert.deepEqual(llamadas[0].cuerpo, { url: "https://example.com/tienda/carro" });
  assert.equal(llamadas[1].url, `${API_URL_AWS}/revisiones?url=${encodeURIComponent("https://example.com/tienda/carro")}`);
  assert.equal(llamadas[1].metodo, "GET");
});

test("página ya vista: 200 done con css se aplica de una vez, saneado", async () => {
  simularFetch(Response.json({ success: true, revision: "abc", status: "done", css: `${CSS} @import url(x);` }));
  const { estado, tema } = await resolverRevision(PAGINA, { consultar: pedirRevision, log: silencioso });
  assert.equal(estado, "listo");
  assert.equal(tema.id, "rev-abc");
  assert.doesNotMatch(tema.css, /import|url\(/);
});

test("404, failed, error de red, sin JSON o css vacío: fin, sin lanzar", async () => {
  const casos = [
    Response.json({ success: false }, { status: 404 }),
    Response.json({ success: true, revision: "abc", status: "failed" }),
    new TypeError("NetworkError when attempting to fetch resource."),
    new Response("<html>502</html>", { status: 502 }),
    Response.json({ success: true, revision: "abc", status: "done", css: "@import url(x);" }),
    Response.json({ success: true, revision: "abc", status: "done" }),
  ];
  for (const respuesta of casos) {
    simularFetch(respuesta);
    assert.deepEqual(await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso }), { estado: "fin" });
  }
});

test("leerRevision rechaza ids de revisión que no cumplen el formato", () => {
  for (const revision of ["../x", "ABC", "a--b", "x".repeat(41), 7]) {
    assert.deepEqual(leerRevision({ success: true, revision, status: "queued" }), { estado: "fin" });
  }
});
