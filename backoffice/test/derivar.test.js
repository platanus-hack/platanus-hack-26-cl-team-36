import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  armarTanda,
  rutaEnPaginas,
  caminoSegunRuta,
  coincidenciaDelPaso,
  distancias,
  errorDelIntento,
  estadoDelPaso,
  fechaIsoDe,
  firmaDelPaso,
  loQuePaso,
  recorreLaRuta,
  resultadoDeRama,
  resumenDeError,
  textoDeElemento,
  porConocimiento,
  unirRamas,
} from "../lib/derivar.js";
import { idsDeTandas, leerTanda, listarTandas } from "../lib/tandas.js";
import { consultaDe, normalizarUrl, rutaSinConsulta } from "../lib/url.js";

// Tandas sintéticas con la forma de agents/.runs/; sus route_tree.json los armó build_route_tree del evaluador.
const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const VIEJA = "tarea-demo/2026-11-21_10-00-00";
const NUEVA = "tarea-demo/2026-11-21_11-00-00";

test("normalizarUrl coincide con normalize_url del evaluador", () => {
  assert.equal(normalizarUrl("https://www.Ejemplo.test/planes/?utm_source=x&b=2&a=1#seccion"), "https://ejemplo.test/planes?a=1&b=2");
  assert.equal(normalizarUrl("http://ejemplo.test:80/"), "http://ejemplo.test/");
  assert.equal(normalizarUrl("http://ejemplo.test:8080"), "http://ejemplo.test:8080/");
  assert.equal(normalizarUrl("https://app.test/#/ruta"), "https://app.test/#/ruta");
  assert.equal(normalizarUrl("no es una url"), "no es una url");
});

test("rutaSinConsulta y consultaDe separan la consulta y conservan la ruta de SPA", () => {
  assert.equal(rutaSinConsulta("https://www.wom.cl/centro-de-ayuda?s=dar+de+baja+fibra"), "https://wom.cl/centro-de-ayuda");
  assert.equal(consultaDe("https://www.wom.cl/centro-de-ayuda?s=dar+de+baja+fibra"), "s=dar+de+baja+fibra");
  assert.equal(consultaDe("https://wom.cl/centro-de-ayuda"), "");
  assert.equal(rutaSinConsulta("https://app.test/x?a=1#/r"), "https://app.test/x#/r");
});

test("estado de un paso según sus señales", () => {
  assert.equal(estadoDelPaso(["no_effect"]), "sin_efecto");
  assert.equal(estadoDelPaso(["went_back"]), "no_cumplida");
  assert.equal(estadoDelPaso(["visible_error", "no_effect"]), "no_cumplida");
  assert.equal(estadoDelPaso([]), "sin_evaluar");
  assert.equal(estadoDelPaso(undefined), "sin_evaluar");
});

test("lo que pasó sale como claves y variables, sin frases", () => {
  const base = { url_before: "https://e.test/", title_before: "Inicio", signals: [] };
  assert.deepEqual(loQuePaso({ ...base, url: "https://e.test/ayuda", title: "Ayuda" }), [
    { clave: "cambioUrl", vars: { de: "e.test/", a: "e.test/ayuda" } },
    { clave: "cambioTitulo", vars: { titulo: "Ayuda" } },
  ]);
  assert.deepEqual(loQuePaso({ ...base, url: "https://e.test/", title: "Inicio", signals: ["no_effect"], screen_change: 0 }), [
    { clave: "sinCambio", vars: {} },
  ]);
  assert.deepEqual(loQuePaso({ ...base, url: "https://e.test/", title: "Inicio", screen_change: 0.25 }), [
    { clave: "cambioParcial", vars: { porcentaje: 25 } },
  ]);
  assert.deepEqual(
    loQuePaso({ ...base, url: "https://e.test/", title: "Inicio", signals: ["went_back", "visible_error"], error_detail: "x" }).map((p) => p.clave),
    ["volvio", "errorVisible", "detalle"],
  );
  assert.deepEqual(loQuePaso({ ...base, url: "https://e.test/", title: "Inicio" }), []);
});

test("firma de cada tipo de acción", () => {
  const clic = (element) => firmaDelPaso({ action: "left_click", coordinates: [380, 549], description: "clic en (380, 549)", element });
  assert.deepEqual(clic({ text: "Buscar tema" }), {
    tipo: "clic", objetivo: "Buscar tema", direccion: null, cantidad: null, x: 380, y: 549, original: "clic en (380, 549)",
  });
  assert.equal(clic({ text: "", href: "/ayuda" }).objetivo, "/ayuda");
  assert.equal(clic(null).tipo, "clic_coordenadas");
  assert.equal(firmaDelPaso({ action: "double_click", element: { text: "A" } }).tipo, "doble_clic");
  const desplazar = firmaDelPaso({ action: "scroll", action_input: {}, description: "scroll up x10" });
  assert.deepEqual([desplazar.tipo, desplazar.direccion, desplazar.cantidad], ["desplazar", "arriba", 10]);
  assert.deepEqual(firmaDelPaso({ action: "type", action_input: { text: "baja" }, description: "escribir «baja»" }).objetivo, "baja");
  assert.equal(firmaDelPaso({ action: "key", description: "atrás", signals: ["went_back"] }).tipo, "atras");
  assert.deepEqual(firmaDelPaso({ action: "key", action_input: { text: "Enter" }, description: "tecla Enter" }).objetivo, "Enter");
  assert.deepEqual(firmaDelPaso({ action: "zoom", description: "zoom" }).tipo, "otra");
});

test("coincide (estimado) según señales, cambio de página y cambio de pantalla", () => {
  assert.equal(coincidenciaDelPaso({ senales: ["no_effect"], paginaAntes: "a", pagina: "b", cambio: 1 }), "no");
  assert.equal(coincidenciaDelPaso({ senales: [], paginaAntes: "a", pagina: "b", cambio: 0 }), "si");
  assert.equal(coincidenciaDelPaso({ senales: [], paginaAntes: "a", pagina: "a", cambio: 0.05 }), "si");
  assert.equal(coincidenciaDelPaso({ senales: [], paginaAntes: "a", pagina: "a", cambio: 0.01 }), "incierto");
  assert.equal(coincidenciaDelPaso({ senales: [], paginaAntes: "a", pagina: "a", cambio: null }), "incierto");
});

