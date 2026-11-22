import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

test("el icono sigue el encendido guardado y conserva el badge existente", async () => {
  const original = globalThis.browser;
  let activo = false;
  const escritos = {};
  let cambio, inicio, instalacion;
  const evento = { addListener() {} };
  globalThis.browser = {
    action: Object.fromEntries(["setIcon", "setBadgeText", "setBadgeBackgroundColor", "setBadgeTextColor"].map((metodo) => [metodo, async (valor) => { escritos[metodo] = valor; }])),
    storage: { local: { get: async () => ({ activo }) }, onChanged: { addListener(listener) { cambio = listener; } } },
    runtime: {
      onStartup: { addListener(listener) { inicio = listener; } },
      onInstalled: { addListener(listener) { instalacion = listener; } },
      onMessage: evento,
    },
    tabs: { onRemoved: evento },
  };
  const comprobar = (estado) => {
    assert.equal(escritos.setBadgeText.text, estado ? "ON" : "");
    for (const size of [16, 32]) {
      // Ruta absoluta: Chrome resuelve las relativas contra el service worker (background/icons/… no existe).
      const icono = `/icons/extension-${estado ? "on" : "off"}-${size}.png`;
      assert.equal(escritos.setIcon.path[size], icono);
      assert.ok(existsSync(new URL(`../src${icono}`, import.meta.url)));
    }
  };
  try {
    await import("../src/background/index.js?indicador-test");
    await inicio();
    comprobar(false);
    activo = true;
    cambio({ activo: { newValue: true } }, "local");
    await new Promise((resolve) => setImmediate(resolve));
    comprobar(true);
    activo = false;
    await instalacion({ temporary: false }); // Firefox
    comprobar(false);
    activo = true;
    await instalacion({ reason: "update" }); // Chrome no manda `temporary`
    comprobar(true);
  } finally { globalThis.browser = original; }
});
