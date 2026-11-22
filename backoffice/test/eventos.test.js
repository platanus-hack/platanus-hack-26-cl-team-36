// De lo leído de un goal (trace.json, route.json, run.json) a eventos v1 de la telaraña viva.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearSeguimiento, eventosDelGoal, goalTerminado, rutaDeLaGuia } from "../lib/eventos.js";

const GUIA = "ejemplo.test/guide/horario/desktop/2026-11-22T12-00-00Z";
const VISITA = "ejemplo.test/visitor/horario/2026-11-22T12-05-00Z";
const INICIO = { url: "https://www.ejemplo.test/?utm_source=x", title: "Inicio " };
const AYUDA = { url: "https://www.ejemplo.test/ayuda/", title: "Ayuda" };
const HORARIO = { url: "https://www.ejemplo.test/ayuda/horario", title: "Horario" };

const pasoDeGuia = (number, antes, despues) => ({
  number,
  label: `click «${despues.title}»`,
  action: "click",
  target: { tag: "a", text: despues.title },
  url_before: antes.url,
  title_before: antes.title,
  url_after: despues.url,
  title_after: despues.title,
});
const pasoDeVisita = (number, antes, despues, segundos, campos = {}) => ({
  number,
  action: "left_click",
  element: { tag: "a", text: despues.title },
  url_before: antes.url,
  title_before: antes.title,
  url: despues.url,
  title: despues.title,
  seconds_since_start: segundos,
  settled_at: `2026-11-22T12:05:${String(segundos).padStart(2, "0")}.000Z`,
  signals: [],
  ...campos,
});
const traza = (status, steps) => ({ schema_version: 1, agent: "visitor", profile: "desktop", status, start: INICIO, steps });

const leido = ({ guia = null, estadoGuia = "running", intentos = [], estadoVisita = "running", estado = "running" } = {}) => ({
  revision: "en-curso",
  host: "ejemplo.test",
  estado,
  goal: {
    goal: "horario",
    guide: { estado: estadoGuia, runKey: GUIA, recorrido: guia },
    visitor: { estado: estadoVisita, runKey: VISITA, intentos },
  },
});
const RUTA = { goal: "horario", status: "verified", start: INICIO, steps: [pasoDeGuia(1, INICIO, AYUDA), pasoDeGuia(2, AYUDA, HORARIO)] };
const resumen = (eventos) => eventos.map((e) => `${e.agent}:${e.attempt}:${e.type}:${e.step}`);

test("un recorrido da start, un step por paso y end con su veredicto; las páginas van normalizadas", () => {
  const eventos = eventosDelGoal(
    leido({
      guia: { archivo: "route.json", datos: RUTA },
      estadoGuia: "succeeded",
      intentos: [{ carpeta: "desktop", archivo: "run.json", datos: { ...traza("succeeded", [pasoDeVisita(1, INICIO, AYUDA, 4)]), end_reason: "done", duration_s: 9, verdict: { outcome: "success" } } }],
      estadoVisita: "succeeded",
    }),
  );
  assert.deepEqual(resumen(eventos), [
    "guide:guia:start:0", "guide:guia:step:1", "guide:guia:step:2", "guide:guia:end:2",
    "visitor:desktop:start:0", "visitor:desktop:step:1", "visitor:desktop:end:1",
  ]);
  const [inicio, clic] = eventos;
  assert.deepEqual(inicio, {
    v: 1,
    id: `${GUIA}|guia|0|start`,
    ts: "2026-11-22T12:00:00.000Z",
    revision: "en-curso",
    host: "ejemplo.test",
    goal: "horario",
    agent: "guide",
    run_id: `${GUIA}|guia`,
    attempt: "guia",
    type: "start",
    step: 0,
    node: { url: "https://ejemplo.test/", title: "Inicio" },
    signals: [],
  });
  assert.equal(clic.action, "left_click");
  assert.deepEqual(clic.from, { url: "https://ejemplo.test/", title: "Inicio" });
  assert.deepEqual(clic.node, { url: "https://ejemplo.test/ayuda", title: "Ayuda" });
  const fin = eventos.at(-1);
  assert.deepEqual([fin.outcome, fin.end_reason, fin.ts], ["success", "done", "2026-11-22T12:05:09.000Z"]);
  assert.equal(eventos.find((e) => e.agent === "visitor" && e.type === "step").ts, "2026-11-22T12:05:04.000Z");
});