test("errores de la herramienta: los cuatro motivos, el juez y sin inicio", () => {
  const traza = "Error: Page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot\nCall log:\n  - x";
  assert.deepEqual(errorDelIntento({ end_reason: "internal_error", final_message: traza, start: { url: "u" } }), {
    tipo: "internal_error",
    resumen: "Page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
    detalle: traza,
  });
  for (const motivo of ["api_error", "no_response", "refusal"]) {
    assert.equal(errorDelIntento({ end_reason: motivo, final_message: "x", start: { url: "u" } }).tipo, motivo);
  }
  const juez = errorDelIntento({ end_reason: "done", start: { url: "u" }, verdict: { justification: "No se pudo obtener el veredicto: timeout" } });
  assert.equal(juez.tipo, "juez");
  assert.equal(errorDelIntento({ end_reason: "done", final_message: "x" }).tipo, "sin_inicio");
  assert.equal(errorDelIntento({ end_reason: "gave_up", start: { url: "u" }, verdict: { justification: "No." } }), null);
  assert.equal(resumenDeError(`\n\nError: ${"a".repeat(200)}`).length, 140);
  assert.ok(resumenDeError(`Error: ${"a".repeat(200)}`).endsWith("…"));
});

test("distancias desde el inicio; lo inalcanzable va afuera", () => {
  const paginas = [{ id: "a", esInicio: true }, { id: "b" }, { id: "c" }, { id: "x" }];
  const ramas = [{ origen: "a", destino: "b" }, { origen: "b", destino: "c" }, { origen: "c", destino: "a" }];
  assert.deepEqual([...distancias(paginas, ramas)], [["a", 0], ["b", 1], ["c", 2], ["x", 3]]);
});

test("resultado de una rama: cómo terminaron los intentos que pasaron por ella", () => {
  const resultadoDe = new Map([["a", "logrado"], ["b", "logrado"], ["c", "fallido"], ["d", "abandonado"], ["e", "abandonado"], ["x", "error"]]);
  const de = (perfiles, extra = {}) => resultadoDeRama({ perfiles, ...extra }, resultadoDe);
  // Todos llegaron, aunque el evaluador marque el tramo como desvío (fuera del camino a la página final).
  assert.deepEqual(de(["a", "b"], { exitos: 0, fallos: 2 }), { resultado: "exito", llegaron: 2, noLlegaron: 0 });
  // Un intento con error de la herramienta no cuenta.
  assert.deepEqual(de(["a", "x"]), { resultado: "exito", llegaron: 1, noLlegaron: 0 });
  assert.deepEqual(de(["a", "c"]), { resultado: "mixto", llegaron: 1, noLlegaron: 1 });
  assert.deepEqual(de(["c", "d"], { exitos: 2 }), { resultado: "fallo", llegaron: 0, noLlegaron: 2 });
  assert.deepEqual(de(["d", "e"]), { resultado: "abandono", llegaron: 0, noLlegaron: 2 });
  assert.deepEqual(de(["x"]), { resultado: "error", llegaron: 0, noLlegaron: 0 });
});

test("fechaIso de una tanda", () => {
  assert.equal(fechaIsoDe("2026-11-21_07-28-42"), "2026-11-21T07:28:42");
  assert.equal(fechaIsoDe("otra cosa"), null);
});

test("lista las tandas del fixture, de la más nueva a la más vieja, con su resumen", async () => {
  assert.deepEqual(await idsDeTandas(RAIZ), [NUEVA, VIEJA]);
  const { carpeta, tandas } = await listarTandas(RAIZ);
  assert.equal(carpeta, "backoffice/test/fixtures/corridas");
  const [nueva, vieja] = tandas;
  assert.equal(vieja.tarea, "tarea-demo");
  assert.equal(vieja.host, "ejemplo.test");
  assert.equal(vieja.fechaIso, "2026-11-21T10:00:00");
  assert.deepEqual([vieja.intentos, vieja.validos, vieja.errores, vieja.logrados], [3, 3, 0, 2]);
  assert.deepEqual(vieja.captura, { perfil: "first_time", archivo: "step_00.png" });
  assert.deepEqual([nueva.intentos, nueva.validos, nueva.errores, nueva.logrados, nueva.siguenLaRuta], [4, 3, 1, 2, 2]);
  // La ruta del evaluador: «clic «Close»», «escribir «baja»», «clic «Buscar»» (3 pasos) y «clic «Dar de baja»» (1).
  assert.deepEqual([nueva.pasosMediana, nueva.pasosIdeales, nueva.paginas], [4, 4, 5]);
  // El primer clic que se queda en el inicio y cambia la pantalla: cerrar el aviso.
  assert.deepEqual(nueva.captura, { perfil: "first_time", archivo: "step_01.png" });
  assert.deepEqual(nueva.perfiles.map((p) => [p.intento, p.nombre, p.resultado]), [
    ["first_time", "Primera vez", "logrado"],
    ["hurried", "Apurado", "logrado"],
    ["mobile", "Móvil", "error"],
    ["senior", "Adulto mayor", "fallido"],
  ]);
  assert.equal(nueva.titular.clave, "datos.hallazgo.resultado");
  assert.deepEqual(nueva.titular.vars.intentos, ["senior"]);
});

test("telaraña de la tanda vieja: ruta, distancias, capturas y ramas", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const { paginas, ramas, ruta, alias } = tanda.telarana;
  assert.deepEqual(ruta.paginas, ["n1", "n2", "n3"]);
  assert.equal(ruta.pasosIdeales, 2);
  assert.deepEqual(alias, {});
  assert.deepEqual(paginas.map((p) => [p.id, p.distancia, p.enRuta, p.hito]), [
    ["n1", 0, true, 0], ["n2", 1, true, 1], ["n3", 2, true, 2], ["n4", 1, false, null],
  ]);
  assert.equal(paginas[0].tituloTipo, "inicio");
  // El nodo de /planes?utm_source=x se encuentra aunque la URL del paso traiga parámetros de seguimiento.
  assert.ok(paginas.every((p) => p.captura), "cada página tiene captura");
  const haciaPlanes = ramas.find((r) => r.destino === "n4");
  // Por /planes pasaron hurried (después lo logró) y mobile (falló): algunos llegaron.
  assert.deepEqual([haciaPlanes.id, haciaPlanes.resultado, haciaPlanes.intentos], ["n1>n4", "mixto", 2]);
  assert.deepEqual([haciaPlanes.llegaron, haciaPlanes.noLlegaron], [1, 1]);
  assert.deepEqual(haciaPlanes.perfiles, ["hurried", "mobile"]);
  assert.equal(ramas.filter((r) => r.enRuta).length, 2);
});

