// Cifras, pestañas y cola del Overview (lib/overview.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITE_MAXIMO, MAXIMO_POR_PESTANA, PESTANAS, contarResumen, idsConTarjeta, listasDelOverview, parametrosDelOverview } from "../lib/overview.js";

test("resumen: una corrida por manifest y un visitante por intento, por dispositivo; en cola aparte", () => {
  const roles = contarResumen({
    corridas: [
      { rol: "cataloger", status: "succeeded" },
      { rol: "cataloger", status: "failed" },
      { rol: "cataloger", status: "abandoned" },
      { rol: "cataloger", status: null },
      { rol: "guide", status: "running" },
      { rol: "improver", status: "succeeded" },
      { rol: "visitor", status: "succeeded" },
    ],
    intentos: [
      { estado: "logrado", dispositivo: "desktop" },
      { estado: "logrado", dispositivo: "mobile" },
      { estado: "error", dispositivo: "desktop" },
      { estado: "en_curso", dispositivo: "mobile" },
      { estado: "sin_medir", dispositivo: "mobile" },
      { estado: "otro", dispositivo: "mobile" },
    ],
    enCola: { guide: 2, visitor: 3, improver: 1 },
  });
  assert.deepEqual(roles, {
    cataloger: { logrado: 1, fallido: 1, en_curso: 0, en_cola: 0 },
    guide: { logrado: 0, fallido: 0, en_curso: 1, en_cola: 2 },
    visitor: {
      all: { logrado: 2, fallido: 0, abandonado: 0, sin_medir: 1, error: 1, en_curso: 1, en_cola: 3 },
      desktop: { logrado: 1, fallido: 0, abandonado: 0, sin_medir: 0, error: 1, en_curso: 0, en_cola: 3 },
      mobile: { logrado: 1, fallido: 0, abandonado: 0, sin_medir: 1, error: 0, en_curso: 1, en_cola: 3 },
    },
    improver: { logrado: 1, fallido: 0, en_curso: 0, en_cola: 1 },
  });
  assert.equal(contarResumen({ corridas: [], intentos: [] }).visitor.mobile.en_cola, 0, "sin tabla: en cola 0");
});

const revision = (id, creada, estado) => ({ revision: id, creada, estado });

test("pestañas: por creada descendente (desempate por id), hasta 6 ids con el total; las en cola son tarjetas (§7.3)", () => {
  const revisiones = [
    revision("c-delivered", "2026-11-21T10:00:00.000Z", "delivered"),
    revision("b-running", "2026-11-22T03:00:00.000Z", "running"),
    revision("a-stalled", "2026-11-22T00:00:00Z", "stalled"),
    revision("q-dos", "2026-11-22T03:36:48.930Z", "queued"),
    revision("q-uno", "2026-11-22T03:36:47.759Z", "queued"),
    revision("f-uno", "2026-11-20T00:00:00.000Z", "failed"),
    revision("f-dos", "2026-11-20T00:00:00.000Z", "failed"),
    revision("sin-fecha", null, "delivered"),
  ];
  const listas = listasDelOverview(revisiones);
  assert.deepEqual(Object.keys(listas), ["cuentas", "pestanas"], "ya no hay cola");
  const { cuentas, pestanas } = listas;
  assert.deepEqual(cuentas, { total: 8, running: 2, stalled: 1, queued: 2, live: 4, delivered: 2, failed: 2 });
  assert.deepEqual(pestanas.recent, { ids: ["q-dos", "q-uno", "b-running", "a-stalled", "c-delivered", "f-dos"], total: 8 });
  assert.deepEqual(pestanas.live, { ids: ["q-dos", "q-uno", "b-running", "a-stalled"], total: 4 });
  assert.equal(cuentas.live, pestanas.live.total);
  assert.deepEqual(pestanas.delivered, { ids: ["c-delivered", "sin-fecha"], total: 2 });
  assert.deepEqual(pestanas.failed, { ids: ["f-dos", "f-uno"], total: 2 });
  assert.deepEqual(idsConTarjeta({ pestanas }), ["q-dos", "q-uno", "b-running", "a-stalled", "c-delivered", "f-dos", "sin-fecha", "f-uno"]);
});

