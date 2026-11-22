// Cifras, pestañas y cola del Overview (lib/overview.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAXIMO_POR_PESTANA, contarResumen, idsConTarjeta, listasDelOverview } from "../lib/overview.js";

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

test("pestañas: por creada descendente (desempate por id), hasta 6 ids con el total", () => {
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
  const { cuentas, pestanas, cola } = listasDelOverview(revisiones);
  assert.deepEqual(cuentas, { total: 8, running: 2, stalled: 1, queued: 2, live: 4, delivered: 2, failed: 2 });
  assert.deepEqual(pestanas.recent, { ids: ["b-running", "a-stalled", "c-delivered", "f-dos", "f-uno", "sin-fecha"], total: 6 });
  assert.deepEqual(pestanas.live, { ids: ["b-running", "a-stalled"], total: 2 });
  assert.deepEqual(pestanas.delivered, { ids: ["c-delivered", "sin-fecha"], total: 2 });
  assert.deepEqual(pestanas.failed, { ids: ["f-dos", "f-uno"], total: 2 });
  assert.deepEqual(cola, { ids: ["q-uno", "q-dos"], total: 2 }, "la cola por orden de llegada");
  assert.deepEqual(idsConTarjeta({ pestanas, cola }), ["b-running", "a-stalled", "c-delivered", "f-dos", "f-uno", "sin-fecha", "q-uno", "q-dos"]);
});

test("pestañas: con más de 6, el total dice cuántas hay", () => {
  const muchas = Array.from({ length: 20 }, (_, i) => revision(`r-${String(i).padStart(2, "0")}`, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`, "delivered"));
  const { pestanas } = listasDelOverview(muchas);
  assert.equal(MAXIMO_POR_PESTANA, 6);
  assert.deepEqual(pestanas.delivered, { ids: ["r-19", "r-18", "r-17", "r-16", "r-15", "r-14"], total: 20 });
  assert.deepEqual(listasDelOverview([]).pestanas.recent, { ids: [], total: 0 });
});