test("intentos de la tanda vieja: quién sigue la ruta, dónde se separa y si vuelve", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const [primera, apurado, movil] = tanda.intentos;
  assert.deepEqual([primera.id, apurado.id, movil.id], ["first_time", "hurried", "mobile"]);
  assert.equal(primera.sigueLaRuta, true);
  assert.equal(primera.logro, "directo");
  assert.equal(primera.seSepara, null);
  assert.deepEqual(apurado.seSepara, { tramo: 1, paso: 1, pagina: "n4", seDetuvo: false });
  assert.equal(apurado.vuelveALaRuta, true);
  assert.equal(apurado.vuelveEnPaso, 4);
  // Abre otra rama primero (n1 → n4 → n1) y después recorre los dos tramos de la ruta: la sigue, y llega directo.
  assert.equal(apurado.sigueLaRuta, true);
  assert.equal(apurado.logro, "directo");
  // Vuelve a la ruta y sigue: alcanza todos los hitos aunque no siga el prefijo estricto.
  assert.equal(apurado.hitosAlcanzados, 3);
  assert.deepEqual(apurado.pasos.map((p) => p.estado), ["sin_evaluar", "sin_efecto", "no_cumplida", "sin_evaluar", "sin_evaluar"]);
  assert.equal(movil.vuelveALaRuta, false);
  assert.equal(movil.resultado, "fallido");
  assert.equal(movil.resultadoJuez, "failed");
  assert.deepEqual(movil.viewport, { ancho: 390, alto: 844 });
});

test("KPIs y métricas por perfil: pares {n, de} y null cuando no aplica", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  assert.deepEqual(tanda.kpis, {
    intentos: 3, validos: 3, errores: 0, logrados: 2, directos: 2, siguenLaRuta: 2,
    pasosMediana: 2, segundosMediana: 10, pasosIdeales: 2, tramos: 2, hitos: 3, sinEfecto: 1, noCumplidas: 2,
  });
  const porPerfil = Object.fromEntries(tanda.perfiles.map((p) => [p.perfil, p]));
  assert.deepEqual(porPerfil.first_time.metricas.exito, { n: 1, de: 1 });
  assert.equal(porPerfil.first_time.metricas.recuperacion, null);
  assert.equal(porPerfil.first_time.metricas.eficiencia, 1);
  assert.deepEqual(porPerfil.hurried.metricas.adherencia, { n: 1, de: 1 });
  assert.deepEqual(porPerfil.hurried.metricas.recuperacion, { n: 1, de: 1 });
  assert.equal(porPerfil.hurried.metricas.eficiencia, 0.4);
  assert.deepEqual(porPerfil.hurried.hitos.map((h) => h.alcanzados), [1, 1, 1]);
  assert.deepEqual(porPerfil.hurried.hitos[0].salen, [{ intento: "hurried", paso: 1 }]);
  assert.equal(porPerfil.mobile.metricas.eficiencia, null, "sin logrados, la eficiencia no aplica");
  assert.deepEqual(porPerfil.mobile.hitos.map((h) => h.alcanzados), [1, 0, 0]);
  assert.deepEqual(porPerfil.mobile.metricas.pasos, { valores: [2], ruta: 2 });
});

test("tanda nueva: variantes de URL unidas en una página; las sin título quedan aparte", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const { paginas, ruta, alias } = tanda.telarana;
  assert.deepEqual(alias, { n4: "n2" });
  assert.deepEqual(paginas.map((p) => [p.id, p.tituloTipo, p.tituloCorto]), [
    ["n1", "inicio", null],
    ["n2", "sitio", "Ayuda"],
    ["n3", "sitio", "Cómo dar de baja"],
    ["n5", "url", "Sin titulo · ?x=1"],
    ["n6", "url", "Sin titulo · ?x=2"],
  ]);
  const ayuda = paginas[1];
  assert.equal(ayuda.url, "https://ejemplo.test/ayuda");
  assert.deepEqual(ayuda.variantes.map((v) => [v.nodo, v.consulta, v.visitas, v.perfiles]), [
    ["n2", "q=baja", 1, ["first_time"]],
    ["n4", "", 2, ["hurried", "mobile"]],
  ]);
  assert.equal(ayuda.visitas, 3);
  assert.deepEqual(ayuda.perfiles, ["first_time", "hurried", "mobile"]);
  assert.deepEqual(ruta.paginas, ["n1", "n2", "n3"]);
  // Acción y pasos de la ruta del evaluador (no los de la rama unida n1 → n2, donde lo más hecho fue «clic «Ayuda»»).
  assert.deepEqual(ruta.tramos.map((t) => [t.origen, t.destino, t.accion, t.pasos, t.segundos]), [
    ["n1", "n2", "clic «Buscar»", 3, 8],
    ["n2", "n3", "clic «Dar de baja»", 1, 3],
  ]);
});

