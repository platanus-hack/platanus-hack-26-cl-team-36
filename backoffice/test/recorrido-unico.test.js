// Corridas del Visitante con recorrido único (PR #79): perfiles desktop/mobile, `--runs 2` (carpetas desktop-2…),
// resultado medido contra la ruta de la Guía, «sin medir» y sin criteria.json. Los fixtures los escribió el código
// del Visitante (outcome.py, route_tree.py, comparison.py y shared.store), no se armaron a mano.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { armarTanda } from "../lib/derivar.js";
import { abrirArchivoDeIntento, idsDeTandas, leerTanda, listarTandas } from "../lib/tandas.js";
import { cifrasDeTanda, resultadosParaMedidor, tieneProblemas } from "../public/corridas/filtros.js";
import { textoDeHallazgo, textoDeTitular } from "../public/datos/textos.js";
import comunEn from "../public/i18n/en/comun.js";
import comunEs from "../public/i18n/es/comun.js";
import datosEn from "../public/i18n/en/datos.js";
import datosEs from "../public/i18n/es/datos.js";

const RAIZ = fileURLToPath(new URL("./fixtures/recorrido-unico", import.meta.url));
const VIEJAS = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const CON_RUTA = "ejemplo.test/visitor/horario/2026-11-22T10-00-00Z";
const SIN_RUTA = "ejemplo.test/visitor/horario/2026-11-22T10-30-00Z";

const DICCIONARIOS = { es: { datos: datosEs, comun: comunEs }, en: { datos: datosEn, comun: comunEn } };
const buscar = (raiz, clave) => clave.split(".").reduce((nodo, parte) => nodo?.[parte], raiz);
const crearT = (idioma) => (clave, vars = {}) => {
  const valor = buscar(DICCIONARIOS[idioma], clave);
  if (typeof valor === "function") return valor(vars, { plural: (n, formas) => (n === 1 ? formas.one : formas.other) });
  return typeof valor === "string" ? valor.replace(/\{(\w+)\}/g, (entero, nombre) => vars[nombre] ?? entero) : clave;
};
const es = crearT("es");
const en = crearT("en");

test("las repeticiones de un perfil son intentos aparte, en orden, con su carpeta y su n.º", async () => {
  const tanda = await leerTanda(RAIZ, CON_RUTA);
  assert.deepEqual(
    tanda.intentos.map((i) => [i.id, i.perfil, i.carpeta, i.repeticion, i.nombrePerfil]),
    [
      ["desktop", "desktop", "desktop", 1, "Escritorio"],
      ["desktop-2", "desktop", "desktop-2", 2, "Escritorio #2"],
      ["mobile", "mobile", "mobile", 1, "Móvil"],
      ["mobile-2", "mobile", "mobile-2", 2, "Móvil #2"],
    ],
  );
  // Perfiles agrupa las repeticiones bajo el nombre del perfil.
  assert.deepEqual(
    tanda.perfiles.map((p) => [p.perfil, p.nombre, p.intentos, p.medidos, p.logrados, p.metricas.exito]),
    [
      ["desktop", "Escritorio", ["desktop", "desktop-2"], 2, 1, { n: 1, de: 2 }],
      ["mobile", "Móvil", ["mobile", "mobile-2"], 2, 1, { n: 1, de: 2 }],
    ],
  );
  const archivo = await abrirArchivoDeIntento(RAIZ, { id: CON_RUTA, perfil: "desktop-2", archivo: "step_01.png" });
  assert.ok(archivo?.cuerpo);
  archivo.cuerpo.destroy();
});

test("el resultado sale de la ruta de la Guía, sin juez ni criteria.json", async () => {
  const tanda = await leerTanda(RAIZ, CON_RUTA);
  assert.equal(tanda.criterio, null);
  assert.equal(tanda.modeloJuez, null);
  assert.deepEqual(
    tanda.intentos.map((i) => [i.id, i.resultado, i.fuente, i.declaroTerminar, i.logro]),
    [
      ["desktop", "logrado", "ruta", true, "directo"],
      ["desktop-2", "fallido", "ruta", true, "declaro_sin_llegar"],
      ["mobile", "abandonado", "ruta", false, null],
      ["mobile-2", "logrado", "ruta", false, "directo"],
    ],
  );
  assert.deepEqual([tanda.kpis.validos, tanda.kpis.medidos, tanda.kpis.logrados], [4, 4, 2]);
});