const muchas = Array.from({ length: 30 }, (_, i) => revision(`r-${String(i).padStart(2, "0")}`, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`, i % 3 ? "delivered" : "failed"));

test("pestañas: con más de 6, el total dice cuántas hay", () => {
  const { pestanas } = listasDelOverview(muchas);
  assert.equal(MAXIMO_POR_PESTANA, 6);
  assert.deepEqual(pestanas.delivered, { ids: ["r-29", "r-28", "r-26", "r-25", "r-23", "r-22"], total: 20 });
  assert.deepEqual(listasDelOverview([]).pestanas.recent, { ids: [], total: 0 });
});

test("parámetros de /api/overview: pestaña conocida y límite entero entre 6 y 500; si no, la página de siempre", () => {
  assert.deepEqual([MAXIMO_POR_PESTANA, LIMITE_MAXIMO, PESTANAS], [6, 500, ["recent", "live", "delivered", "failed"]]);
  const de = (pestana, limite) => parametrosDelOverview({ pestana, limite });
  assert.deepEqual(de("delivered", "16"), { pestana: "delivered", limite: 16 });
  assert.deepEqual(de("live", 7), { pestana: "live", limite: 7 });
  assert.deepEqual(de("failed", "007"), { pestana: "failed", limite: 7 });
  assert.deepEqual(de("recent", "500"), { pestana: "recent", limite: 500 });
  assert.deepEqual(de("recent", "501"), { pestana: "recent", limite: 500 }, "tope");
  assert.deepEqual(de("recent", "99999999999"), { pestana: "recent", limite: 500 }, "tope");
  const siempre = { pestana: null, limite: 6 };
  for (const limite of ["6", "5", "0", "-7", "10.5", "1e3", "abc", "", " 8", null, undefined]) {
    assert.deepEqual(de("delivered", limite), siempre, `limite ${JSON.stringify(limite)}`);
  }
  for (const pestana of ["queued", "Delivered", "", null, undefined, "__proto__"]) {
    assert.deepEqual(de(pestana, "16"), siempre, `pestana ${JSON.stringify(pestana)}`);
  }
  assert.deepEqual(parametrosDelOverview(), siempre);
});

test("paginado: la pestaña pedida trae hasta `limite` ids, las demás 6, y el total no cambia", () => {
  const corta = listasDelOverview(muchas);
  const larga = listasDelOverview(muchas, parametrosDelOverview({ pestana: "delivered", limite: "16" }));
  assert.equal(larga.pestanas.delivered.ids.length, 16);
  assert.deepEqual(larga.pestanas.delivered.ids.slice(0, 6), corta.pestanas.delivered.ids, "empieza por la página anterior, en el mismo orden");
  for (const otra of ["recent", "live", "failed"]) assert.deepEqual(larga.pestanas[otra], corta.pestanas[otra], otra);
  assert.deepEqual(Object.values(larga.pestanas).map((p) => p.total), Object.values(corta.pestanas).map((p) => p.total));
  assert.deepEqual(larga.cuentas, corta.cuentas);
  const todo = listasDelOverview(muchas, { pestana: "delivered", limite: 500 });
  assert.equal(todo.pestanas.delivered.ids.length, 20, "no más de las que hay");
  // Las tarjetas: las de todos los ids devueltos; las de la página corta siguen ahí y en el mismo orden.
  const deLaCorta = idsConTarjeta(corta);
  assert.deepEqual(idsConTarjeta(larga).filter((id) => deLaCorta.includes(id)), deLaCorta);
  assert.equal(idsConTarjeta(larga).length, new Set(Object.values(larga.pestanas).flatMap((p) => p.ids)).size);
});