test("tanda nueva: el error de la herramienta se marca y no cuenta", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const porId = Object.fromEntries(tanda.intentos.map((i) => [i.id, i]));
  assert.deepEqual(tanda.intentos.map((i) => i.id), ["first_time", "hurried", "mobile", "senior"]);
  assert.equal(porId.mobile.resultado, "error");
  assert.equal(porId.mobile.error.tipo, "internal_error");
  assert.equal(porId.mobile.respuesta, "");
  assert.equal(porId.mobile.logro, null);
  assert.equal(porId.mobile.duracion, 5, "sin duration_s, la duración es el último paso");
  assert.deepEqual(porId.mobile.demoras, []);
  assert.equal(porId.first_time.sigueLaRuta, true);
  assert.equal(porId.hurried.sigueLaRuta, true);
  assert.deepEqual(porId.senior.seSepara, { tramo: 1, paso: 1, pagina: "n5", seDetuvo: false });
  assert.equal(porId.senior.vuelveALaRuta, false);
  assert.equal(porId.senior.resultado, "fallido");
  assert.equal(porId.senior.pasos[2].estado, "no_cumplida");
  assert.deepEqual(porId.senior.camino, ["n1", "n5", "n6", "n5"]);
  const k = tanda.kpis;
  assert.deepEqual([k.intentos, k.validos, k.errores, k.logrados, k.siguenLaRuta], [4, 3, 1, 2, 2]);

  const inicioAyuda = tanda.telarana.ramas.find((r) => r.id === "n1>n2");
  assert.deepEqual([inicioAyuda.exitos, inicioAyuda.fallos, inicioAyuda.errores, inicioAyuda.intentos], [2, 0, 1, 3]);
  assert.deepEqual(inicioAyuda.acciones, [
    { accion: "clic «Ayuda»", intentos: 2, pasadas: 2, perfiles: ["hurried", "mobile"], salto: false },
    { accion: "clic «Buscar»", intentos: 1, pasadas: 1, perfiles: ["first_time"], salto: false },
  ]);
  assert.equal(inicioAyuda.accion, "clic «Ayuda»");
  const ayuda = tanda.telarana.paginas.find((p) => p.id === "n2");
  assert.deepEqual(ayuda.finales, { logrado: 0, fallido: 0, abandonado: 0, error: 1 });

  const movil = tanda.perfiles.find((p) => p.perfil === "mobile");
  assert.deepEqual([movil.validos, movil.errores, movil.metricas.exito, movil.metricas.eficiencia], [0, 1, null, null]);
  assert.deepEqual(movil.metricas.pasos.valores, []);
});

test("tanda nueva: campos de cada paso", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const primera = tanda.intentos[0];
  const [cerrar, escribir, buscar, baja] = primera.pasos;
  assert.deepEqual([cerrar.paginaAntes, cerrar.pagina, cerrar.salePagina, cerrar.coincide], ["n1", "n1", false, "si"]);
  assert.equal(escribir.coincide, "incierto");
  assert.deepEqual(escribir.firma.tipo, "escribir");
  assert.deepEqual(cerrar.rutaAqui, {
    enRuta: true, hito: 0, total: 2, termina: false, accion: "clic «Buscar»", destino: "n2", coincideConUsuario: null,
  });
  assert.equal(buscar.rutaAqui.coincideConUsuario, true);
  assert.equal(buscar.carril, "en-ruta");
  assert.equal(buscar.inicioSegundos, 5);
  assert.deepEqual(baja.rutaAqui.hito, 1);
  assert.deepEqual(primera.hitos, [
    { pagina: "n1", alcanzado: true, paso: 0 },
    { pagina: "n2", alcanzado: true, paso: 3 },
    { pagina: "n3", alcanzado: true, paso: 4 },
  ]);
  const senior = tanda.intentos[3];
  assert.equal(senior.pasos[0].carril, "fuera-de-ruta");
  assert.deepEqual(senior.pasos[1].rutaAqui, { enRuta: false });
  assert.equal(senior.pasos[2].firma.tipo, "atras");
  assert.equal(senior.pasos[2].coincide, "no");
});

test("vecinas: la tanda anterior, la siguiente y las de la misma tarea", async () => {
  const nueva = await leerTanda(RAIZ, NUEVA);
  assert.deepEqual(nueva.vecinas, {
    anterior: VIEJA,
    siguiente: null,
    mismaTarea: [{ id: VIEJA, fecha: "2026-11-21_10-00-00" }],
  });
  const vieja = await leerTanda(RAIZ, VIEJA);
  assert.deepEqual([vieja.vecinas.anterior, vieja.vecinas.siguiente], [null, NUEVA]);
  assert.deepEqual(nueva.criterio, { texto: "Se ve cómo dar de baja", evidencias: ["Un título que dice baja"] });
});

test("un id que no es una tanda no se lee", async () => {
  assert.equal(await leerTanda(RAIZ, "../corridas"), null);
  assert.equal(await leerTanda(RAIZ, "tarea-demo"), null);
  assert.equal(await leerTanda(RAIZ, `${VIEJA}/first_time`), null);
});

// La tanda vieja leída tal cual de disco, para variarla en memoria.
function tandaViejaCruda() {
  const leer = (archivo) => JSON.parse(readFileSync(`${RAIZ}/${VIEJA}/${archivo}`, "utf8"));
  return {
    id: VIEJA,
    arbol: leer("route_tree.json"),
    criterio: leer("criteria.json"),
    intentos: ["first_time", "hurried", "mobile"].map((perfil) => ({ perfil, run: leer(`${perfil}/run.json`), video: false })),
  };
}

// El celular parte en m.ejemplo.test (el sitio lo redirige): otra página de inicio, no un desvío.
function conInicioMovil(cruda, perfiles) {
  const m = (url) => url.replace("https://www.ejemplo.test/", "https://m.ejemplo.test/");
  cruda.arbol.nodes.push({
    id: "n9", url: "https://m.ejemplo.test/", title: "Inicio", visits: perfiles.length, profiles: [...perfiles],
    is_start: true, endings: { success: 0, failed: 0, abandoned: 0 },
  });
  for (const nodo of cruda.arbol.nodes) if (nodo.id === "n1") nodo.profiles = nodo.profiles.filter((p) => !perfiles.includes(p));
  for (const rama of cruda.arbol.branches) if (rama.source === "n1" && rama.profiles.every((p) => perfiles.includes(p))) rama.source = "n9";
  for (const intento of cruda.intentos) {
    if (!perfiles.includes(intento.perfil)) continue;
    intento.run.start.url = m(intento.run.start.url);
    const [primero] = intento.run.steps;
    primero.url_before = m(primero.url_before);
  }
  return cruda;
}

test("video: videoDesfase sale de video_offset_s, 0 si no viene", () => {
  const cruda = tandaViejaCruda();
  cruda.intentos[0].run.video_offset_s = 1.75;
  cruda.intentos[1].run.video_offset_s = "x";
  const tanda = armarTanda(cruda);
  assert.deepEqual(tanda.intentos.map((i) => i.videoDesfase), [1.75, 0, 0]);
});

