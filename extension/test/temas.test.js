// Tests de la lógica pura de temas (src/background/temas.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTema } from "../src/background/temas.js";

test("normalizarTema completa valores por defecto", () => {
  const tema = normalizarTema({ id: "x", css: "" });
  assert.deepEqual(tema, { id: "x", nombre: "x", css: "", features: {}, eventosNavegacion: [] });
});

test("normalizarTema rechaza temas incompletos o ids raros", () => {
  assert.throws(() => normalizarTema({ css: "" }), /id/);
  assert.throws(() => normalizarTema({ id: "../otro", css: "" }), /id/);
  assert.throws(() => normalizarTema({ id: "x" }), /css/);
  assert.throws(() => normalizarTema({ id: "x", css: "", features: ["modo-foco"] }), /features/);
});
