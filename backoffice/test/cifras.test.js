// Cifras, pestañas y cola del Overview (lib/overview.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGINA_MAXIMA, PESTANAS, POR_PAGINA, contarResumen, idsConTarjeta, listasDelOverview, parametrosDelOverview } from "../lib/overview.js";

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
  assert.deepEqual(pestanas.recent, { ids: ["q-dos", "q-uno", "b-running", "a-stalled", "c-delivered", "f-dos"], total: 8, pagina: 1, paginas: 2 });
  assert.deepEqual(pestanas.live, { ids: ["q-dos", "q-uno", "b-running", "a-stalled"], total: 4, pagina: 1, paginas: 1 });
  assert.equal(cuentas.live, pestanas.live.total);
  assert.deepEqual(pestanas.delivered, { ids: ["c-delivered", "sin-fecha"], total: 2, pagina: 1, paginas: 1 });
  assert.deepEqual(pestanas.failed, { ids: ["f-dos", "f-uno"], total: 2, pagina: 1, paginas: 1 });
  assert.deepEqual(idsConTarjeta({ pestanas }), ["q-dos", "q-uno", "b-running", "a-stalled", "c-delivered", "f-dos", "sin-fecha", "f-uno"]);
});

const muchas = Array.from({ length: 30 }, (_, i) => revision(`r-${String(i).padStart(2, "0")}`, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`, i % 3 ? "delivered" : "failed"));

test("pestañas: con más de 6, la página 1 y cuántas páginas y revisiones hay", () => {
  const { pestanas } = listasDelOverview(muchas);
  assert.equal(POR_PAGINA, 6);
  assert.deepEqual(pestanas.delivered, { ids: ["r-29", "r-28", "r-26", "r-25", "r-23", "r-22"], total: 20, pagina: 1, paginas: 4 });
  assert.deepEqual(listasDelOverview([]).pestanas.recent, { ids: [], total: 0, pagina: 1, paginas: 1 }, "sin revisiones hay una página, vacía");
});

test("parámetros de /api/overview: pestaña conocida y página entera desde 2; si no, la página 1 de siempre", () => {
  assert.deepEqual([POR_PAGINA, PAGINA_MAXIMA, PESTANAS], [6, 9999, ["recent", "live", "delivered", "failed"]]);
  const de = (pestana, pagina) => parametrosDelOverview({ pestana, pagina });
  assert.deepEqual(de("delivered", "3"), { pestana: "delivered", pagina: 3, link: null });
  assert.deepEqual(de("live", 2), { pestana: "live", pagina: 2, link: null });
  assert.deepEqual(de("failed", "007"), { pestana: "failed", pagina: 7, link: null });
  assert.deepEqual(de("recent", "9999"), { pestana: "recent", pagina: 9999, link: null });
  assert.deepEqual(de("recent", "10000"), { pestana: "recent", pagina: 9999, link: null }, "tope");
  assert.deepEqual(de("recent", "999999999"), { pestana: "recent", pagina: 9999, link: null }, "tope");
  const siempre = { pestana: null, pagina: 1, link: null };
  for (const pagina of ["1", "0", "-2", "2.5", "1e3", "abc", "", " 2", "9999999999", null, undefined]) {
    assert.deepEqual(de("delivered", pagina), siempre, `pagina ${JSON.stringify(pagina)}`);
  }
  for (const pestana of ["queued", "Delivered", "", null, undefined, "__proto__"]) {
    assert.deepEqual(de(pestana, "3"), siempre, `pestana ${JSON.stringify(pestana)}`);
  }
  assert.deepEqual(parametrosDelOverview(), siempre);
});

test("paginado: la pestaña pedida trae su página de 6, las demás la 1, y los totales no cambian", () => {
  const primera = listasDelOverview(muchas);
  const tercera = listasDelOverview(muchas, parametrosDelOverview({ pestana: "delivered", pagina: "3" }));
  assert.deepEqual(tercera.pestanas.delivered, { ids: ["r-11", "r-10", "r-08", "r-07", "r-05", "r-04"], total: 20, pagina: 3, paginas: 4 });
  const cuarta = listasDelOverview(muchas, { pestana: "delivered", pagina: 4 });
  assert.deepEqual(cuarta.pestanas.delivered, { ids: ["r-02", "r-01"], total: 20, pagina: 4, paginas: 4 }, "la última, con lo que queda");
  // Las páginas, una tras otra, son la lista entera sin repetir ni saltar.
  const enOrden = [1, 2, 3, 4].flatMap((pagina) => listasDelOverview(muchas, { pestana: "delivered", pagina }).pestanas.delivered.ids);
  assert.equal(new Set(enOrden).size, 20);
  assert.deepEqual(enOrden.slice(0, 6), primera.pestanas.delivered.ids);
  for (const otra of ["recent", "live", "failed"]) assert.deepEqual(tercera.pestanas[otra], primera.pestanas[otra], otra);
  assert.deepEqual(tercera.cuentas, primera.cuentas);
  // Una página que ya no existe vale la última: la página dice cuál dio.
  assert.deepEqual(listasDelOverview(muchas, { pestana: "delivered", pagina: 9 }).pestanas.delivered, cuarta.pestanas.delivered);
  assert.deepEqual(listasDelOverview([], { pestana: "failed", pagina: 5 }).pestanas.failed, { ids: [], total: 0, pagina: 1, paginas: 1 });
  // Las tarjetas: las de todos los ids devueltos, sin repetir.
  assert.equal(idsConTarjeta(tercera).length, new Set(Object.values(tercera.pestanas).flatMap((p) => p.ids)).size);
});

test("búsqueda por link: normalizada en los parámetros y, en las listas, solo lo que calza (cifras incluidas)", () => {
  assert.deepEqual(parametrosDelOverview({ link: "  Metro.CL/  " }), { pestana: null, pagina: 1, link: "metro.cl/" });
  assert.deepEqual(parametrosDelOverview({ link: "   " }), { pestana: null, pagina: 1, link: null });
  assert.deepEqual(parametrosDelOverview({ pestana: "failed", pagina: "2", link: "dt" }), { pestana: "failed", pagina: 2, link: "dt" });
  const conLink = (id, url, estado, creada) => ({ ...revision(id, creada, estado), url });
  const revisiones = [
    conLink("metro", "https://www.metro.cl/", "delivered", "2026-11-22T03:00:00Z"),
    conLink("metro-mapa", "https://metro.cl/mapa", "failed", "2026-11-22T02:00:00Z"),
    conLink("dt", "https://www.dt.gob.cl/portal/1626", "running", "2026-11-22T01:00:00Z"),
    conLink("sin-url", null, "queued", "2026-11-22T00:00:00Z"),
  ];
  const metro = listasDelOverview(revisiones, parametrosDelOverview({ link: "https://www.metro.cl/" }));
  assert.deepEqual(metro.pestanas.recent.ids, ["metro", "metro-mapa"]);
  assert.deepEqual(metro.cuentas, { total: 2, running: 0, stalled: 0, queued: 0, live: 0, delivered: 1, failed: 1 });
  assert.deepEqual(listasDelOverview(revisiones, { link: "mapa metro" }).pestanas.recent.ids, ["metro-mapa"], "cada palabra debe estar");
  assert.deepEqual(listasDelOverview(revisiones, { link: "zzz" }).pestanas.recent, { ids: [], total: 0, pagina: 1, paginas: 1 });
  assert.equal(listasDelOverview(revisiones, { link: null }).cuentas.total, 4, "sin búsqueda, todas");
});