test("caminoSegunRuta: otra página de inicio hace de inicio de la ruta, y solo al partir", () => {
  const ruta = { paginas: ["a", "b", "c"] };
  const inicios = new Set(["a", "m"]);
  const alterno = caminoSegunRuta(["m", "b", "m"], [0, 2, 5], ruta, inicios);
  assert.deepEqual([alterno.camino, alterno.llegadas], [["a", "b", "a"], [0, 2, 5]]);
  assert.equal(alterno.comoRuta("m"), "a");
  // Si después entra a la página de inicio de la ruta, no se repite el hito.
  assert.deepEqual(caminoSegunRuta(["m", "a", "b"], [0, 1, 2], ruta, inicios).camino, ["a", "b"]);
  // Partir en una página que no es de inicio, o sin ruta, no cambia nada.
  assert.deepEqual(caminoSegunRuta(["x", "b"], [0, 1], ruta, inicios).camino, ["x", "b"]);
  assert.deepEqual(caminoSegunRuta(["m"], [0], null, inicios).camino, ["m"]);
});

test("otra página de inicio: no es un desvío en el paso 0 y las dos se llaman distinto", () => {
  const tanda = armarTanda(conInicioMovil(tandaViejaCruda(), ["mobile"]));
  const movil = tanda.intentos.find((i) => i.id === "mobile");
  assert.deepEqual(movil.camino, ["n9", "n4"], "el camino real no cambia");
  // Se separa al ir a Planes (paso 1), no al partir.
  assert.deepEqual(movil.seSepara, { tramo: 1, paso: 1, pagina: "n4", seDetuvo: false });
  assert.deepEqual(movil.hitos[0], { pagina: "n1", alcanzado: true, paso: 0 });
  assert.equal(movil.pasos[0].rutaAqui.hito, 0);
  assert.ok(!tanda.hallazgos.some((h) => h.paso === 0), "ningún hallazgo enlaza al paso 0");
  const desvio = tanda.hallazgos.find((h) => h.id === "desvio:mobile");
  assert.deepEqual([desvio.vars.desdePagina, desvio.vars.haciaPagina, desvio.vars.paso], ["n1", "n4", 1]);

  const nombres = Object.fromEntries(tanda.telarana.paginas.map((p) => [p.id, [p.tituloTipo, p.tituloCorto]]));
  assert.deepEqual(nombres.n1, ["inicio", "ejemplo.test"]);
  assert.deepEqual(nombres.n9, ["inicio", "m.ejemplo.test"]);
  assert.equal(tanda.telarana.paginas.find((p) => p.id === "n9").esInicio, true);
});

test("otra página de inicio: quien sigue la ruta desde ella llega directo", () => {
  const tanda = armarTanda(conInicioMovil(tandaViejaCruda(), ["first_time"]));
  const primera = tanda.intentos.find((i) => i.id === "first_time");
  assert.deepEqual(primera.camino, ["n9", "n2", "n3"]);
  assert.equal(primera.sigueLaRuta, true);
  assert.equal(primera.logro, "directo");
  assert.equal(primera.hitosAlcanzados, 3);
  assert.deepEqual(primera.pasos.map((p) => p.carril), ["en-ruta", "en-ruta"]);
  assert.equal(primera.pasos[0].rutaAqui.coincideConUsuario, true);
});

test("una tanda que no se puede derivar se omite de la lista, sin tumbar las demás", async (t) => {
  const buena = tandaViejaCruda();
  const fuente = {
    descripcion: "memoria",
    listarIds: async () => ["tarea-demo/2026-11-21_10-00-00", "rota/2026-11-21_12-00-00"],
    listarPerfiles: async (id) => (id.startsWith("rota") ? [] : ["first_time", "hurried", "mobile"]),
    leerJson: async (id, relativa) => {
      if (id.startsWith("rota")) return relativa === "route_tree.json" ? { nodes: 5 } : null;
      if (relativa === "route_tree.json") return buena.arbol;
      if (relativa === "criteria.json") return buena.criterio;
      return buena.intentos.find((i) => relativa === `${i.perfil}/run.json`)?.run ?? null;
    },
    existe: async () => false,
    abrirArchivo: async () => null,
  };
  const errores = t.mock.method(console, "error", () => {});
  const { tandas } = await listarTandas(fuente);
  assert.deepEqual(tandas.map((tanda) => tanda.id), ["tarea-demo/2026-11-21_10-00-00"]);
  assert.equal(errores.mock.callCount(), 1);
});

test("el texto de un elemento cortado por el evaluador termina en palabra entera y «…»", () => {
  const cortado = "Exención de contribuciones para la vivienda principal de personas de 65 años o m";
  assert.equal(cortado.length, 80);
  assert.equal(textoDeElemento(cortado), "Exención de contribuciones para la vivienda principal de personas de 65 años o…");
  assert.equal(textoDeElemento("  Buscar tema "), "Buscar tema");
  assert.equal(textoDeElemento("x".repeat(80)), `${"x".repeat(80)}…`, "sin espacios cerca del final, se corta donde venía");
  assert.equal(firmaDelPaso({ action: "left_click", element: { text: cortado } }).objetivo.endsWith("o…"), true);
});

// ── Seguir la ruta: recorrer sus tramos en orden, aunque antes o entre medio se abran otras ramas ──────────────

/** La tanda vieja armada a mano desde sus archivos, con lo que cambie `ajustar(arbol)`. */
function tandaViejaCon(ajustar) {
  const carpeta = new URL(`./fixtures/corridas/${VIEJA}/`, import.meta.url);
  const leer = (archivo) => JSON.parse(readFileSync(new URL(archivo, carpeta), "utf8"));
  const arbol = leer("route_tree.json");
  ajustar(arbol);
  const intentos = ["first_time", "hurried", "mobile"].map((perfil) => ({ perfil, run: leer(`${perfil}/run.json`), video: false }));
  return armarTanda({ id: VIEJA, arbol, criterio: leer("criteria.json"), intentos });
}

test("recorreLaRuta: cada tramo seguido y en orden; otras ramas antes o entre medio no importan", () => {
  const ruta = ["a", "b", "c"];
  assert.equal(recorreLaRuta(["a", "b", "c"], ruta), true);
  assert.equal(recorreLaRuta(["a", "x", "a", "y", "a", "b", "z", "b", "c"], ruta), true, "ramifica primero y después recorre la ruta");
  assert.equal(recorreLaRuta(["a", "x", "c"], ruta), false, "llega a la meta por otro tramo");
  assert.equal(recorreLaRuta(["a", "b", "x", "c"], ruta), false, "b → c nunca seguidos");
  assert.equal(recorreLaRuta(["b", "c", "a", "b"], ruta), false, "los tramos al revés del orden");
  assert.equal(recorreLaRuta(["a"], ["a"]), false, "una ruta de una sola página no se sigue");
  assert.equal(recorreLaRuta([], ruta), false);
});

