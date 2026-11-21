// Tests del proveedor de la API (src/background/proveedor-api.js) con fetch simulado,
// de la cadena de proveedores y de la configuración de la URL del backend.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API_URL } from "../src/background/config.js";
import { proveedorApi } from "../src/background/proveedor-api.js";
import { buscarEnProveedores } from "../src/background/temas.js";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

// Reemplaza fetch por uno que responde `respuesta` y guarda lo que se envió.
function simularFetch(respuesta) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url, opciones, cuerpo: JSON.parse(opciones.body) });
    return respuesta;
  };
  return llamadas;
}

test("envía POST a /temas/buscar solo con el origen de la página", async () => {
  const llamadas = simularFetch(new Response(null, { status: 204 }));
  await proveedorApi.buscar("https://www.youtube.com/watch?v=abc&t=10");
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, `${API_URL}/temas/buscar`);
  assert.equal(llamadas[0].opciones.method, "POST");
  assert.deepEqual(llamadas[0].cuerpo, { url: "https://www.youtube.com" });
});

test("respuesta vacía (204, cuerpo vacío, null o {}) significa sin tema", async () => {
  for (const respuesta of [
    new Response(null, { status: 204 }),
    new Response("", { status: 200 }),
    new Response("null", { status: 200 }),
    new Response("{}", { status: 200 }),
  ]) {
    simularFetch(respuesta);
    assert.equal(await proveedorApi.buscar("https://www.youtube.com/"), null);
  }
});

test("si la API devuelve un tema, se normaliza", async () => {
  simularFetch(Response.json({ id: "yt-api", dominios: ["youtube.com"], css: "html.mi-tema {}" }));
  const tema = await proveedorApi.buscar("https://www.youtube.com/");
  assert.equal(tema.id, "yt-api");
  assert.deepEqual(tema.features, {});
});

test("un error HTTP se propaga para que se use el siguiente proveedor", async () => {
  simularFetch(new Response("boom", { status: 500 }));
  await assert.rejects(proveedorApi.buscar("https://www.youtube.com/"), /500/);
});

test("buscarEnProveedores cae al siguiente proveedor si uno falla o no tiene tema", async () => {
  const avisos = [];
  const avisar = (...args) => avisos.push(args);
  const falla = { nombre: "falla", buscar: async () => { throw new Error("caído"); } };
  const vacio = { nombre: "vacio", buscar: async () => null };
  const local = { nombre: "local", buscar: async () => ({ id: "youtube" }) };

  assert.equal((await buscarEnProveedores([falla, vacio, local], "https://x", avisar))?.id, "youtube");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0][0], /"falla"/);

  assert.equal(await buscarEnProveedores([vacio], "https://x", avisar), null);
});

test("la URL del backend tiene permiso en el manifest (sin puerto)", () => {
  const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
  // Firefox no acepta puertos en los patrones: "http://localhost:3000/*" no da permiso,
  // la request sale como CORS con preflight y falla. "http://localhost/*" cubre todos los puertos.
  const { protocol, hostname } = new URL(API_URL);
  const patron = `${protocol}//${hostname}/*`;
  assert.ok(manifest.host_permissions.includes(patron), `Agrega "${patron}" a host_permissions en manifest.json`);
});