test("declarar que terminó sin llegar es un hallazgo propio, en los dos idiomas", async () => {
  const tanda = await leerTanda(RAIZ, CON_RUTA);
  assert.deepEqual(tanda.hallazgos.map((h) => h.id).filter((id) => /^(declaro|detenido)/.test(id)), ["declaro:desktop-2", "detenido:mobile"]);
  const declaro = tanda.hallazgos.find((h) => h.id === "declaro:desktop-2");
  assert.equal(
    textoDeHallazgo(declaro, tanda, es),
    "Escritorio #2 declaró que terminó sin llegar a la página final de la ruta: se quedó en «Contacto» tras 1 paso.",
  );
  assert.match(textoDeHallazgo(declaro, tanda, en), /^Escritorio #2 said it was done without reaching/);
  assert.equal(es("comun.logro.declaro_sin_llegar"), "declaró que terminó sin llegar");
  assert.equal(textoDeHallazgo(tanda.hallazgos[0], tanda, es), "2 de 4 llegan a la respuesta. No llegan: Escritorio #2 y Móvil.");
});

test("la telaraña reparte los tramos de un perfil entre las repeticiones que los recorrieron", async () => {
  const tanda = await leerTanda(RAIZ, CON_RUTA);
  const rama = (id) => tanda.telarana.ramas.find((r) => r.id === id);
  // El árbol del Visitante solo dice «desktop» y «mobile».
  assert.deepEqual(rama("n1>n2").perfiles, ["desktop", "mobile"]);
  assert.deepEqual(rama("n1>n2").intentosIds, ["desktop", "mobile", "mobile-2"]);
  assert.deepEqual([rama("n1>n2").resultado, rama("n1>n2").llegaron, rama("n1>n2").noLlegaron], ["mixto", 2, 1]);
  assert.deepEqual([rama("n1>n4").intentosIds, rama("n1>n4").resultado], [["desktop-2"], "fallo"]);
  assert.deepEqual(tanda.telarana.paginas.find((p) => p.id === "n4").finales, { logrado: 0, fallido: 1, abandonado: 0, sin_medir: 0, error: 0 });
});

test("sin ruta de la Guía ni juez el intento queda sin medir y no cuenta como problema", async () => {
  const tanda = await leerTanda(RAIZ, SIN_RUTA);
  const [intento] = tanda.intentos;
  assert.deepEqual([intento.resultado, intento.resultadoJuez, intento.fuente, intento.declaroTerminar, intento.logro], ["sin_medir", "unmeasured", null, true, null]);
  assert.deepEqual([tanda.kpis.validos, tanda.kpis.medidos, tanda.kpis.logrados], [1, 0, 0]);
  assert.equal(tanda.perfiles[0].metricas.exito, null);
  assert.equal(tanda.telarana.paginas.find((p) => p.id === "n3").finales.sin_medir, 1);
  assert.equal(tanda.telarana.ramas.find((r) => r.id === "n1>n2").resultado, "sin_medir");
  assert.deepEqual(tanda.hallazgos.map((h) => h.id), ["resultado"]);
  assert.equal(textoDeHallazgo(tanda.hallazgos[0], tanda, es), "El único intento no se midió: no hay ruta de la Guía ni juez.");
  assert.equal(textoDeHallazgo(tanda.hallazgos[0], tanda, en), "The only attempt was not measured: there is no Guide route nor judge.");
  assert.equal(tanda.titulares.tanda.nivel, "info");
  assert.equal(tanda.titulares.perfiles.vars.caso, "sinMedir");
  assert.match(textoDeTitular(tanda.titulares.telarana, tanda, es), /^No se midió quién llegó/);

  const { tandas } = await listarTandas(RAIZ);
  const resumen = tandas.find((t) => t.id === SIN_RUTA);
  assert.deepEqual([resumen.validos, resumen.medidos, resumen.perfiles[0].resultado], [1, 0, "sin_medir"]);
  assert.equal(tieneProblemas(resumen), false);
  assert.equal(cifrasDeTanda(resumen).medidos, 0);
  assert.equal(tieneProblemas(tandas.find((t) => t.id === CON_RUTA)), true);
  assert.deepEqual(resultadosParaMedidor([{ resultado: "error" }, { resultado: "sin_medir" }, { resultado: "logrado" }]).map((p) => p.resultado), ["logrado", "sin_medir", "error"]);
});

test("una tanda mezcla medidos y sin medir: los sin medir no cuentan en «llegan»", () => {
  const leer = (relativa) => JSON.parse(readFileSync(new URL(`./fixtures/recorrido-unico/${CON_RUTA}/${relativa}`, import.meta.url), "utf8"));
  const crudos = ["desktop", "desktop-2", "mobile", "mobile-2"].map((carpeta) => ({ perfil: carpeta, run: leer(`${carpeta}/run.json`), video: false }));
  crudos[3].run.verdict = { outcome: "unmeasured", source: null, claimed_done: false, justification: "Sin ruta." };
  const mezcla = armarTanda({ id: CON_RUTA, arbol: leer("route_tree.json"), criterio: null, intentos: crudos });
  assert.deepEqual([mezcla.kpis.validos, mezcla.kpis.medidos, mezcla.kpis.logrados], [4, 3, 1]);
  assert.ok(mezcla.hallazgos.some((h) => h.id === "sinMedir"));
  assert.equal(textoDeHallazgo(mezcla.hallazgos.find((h) => h.id === "sinMedir"), mezcla, es), "Un intento no se midió (no hay ruta de la Guía ni juez): Móvil #2.");
});

test("las corridas viejas siguen igual: veredicto del juez, un intento por perfil", async () => {
  const [nueva] = await idsDeTandas(VIEJAS);
  const tanda = await leerTanda(VIEJAS, nueva);
  assert.deepEqual(tanda.intentos.map((i) => [i.id, i.perfil, i.repeticion, i.fuente]), [
    ["first_time", "first_time", 1, "juez"],
    ["hurried", "hurried", 1, "juez"],
    ["mobile", "mobile", 1, "juez"],
    ["senior", "senior", 1, "juez"],
  ]);
  assert.ok(tanda.telarana.ramas.every((rama) => rama.intentosIds.every((id) => rama.perfiles.includes(id))));
  assert.ok(tanda.criterio);
});

test("un run.json con perfil o nombre que no son texto usa la carpeta", () => {
  const leer = (relativa) => JSON.parse(readFileSync(new URL(`./fixtures/recorrido-unico/${CON_RUTA}/${relativa}`, import.meta.url), "utf8"));
  const run = { ...leer("desktop-2/run.json"), profile: { x: 1 }, profile_name: ["<b>"] };
  const tanda = armarTanda({ id: CON_RUTA, arbol: leer("route_tree.json"), criterio: null, intentos: [{ perfil: "desktop-2", run, video: false }] });
  assert.deepEqual([tanda.intentos[0].perfil, tanda.intentos[0].nombrePerfil, tanda.perfiles[0].nombre], ["desktop-2", "desktop-2 #2", "desktop-2"]);
});

test("un intento interrumpido no está en el árbol: no descuenta finales ni se asigna a tramos", () => {
  const leer = (relativa) => JSON.parse(readFileSync(new URL(`./fixtures/recorrido-unico/${CON_RUTA}/${relativa}`, import.meta.url), "utf8"));
  const crudos = ["desktop", "desktop-2", "mobile", "mobile-2"].map((carpeta) => ({ perfil: carpeta, run: leer(`${carpeta}/run.json`), video: false }));
  // Como lo deja outcome.interrupted: el camino de `mobile`, fuera del route_tree.json.
  const interrumpido = { ...leer("mobile/run.json"), attempt: 3, folder: "mobile-3", end_reason: "api_error", final_message: "Timeout" };
  interrumpido.verdict = { outcome: "interrupted", source: null, claimed_done: false, justification: "Se interrumpió." };
  crudos.push({ perfil: "mobile-3", run: interrumpido, video: false });
  const tanda = armarTanda({ id: CON_RUTA, arbol: leer("route_tree.json"), criterio: null, intentos: crudos });
  assert.equal(tanda.intentos.find((i) => i.id === "mobile-3").resultado, "error");
  assert.deepEqual(tanda.telarana.paginas.find((p) => p.id === "n2").finales, { logrado: 0, fallido: 0, abandonado: 1, sin_medir: 0, error: 1 });
  const rama = tanda.telarana.ramas.find((r) => r.id === "n1>n2");
  assert.deepEqual([rama.intentosIds, rama.exitos, rama.fallos, rama.errores], [["desktop", "mobile", "mobile-2"], 2, 1, 0]);
});