test("quien llega por otro tramo no sigue la ruta, aunque pase por todos sus hitos", () => {
  // Ruta n1 → n4 → n3: hurried pasa por n4 y por n3, pero nunca n4 → n3 seguidos.
  const tanda = tandaViejaCon((arbol) => {
    arbol.recommended_route = { start_node: "n1", end_node: "n3", steps: [{ source: "n1", target: "n4" }, { source: "n4", target: "n3" }] };
  });
  const apurado = tanda.intentos.find((intento) => intento.id === "hurried");
  assert.equal(apurado.resultado, "logrado");
  assert.equal(apurado.sigueLaRuta, false);
  assert.equal(apurado.logro, "indirecto");
});

test("una ruta recomendada vacía (0 pasos) es «sin ruta»: las cifras de la ruta son null", () => {
  const tanda = tandaViejaCon((arbol) => {
    arbol.recommended_route = { start_node: "n1", end_node: "n1", steps: [] };
  });
  assert.equal(tanda.telarana.ruta, null);
  assert.equal(tanda.kpis.siguenLaRuta, null);
  assert.equal(tanda.kpis.directos, null);
  assert.equal(tanda.kpis.pasosIdeales, null);
  for (const perfil of tanda.perfiles) {
    assert.equal(perfil.metricas.adherencia, null);
    assert.equal(perfil.directos, null);
  }
  for (const intento of tanda.intentos) assert.equal(intento.logro, null);
  // El titular no dice que nadie llegó (2 llegaron) ni cuenta quiénes siguen una ruta que no hay.
  assert.deepEqual(tanda.titulares.telarana.vars, { hayRuta: false, enInicio: true, probabilidad: null, tramos: 0, pasosIdeales: null, siguen: null, validos: 3, logrados: 2 });
  // Sigue sin ruta que seguir, pero no «sin ruta»: la tarea se resuelve en la página de inicio (C4-5).
  assert.ok(tanda.telarana.rutaEnInicio?.pagina);
  assert.equal(tanda.hallazgos[0].vars.directos, null);
});

test("tanda de exploradores: sin hallazgos ni titulares de costo en pasos (dan pasos de más a propósito)", async () => {
  // La tanda nueva con una ruta de 2 pasos (un clic por tramo): la mediana (4) dobla la ruta.
  const armar = (extra) => {
    const carpeta = new URL(`./fixtures/corridas/${NUEVA}/`, import.meta.url);
    const leer = (archivo) => JSON.parse(readFileSync(new URL(archivo, carpeta), "utf8"));
    const original = leer("route_tree.json");
    const pasos = original.recommended_route.steps.map((paso) => ({ ...paso, preceding_actions: [] }));
    const arbol = { ...original, recommended_route: { ...original.recommended_route, steps: pasos }, ...extra };
    const intentos = ["first_time", "hurried", "mobile", "senior"].map((perfil) => ({ perfil, run: leer(`${perfil}/run.json`), video: false }));
    return armarTanda({ id: NUEVA, arbol, criterio: leer("criteria.json"), intentos });
  };
  const comun = armar({});
  assert.ok(comun.hallazgos.some((h) => h.id === "costo"), "la tanda común sí tiene el hallazgo de costo");
  const tanda = armar({ conjunto_exploradores: "conocimiento" });
  assert.equal(tanda.exploradores, true);
  assert.equal(comun.exploradores, false);
  assert.ok(!tanda.hallazgos.some((h) => h.id === "costo"));
  assert.notEqual(tanda.titulares.perfiles.vars.caso, "masPasos");
  assert.notEqual(tanda.titulares.tanda.vars.caso, "masPasos");
});

// ── Nivel de conocimiento: cada intento con su propia tarea ─────────────────────────────────────────────────────

test("cada intento lleva su nivel de conocimiento, la tarea que leyó y los términos que no pudo escribir", () => {
  const carpeta = new URL(`./fixtures/corridas/${VIEJA}/`, import.meta.url);
  const leer = (archivo) => JSON.parse(readFileSync(new URL(archivo, carpeta), "utf8"));
  const arbol = { ...leer("route_tree.json"), tarea_sin_contexto: "Quieres dejar de pagar el internet de la casa: averigua cómo." };
  const coloquial = "Quieres dejar de pagar el internet de la casa: averigua cómo.";
  const runs = {
    first_time: { ...leer("first_time/run.json"), conocimiento: "sin_contexto", instruction: coloquial, tarea_coloquial: true, terminos_rechazados: ["dar de baja", "dar de baja"] },
    hurried: { ...leer("hurried/run.json"), conocimiento: "conoce_tema", terminos_rechazados: [] },
    mobile: leer("mobile/run.json"),
  };
  const tanda = armarTanda({ id: VIEJA, arbol, criterio: leer("criteria.json"), intentos: Object.entries(runs).map(([perfil, run]) => ({ perfil, run, video: false })) });
  const [sinContexto, conoce, comun] = tanda.intentos;
  assert.equal(sinContexto.conocimiento, "sin_contexto");
  assert.equal(sinContexto.instruccion, coloquial);
  assert.deepEqual(sinContexto.terminosRechazados, ["dar de baja"]);
  assert.equal(conoce.conocimiento, "conoce_tema");
  assert.equal(conoce.instruccion, runs.hurried.instruction?.trim() || null);
  assert.equal(comun.conocimiento, null, "un perfil común no tiene nivel");
  assert.deepEqual(comun.terminosRechazados, []);
  assert.equal(tanda.instruccionSinContexto, coloquial);
  assert.equal((tandaViejaCon(() => {})).instruccionSinContexto, null);
});

// ── C2-3: la ruta recomendada es la del evaluador ───────────────────────────────────────────────────────────────

