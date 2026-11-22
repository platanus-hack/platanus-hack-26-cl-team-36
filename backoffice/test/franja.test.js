import { test } from "node:test";
import assert from "node:assert/strict";
import { modeloDeFranja, vecinoDe } from "../public/tanda/franja.js";
import { modeloDeTarjeta } from "../public/overview/tarjetas.js";
import { enlaceATanda, parametrosQueSiguen, parsearHash } from "../public/nucleo/rutas.js";

const T = (goal) => `telcopacifico.test/visitor/${goal}/2026-11-21T10-00-00Z`;
const TARJETA = {
  revision: "abc123-x",
  sitio: "Telco Pacífico",
  host: "telcopacifico.test",
  url: "https://telcopacifico.test/",
  estado: "delivered",
  goals: [
    { goal: "dar-de-baja", instruccion: "Encontrar cómo dar de baja un plan móvil", tanda: T("dar-de-baja"), intentos: [{ estado: "logrado" }, { estado: "logrado" }] },
    { goal: "portabilidad", instruccion: "Cambiarse de compañía", tanda: null, espera: true, intentos: [] },
    { goal: "cobertura-5g", instruccion: "Revisar si hay cobertura 5G", tanda: T("cobertura-5g"), intentos: [{ estado: "logrado" }, { estado: "fallido" }, { estado: "logrado" }] },
  ],
};

test("la franja: un goal por celda con el medidor de la tarjeta, la elegida es la de la tanda abierta", () => {
  const modelo = modeloDeFranja(TARJETA, T("cobertura-5g"));
  assert.equal(modelo.sitio, "Telco Pacífico");
  assert.equal(modelo.estado, "delivered");
  assert.equal(modelo.indice, 2);
  assert.deepEqual(modelo.goals.map((g) => [g.n, g.elegido, g.elegible, g.texto, g.tono]), [
    [1, false, true, "2/2", "logrado"],
    [2, false, false, "—", "neutro"],
    [3, true, true, "2/3", "aviso"],
  ]);
  assert.deepEqual(modelo.goals[2].tramos, ["logrado", "logrado", "fallido"]);
});

test("la franja: el vecino salta los goals sin tanda y da la vuelta", () => {
  const modelo = modeloDeFranja(TARJETA, T("cobertura-5g"));
  assert.equal(vecinoDe(modelo, 1).goal, "dar-de-baja");
  assert.equal(vecinoDe(modelo, -1).goal, "dar-de-baja");
  const solo = modeloDeFranja({ ...TARJETA, goals: [TARJETA.goals[0], TARJETA.goals[1]] }, T("dar-de-baja"));
  assert.equal(vecinoDe(solo, 1), null);
});

test("sin franja: menos de dos goals o una tanda que no es de la revisión", () => {
  assert.equal(modeloDeFranja({ ...TARJETA, goals: [TARJETA.goals[0]] }, T("dar-de-baja")), null);
  assert.equal(modeloDeFranja(TARJETA, "otro.test/visitor/x/2026-11-21T10-00-00Z"), null);
  assert.equal(modeloDeFranja(null, T("dar-de-baja")), null);
  // Otra corrida del mismo goal: se reconoce por el nombre del goal.
  assert.equal(modeloDeFranja(TARJETA, "telcopacifico.test/visitor/cobertura-5g/2026-11-22T10-00-00Z").indice, 2);
});

test("la tarjeta sabe si su tanda es de uno de sus goals (su enlace lleva ?revision=)", () => {
  assert.equal(modeloDeTarjeta(TARJETA).tandaPropia, true);
  const soloCaptura = { ...TARJETA, goals: [], capturas: { desktop: { tanda: T("dar-de-baja"), carpeta: "c", archivo: "step_00.png" } } };
  assert.equal(modeloDeTarjeta(soloCaptura).tandaPropia, false);
  assert.equal(modeloDeTarjeta(soloCaptura).tanda, T("dar-de-baja"));
});

test("la revisión va en el hash de la tanda, sigue al cambiar de pestaña y una inválida se descarta", () => {
  const tanda = T("cobertura-5g");
  const hash = enlaceATanda(tanda, "replay", { intento: "mobile", paso: "2", revision: "mwqhgg8u-c7d205" });
  assert.equal(hash, `#/t/${tanda}/replay?intento=mobile&paso=2&revision=mwqhgg8u-c7d205`);
  const ruta = parsearHash(hash);
  assert.equal(ruta.parametros.revision, "mwqhgg8u-c7d205");
  assert.deepEqual(parametrosQueSiguen(ruta.parametros), { intento: "mobile", revision: "mwqhgg8u-c7d205" });
  assert.equal(enlaceATanda(tanda, "telarana", parametrosQueSiguen(ruta.parametros)), `#/t/${tanda}/path-map?intento=mobile&revision=mwqhgg8u-c7d205`);
  assert.deepEqual(parsearHash(`#/t/${tanda}/path-map?revision=..%2Fx`).parametros, {});
  assert.equal(enlaceATanda(tanda, "telarana", { revision: "NO VALE" }), `#/t/${tanda}/path-map`);
});
