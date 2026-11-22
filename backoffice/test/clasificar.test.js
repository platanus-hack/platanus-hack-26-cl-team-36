import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANCHO_MOVIL, dispositivoDeViewport, estadoDeCorrida, intentoDelVisitante } from "../lib/clasificar.js";
import { ARCHIVO_DANADO, armarTanda, resultadoDelRun } from "../lib/derivar.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas/demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z", import.meta.url));
const runDe = (perfil) => JSON.parse(readFileSync(`${RAIZ}/${perfil}/run.json`, "utf8"));
const ok = (datos) => ({ run: { datos, estado: "ok" } });

test("dispositivo: ancho del viewport bajo 700 es mobile; el resto (y sin viewport) desktop", () => {
  assert.equal(ANCHO_MOVIL, 700);
  for (const [viewport, esperado] of [
    ["390x844", "mobile"],
    ["699x1000", "mobile"],
    ["700x1000", "desktop"],
    ["1024x768", "desktop"],
    [{ width: 390, height: 844 }, "mobile"],
    [undefined, "desktop"],
    ["", "desktop"],
    ["ancho", "desktop"],
    ["0x0", "desktop"],
  ]) {
    assert.equal(dispositivoDeViewport(viewport), esperado, JSON.stringify(viewport));
  }
});

test("estado de una corrida por su manifest: succeeded, failed, running; lo demás no cuenta", () => {
  assert.equal(estadoDeCorrida("succeeded"), "logrado");
  assert.equal(estadoDeCorrida("failed"), "fallido");
  assert.equal(estadoDeCorrida("running"), "en_curso");
  for (const otro of ["abandoned", "pending", "constructor", "__proto__", "", null, undefined, 3]) {
    assert.equal(estadoDeCorrida(otro), null, String(otro));
  }
});

test("resultadoDelRun clasifica igual que la tanda (armarIntento), con cada forma de terminar", () => {
  const base = runDe("first_time");
  const variantes = {
    logrado: base,
    fallido: { ...base, verdict: { ...base.verdict, outcome: "failed" } },
    abandonado: { ...base, verdict: { ...base.verdict, outcome: "abandoned" } },
    sin_medir: { ...base, verdict: { ...base.verdict, outcome: "unmeasured" } },
    interrumpido_sin_error: { ...base, verdict: { outcome: "interrupted" } },
    sin_veredicto: { ...base, verdict: undefined },
    api_error: { ...base, end_reason: "api_error", verdict: { outcome: "interrupted" } },
    refusal: { ...base, end_reason: "refusal" },
    juez: { ...base, verdict: { outcome: "success", justification: "No se pudo obtener el veredicto: tiempo" } },
    sin_inicio: { ...base, start: {} },
    danado: { profile: "x", end_reason: ARCHIVO_DANADO, final_message: "x/run.json no es JSON válido", steps: [] },
    movil: runDe("mobile"),
  };
  const intentos = Object.entries(variantes).map(([perfil, run]) => ({ perfil, run, video: false }));
  const tanda = armarTanda({ id: "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z", arbol: null, criterio: null, intentos });
  for (const intento of tanda.intentos) {
    assert.equal(resultadoDelRun(variantes[intento.id]), intento.resultado, intento.id);
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(variantes).map(([nombre, run]) => [nombre, resultadoDelRun(run)])),
    {
      logrado: "logrado",
      fallido: "fallido",
      abandonado: "abandonado",
      sin_medir: "sin_medir",
      interrumpido_sin_error: "abandonado",
      sin_veredicto: "abandonado",
      api_error: "error",
      refusal: "error",
      juez: "error",
      sin_inicio: "error",
      danado: "error",
      movil: "fallido",
    },
  );
});

test("un intento con run.json: estado, dispositivo, inicio y captura", () => {
  assert.deepEqual(intentoDelVisitante("mobile", ok(runDe("mobile"))), {
    carpeta: "mobile",
    estado: "fallido",
    dispositivo: "mobile",
    url: runDe("mobile").start.url,
    titulo: "Inicio",
    captura: "step_00.png",
    instruccion: runDe("mobile").instruction ?? null,
  });
  const base = runDe("first_time");
  const captura = (start, extra = {}) => intentoDelVisitante("d", ok({ ...base, ...extra, start })).captura;
  assert.equal(captura({ ...base.start, screenshot: "step_03.png" }), "step_03.png");
  assert.equal(captura({ ...base.start, screenshot: "../../servidor.js" }), "step_00.png", "solo step_NN.png");
  assert.equal(captura({ ...base.start, screenshot: undefined }), "step_00.png");
  assert.equal(captura({}, { end_reason: "api_error" }), null, "un error sin página de inicio no tiene captura");
  assert.equal(intentoDelVisitante("d", ok({ ...base, start: undefined, start_url: "https://demo.cl/x" })).url, "https://demo.cl/x");
});

test("run.json dañado o que no es un intento: error (sin viewport, desktop)", () => {
  for (const run of [{ datos: null, estado: "danado" }, { datos: [1, 2], estado: "ok" }, { datos: null, estado: "ok" }]) {
    const intento = intentoDelVisitante("mobile-2", { run });
    assert.deepEqual([intento.estado, intento.dispositivo, intento.captura], ["error", "desktop", null], JSON.stringify(run));
  }
});

test("sin run.json: en curso solo con trace.json running dentro de una tanda que corre", () => {
  const falta = { datos: null, estado: "falta" };
  const enCurso = (traza, tandaEnCurso = true) => intentoDelVisitante("m", { run: falta, traza, tandaEnCurso });
  assert.deepEqual([enCurso({ status: "running", profile: "mobile" }).estado, enCurso({ status: "running", profile: "mobile" }).dispositivo], ["en_curso", "mobile"]);
  assert.equal(enCurso({ status: "running", profile: "desktop" }).dispositivo, "desktop");
  assert.equal(enCurso({ status: "running" }).dispositivo, "desktop", "sin perfil: desktop");
  assert.equal(enCurso({ status: "running", profile: "mobile" }, false), null, "tanda cerrada: no cuenta");
  assert.equal(enCurso({ status: "succeeded", profile: "mobile" }), null);
  assert.equal(enCurso(null), null);
  assert.equal(intentoDelVisitante("m", { run: falta }), null);
});