test("rutaEnPaginas: acción y pasos de la ruta del evaluador, no de la rama unida; nunca un «volver a…»", () => {
  const paginaDeNodo = new Map([["n1", "p1"], ["n2", "p2"], ["n3", "p2"], ["n4", "p3"]]);
  const ramaPorId = new Map([
    ["p1>p2", { acciones: [{ accion: "volver a «Horarios y Tarifas»" }, { accion: "clic «Horarios»" }], accion: "volver a «Horarios y Tarifas»", pasosMinimos: 1, medianaSegundos: 4 }],
    ["p2>p3", { acciones: [{ accion: "clic «Otra cosa»" }], accion: "clic «Otra cosa»", pasosMinimos: 1, medianaSegundos: 6 }],
  ]);
  const ruta = rutaEnPaginas(
    {
      start_node: "n1",
      steps: [
        // metro 16-10-13: «scroll down x10» y luego «clic «Horarios»» = 2 pasos (la rama unida decía «volver a…», 1).
        { source: "n1", target: "n2", action: "clic «Horarios»", preceding_actions: ["scroll down x10"], median_time_s: 18.7 },
        // n3 es la misma página que n2: el tramo p2 → p3 junta los dos pasos.
        { source: "n2", target: "n3", action: "clic «Ver más»", preceding_actions: [], median_time_s: 2 },
        { source: "n3", target: "n4", action: "volver a «Tarifas»", preceding_actions: ["scroll down x5", "scroll down x5"] },
      ],
      estimated_probability: 0.5,
    },
    paginaDeNodo,
    ramaPorId,
  );
  assert.deepEqual(ruta.paginas, ["p1", "p2", "p3"]);
  assert.deepEqual(ruta.tramos, [
    { origen: "p1", destino: "p2", accion: "clic «Horarios»", pasos: 2, segundos: 18.7 },
    // Un «volver a…» del evaluador no se muestra como la acción: la de la rama que no es volver. Sin la mediana de
    // cada paso, la de la rama.
    { origen: "p2", destino: "p3", accion: "clic «Otra cosa»", pasos: 4, segundos: 6 },
  ]);
  assert.equal(ruta.pasosIdeales, 6);
  assert.equal(ruta.segundos, 24.7);
  assert.equal(rutaEnPaginas({ start_node: "n1", steps: [] }, paginaDeNodo, ramaPorId), null, "sin tramos no hay ruta");
});

// ── C2-4: sin demoras para los exploradores; sin ids de nodo en los titulares de la lista ───────────────────────

test("exploradores: sin hallazgos de demora ni titular «da N pasos seguidos»; sus demoras siguen marcando la telaraña", () => {
  const carpeta = new URL(`./fixtures/corridas/${NUEVA}/`, import.meta.url);
  const leer = (archivo) => JSON.parse(readFileSync(new URL(archivo, carpeta), "utf8"));
  const intentos = ["first_time", "hurried", "mobile", "senior"].map((perfil) => ({ perfil, run: leer(`${perfil}/run.json`), video: false }));
  const armar = (extra) => armarTanda({ id: NUEVA, arbol: { ...leer("route_tree.json"), ...extra }, criterio: leer("criteria.json"), intentos });
  const comun = armar({});
  assert.ok(comun.hallazgos.some((h) => h.id.startsWith("demora:")), "la tanda común sí tiene su demora");
  const exploradores = armar({ conjunto_exploradores: "conocimiento" });
  assert.equal(exploradores.hallazgos.filter((h) => h.id.startsWith("demora:")).length, 0);
  assert.notEqual(exploradores.titulares.tanda.vars.caso, "demora");
  assert.ok(exploradores.intentos.some((intento) => intento.demoras.length > 0), "las marcas de atasco de la telaraña siguen");
});

test("lista: el titular nombra la página (nunca «n4»), traducida en el navegador", async () => {
  const { resumirTanda } = await import("../lib/derivar.js");
  const { textoDeTitular } = await import("../public/datos/textos.js");
  const tanda = await leerTanda(RAIZ, NUEVA);
  // Un titular de demora (todos llegan, pero alguien da muchos pasos en una página).
  tanda.titulares.tanda = { clave: "datos.titular.tanda", nivel: "dificultad", vars: { validos: 3, errores: 0, caso: "demora", intento: "hurried", pagina: "n2", pasos: 7 } };
  const resumen = resumirTanda(tanda);
  assert.equal(typeof resumen.titular.vars.pagina, "object");
  assert.doesNotMatch(JSON.stringify(resumen.titular), /"n\d+"/);
  assert.deepEqual(resumen.titular.vars.pagina, { tituloTipo: "sitio", tituloCorto: "Ayuda", titulo: resumen.titular.vars.pagina.titulo, url: "https://ejemplo.test/ayuda" });
  const t = (clave, vars) => (clave === "datos.titular.tanda" ? `… da ${vars.pasos} pasos seguidos en «${vars.pagina}».` : clave);
  assert.equal(textoDeTitular(resumen.titular, resumen, t), "… da 7 pasos seguidos en «Ayuda».");
  // La página de inicio se nombra con el diccionario (Inicio / Home), también desde la lista.
  tanda.titulares.tanda.vars.pagina = "n1";
  const inicio = resumirTanda(tanda).titular;
  assert.equal(inicio.vars.pagina.tituloTipo, "inicio");
  const conInicio = (clave, vars) => (clave === "datos.pagina.inicio" ? "Inicio" : clave === "datos.titular.tanda" ? `«${vars.pagina}»` : clave);
  assert.equal(textoDeTitular(inicio, resumirTanda(tanda), conInicio), "«Inicio»");
});

test("un explorador que vuelve a una página con volver_a_nodo no tropieza (ni se traba ahí)", async () => {
  const { atascosPorPagina } = await import("../public/telarana/atascos.js");
  const conSaltos = (accion) => {
    const cruda = tandaViejaCruda();
    const apurado = cruda.intentos.find((intento) => intento.perfil === "hurried").run;
    for (const paso of apurado.steps) {
      paso.action = accion;
      paso.signals = ["went_back"];
    }
    return armarTanda(cruda);
  };
  const tanda = conSaltos("volver_a_nodo");
  const apurado = tanda.intentos.find((intento) => intento.id === "hurried");
  assert.ok(apurado.pasos.every((paso) => paso.estado === "sin_evaluar" && !paso.senales.includes("went_back")));
  const tropiezos = tanda.hallazgos.find((h) => h.id === "tropiezos");
  assert.ok(!tropiezos?.vars.casos.some((caso) => caso.intento === "hurried"), "sin tropiezos de hurried");
  for (const [, atascos] of atascosPorPagina(tanda)) assert.ok(!atascos.some((a) => a.intento === "hurried" && a.tropiezos), "sin atascos de hurried");
  // Un «volvió atrás» de verdad (un clic que regresa) sí cuenta.
  const conClics = conSaltos("left_click");
  assert.ok(conClics.intentos.find((intento) => intento.id === "hurried").pasos.every((paso) => paso.estado === "no_cumplida"));
  assert.ok(conClics.hallazgos.find((h) => h.id === "tropiezos").vars.pasos > (tropiezos?.vars.pasos ?? 0));
});

