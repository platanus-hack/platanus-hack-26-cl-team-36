import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { conTransicion } from "../public/nucleo/transiciones.js";

// Un document mínimo con View Transitions: `llamar` decide si el navegador llega a llamar el callback.
function documento({ visible = true, llamar = true } = {}) {
  const registro = { saltadas: 0 };
  globalThis.document = {
    visibilityState: visible ? "visible" : "hidden",
    documentElement: { dataset: {} },
    startViewTransition(callback) {
      let resolverHecho;
      let rechazarHecho;
      const hecho = new Promise((si, no) => ((resolverHecho = si), (rechazarHecho = no)));
      const correr = () => Promise.resolve(callback()).then(resolverHecho, rechazarHecho);
      if (llamar) setTimeout(correr, 5);
      return {
        updateCallbackDone: hecho,
        ready: hecho,
        finished: hecho,
        skipTransition() {
          registro.saltadas += 1;
          // Como pide la especificación: el callback pendiente se llama igual, en otra tarea.
          setTimeout(correr, 0);
        },
      };
    },
  };
  return registro;
}

afterEach(() => {
  delete globalThis.document;
});

test("conTransicion: con la página oculta actualiza sin transición", async () => {
  documento({ visible: false, llamar: false });
  let veces = 0;
  await conTransicion(() => {
    veces += 1;
  });
  assert.equal(veces, 1);
});

test("conTransicion: si el navegador nunca llama el callback, a los 250 ms se salta y actualiza una vez", async () => {
  const registro = documento({ llamar: false });
  let veces = 0;
  const inicio = Date.now();
  await conTransicion(() => {
    veces += 1;
  });
  assert.equal(veces, 1);
  assert.equal(registro.saltadas, 1);
  assert.ok(Date.now() - inicio >= 240);
  await new Promise((listo) => setTimeout(listo, 10));
  assert.equal(veces, 1, "el callback que la especificación encola no vuelve a actualizar");
});

test("conTransicion: en el caso normal actualiza una vez, sin saltarse la transición", async () => {
  const registro = documento();
  let veces = 0;
  await conTransicion(async () => {
    veces += 1;
  });
  assert.equal(veces, 1);
  assert.equal(registro.saltadas, 0);
});

test("conTransicion: un error al actualizar sale de conTransicion", async () => {
  documento();
  await assert.rejects(
    conTransicion(() => {
      throw new Error("marco roto");
    }),
    /marco roto/,
  );
});
