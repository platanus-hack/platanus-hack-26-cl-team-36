// Tests de las revisiones (src/background/revisiones.js + pedirRevision/consultarRevision de api.js) con fetch simulado.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("revisión en curso (pedida desde afuera): queued, luego running y luego done con css, solo con GET", async () => {
  const llamadas = simularFetch(
    Response.json({ success: true, revision: "r1a2", status: "queued" }),
    Response.json({ success: true, revision: "r1a2", status: "running" }),
    Response.json({ success: true, revision: "r1a2", status: "done", css: CSS }),
  );
  assert.deepEqual(await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso }), {
    estado: "esperando",
    revision: "r1a2",
  });
  assert.equal((await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso })).estado, "esperando");
  const listo = await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso });

  assert.equal(listo.estado, "listo");
  assert.deepEqual(listo.cruda, { revision: "r1a2", css: CSS });
  assert.deepEqual(listo.tema, {
    id: "rev-r1a2",
    nombre: "Revisión r1a2",
    css: "html.mi-tema body {\n  color: #222;\n}\n",
    features: {},
    eventosNavegacion: [],
  });
  for (const llamada of llamadas) {
    assert.equal(llamada.url, `${API_URL_AWS}/revisiones?url=${encodeURIComponent("https://example.com/tienda/carro")}`);
    assert.equal(llamada.metodo, "GET");
  }
});

test("pedirRevision (sin uso en la extensión por ahora) envía POST con la URL sin query ni hash", async () => {
  const llamadas = simularFetch(Response.json({ success: true, revision: "r1a2", status: "queued" }, { status: 202 }));
  assert.equal((await resolverRevision(PAGINA, { consultar: pedirRevision, log: silencioso })).estado, "esperando");
  assert.equal(llamadas[0].url, `${API_URL_AWS}/revisiones`);
  assert.equal(llamadas[0].metodo, "POST");
  assert.deepEqual(llamadas[0].cuerpo, { url: "https://example.com/tienda/carro" });
});

test("página ya vista: 200 done con css se aplica de una vez, saneado", async () => {
  simularFetch(Response.json({ success: true, revision: "abc", status: "done", css: `${CSS} @import url(x);` }));
  const { estado, tema } = await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso });
  assert.equal(estado, "listo");
  assert.equal(tema.id, "rev-abc");
  assert.doesNotMatch(tema.css, /import|url\(/);
});

test("página sin revisión (404): sin-revision, sin lanzar", async () => {
  simularFetch(Response.json({ success: false }, { status: 404 }));
  assert.deepEqual(await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso }), {
    estado: "sin-revision",
  });
});

test("failed o done sin css: fin; css sin nada aplicable: inaplicable; sin lanzar", async () => {
  const casos = [
    [Response.json({ success: true, revision: "abc", status: "failed" }), "fin"],
    [Response.json({ success: true, revision: "abc", status: "done" }), "fin"],
    [Response.json({ success: true, revision: "abc", status: "done", css: "@import url(x);" }), "inaplicable"],
  ];
  for (const [respuesta, estado] of casos) {
    simularFetch(respuesta);
    assert.deepEqual(await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso }), { estado });
  }
});

test("error de red, timeout, 5xx, 429 o sin JSON: error pasajero, sin lanzar", async () => {
  const casos = [
    new TypeError("NetworkError when attempting to fetch resource."),
    new DOMException("The operation timed out.", "TimeoutError"),
    new Response("<html>502</html>", { status: 502 }),
    Response.json({ success: false }, { status: 500 }),
    Response.json({ success: false }, { status: 429 }),
    new Response("no es json", { status: 200 }),
  ];
  for (const respuesta of casos) {
    simularFetch(respuesta);
    assert.deepEqual(await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso }), { estado: "error" });
  }
});

test("leerRevision rechaza ids de revisión que no cumplen el formato", () => {
  for (const revision of ["../x", "ABC", "a--b", "x".repeat(41), 7]) {
    assert.deepEqual(leerRevision({ success: true, revision, status: "queued" }), { estado: "fin" });
  }
});

const METRO = JSON.parse(readFileSync(new URL("fixtures/metro/tema.json", import.meta.url), "utf8"));

test("leerRevision acepta el tema.json (un objeto) junto al css; si no es un objeto, lo ignora", () => {
  const tema = { features: { vista: [] } };
  assert.deepEqual(leerRevision({ success: true, revision: "r1", status: "done", css: CSS, tema }), {
    estado: "listo",
    revision: "r1",
    css: CSS,
    tema,
  });
  for (const raro of [null, "x", [1]]) {
    assert.deepEqual(leerRevision({ success: true, revision: "r1", status: "done", css: CSS, tema: raro }), {
      estado: "listo",
      revision: "r1",
      css: CSS,
    });
  }
  assert.deepEqual(leerRevision({ success: true, revision: "r1", status: "done", tema }), { estado: "fin" });
});

test("revisión con tema: el tema llega al motor con sus features saneadas", async () => {
  const fuera = { id: "fuera", contenedor: "a", componente: "lanzador", datos: [{ titulo: "x", enlace: "//evil.com" }] };
  const tema = { features: { ...METRO.features, vista: [...METRO.features.vista, fuera] } };
  simularFetch(Response.json({ success: true, revision: "r1", status: "done", css: CSS, tema }));
  const avisos = [];
  const log = { ...silencioso, warn: (...args) => avisos.push(args) };
  const listo = await resolverRevision(PAGINA, { consultar: consultarRevision, log });
  assert.equal(listo.estado, "listo");
  assert.deepEqual(listo.tema.features, METRO.features);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0][1][0], /^vista "fuera"/);
});

test("revisión con tema pero sin CSS aplicable: sin tema", async () => {
  simularFetch(Response.json({ success: true, revision: "r1", status: "done", css: "", tema: METRO }));
  assert.deepEqual(await resolverRevision(PAGINA, { consultar: consultarRevision, log: silencioso }), {
    estado: "inaplicable",
  });
});
