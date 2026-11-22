// Tests de la URL de la API (src/background/config.js). Las llamadas a /revisiones están en revisiones.test.js.
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { API_URL_AWS, API_URL_LOCAL, CLAVE_API_LOCAL, recargadaEnDesarrollo, urlDeLaApi } from "../src/background/config.js";

afterEach(() => {
  delete globalThis.browser;
});

// Simula `browser.management.getSelf()` con el installType dado y `storage.local` con `guardado`.
function simularInstalacion(installType, guardado = {}) {
  globalThis.browser = {
    management: { getSelf: async () => ({ installType }) },
    storage: { local: { get: async (clave) => (clave in guardado ? { [clave]: guardado[clave] } : {}) } },
  };
}

test("instalada o fuera del navegador usa la API de AWS", async () => {
  simularInstalacion("normal");
  assert.equal(await urlDeLaApi(), API_URL_AWS);

  delete globalThis.browser;
  assert.equal(await urlDeLaApi(), API_URL_AWS);
});

test("en modo desarrollo también usa la de AWS, salvo que se pida la local", async () => {
  simularInstalacion("development");
  assert.equal(await urlDeLaApi(), API_URL_AWS);

  simularInstalacion("development", { [CLAVE_API_LOCAL]: true });
  assert.equal(await urlDeLaApi(), API_URL_LOCAL);

  simularInstalacion("development", { [CLAVE_API_LOCAL]: "si" }); // solo true la activa
  assert.equal(await urlDeLaApi(), API_URL_AWS);
});

test("instalada, pedir la API local no cambia nada", async () => {
  simularInstalacion("normal", { [CLAVE_API_LOCAL]: true });
  assert.equal(await urlDeLaApi(), API_URL_AWS);
});

test("Firefox: recargada en desarrollo solo si onInstalled trae temporary", async () => {
  simularInstalacion("development"); // en Firefox manda `temporary`, no el installType
  assert.equal(await recargadaEnDesarrollo({ reason: "update", temporary: true }), true);
  assert.equal(await recargadaEnDesarrollo({ reason: "install", temporary: false }), false);
});

test("Chrome (sin temporary): recargada en desarrollo si está desempaquetada y se instaló o recargó", async () => {
  simularInstalacion("development");
  assert.equal(await recargadaEnDesarrollo({ reason: "update" }), true);
  assert.equal(await recargadaEnDesarrollo({ reason: "install" }), true);
  assert.equal(await recargadaEnDesarrollo({ reason: "chrome_update" }), false); // se actualizó el navegador

  simularInstalacion("normal");
  assert.equal(await recargadaEnDesarrollo({ reason: "update" }), false);

  delete globalThis.browser;
  assert.equal(await recargadaEnDesarrollo({ reason: "update" }), false);
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
