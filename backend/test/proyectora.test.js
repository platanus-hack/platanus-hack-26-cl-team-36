import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claveDeEvento, crearProyectora, goalsElegidos, pasosDelGoal, profundidad } from "../proyectora.js";
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

test("goalsElegidos: sin barreras ni otros niveles, los más prominentes primero, hasta goals_max", () => {
  assert.deepEqual(goalsElegidos(GOALS.goals, 3), ["ver-contacto", "buscar-precio"]);
  assert.deepEqual(goalsElegidos(GOALS.goals, 1), ["ver-contacto"]);
});

test("goalsElegidos: los que salen del sitio o tienen barreras van al final", () => {
  const goals = [
    goal("fuera", { start_url: "https://www.ejemplo.cl/", entry: "https://otro.cl/x" }),
    goal("escondido", { prominence: "buried", start_url: "https://www.ejemplo.cl/", entry: "/ayuda" }),
    goal("con-efecto", { gates: ["side_effect"] }),
    goal("secundario", { prominence: "secondary", start_url: "https://www.ejemplo.cl/", entry: "https://pagos.ejemplo.cl/" }),
    goal("principal"),
  ];
  assert.deepEqual(goalsElegidos(goals, 10), ["principal", "secundario", "escondido", "con-efecto", "fuera"]);
});

test("goalsElegidos elige lo mismo que el conductor ante un catálogo real", () => {
  // agents/shared/tests/test_catalog.py lee el mismo archivo y espera lo mismo.
  const catalogo = JSON.parse(readFileSync(new URL("../../agents/shared/tests/data/catalogo-metro.json", import.meta.url)));
  assert.deepEqual(goalsElegidos(catalogo.goals, catalogo.goals_max), catalogo.expected);
  assert.deepEqual(goalsElegidos(catalogo.goals, Infinity), catalogo.expected_all);
  for (const [limite, esperado] of Object.entries(catalogo.expected_by_limit)) {
    assert.deepEqual(goalsElegidos(catalogo.goals, Number(limite)), esperado, `goals_max ${limite}`);
  }
});

test("con 8 goals: 4 largos, 2 medianos y 2 de los primeros, como for_revision", () => {
  const goal = (id, demand, estimated_steps) => ({ id, level: "user_goal", start_url: "https://ejemplo.cl/", demand, prominence: "secondary", estimated_steps });
  const goals = [
    ...[0, 1, 2, 3].map((n) => goal(`top-corto-${n}`, "top", 1)),
    ...[0, 1, 2].map((n) => goal(`medio-${n}`, "common", 3)),
    ...[0, 1, 2, 3, 4].map((n) => goal(`largo-${n}`, "rare", 6)),
  ];
  assert.deepEqual(goalsElegidos(goals, 8), ["top-corto-0", "top-corto-1", "medio-0", "medio-1", "largo-0", "largo-1", "largo-2", "largo-3"]);
});

test("profundidad: por pasos estimados o formulario, como depth de goal.py", () => {
  const pasos = [undefined, 1, 2, 3, 4, 5];
  assert.deepEqual(pasos.map((estimated_steps) => profundidad({ estimated_steps })), [null, "short", "short", "medium", "medium", "long"]);
  assert.equal(profundidad({ submits_form: true, estimated_steps: 1 }), "long");
});

test("goalsElegidos: primero las tareas principales y mezcla largas y medianas", () => {
  const goals = [
    goal("raro", { demand: "rare", estimated_steps: 1 }),
    goal("top-corto", { demand: "top", prominence: "secondary", estimated_steps: 1 }),
    goal("top-medio", { demand: "top", prominence: "secondary", estimated_steps: 3 }),
    goal("comun-largo", { demand: "common", prominence: "secondary", estimated_steps: 7 }),
    goal("raro-largo", { demand: "rare", prominence: "secondary", submits_form: true }),
    goal("comun-corto", { demand: "common", prominence: "secondary", estimated_steps: 2 }),
    goal("anterior", { prominence: "secondary" }),
  ];
  assert.deepEqual(goalsElegidos(goals, Infinity), ["top-corto", "top-medio", "comun-largo", "comun-corto", "anterior", "raro", "raro-largo"]);
  assert.deepEqual(goalsElegidos(goals, 3), ["top-corto", "top-medio", "comun-largo"]);
  assert.deepEqual(goalsElegidos(goals, 6), ["top-corto", "top-medio", "comun-largo", "comun-corto", "anterior", "raro-largo"]);
});

