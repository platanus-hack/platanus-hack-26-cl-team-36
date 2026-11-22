// Cuándo un goal ofrece su telaraña en vivo y qué dice su indicador (public/datos/vivo.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RECIENTE_MS, estadoDelVivo, goalEnVivo, tandaDelGoal } from "../public/datos/vivo.js";

const AHORA = Date.parse("2026-11-22T12:00:00Z");
const hace = (ms) => new Date(AHORA - ms).toISOString();
const etapa = (estado, actualizada = null, resultados = []) => ({ estado, actualizada, resultados });
const goal = (guide, visitor) => ({ goal: "horario", guide, visitor });

test("en vivo: la Guía o el Visitante corriendo, o una de las dos recién cerrada", () => {
  assert.equal(goalEnVivo(goal(etapa("running"), etapa("pending")), AHORA), true);
  assert.equal(goalEnVivo(goal(etapa("succeeded", hace(RECIENTE_MS * 2)), etapa("running")), AHORA), true);
  assert.equal(goalEnVivo(goal(etapa("succeeded", hace(60_000)), etapa("pending")), AHORA), true, "la Guía acaba de cerrar");
  assert.equal(goalEnVivo(goal(etapa("succeeded", hace(RECIENTE_MS * 2)), etapa("failed", hace(5_000))), AHORA), true);
  assert.equal(goalEnVivo(goal(etapa("succeeded", hace(RECIENTE_MS * 2)), etapa("succeeded", hace(RECIENTE_MS + 1))), AHORA), false, "terminó hace rato");
  assert.equal(goalEnVivo(goal(etapa("pending"), etapa("pending")), AHORA), false, "no empezó");
  assert.equal(goalEnVivo(goal(etapa("succeeded"), etapa("succeeded")), AHORA), false, "sin fecha no es reciente");
});

test("la tanda del goal es la del resultado del Visitante", () => {
  assert.equal(tandaDelGoal(goal(etapa("succeeded"), etapa("succeeded", null, [{ archivo: "x" }, { tanda: "ej.test/visitor/h/2026-11-22T12-05-00Z" }]))), "ej.test/visitor/h/2026-11-22T12-05-00Z");
  assert.equal(tandaDelGoal(goal(etapa("succeeded"), etapa("running"))), null);
  assert.equal(tandaDelGoal(null), null);
});

test("el indicador sigue a la transmisión, salvo que la revisión ya diga que el Visitante cerró", () => {
  const corriendo = goal(etapa("succeeded"), etapa("running"));
  assert.equal(estadoDelVivo(undefined, corriendo), "conectando");
  assert.equal(estadoDelVivo("en-vivo", corriendo), "en-vivo");
  assert.equal(estadoDelVivo("reconectando", corriendo), "reconectando");
  assert.equal(estadoDelVivo("terminado", corriendo), "terminado");
  assert.equal(estadoDelVivo("error", goal(etapa("succeeded"), etapa("succeeded"))), "terminado", "un 204 al reconectar a un goal cerrado");
  assert.equal(estadoDelVivo("error", corriendo), "error");
});
