import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { crearActualizadorIndicador, estadoDelIndicador } from "../src/background/indicador.js";

test("ON/OFF distingue la habilitación global con icono, texto y título localizado", () => {
  for (const activo of [true, false]) {
    for (const idioma of ["es", "en"]) {
      const estado = estadoDelIndicador({ activo, idioma });
      assert.equal(estado.texto, activo ? "ON" : "OFF");
      assert.match(estado.titulo, /Chameleon Mode/);
      assert.match(estado.titulo, idioma === "es" ? /sitios/ : /sites/);
      assert.doesNotMatch(estado.titulo, /aplicado|applied/);
      assert.notEqual(estado.titulo, activo ? "accion.encendida" : "accion.apagada");
      for (const [size, icono] of Object.entries(estado.iconos)) {
        assert.ok(existsSync(new URL(`../src/${icono}`, import.meta.url)), `falta ${size}px ${icono}`);
        assert.ok(icono.includes(activo ? "-on-" : "-off-"));
      }
    }
  }
  assert.equal(estadoDelIndicador().texto, "ON", "misma preferencia inicial que el motor");
});

test("restaura OFF al arrancar desde storage y admite navegadores sin setBadgeTextColor", async () => {
  const escrituras = {};
  const action = Object.fromEntries(["setIcon", "setTitle", "setBadgeText", "setBadgeBackgroundColor"].map((metodo) => [metodo, async (valor) => { escrituras[metodo] = valor; }]));
  const actualizar = crearActualizadorIndicador({ action, storage: { get: async () => ({ activo: false, idioma: "en" }) } });
  await actualizar();
  assert.deepEqual(escrituras.setBadgeText, { text: "OFF" });
  assert.match(escrituras.setTitle.title, /off/);
  assert.match(escrituras.setIcon.path[16], /-off-/);
});

test("un cambio lento no pisa el estado nuevo y una escritura fallida no rompe la cola", async () => {
  let liberar;
  const espera = new Promise((resolve) => { liberar = resolve; });
  let almacenado = { activo: true, idioma: "es" };
  const escrituras = [];
  let llamadas = 0;
  const action = {
    async setIcon({ path }) { if (++llamadas === 1) await espera; escrituras.push(path[16]); },
    async setTitle() {},
    async setBadgeText() {},
    async setBadgeBackgroundColor() { if (llamadas === 1) throw new Error("API temporal"); },
    async setBadgeTextColor() {},
  };
  const actualizar = crearActualizadorIndicador({ action, storage: { get: async () => almacenado } });
  const primero = actualizar();
  const rechazo = assert.rejects(primero, /API temporal/);
  await new Promise((resolve) => setImmediate(resolve));
  almacenado = { activo: false, idioma: "en" };
  const segundo = actualizar();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(llamadas, 1, "espera a que terminen todas las escrituras anteriores");
  liberar();
  await Promise.all([rechazo, segundo]);
  assert.deepEqual(escrituras, ["icons/extension-on-16.png", "icons/extension-off-16.png"]);
});

test("el event page restaura el estado guardado sin esperar a onStartup y sigue idioma y activo", async () => {
  const original = globalThis.browser;
  let almacenado = { activo: false, idioma: "es" };
  const escritos = {};
  let cambio;
  const evento = { addListener() {} };
  globalThis.browser = {
    action: Object.fromEntries(["setIcon", "setTitle", "setBadgeText", "setBadgeBackgroundColor", "setBadgeTextColor"].map((metodo) => [metodo, async (valor) => { escritos[metodo] = valor; }])),
    storage: { local: { get: async () => almacenado }, onChanged: { addListener(listener) { cambio = listener; } } },
    runtime: { onStartup: evento, onInstalled: evento, onMessage: evento },
    tabs: { onRemoved: evento },
  };
  try {
    await import("../src/background/index.js?indicador-test");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(escritos.setBadgeText.text, "OFF");
    assert.match(escritos.setTitle.title, /apagado/);
    almacenado = { activo: true, idioma: "en" };
    cambio({ activo: { newValue: true }, idioma: { newValue: "en" } }, "local");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(escritos.setBadgeText.text, "ON");
    assert.match(escritos.setTitle.title, /on for supported sites/);
    almacenado = { activo: true, idioma: "es" };
    cambio({ idioma: { newValue: "es" } }, "local");
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(escritos.setTitle.title, /encendido/);
  } finally { globalThis.browser = original; }
});