test("acciones y señales: volver es go_back, las señales del Visitante pasan tal cual", () => {
  const pasos = [
    pasoDeVisita(1, INICIO, AYUDA, 4),
    pasoDeVisita(2, AYUDA, INICIO, 6, { action: "key", signals: ["went_back"] }),
    pasoDeVisita(3, INICIO, AYUDA, 8, { action: "volver_a_nodo", signals: ["revisit"] }),
    pasoDeVisita(4, AYUDA, AYUDA, 9, { action: "scroll", signals: ["no_effect"] }),
  ];
  const pasosDe = eventosDelGoal(leido({ intentos: [{ carpeta: "desktop", archivo: "trace.json", datos: traza("running", pasos) }] })).filter((e) => e.type === "step");
  assert.deepEqual(pasosDe.map((e) => [e.action, e.signals]), [
    ["left_click", []], ["go_back", ["went_back"]], ["go_back", ["revisit"]], ["scroll", ["no_effect"]],
  ]);
});

test("dos lecturas del mismo recorrido: solo sale lo nuevo y los ids no cambian", () => {
  const nuevos = crearSeguimiento();
  const intento = (status, pasos) => [{ carpeta: "desktop", archivo: "trace.json", datos: traza(status, pasos) }];
  const primera = nuevos(eventosDelGoal(leido({ intentos: intento("running", [pasoDeVisita(1, INICIO, AYUDA, 4)]) })));
  assert.deepEqual(resumen(primera), ["visitor:desktop:start:0", "visitor:desktop:step:1"]);
  const pasos = [pasoDeVisita(1, INICIO, AYUDA, 4), pasoDeVisita(2, AYUDA, HORARIO, 7)];
  const segunda = nuevos(eventosDelGoal(leido({ intentos: intento("running", pasos) })));
  assert.deepEqual(segunda.map((e) => e.id), [`${VISITA}|desktop|2|step`]);
  assert.deepEqual(nuevos(eventosDelGoal(leido({ intentos: intento("running", pasos) }))), []);
});

test("un intento que pasa a terminado emite end una sola vez, aunque cambie su archivo", () => {
  const nuevos = crearSeguimiento();
  const pasos = [pasoDeVisita(1, INICIO, AYUDA, 4)];
  // Una traza "succeeded" espera el veredicto de run.json.
  assert.deepEqual(resumen(nuevos(eventosDelGoal(leido({ intentos: [{ carpeta: "desktop", archivo: "trace.json", datos: traza("succeeded", pasos) }] })))), [
    "visitor:desktop:start:0", "visitor:desktop:step:1",
  ]);
  const run = { carpeta: "desktop", archivo: "run.json", datos: { ...traza("succeeded", pasos), end_reason: "done", verdict: { outcome: "failed" } } };
  const fin = nuevos(eventosDelGoal(leido({ intentos: [run], estadoVisita: "succeeded" })));
  assert.deepEqual(fin.map((e) => [e.type, e.outcome, e.end_reason]), [["end", "failed", "done"]]);
  // Terminado, nada más de ese intento sale (la Guía pasa de trace.json a route.json con otros pasos).
  const masLargo = { ...run, datos: { ...run.datos, steps: [...pasos, pasoDeVisita(2, AYUDA, HORARIO, 7)] } };
  assert.deepEqual(nuevos(eventosDelGoal(leido({ intentos: [masLargo], estadoVisita: "succeeded" }))), []);
});

test("interrumpido: la traza failed termina con error; la etapa cerrada sin run.json también", () => {
  const pasos = [pasoDeVisita(1, INICIO, AYUDA, 4)];
  const interrumpido = eventosDelGoal(leido({ intentos: [{ carpeta: "mobile", archivo: "trace.json", datos: traza("failed", pasos) }] })).at(-1);
  assert.deepEqual([interrumpido.type, interrumpido.outcome, interrumpido.end_reason], ["end", "error", "interrupted"]);
  const caida = eventosDelGoal(leido({ intentos: [{ carpeta: "mobile", archivo: "trace.json", datos: traza("running", pasos) }], estadoVisita: "failed" })).at(-1);
  assert.deepEqual([caida.type, caida.outcome], ["end", "error"]);
  const run = (outcome) => ({ carpeta: "mobile", archivo: "run.json", datos: { ...traza("failed", pasos), end_reason: "api_error", verdict: { outcome } } });
  assert.equal(eventosDelGoal(leido({ intentos: [run("interrupted")], estadoVisita: "succeeded" })).at(-1).outcome, "error");
});

test("un trace.json a medio escribir: sin inicio no hay eventos; los pasos sin URL se saltan", () => {
  assert.deepEqual(eventosDelGoal(leido({ intentos: [{ carpeta: "desktop", archivo: "trace.json", datos: { steps: [{ number: 1 }] } }] })), []);
  const pasos = [pasoDeVisita(1, INICIO, AYUDA, 4), { number: 2, action: "left_click" }];
  assert.deepEqual(resumen(eventosDelGoal(leido({ intentos: [{ carpeta: "desktop", archivo: "trace.json", datos: traza("running", pasos) }] }))), [
    "visitor:desktop:start:0", "visitor:desktop:step:1",
  ]);
});