test("ignora manifiestos sin revisión y claves que no son manifiestos", async () => {
  const { db, almacen, proyectar } = escenario();
  almacen.archivos[`${CATALOGO}/manifest.json`] = { agent: "cataloger", status: "succeeded" };
  await proyectar(`${CATALOGO}/manifest.json`);
  await proyectar(`${CATALOGO}/goals.json`);
  assert.equal(db.items.size, 1);
});

test("manifiestos y catálogos malformados se saltan sin lanzar", async () => {
  const { db, almacen, proyectar, evento, item } = escenario();
  almacen.archivos[`${CONDUCTOR}/manifest.json`] = "{ no es json";
  await proyectar(`${CONDUCTOR}/manifest.json`);
  for (const manifiesto of [null, 5, [], { agent: "conductor", status: "toString" }, { agent: "conductor", status: "running", revision: 7 }]) {
    almacen.archivos[`${CONDUCTOR}/manifest.json`] = JSON.stringify(manifiesto);
    await proyectar(`${CONDUCTOR}/manifest.json`);
  }
  assert.equal(db.items.size, 1);

  for (const goals of ["{ roto", { goals: null }, { goals: [null, { id: 3 }, goal("ok", { gates: "login" })] }]) {
    almacen.archivos[`${CATALOGO}/goals.json`] = goals;
    await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  }
  assert.equal(item("STAGE#cataloger").status, "succeeded");
  assert.equal(item("GOAL#ok#guide"), undefined);
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

test("improver terminado guarda el tema sin tocar el status de META", async () => {
  const { evento, item } = escenario();
  await evento(CONDUCTOR, { agent: "conductor", status: "running" });
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  assert.equal(item("META").status, "running");
  assert.equal(item("META").css_key, `${MEJORA}/tema.css`);
});

test("improver con tema.json guarda también tema_key; sin él, no", async () => {
  const conTema = escenario();
  conTema.almacen.archivos[`${MEJORA}/tema.json`] = { features: {} };
  await conTema.evento(MEJORA, { agent: "improver", status: "succeeded" });
  assert.equal(conTema.item("META").tema_key, `${MEJORA}/tema.json`);

  const sinTema = escenario();
  await sinTema.evento(MEJORA, { agent: "improver", status: "succeeded" });
  assert.equal(sinTema.item("META").css_key, `${MEJORA}/tema.css`);
  assert.equal(sinTema.item("META").tema_key, null);
});

test("improver: cualquier error al buscar el tema.json cuenta como sin tema, sin frenar css_key", async (t) => {
  const avisos = t.mock.method(console, "warn", () => {});
  for (const [name, avisa] of [["AccessDenied", false], ["Forbidden", false], ["TimeoutError", true], ["Error", true]]) {
    const { almacen, evento, item } = escenario();
    almacen.archivos[`${MEJORA}/tema.json`] = { features: {} };
    almacen.cabecera = async () => {
      throw Object.assign(new Error("falla"), { name });
    };
    const antes = avisos.mock.callCount();
    await evento(MEJORA, { agent: "improver", status: "succeeded" });
    assert.equal(item("META").css_key, `${MEJORA}/tema.css`, name);
    assert.equal(item("META").tema_key, null, name);
    assert.equal(avisos.mock.callCount() > antes, avisa, name);
  }
});

test("improver: el tema.json se busca con HEAD, sin bajarlo", async () => {
  const { almacen, evento, item } = escenario();
  almacen.archivos[`${MEJORA}/tema.json`] = { features: {} };
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  assert.equal(item("META").tema_key, `${MEJORA}/tema.json`);
  assert.equal(almacen.leidos.includes(`${MEJORA}/tema.json`), false);
});

test("improver fallido no guarda css_key", async () => {
  const { evento, item } = escenario();
  await evento(MEJORA, { agent: "improver", status: "failed" });
  assert.equal(item("STAGE#improver").status, "failed");
  assert.equal(item("META").css_key, undefined);
});

const MEJORA_NUEVA = "ejemplo.cl/improver/20261122T090000Z";

test("improver de nuevo sobre una revisión done: el tema y la corrida pasan a la nueva, sin tocar el status", async () => {
  const { almacen, evento, item } = escenario();
  almacen.archivos[`${MEJORA}/tema.json`] = { features: {} };
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  await evento(CONDUCTOR, { agent: "conductor", status: "succeeded" });

  await evento(MEJORA_NUEVA, { agent: "improver", status: "running" });
  assert.equal(item("STAGE#improver").status, "succeeded");
  assert.equal(item("STAGE#improver").run_key, MEJORA);
  assert.equal(item("META").css_key, `${MEJORA}/tema.css`);

  await evento(MEJORA_NUEVA, { agent: "improver", status: "succeeded" });
  assert.equal(item("STAGE#improver").run_key, MEJORA_NUEVA);
  assert.equal(item("META").css_key, `${MEJORA_NUEVA}/tema.css`);
  assert.equal(item("META").tema_key, null, "sin tema.json no queda el de la corrida anterior");
  assert.equal(item("META").status, "done");
  assert.equal(item("META").resumen.fases.improver.succeeded, 1);

  // Lambda reintenta eventos viejos: la corrida anterior no vuelve.
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  assert.equal(item("STAGE#improver").run_key, MEJORA_NUEVA);
  assert.equal(item("META").css_key, `${MEJORA_NUEVA}/tema.css`);
});

test("improver de nuevo que falla deja el tema de la corrida anterior", async () => {
  const { evento, item } = escenario();
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  await evento(CONDUCTOR, { agent: "conductor", status: "succeeded" });
  await evento(MEJORA_NUEVA, { agent: "improver", status: "failed" });
  assert.equal(item("STAGE#improver").status, "succeeded");
  assert.equal(item("STAGE#improver").run_key, MEJORA);
  assert.equal(item("META").css_key, `${MEJORA}/tema.css`);
  assert.equal(item("META").status, "done");
});

test("claveDeEvento decodifica la clave del evento S3", () => {
  assert.equal(
    claveDeEvento({ s3: { object: { key: "ejemplo.cl%3A8080/cataloger/a+b/manifest.json" } } }),
    "ejemplo.cl:8080/cataloger/a b/manifest.json",
  );
});

// Trazas en vivo y resumen en META.

const GUIA_TRAZA = `${GUIA}/trace.json`;
const VISITA_TRAZA = `${VISITA}/desktop/trace.json`;
const VISITA_TRAZA_2 = `${VISITA}/desktop-2/trace.json`;
const CONTACTO = "ejemplo.cl/guide/ver-contacto/desktop/20261121T120600Z";
const INICIO = { url: "https://ejemplo.cl/", title: "Ejemplo", screenshot: "step_00.png" };
const pasoGuia = (n) => ({
  number: n,
  label: `click «Paso ${n}»`,
  action: "click",
  url_before: "https://ejemplo.cl/",
  url_after: `https://ejemplo.cl/p${n}`,
  title_after: `Página ${n}`,
});
const pasoVisita = (n) => ({ number: n, action: "left_click", description: `clic ${n}`, url: `https://ejemplo.cl/v${n}`, title: `Visita ${n}` });

const traza = (agent, pasos, extra = {}) => ({
  schema_version: 1,
  agent,
  goal: "buscar-precio",
  revision: REV,
  profile: agent === "visitor" ? "desktop" : null,
  status: "running",
  updated_at: `2026-11-21T12:00:${String(pasos.length).padStart(2, "0")}Z`,
  start: INICIO,
  steps: pasos,
  ...extra,
});

function conTrazas(opciones) {
  const base = escenario(opciones);
  const publicar = (clave, contenido) => {
    base.almacen.archivos[clave] = contenido;
    return base.proyectar(clave);
  };
  return { ...base, publicar, resumen: () => base.item("META").resumen };
}

// [pending, running, succeeded, failed, skipped] por fase.
const fases = (catalog, guide, visitor, improver) => {
  const n = ([pending = 0, running = 0, succeeded = 0, failed = 0, skipped = 0] = []) => ({ pending, running, succeeded, failed, skipped });
  return { catalog: n(catalog), guide: n(guide), visitor: n(visitor), improver: n(improver) };
};

test("traza de la Guía: pending → running con el paso, la acción y la página", async () => {
  const { evento, publicar, item } = conTrazas();
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  await publicar(GUIA_TRAZA, traza("guide", [pasoGuia(1), pasoGuia(2)]));
  assert.deepEqual(item("GOAL#buscar-precio#guide"), {
    ...claveRevision(REV, "GOAL#buscar-precio#guide"),
    status: "running",
    step: 2,
    last_action: "click «Paso 2»",
    last_url: "https://ejemplo.cl/p2",
    last_title: "Página 2",
    trace_key: GUIA_TRAZA,
    trace_at: "2026-11-21T12:00:02Z",
    updated_at: "2026-11-21T12:00:00.000Z",
  });
});

test("traza sin pasos: la página de inicio; la del Visitante usa los campos de run.json", async () => {
  const { publicar, item } = conTrazas();
  await publicar(VISITA_TRAZA, traza("visitor", []));
  const inicio = item("GOAL#buscar-precio#visitor");
  assert.deepEqual([inicio.status, inicio.step, inicio.last_action, inicio.last_url], ["running", 0, null, "https://ejemplo.cl/"]);

  await publicar(VISITA_TRAZA, traza("visitor", [pasoVisita(1)]));
  const visita = item("GOAL#buscar-precio#visitor");
  assert.deepEqual([visita.step, visita.last_action, visita.last_url, visita.last_title], [1, "clic 1", "https://ejemplo.cl/v1", "Visita 1"]);
  assert.equal(visita.trace_key, VISITA_TRAZA);
});

test("una traza tardía no retrocede un GOAL terminado ni un avance más nuevo", async () => {
  const { evento, publicar, almacen, proyectar, item } = conTrazas();
  await publicar(GUIA_TRAZA, traza("guide", [pasoGuia(1), pasoGuia(2), pasoGuia(3)], { status: "succeeded" }));
  await evento(GUIA, { agent: "guide", goal: "buscar-precio", status: "succeeded" });
  // Otra invocación leyó una versión vieja del trace.json y escribe después.
  almacen.archivos[GUIA_TRAZA] = traza("guide", [pasoGuia(1)]);
  await proyectar(GUIA_TRAZA);
  const guia = item("GOAL#buscar-precio#guide");
  assert.deepEqual([guia.status, guia.step, guia.run_key], ["succeeded", 3, GUIA]);
});

test("Visitante con varios intentos: el GOAL muestra el último que avanzó, sin importar el orden", async () => {
  const primero = [VISITA_TRAZA, traza("visitor", [pasoVisita(1), pasoVisita(2), pasoVisita(3)], { updated_at: "2026-11-21T12:00:10Z" })];
  const segundo = [VISITA_TRAZA_2, traza("visitor", [pasoVisita(1)], { updated_at: "2026-11-21T12:00:20Z" })];
  for (const orden of [[primero, segundo], [segundo, primero]]) {
    const { publicar, item, resumen } = conTrazas();
    for (const [clave, contenido] of orden) await publicar(clave, contenido);
    assert.equal(item("GOAL#buscar-precio#visitor").trace_key, VISITA_TRAZA_2);
    assert.equal(item("GOAL#buscar-precio#visitor").step, 1);
    // El resumen suma los pasos de todos los intentos, también los del que avanzó antes.
    assert.equal(resumen().pasos, 4);
  }
});

test("Visitante con varios intentos: un aviso viejo de un intento no le baja los pasos", async () => {
  const { publicar, almacen, proyectar, resumen } = conTrazas();
  await publicar(VISITA_TRAZA, traza("visitor", [pasoVisita(1), pasoVisita(2)]));
  await publicar(VISITA_TRAZA_2, traza("visitor", [pasoVisita(1), pasoVisita(2), pasoVisita(3)]));
  almacen.archivos[VISITA_TRAZA] = traza("visitor", [pasoVisita(1)]);
  await proyectar(VISITA_TRAZA);
  assert.equal(resumen().pasos, 5);
});

test("pasosDelGoal: los de cada intento si los hay; si no, step", () => {
  assert.equal(pasosDelGoal({ step: 3 }), 3);
  assert.equal(pasosDelGoal({ step: 1, "step#desktop": 4, "step#mobile": 1, "trace_at#desktop": "x" }), 5);
  assert.equal(pasosDelGoal({}), 0);
});

test("trazas malformadas, sin revisión, de una revisión inexistente o fuera del layout se ignoran sin lanzar", async () => {
  const { db, publicar } = conTrazas();
  const antes = structuredClone([...db.items]);
  await publicar(GUIA_TRAZA, "{ no es json");
  for (const contenido of [null, 5, [], traza("guide", [], { revision: undefined }), traza("guide", "x"), traza("guide", [], { updated_at: 3 })]) {
    await publicar(GUIA_TRAZA, JSON.stringify(contenido));
  }
  await publicar(GUIA_TRAZA, traza("guide", [pasoGuia(1)], { revision: "otra" }));
  await publicar("ejemplo.cl/guide/trace.json", traza("guide", []));
  await publicar(`${CATALOGO}/x/trace.json`, traza("guide", []));
  assert.deepEqual([...db.items], antes);
});

test("resumen: recién creada, todo pending", async () => {
  const { evento, resumen, item } = conTrazas();
  await evento(CONDUCTOR, { agent: "conductor", status: "running" });
  assert.deepEqual(resumen(), { fases: fases([1], [], [], [1]), agentes_activos: 0, pasos: 0, goals_total: 0 });
  assert.equal(item("META").status, "running");
  assert.equal(item("META").updated_at, "2026-11-21T12:00:00.000Z");
});

test("resumen: catálogo listo con goals pending", async () => {
  const { evento, resumen } = conTrazas();
  await evento(CATALOGO, { agent: "cataloger", status: "running" });
  assert.deepEqual(resumen(), { fases: fases([0, 1], [], [], [1]), agentes_activos: 1, pasos: 0, goals_total: 0 });
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  assert.deepEqual(resumen(), { fases: fases([0, 0, 1], [2], [2], [1]), agentes_activos: 0, pasos: 0, goals_total: 2 });
});

test("resumen: varios agentes corriendo suman sus pasos", async () => {
  const { evento, publicar, resumen } = conTrazas();
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  await publicar(GUIA_TRAZA, traza("guide", [pasoGuia(1), pasoGuia(2)]));
  await publicar(`${CONTACTO}/trace.json`, { ...traza("guide", [pasoGuia(1)]), goal: "ver-contacto" });
  await evento(GUIA, { agent: "guide", goal: "buscar-precio", status: "succeeded" });
  await publicar(VISITA_TRAZA, traza("visitor", [pasoVisita(1), pasoVisita(2), pasoVisita(3)]));
  assert.deepEqual(resumen(), { fases: fases([0, 0, 1], [0, 1, 1], [1, 1], [1]), agentes_activos: 2, pasos: 6, goals_total: 2 });
});

test("resumen: todo terminado sin pisar status ni css_key", async () => {
  const { evento, publicar, resumen, item } = conTrazas({ goalsMax: 1 });
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  await publicar(`${CONTACTO}/trace.json`, { ...traza("guide", [pasoGuia(1)]), goal: "ver-contacto" });
  await evento(CONTACTO, { agent: "guide", goal: "ver-contacto", status: "succeeded" });
  await evento("ejemplo.cl/visitor/ver-contacto/20261121T121000Z", { agent: "visitor", goal: "ver-contacto", status: "failed" });
  await evento(MEJORA, { agent: "improver", status: "succeeded" });
  await evento(CONDUCTOR, { agent: "conductor", status: "succeeded" });
  assert.deepEqual(resumen(), {
    fases: fases([0, 0, 1], [0, 0, 1], [0, 0, 0, 1], [0, 0, 1]),
    agentes_activos: 0,
    pasos: 1,
    goals_total: 1,
  });
  assert.equal(item("META").status, "done");
  assert.equal(item("META").css_key, `${MEJORA}/tema.css`);
});

test("resumen: revisión fallida", async () => {
  const { evento, resumen, item } = conTrazas();
  await evento(CATALOGO, { agent: "cataloger", status: "failed" });
  await evento(CONDUCTOR, { agent: "conductor", status: "failed" });
  assert.deepEqual(resumen(), { fases: fases([0, 0, 0, 1], [], [], [1]), agentes_activos: 0, pasos: 0, goals_total: 0 });
  assert.equal(item("META").status, "failed");
});

test("Guía fallida: su Visitante sigue pending y corre igual", async () => {
  const { evento, resumen, item } = conTrazas();
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  await evento(GUIA, { agent: "guide", goal: "buscar-precio", status: "failed" });
  assert.equal(item("GOAL#buscar-precio#visitor").status, "pending");
  await evento(VISITA, { agent: "visitor", goal: "buscar-precio", status: "running" });
  await evento(VISITA, { agent: "visitor", goal: "buscar-precio", status: "succeeded" });
  assert.equal(item("GOAL#buscar-precio#visitor").status, "succeeded");
  assert.deepEqual(resumen().fases.visitor, { pending: 1, running: 0, succeeded: 1, failed: 0, skipped: 0 });
});

test("eventos repetidos y desordenados dejan el mismo resultado final", async () => {
  // Cada evento lee el objeto tal como quedó en S3.
  const archivos = {
    [`${CATALOGO}/manifest.json`]: { revision: REV, agent: "cataloger", status: "succeeded" },
    [`${GUIA}/manifest.json`]: { revision: REV, agent: "guide", goal: "buscar-precio", status: "succeeded" },
    [GUIA_TRAZA]: traza("guide", [pasoGuia(1), pasoGuia(2)], { status: "succeeded" }),
    [VISITA_TRAZA]: traza("visitor", [pasoVisita(1)]),
    [`${CONDUCTOR}/manifest.json`]: { revision: REV, agent: "conductor", status: "running" },
  };
  const claves = Object.keys(archivos);
  async function final(orden) {
    const { db, almacen, proyectar } = conTrazas();
    Object.assign(almacen.archivos, structuredClone(archivos));
    for (const i of orden) await proyectar(claves[i]);
    // resumen_version cuenta escrituras, no estado.
    delete db.item(claveRevision(REV)).resumen_version;
    return Object.fromEntries(db.items);
  }
  const enOrden = await final([0, 1, 2, 3, 4]);
  for (const orden of [[4, 3, 2, 1, 0], [2, 0, 3, 3, 4, 1, 2, 0], [1, 1, 3, 0, 2, 4, 4]]) {
    assert.deepEqual(await final(orden), enOrden);
  }
  assert.equal(enOrden[`REV#${REV}|GOAL#buscar-precio#guide`].status, "succeeded");
  assert.equal(enOrden[`REV#${REV}|GOAL#buscar-precio#visitor`].status, "running");
  assert.deepEqual(enOrden[`REV#${REV}|META`].resumen.fases.guide, { pending: 1, running: 0, succeeded: 1, failed: 0, skipped: 0 });
  assert.equal(enOrden[`REV#${REV}|META`].resumen.pasos, 3);
});

test("resumen: una consulta vieja no pisa la de una más nueva, aunque marquen la misma hora", async () => {
  const { db, evento, publicar, resumen } = conTrazas();
  await evento(CATALOGO, { agent: "cataloger", status: "succeeded" });
  // La Guía consulta para su resumen y, antes de que escriba, el Visitante proyecta su traza entera.
  const listar = db.listar;
  let consultas = 0;
  db.listar = async (PK) => {
    const foto = await listar(PK);
    if (++consultas === 2) await publicar(VISITA_TRAZA, traza("visitor", [pasoVisita(1)]));
    return foto;
  };
  await publicar(GUIA_TRAZA, traza("guide", [pasoGuia(1)]));
  assert.deepEqual(resumen().fases.visitor, { pending: 1, running: 1, succeeded: 0, failed: 0, skipped: 0 });
  assert.equal(resumen().pasos, 2);
});
