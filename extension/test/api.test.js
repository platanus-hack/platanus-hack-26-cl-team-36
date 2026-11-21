// Tests del cliente de la API (src/background/api.js) con fetch simulado.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consultarTema } from "../src/background/api.js";
import { API_URL_AWS, API_URL_LOCAL, urlDeLaApi } from "../src/background/config.js";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete globalThis.browser;
});

// Simula `browser.management.getSelf()` con el installType dado.
function simularInstalacion(installType) {
  globalThis.browser = { management: { getSelf: async () => ({ installType }) } };
}

// Reemplaza fetch por uno que responde `respuesta` y guarda lo que se envió.
function simularFetch(respuesta) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url, opciones, cuerpo: JSON.parse(opciones.body) });
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  };
  return llamadas;
}

test("envía POST a /temas/buscar solo con el origen de la página", async () => {
  const llamadas = simularFetch(Response.json({ success: true, tema: "youtube" }));
  await consultarTema("https://www.youtube.com/watch?v=abc&t=10");
  assert.equal(llamadas[0].url, `${API_URL_AWS}/temas/buscar`);
  assert.equal(llamadas[0].opciones.method, "POST");
  assert.deepEqual(llamadas[0].cuerpo, { url: "https://www.youtube.com" });
});

test("success: true devuelve el id del tema", async () => {
  simularFetch(Response.json({ success: true, tema: "gmail" }));
  assert.equal(await consultarTema("https://mail.google.com/mail/u/0/"), "gmail");
});

test("success: false (404) devuelve null", async () => {
  simularFetch(Response.json({ success: false, error: "Sin tema" }, { status: 404 }));
  assert.equal(await consultarTema("https://example.com/"), null);
});

test("backend caído o respuesta rara lanzan error", async () => {
  simularFetch(new TypeError("NetworkError when attempting to fetch resource."));
  await assert.rejects(consultarTema("https://www.youtube.com/"), /NetworkError/);

  simularFetch(new Response("<html>502</html>", { status: 502 }));
  await assert.rejects(consultarTema("https://www.youtube.com/"), /502/);

  simularFetch(Response.json({ success: true })); // success sin tema
  await assert.rejects(consultarTema("https://www.youtube.com/"), /inesperada/);
});

test("en modo desarrollo usa la API local; instalada, la de AWS", async () => {
  simularInstalacion("development");
  assert.equal(await urlDeLaApi(), API_URL_LOCAL);

  simularInstalacion("normal");
  assert.equal(await urlDeLaApi(), API_URL_AWS);

  delete globalThis.browser; // fuera de Firefox
  assert.equal(await urlDeLaApi(), API_URL_AWS);
});

test("el manifest da permiso sobre las dos URLs del backend", () => {
  const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
  // Firefox no acepta puertos en los patrones: con puerto la request sale como CORS y falla.
  for (const url of [API_URL_LOCAL, API_URL_AWS]) {
    const { protocol, hostname } = new URL(url);
    const aceptados = [`${protocol}//*/*`, `${protocol}//${hostname}/*`, "<all_urls>"];
    assert.ok(
      manifest.host_permissions.some((p) => aceptados.includes(p)),
      `Agrega "${protocol}//${hostname}/*" (sin puerto) a host_permissions en manifest.json`,
    );
  }
});
