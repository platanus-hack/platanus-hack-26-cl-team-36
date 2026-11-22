import assert from "node:assert/strict";
import { test } from "node:test";
import { posicionEnLaRuta } from "../public/replay/ruta.js";

// El intento de la maqueta: movilsur.test · dar-de-baja · Escritorio (13 pasos, se queda en «Dar de baja»).
const RUTA = ["inicio", "soporte", "baja", "requisitos"];
const TELARANA = { deLaTelarana: true };
const PAGINAS = ["inicio", "hogar", "cuenta", "planes", "cuenta", "soporte", "planes", "hogar", "planes", "soporte", "baja", "equipos", "baja"];
const EN_RUTA = new Set(RUTA);
const intento = {
  pasos: PAGINAS.map((pagina, i) => ({ numero: i + 1, pagina, carril: EN_RUTA.has(pagina) ? "en-ruta" : "fuera-de-ruta" })),
  hitos: [
    { pagina: "inicio", alcanzado: true, paso: 0 },
    { pagina: "soporte", alcanzado: true, paso: 6 },
    { pagina: "baja", alcanzado: true, paso: 11 },
    { pagina: "requisitos", alcanzado: false, paso: null },
  ],
};

test("en el paso 11 está en «Dar de baja», con los desvíos agrupados bajo el hito del que salieron", () => {
  const posicion = posicionEnLaRuta(intento, 10, RUTA, TELARANA);
  assert.equal(posicion.alcanzados, 3);
  assert.equal(posicion.total, 4);
  assert.equal(posicion.enDesvio, false);
  assert.deepEqual(posicion.hitos.map((hito) => hito.aqui), [false, false, true, false]);
  assert.deepEqual(posicion.hitos.map((hito) => hito.alcanzado), [true, true, true, false]);
  assert.deepEqual(posicion.hitos[0].desvios, { pasos: [2, 3, 4, 5], paginas: ["hogar", "cuenta", "planes"], aqui: false });
  assert.deepEqual(posicion.hitos[1].desvios.pasos, [7, 8, 9]);
  assert.deepEqual(posicion.hitos[2].desvios.pasos, [], "el desvío del paso 12 todavía no pasó");
  assert.equal(posicion.hitos[3].meta, true);
});

test("en un paso fuera de la ruta, el grupo de desvíos es el que está aquí", () => {
  const posicion = posicionEnLaRuta(intento, 11, RUTA, TELARANA);
  assert.equal(posicion.enDesvio, true);
  assert.equal(posicion.hitos.some((hito) => hito.aqui), false);
  assert.deepEqual(posicion.hitos[2].desvios, { pasos: [12], paginas: ["equipos"], aqui: true });
});

test("en el paso 1 solo alcanzó el inicio", () => {
  const posicion = posicionEnLaRuta(intento, 0, RUTA, TELARANA);
  assert.equal(posicion.alcanzados, 1);
  assert.equal(posicion.hitos[0].aqui, true);
  assert.deepEqual(posicion.hitos.flatMap((hito) => hito.desvios.pasos), []);
});

test("con la ruta de la Guía, las llegadas salen de los pasos y una página sin visitar (id null) no calza", () => {
  const conNulos = { ...intento, pasos: [...intento.pasos, { numero: 14, pagina: null, carril: "fuera-de-ruta" }] };
  const posicion = posicionEnLaRuta(conNulos, 13, ["inicio", "soporte", "baja", null]);
  assert.deepEqual(posicion.hitos.map((hito) => hito.alcanzado), [true, true, true, false]);
  assert.equal(posicion.enDesvio, true, "un paso sin página es un desvío, no la página final");
  assert.deepEqual(posicion.hitos[2].desvios, { pasos: [12, 14], paginas: ["equipos"], aqui: true });
});

test("una página de inicio alterna marcada en ruta cuenta como el inicio, solo con la ruta de la telaraña", () => {
  const alterno = { pasos: [{ numero: 1, pagina: "m-inicio", carril: "en-ruta" }], hitos: [] };
  assert.equal(posicionEnLaRuta(alterno, 0, RUTA, TELARANA).hitos[0].aqui, true);
  assert.equal(posicionEnLaRuta(alterno, 0, RUTA).enDesvio, true);
});

test("sin ruta, o con una ruta de una sola página, no hay seguimiento", () => {
  assert.equal(posicionEnLaRuta(intento, 0, null), null);
  assert.equal(posicionEnLaRuta(intento, 0, ["inicio"]), null);
});
