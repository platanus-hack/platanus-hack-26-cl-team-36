import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { anillos, estadoDelPaso, loQuePaso, resultadoDeRama } from "../lib/derivar.js";
import { idsDeTandas, leerTanda, listarTandas } from "../lib/tandas.js";
import { normalizarUrl } from "../lib/url.js";

// Tanda sintética con la forma de agents/.runs/; su route_tree.json lo armó build_route_tree del evaluador.
const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const ID = "tarea-demo/2026-11-21_10-00-00";

test("normalizarUrl coincide con normalize_url del evaluador", () => {
  assert.equal(normalizarUrl("https://www.Ejemplo.test/planes/?utm_source=x&b=2&a=1#seccion"), "https://ejemplo.test/planes?a=1&b=2");
  assert.equal(normalizarUrl("http://ejemplo.test:80/"), "http://ejemplo.test/");
  assert.equal(normalizarUrl("http://ejemplo.test:8080"), "http://ejemplo.test:8080/");
  assert.equal(normalizarUrl("https://app.test/#/ruta"), "https://app.test/#/ruta");
  assert.equal(normalizarUrl("no es una url"), "no es una url");
});

test("estado de un paso según sus señales", () => {
  assert.equal(estadoDelPaso(["no_effect"]), "sin_efecto");
  assert.equal(estadoDelPaso(["went_back"]), "no_cumplida");
  assert.equal(estadoDelPaso(["visible_error", "no_effect"]), "no_cumplida");
  assert.equal(estadoDelPaso([]), "sin_evaluar");
  assert.equal(estadoDelPaso(undefined), "sin_evaluar");
});

test("lo que pasó se arma con URL, título y señales", () => {
  const base = { url_before: "https://e.test/", title_before: "Inicio", signals: [] };
  assert.match(loQuePaso({ ...base, url: "https://e.test/ayuda", title: "Ayuda" }), /Pasó de e\.test\/ a e\.test\/ayuda\. La página se llama «Ayuda»\./);
  assert.equal(loQuePaso({ ...base, url: "https://e.test/", title: "Inicio", signals: ["no_effect"], screen_change: 0 }), "La pantalla no cambió.");
  assert.match(loQuePaso({ ...base, url: "https://e.test/", title: "Inicio", screen_change: 0.25 }), /25 %/);
  assert.match(loQuePaso({ ...base, url: "https://e.test/", title: "Inicio", signals: ["visible_error"], screen_change: 0.1 }), /error en pantalla/);
});

test("anillos: distancia en ramas desde el inicio; lo inalcanzable va afuera", () => {
  const nodos = [{ id: "a", is_start: true }, { id: "b" }, { id: "c" }, { id: "x" }];
  const ramas = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" }];
  assert.deepEqual([...anillos(nodos, ramas)], [["a", 0], ["b", 1], ["c", 2], ["x", 3]]);
});

test("color de una rama", () => {
  assert.equal(resultadoDeRama({ successes: 2, failures: 0 }), "exito");
  assert.equal(resultadoDeRama({ successes: 1, failures: 1 }), "mixto");
  assert.equal(resultadoDeRama({ successes: 0, failures: 1 }, { endings: { failed: 1, abandoned: 0 } }), "fallo");
  assert.equal(resultadoDeRama({ successes: 0, failures: 1 }, { endings: { failed: 0, abandoned: 2 } }), "abandono");
});

test("lista la tanda del fixture con su resumen", async () => {
  assert.deepEqual(await idsDeTandas(RAIZ), [ID]);
  const [resumen] = await listarTandas(RAIZ);
  assert.equal(resumen.tarea, "tarea-demo");
  assert.equal(resumen.host, "ejemplo.test");
  assert.equal(resumen.intentos, 3);
  assert.equal(resumen.exitos, 2);
  assert.deepEqual(resumen.captura, { perfil: "first_time", archivo: "step_00.png" });
});

test("telaraña: ruta recomendada, anillos y capturas por nodo", async () => {
  const tanda = await leerTanda(RAIZ, ID);
  const { nodos, ramas, ruta } = tanda.telarana;
  assert.deepEqual(ruta.nodos, ["n1", "n2", "n3"]);
  assert.deepEqual(nodos.map((n) => [n.id, n.anillo, n.enRuta]), [["n1", 0, true], ["n2", 1, true], ["n3", 2, true], ["n4", 1, false]]);
  // El nodo de /planes?utm_source=x se encuentra aunque la URL del paso traiga parámetros de seguimiento.
  assert.ok(nodos.every((n) => n.captura), "cada nodo tiene captura");
  const haciaPlanes = ramas.find((r) => r.destino === "n4");
  assert.equal(haciaPlanes.resultado, "fallo");
  assert.equal(haciaPlanes.intentos, 2);
  assert.deepEqual(haciaPlanes.perfiles, ["hurried", "mobile"]);
  assert.equal(ramas.filter((r) => r.enRuta).length, 2);
});

test("intentos: quién sigue la ruta, dónde se separa y si vuelve", async () => {
  const tanda = await leerTanda(RAIZ, ID);
  const [primera, apurado, movil] = tanda.intentos;
  assert.deepEqual([primera.perfil, apurado.perfil, movil.perfil], ["first_time", "hurried", "mobile"]);
  assert.equal(primera.sigueLaRuta, true);
  assert.equal(primera.seSepara, null);
  assert.deepEqual(apurado.seSepara, { etapa: 1, paso: 1, nodo: "n4", seDetuvo: false });
  assert.equal(apurado.vuelveALaRuta, true);
  assert.deepEqual(apurado.pasos.map((p) => p.estado), ["sin_evaluar", "sin_efecto", "no_cumplida", "sin_evaluar", "sin_evaluar"]);
  assert.equal(movil.vuelveALaRuta, false);
  assert.equal(movil.resultado, "failed");
  assert.deepEqual(movil.viewport, { ancho: 390, alto: 844 });
});

test("KPIs y métricas por perfil", async () => {
  const tanda = await leerTanda(RAIZ, ID);
  assert.deepEqual(tanda.kpis, {
    intentos: 3,
    exitos: 2,
    siguenLaRuta: 1,
    pasosMediana: 2,
    pasosIdeales: 2,
    tramosDeRuta: 2,
    noCumplidas: 2,
    sinEfecto: 1,
  });
  const porPerfil = Object.fromEntries(tanda.perfiles.map((p) => [p.perfil, p]));
  assert.deepEqual(porPerfil.first_time.enRutaPorTramo, [100, 100]);
  assert.deepEqual(porPerfil.hurried.enRutaPorTramo, [0, 0]);
  assert.deepEqual(porPerfil.first_time.metricas, { exito: 100, eficiencia: 100, adherencia: 100, sinTropiezos: 100, recuperacion: null });
  assert.deepEqual(porPerfil.hurried.metricas, { exito: 100, eficiencia: 40, adherencia: 0, sinTropiezos: 60, recuperacion: 100 });
  assert.deepEqual(porPerfil.mobile.metricas, { exito: 0, eficiencia: 0, adherencia: 0, sinTropiezos: 50, recuperacion: 0 });
});

test("un id que no es una tanda no se lee", async () => {
  assert.equal(await leerTanda(RAIZ, "../corridas"), null);
  assert.equal(await leerTanda(RAIZ, "tarea-demo"), null);
  assert.equal(await leerTanda(RAIZ, "tarea-demo/2026-11-21_10-00-00/first_time"), null);
});
