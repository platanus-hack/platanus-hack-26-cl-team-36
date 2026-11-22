// Una revisión en curso abre la hoja en vivo de un goal (public/overview/tarjetas.js) y el riel de esa hoja dice cómo
// va cada goal (public/datos/vivo.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalEnVivoDeTarjeta, modeloDeTarjeta } from "../public/overview/tarjetas.js";
import { faseDeGoal, filaDeGoal } from "../public/datos/vivo.js";

const TANDA = "sitio.cl/visitor/horario/2026-11-22T10-40-00Z";
const goal = (id, { tanda = null, intentos = [] } = {}) => ({ goal: id, instruccion: id, tanda, intentos: intentos.map((estado) => ({ estado })) });

test("en curso: abre el primer goal sin tanda con intentos corriendo; si ninguno corre, el primero sin tanda", () => {
  const goals = [goal("a", { tanda: TANDA, intentos: ["logrado"] }), goal("b"), goal("c", { intentos: ["en_curso"] })];
  assert.equal(goalEnVivoDeTarjeta({ estado: "running", goals }), "c");
  assert.equal(goalEnVivoDeTarjeta({ estado: "stalled", goals: goals.slice(0, 2) }), "b");
});

test("no abre en vivo: terminada, fallida, en cola, sin goals o con todos los goals con tanda", () => {
  const goals = [goal("a", { intentos: ["en_curso"] })];
  for (const estado of ["delivered", "failed", "queued"]) assert.equal(goalEnVivoDeTarjeta({ estado, goals }), null, estado);
  assert.equal(goalEnVivoDeTarjeta({ estado: "running", goals: [] }), null);
  assert.equal(goalEnVivoDeTarjeta({ estado: "running", goals: [goal("a", { tanda: TANDA })] }), null);
});

test("modelo: la tarjeta en curso trae su goal en vivo y las filas sin tanda se marcan en vivo", () => {
  const modelo = modeloDeTarjeta({ revision: "r1", estado: "running", goals: [goal("a", { tanda: TANDA }), goal("b", { intentos: ["en_curso"] })] });
  assert.equal(modelo.vivo, "b");
  assert.deepEqual(modelo.medidores.visibles.map((m) => [m.goal, m.vivo]), [["a", false], ["b", true]]);
  const terminada = modeloDeTarjeta({ revision: "r2", estado: "delivered", goals: [goal("a")] });
  assert.equal(terminada.vivo, null);
  assert.equal(terminada.medidores.visibles[0].vivo, false);
});

test("riel: la fase de cada goal y su fila", () => {
  const etapa = (estado, resultados = []) => ({ estado, resultados });
  const de = (guide, visitor) => ({ goal: "g", guide: etapa(guide), visitor: visitor === "tanda" ? etapa("succeeded", [{ tanda: TANDA }]) : etapa(visitor) });
  assert.equal(faseDeGoal(de("pending", "pending")), "espera");
  assert.equal(faseDeGoal(de("running", "pending")), "ruta");
  assert.equal(faseDeGoal(de("succeeded", "pending")), "ruta");
  assert.equal(faseDeGoal(de("succeeded", "running")), "visita");
  assert.equal(faseDeGoal(de("succeeded", "tanda")), "tanda");
  assert.equal(faseDeGoal(de("failed", "skipped")), "fallido");
  const t = (clave) => clave;
  assert.deepEqual(filaDeGoal(de("succeeded", "running"), t), { id: "g", punto: "en_curso", nombre: "g", cifra: "vivo.riel.fase.visita", cifraAviso: false });
  assert.equal(filaDeGoal(de("succeeded", "failed"), t).cifraAviso, true);
});
