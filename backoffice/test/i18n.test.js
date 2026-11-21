import { test } from "node:test";
import assert from "node:assert/strict";
import { IDIOMAS, formatear } from "../public/nucleo/i18n.js";

const dicc = {
  es: {
    replay: {
      esperaba: "Esperaba",
      pasoDeTotal: "Paso {n} de {total}",
      pasos: ({ n }, { plural }) => `${n} ${plural(n, { one: "paso", other: "pasos" })}`,
      soloEnEspanol: "Solo aquí",
      duracion: ({ s }, { fmt }) => `a los ${fmt.duracion(s)}`,
    },
  },
  en: {
    replay: {
      esperaba: "Expected",
      pasoDeTotal: "Step {n} of {total}",
      pasos: ({ n }, { plural }) => `${n} ${plural(n, { one: "step", other: "steps" })}`,
      duracion: ({ s }, { fmt }) => `at ${fmt.duracion(s)}`,
    },
  },
};

test("idiomas", () => {
  assert.deepEqual(IDIOMAS, ["es", "en"]);
});

test("interpolación", () => {
  assert.equal(formatear(dicc, "replay.pasoDeTotal", { n: 4, total: 12 }, "es"), "Paso 4 de 12");
  assert.equal(formatear(dicc, "replay.pasoDeTotal", { n: 4, total: 12 }, "en"), "Step 4 of 12");
  assert.equal(formatear(dicc, "replay.esperaba", {}, "en"), "Expected");
});

test("variable desconocida queda como {var}", () => {
  assert.equal(formatear(dicc, "replay.pasoDeTotal", { n: 4 }, "es"), "Paso 4 de {total}");
  assert.equal(formatear(dicc, "replay.pasoDeTotal", undefined, "es"), "Paso {n} de {total}");
});

test("funciones con plural (0, 1, 2) en ambos idiomas", () => {
  assert.deepEqual([0, 1, 2].map((n) => formatear(dicc, "replay.pasos", { n }, "es")), ["0 pasos", "1 paso", "2 pasos"]);
  assert.deepEqual([0, 1, 2].map((n) => formatear(dicc, "replay.pasos", { n }, "en")), ["0 steps", "1 step", "2 steps"]);
});

test("las funciones reciben fmt del idioma del texto", () => {
  assert.equal(formatear(dicc, "replay.duracion", { s: 65 }, "es"), "a los 1 min 5 s");
  assert.equal(formatear(dicc, "replay.duracion", { s: 65 }, "en"), "at 1 min 5 s");
});

test("respaldo: en → es → la clave, y avisa de lo que falta", () => {
  const faltas = [];
  const alFaltar = (clave, idioma) => faltas.push(`${idioma}:${clave}`);
  assert.equal(formatear(dicc, "replay.soloEnEspanol", {}, "en", alFaltar), "Solo aquí");
  assert.equal(formatear(dicc, "replay.noExiste", {}, "en", alFaltar), "replay.noExiste");
  assert.equal(formatear(dicc, "otra.seccion.clave", {}, "es", alFaltar), "otra.seccion.clave");
  assert.deepEqual(faltas, ["en:replay.soloEnEspanol", "en:replay.noExiste", "es:otra.seccion.clave"]);
});

test("una clave que apunta a un objeto no es un texto", () => {
  assert.equal(formatear(dicc, "replay", {}, "es"), "replay");
});
