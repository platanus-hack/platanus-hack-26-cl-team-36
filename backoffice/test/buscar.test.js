import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizar } from "../public/nucleo/buscar.js";

test("normalizar quita tildes y pasa a minúsculas", () => {
  assert.equal(normalizar("Telaraña ÉXITO"), "telarana exito");
});