test("la Guía: su ruta verificada sin páginas repetidas, y su end con la etapa", () => {
  assert.deepEqual(rutaDeLaGuia({ recorrido: { archivo: "route.json", datos: RUTA } }), [
    { url: "https://ejemplo.test/", title: "Inicio" },
    { url: "https://ejemplo.test/ayuda", title: "Ayuda" },
    { url: "https://ejemplo.test/ayuda/horario", title: "Horario" },
  ]);
  assert.equal(rutaDeLaGuia({ recorrido: { archivo: "route.json", datos: { ...RUTA, status: "unverified" } } }), null);
  assert.equal(rutaDeLaGuia({ recorrido: { archivo: "trace.json", datos: RUTA } }), null);

  const explorando = { archivo: "trace.json", datos: { status: "running", start: INICIO, steps: [pasoDeGuia(1, INICIO, AYUDA)] } };
  assert.ok(!eventosDelGoal(leido({ guia: explorando })).some((e) => e.type === "end"));
  const fallida = eventosDelGoal(leido({ guia: explorando, estadoGuia: "failed" })).at(-1);
  assert.deepEqual([fallida.type, fallida.outcome], ["end", "failed"]);
  const sinVerificar = eventosDelGoal(leido({ guia: { archivo: "route.json", datos: { ...RUTA, status: "unverified" } }, estadoGuia: "succeeded" })).at(-1);
  assert.deepEqual([sinVerificar.outcome, sinVerificar.end_reason], ["failed", "unverified"]);
});

test("Last-Event-ID con dos intentos intercalados: se da por enviado solo lo de su intento hasta ese paso", () => {
  const desktop = [pasoDeVisita(1, INICIO, AYUDA, 4), pasoDeVisita(2, AYUDA, HORARIO, 8)];
  const mobile = [pasoDeVisita(1, INICIO, AYUDA, 2), pasoDeVisita(2, AYUDA, HORARIO, 6)];
  const eventos = eventosDelGoal(leido({
    intentos: [
      { carpeta: "desktop", archivo: "trace.json", datos: traza("running", desktop) },
      { carpeta: "mobile", archivo: "trace.json", datos: traza("running", mobile) },
    ],
  }));
  assert.deepEqual(resumen(eventos), [
    "visitor:desktop:start:0", "visitor:mobile:start:0", "visitor:mobile:step:1", "visitor:desktop:step:1",
    "visitor:mobile:step:2", "visitor:desktop:step:2",
  ]);
  // El cliente vio hasta desktop 1, pero mobile 2 (de antes en ts) pudo no haber salido: todo lo de mobile se reenvía.
  assert.deepEqual(resumen(crearSeguimiento(`${VISITA}|desktop|1|step`)(eventos)), [
    "visitor:mobile:start:0", "visitor:mobile:step:1", "visitor:mobile:step:2", "visitor:desktop:step:2",
  ]);
  // Con el end de un intento, nada más de él.
  const terminado = crearSeguimiento(`${VISITA}|desktop|2|end`)(eventos);
  assert.ok(terminado.every((e) => e.attempt === "mobile"));
});

test("la Guía con hora en sus pasos: sus eventos la usan", () => {
  const conHora = { ...RUTA, steps: RUTA.steps.map((paso, i) => ({ ...paso, settled_at: `2026-11-22T12:00:0${i + 3}.000Z` })) };
  const pasos = eventosDelGoal(leido({ guia: { archivo: "route.json", datos: conHora }, estadoGuia: "succeeded" })).filter((e) => e.type === "step");
  assert.deepEqual(pasos.map((e) => e.ts), ["2026-11-22T12:00:03.000Z", "2026-11-22T12:00:04.000Z"]);
  const porSegundos = { ...RUTA, steps: RUTA.steps.map((paso, i) => ({ ...paso, seconds_since_start: 10 * (i + 1) })) };
  const otros = eventosDelGoal(leido({ guia: { archivo: "route.json", datos: porSegundos }, estadoGuia: "succeeded" })).filter((e) => e.type === "step");
  assert.deepEqual(otros.map((e) => e.ts), ["2026-11-22T12:00:10.000Z", "2026-11-22T12:00:20.000Z"]);
});

test("goalTerminado: con el Visitante cerrado (o no lanzado) o la revisión terminada", () => {
  assert.equal(goalTerminado(leido()), false);
  assert.equal(goalTerminado(leido({ estadoVisita: "skipped" })), true);
  assert.equal(goalTerminado(leido({ estadoVisita: "pending", estado: "failed" })), true);
});
