import { test } from "node:test";
import assert from "node:assert/strict";
import { claveDeEvento, crearProyectora, goalsElegidos } from "../proyectora.js";
import { claveRevision } from "../estados.js";
import { almacenFalso, tablaFalsa } from "./fakes.js";

const REV = "mfx0abc-1a2b3c";
const CATALOGO = "ejemplo.cl/cataloger/20261121T120000Z";
const GUIA = "ejemplo.cl/guide/buscar-precio/desktop/20261121T120500Z";
const VISITA = "ejemplo.cl/visitor/buscar-precio/20261121T121000Z";
const MEJORA = "ejemplo.cl/improver/20261121T123000Z";
const CONDUCTOR = "ejemplo.cl/conductor/20261121T115900Z";

const goal = (id, extra = {}) => ({ id, level: "user_goal", gates: [], prominence: "primary", exclusion: null, ...extra });
const GOALS = {
  host: "ejemplo.cl",
  issues: [],
  goals: [
    goal("ver-contacto"),
    goal("buscar-precio", { prominence: "buried" }),
    goal("iniciar-sesion", { gates: ["login"], exclusion: "barrera login" }),
    goal("comprar", { level: "summary", exclusion: "nivel summary" }),
  ],
};

function escenario({ goalsMax = 3 } = {}) {
  const db = tablaFalsa();
  db.items.set(`REV#${REV}|META`, { ...claveRevision(REV), url: "https://ejemplo.cl", status: "queued" });
  const almacen = almacenFalso({ [`${CATALOGO}/goals.json`]: GOALS });
  const proyectar = crearProyectora({ db, almacen, goalsMax, ahora: () => new Date("2026-11-21T12:00:00Z") });
  // Publica el manifiesto (como lo dejaría el agente) y entrega el evento.
  const evento = (runKey, manifiesto) => {
    almacen.archivos[`${runKey}/manifest.json`] = { revision: REV, ...manifiesto };
    return proyectar(`${runKey}/manifest.json`);
  };
  return { db, almacen, proyectar, evento, item: (SK) => db.item(claveRevision(REV, SK)) };
}

test("goalsElegidos: sin barreras ni otros niveles, los escondidos primero, hasta goals_max", () => {
  assert.deepEqual(goalsElegidos(GOALS.goals, 3), ["buscar-precio", "ver-contacto"]);
  assert.deepEqual(goalsElegidos(GOALS.goals, 1), ["buscar-precio"]);
});

test("ignora manifiestos sin revisión y claves que no son manifiestos", async () => {
  const { db, almacen, proyectar } = escenario();
  almacen.archivos[`${CATALOGO}/manifest.json`] = { agent: "cataloger", status: "succeeded" };
  await proyectar(`${CATALOGO}/manifest.json`);
  await proyectar(`${CATALOGO}/goals.json`);
  assert.equal(db.items.size, 1);
});

test("conductor: running → running, succeeded → done, failed → failed", async () => {
  for (const [status, meta] of [["running", "running"], ["succeeded", "done"], ["failed", "failed"]]) {
    const { evento, item } = escenario();
    await evento(CONDUCTOR, { agent: "conductor", status });
    assert.equal(item("META").status, meta);
  }
});

test("conductor de una revisión que la API no creó no inventa META", async () => {
  const { db, almacen, proyectar } = escenario();
  almacen.archivos[`${CONDUCTOR}/manifest.json`] = { agent: "conductor", status: "running", revision: "otra" };
  await proyectar(`${CONDUCTOR}/manifest.json`);
  assert.equal(db.item(claveRevision("otra")), undefined);
});

test("catálogo terminado: STAGE, goals pending y goals_total", async () => {
  const { evento, item } = escenario();
  await evento(CATALOGO, { agent: "cataloger", status: "running" });
  assert.deepEqual(item("STAGE#cataloger"), {
    ...claveRevision(REV, "STAGE#cataloger"),
    status: "running",
    run_key: CATALOGO,
    updated_at: "2026-11-21T12:00:00.000Z",
  });
  assert.equal(item("GOAL#buscar-precio#guide"), undefined);

  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  assert.equal(item("STAGE#cataloger").status, "succeeded");
  for (const id of ["buscar-precio", "ver-contacto"]) {
    assert.equal(item(`GOAL#${id}#guide`).status, "pending");
    assert.equal(item(`GOAL#${id}#visitor`).status, "pending");
  }
  assert.equal(item("GOAL#iniciar-sesion#guide"), undefined);
  assert.equal(item("META").goals_total, 2);
});

test("guide y visitor actualizan su GOAL", async () => {
  const { evento, item } = escenario();
  await evento(GUIA, { agent: "guide", goal: "buscar-precio", viewport: "desktop", status: "succeeded" });
  await evento(VISITA, { agent: "visitor", goal: "buscar-precio", status: "running" });
  assert.equal(item("GOAL#buscar-precio#guide").status, "succeeded");
  assert.equal(item("GOAL#buscar-precio#guide").run_key, GUIA);
  assert.equal(item("GOAL#buscar-precio#visitor").status, "running");
});

test("el catálogo que llega tarde no pisa goals que ya avanzaron", async () => {
  const { evento, item } = escenario();
  await evento(GUIA, { agent: "guide", goal: "buscar-precio", viewport: "desktop", status: "running" });
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  assert.equal(item("GOAL#buscar-precio#guide").status, "running");
  assert.equal(item("GOAL#buscar-precio#guide").run_key, GUIA);
  assert.equal(item("GOAL#ver-contacto#guide").status, "pending");
});

test("eventos repetidos y desordenados: un running tardío no retrocede", async () => {
  const { evento, item } = escenario();
  await evento(VISITA, { agent: "visitor", goal: "buscar-precio", status: "succeeded" });
  await evento(VISITA, { agent: "visitor", goal: "buscar-precio", status: "running" });
  await evento(VISITA, { agent: "visitor", goal: "buscar-precio", status: "succeeded" });
  assert.equal(item("GOAL#buscar-precio#visitor").status, "succeeded");

  await evento(CONDUCTOR, { agent: "conductor", status: "succeeded" });
  await evento(CONDUCTOR, { agent: "conductor", status: "running" });
  await evento(CONDUCTOR, { agent: "conductor", status: "failed" });
  assert.equal(item("META").status, "done");
});

test("improver terminado guarda css_key en META", async () => {
  const { evento, item } = escenario();
  await evento(MEJORA, { agent: "improver", status: "running" });
  assert.equal(item("META").css_key, undefined);
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  assert.equal(item("STAGE#improver").status, "succeeded");
  assert.equal(item("META").css_key, `${MEJORA}/tema.css`);
});

test("improver fallido no guarda css_key", async () => {
  const { evento, item } = escenario();
  await evento(MEJORA, { agent: "improver", status: "failed" });
  assert.equal(item("STAGE#improver").status, "failed");
  assert.equal(item("META").css_key, undefined);
});

test("claveDeEvento decodifica la clave del evento S3", () => {
  assert.equal(
    claveDeEvento({ s3: { object: { key: "ejemplo.cl%3A8080/cataloger/a+b/manifest.json" } } }),
    "ejemplo.cl:8080/cataloger/a b/manifest.json",
  );
});
