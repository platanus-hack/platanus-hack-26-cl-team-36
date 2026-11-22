import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenDelPaso, tonoDelPaso } from "../public/replay/paso.js";

test("tonoDelPaso: peligro gana a aviso; sin señales, fuera de la ruta o nada", () => {
  assert.equal(tonoDelPaso({ senales: ["no_effect", "visible_error"] }), "peligro");
  assert.equal(tonoDelPaso({ senales: ["went_back"], carril: "fuera-de-ruta" }), "aviso");
  assert.equal(tonoDelPaso({ senales: [], carril: "fuera-de-ruta" }), "fuera");
  assert.equal(tonoDelPaso({ senales: [], carril: "en-ruta" }), null);
  assert.equal(tonoDelPaso(null), null);
});

test("resumenDelPaso: la etiqueta del explorador, si no la expectativa y si no la descripción", () => {
  assert.equal(resumenDelPaso({ expectativa: "[rama 1, buscador] Espero ver el buscador" }), "rama 1, buscador");
  assert.equal(resumenDelPaso({ expectativa: "Espero ver las tarifas", descripcion: "scroll down" }), "Espero ver las tarifas");
  assert.equal(resumenDelPaso({ expectativa: "  ", descripcion: "scroll down x3" }), "scroll down x3");
  assert.equal(resumenDelPaso({}), "");
});