test("firma de un salto del explorador: «volver a «X»», con su propio tipo (se traduce)", () => {
  const salto = { action: "volver_a_nodo", action_input: { nodo: "p1", url: "https://www.ine.gob.cl/", titulo: "Inicio" }, description: "volver a «Inicio»" };
  assert.deepEqual({ tipo: firmaDelPaso(salto).tipo, objetivo: firmaDelPaso(salto).objetivo }, { tipo: "volver", objetivo: "Inicio" });
  assert.equal(firmaDelPaso({ action: "volver_a_nodo", description: "volver a «Mapa del sitio»" }).objetivo, "Mapa del sitio");
});

test("tarjeta de la ruta: las acciones humanas primero; un «volver a …» nunca la encabeza", async () => {
  const { accionesDelTramo } = await import("../public/pantallas/resumen.js");
  const ctx = { t: (clave, vars = {}) => (clave === "resumen.ruta.accionVeces" ? `${vars.accion} (${vars.n})` : clave === "resumen.ruta.masAcciones" ? `+${vars.n}` : clave) };
  const c = {
    tanda: {
      intentos: ["a", "b", "c"].map((id) => ({ id, perfil: id, resultado: "logrado" })),
      telarana: {
        ramas: [{
          origen: "n1", destino: "n2",
          acciones: [
            { accion: "volver a «Agenda»", perfiles: ["a", "b", "c"], salto: true },
            { accion: "clic «Horarios»", perfiles: ["a", "b"], salto: false },
          ],
        }],
      },
    },
  };
  assert.equal(accionesDelTramo(ctx, c, { origen: "n1", destino: "n2", accion: "" }).texto, "clic «Horarios» (2) · volver a «Agenda» (3)");
});

test("tarjeta de la ruta: encabeza la acción de la ruta del tramo, aunque otra se repita más en la rama", async () => {
  const { accionesDelTramo } = await import("../public/pantallas/resumen.js");
  const ctx = { t: (clave, vars = {}) => (clave === "resumen.ruta.accionVeces" ? `${vars.accion} (${vars.n})` : clave === "resumen.ruta.masAcciones" ? `+${vars.n}` : clave) };
  const perfiles = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const c = {
    tanda: {
      intentos: perfiles.map((id) => ({ id, perfil: id, resultado: "logrado" })),
      telarana: {
        ramas: [{
          origen: "n1", destino: "n2",
          acciones: [
            { accion: "clic «Buscar»", perfiles: perfiles.slice(0, 6), salto: false },
            { accion: "clic «Ir al Centro de Ayuda»", perfiles: perfiles.slice(0, 3), salto: false },
            { accion: "volver a «Inicio»", perfiles: ["h"], salto: true },
          ],
        }],
      },
    },
  };
  const tramo = { origen: "n1", destino: "n2", accion: "clic «Ir al Centro de Ayuda»" };
  assert.equal(accionesDelTramo(ctx, c, tramo).texto.split(" · ")[0], "clic «Ir al Centro de Ayuda» (3)");
  // Si la rama no tiene la acción de la ruta, igual va primero (sin cuenta).
  assert.equal(accionesDelTramo(ctx, c, { ...tramo, accion: "tecla Enter" }).texto.split(" · ")[0], "tecla Enter");
  // Un «volver a …» de la ruta no encabeza la tarjeta.
  assert.equal(accionesDelTramo(ctx, c, { ...tramo, accion: "volver a «Inicio»" }).texto.split(" · ")[0], "clic «Buscar» (6)");
});

test("resultado por nivel de conocimiento: intentos, logrados, medianas y escrituras rechazadas", () => {
  const intento = (conocimiento, resultado, pasos, duracion, rechazados = []) => ({ conocimiento, resultado, pasos: Array(pasos).fill({}), duracion, terminosRechazados: rechazados });
  const intentos = [
    intento("sin_contexto", "logrado", 20, 78), intento("sin_contexto", "logrado", 18, 70),
    intento("conoce_tema", "logrado", 24, 91, ["ipc"]), intento("conoce_tema", "fallido", 30, 120), intento("conoce_tema", "error", 2, 5),
  ];
  assert.deepEqual(porConocimiento(intentos), [
    { nivel: "sin_contexto", intentos: 2, logrados: 2, pasosMediana: 19, segundosMediana: 74, rechazos: 0 },
    { nivel: "conoce_tema", intentos: 3, logrados: 1, pasosMediana: 24, segundosMediana: 91, rechazos: 1 },
  ]);
  // Sin los dos niveles (perfiles comunes, o un solo nivel), no hay comparación.
  assert.equal(porConocimiento(intentos.map((i) => ({ ...i, conocimiento: null }))), null);
  assert.equal(porConocimiento(intentos.filter((i) => i.conocimiento === "conoce_tema")), null);
});

test("grosor de un tramo = intentos distintos que lo tomaron, no las pasadas (C4-4)", async () => {
  const { anchoDeTramo } = await import("../public/telarana/escena.js");
  // 8 intentos pasan 43 veces de n1 a n2 (un explorador vuelve y repite): el tramo tiene 8 intentos y 43 pasadas.
  const perfiles = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const crudas = Array.from({ length: 43 }, (_, i) => ({ source: "x1", target: "x2", action: i % 2 ? "clic «Ayuda»" : "clic «Buscar»", profiles: [perfiles[i % 8]], successes: 1 }));
  const [rama] = unirRamas(crudas, new Map([["x1", "n1"], ["x2", "n2"]]), new Set());
  assert.equal(rama.intentos, 8);
  assert.equal(rama.pasadas, 43);
  assert.deepEqual(rama.acciones.map((a) => [a.accion, a.intentos, a.pasadas]), [["clic «Ayuda»", 4, 21], ["clic «Buscar»", 4, 22]].sort((p, q) => q[2] - p[2]));
  assert.equal(anchoDeTramo({ tipo: "avance", intentos: rama.intentos }), 1.5 + 1.25 * 8, "como un tramo que tomaron los 8");
  // Los secundarios siguen con su tope de 3 px.
  assert.equal(anchoDeTramo({ tipo: "retroceso", intentos: rama.intentos }), 3);
});
