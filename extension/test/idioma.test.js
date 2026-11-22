// Tests del diccionario (src/comun/idioma.js), de su carga en los content scripts y del
// texto intermedio de la animación del popup (src/popup/idioma.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import "../src/comun/idioma.js";
import { textoIntermedio } from "../src/popup/idioma.js";

const { CLAVE_IDIOMA, IDIOMA_POR_DEFECTO, IDIOMAS, TEXTOS, normalizarIdioma, t, fijar, texto, actual } = globalThis.MiTema.idioma;

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");
const marcas = (valor) => [...valor.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const formas = (valor) => (typeof valor === "string" ? [valor] : Object.values(valor));

// ---------- Diccionario ----------

test("hay español e inglés, y español es el idioma por defecto", () => {
  assert.deepEqual(Object.keys(TEXTOS).sort(), ["en", "es"]);
  assert.deepEqual(Object.keys(IDIOMAS).sort(), ["en", "es"]);
  assert.equal(IDIOMA_POR_DEFECTO, "es");
  assert.equal(CLAVE_IDIOMA, "idioma");
});

test("es y en tienen exactamente las mismas claves", () => {
  assert.deepEqual(Object.keys(TEXTOS.en).sort(), Object.keys(TEXTOS.es).sort());
});

test("ningún texto vacío, y cada traducción usa los mismos parámetros y formas de plural", () => {
  for (const clave of Object.keys(TEXTOS.es)) {
    const es = TEXTOS.es[clave];
    const en = TEXTOS.en[clave];
    assert.equal(typeof es, typeof en, `"${clave}" es texto en un idioma y plural en el otro`);
    if (typeof es === "object") {
      assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort(), `formas de plural distintas en "${clave}"`);
      assert.ok(es.uno && es.otros, `"${clave}" necesita al menos "uno" y "otros"`);
    }
    for (const valor of [...formas(es), ...formas(en)]) {
      assert.equal(typeof valor, "string");
      assert.ok(valor.trim().length > 0, `texto vacío en "${clave}"`);
    }
    assert.deepEqual(marcas(formas(en).join(" ")), marcas(formas(es).join(" ")), `parámetros distintos en "${clave}"`);
  }
});

test("t: traduce, interpola y formatea números según el idioma", () => {
  assert.equal(t("es", "opinion.enviar"), "Enviar");
  assert.equal(t("en", "opinion.enviar"), "Send");
  assert.equal(t("es", "motivo.largo", { max: 2000 }), "El comentario es muy largo (máximo 2.000 caracteres).");
  assert.equal(t("en", "motivo.largo", { max: 2000 }), "Your comment is too long (2,000 characters max).");
  assert.equal(t("en", "idioma.boton", { nombre: "English" }), "Language: English. Change language");
});

test("t: plurales con cero, uno y otros", () => {
  assert.equal(t("es", "opinion.pendientes", { n: 0 }), "Aún no hay opiniones guardadas en tu equipo.");
  assert.equal(t("es", "opinion.pendientes", { n: 1 }), "1 opinión guardada en tu equipo.");
  assert.equal(t("es", "opinion.pendientes", { n: 2 }), "2 opiniones guardadas en tu equipo.");
  assert.equal(t("en", "opinion.pendientes", { n: 1 }), "1 response saved on this device.");
  assert.equal(t("en", "opinion.pendientes", { n: 12 }), "12 responses saved on this device.");
});

test("t: idioma desconocido cae al español; clave desconocida se devuelve tal cual", () => {
  assert.equal(t("fr", "opinion.enviar"), "Enviar");
  assert.equal(t(undefined, "opinion.enviar"), "Enviar");
  assert.equal(t("en", "no.existe"), "no.existe");
  assert.equal(t("en", "idioma.boton"), "Language: {nombre}. Change language"); // sin el parámetro queda la marca
});

test("normalizarIdioma: solo acepta idiomas del diccionario", () => {
  assert.equal(normalizarIdioma("en"), "en");
  assert.equal(normalizarIdioma("es"), "es");
  for (const raro of [undefined, null, "", "EN", "fr", "__proto__", "toString"]) assert.equal(normalizarIdioma(raro), "es");
});

test("fijar/texto: el idioma actual de los content scripts", () => {
  assert.equal(actual(), "es");
  fijar("en");
  assert.equal(texto("foco.entrar"), "🎯 Focus mode");
  fijar("xx");
  assert.equal(actual(), "es");
  assert.equal(texto("foco.entrar"), "🎯 Modo foco");
});

// ---------- Content scripts ----------

test("comun/idioma.js se carga justo después de content/registro.js en los content scripts", () => {
  const scripts = JSON.parse(leer("manifest.json")).content_scripts.flatMap((cs) => cs.js ?? []);
  assert.equal(scripts.indexOf("comun/idioma.js"), scripts.indexOf("content/registro.js") + 1);
});

test("en un content script, idioma.js se suma a MiTema sin pisar el registro", () => {
  const contexto = vm.createContext({});
  vm.runInContext(leer("content/registro.js"), contexto);
  vm.runInContext(leer("comun/idioma.js"), contexto);
  const MiTema = vm.runInContext("globalThis.MiTema", contexto);
  assert.equal(typeof MiTema.registrarFeature, "function");
  assert.equal(MiTema.idioma.t("en", "cartelera.boton"), "Play");
});

test("los content scripts que muestran texto lo sacan del diccionario", () => {
  assert.match(leer("features/modo-foco.js"), /MiTema\.idioma\.texto\(.*"foco\./);
  assert.match(leer("componentes/cartelera.js"), /MiTema\.idioma\.t\(/);
  assert.doesNotMatch(leer("features/modo-foco.js"), /"🎯 /);
});

// ---------- Animación del popup ----------

test("textoIntermedio: empieza en el texto viejo y termina en el nuevo", () => {
  assert.equal(textoIntermedio("Enviar", "Send", 0), "Enviar");
  assert.equal(textoIntermedio("Enviar", "Send", 1), "Send");
});

test("textoIntermedio: el largo pasa de a poco y lo ya resuelto es el texto nuevo", () => {
  const desde = "Ayúdanos a mejorar tu experiencia";
  const hasta = "Help us improve your experience";
  let largoAnterior = desde.length;
  for (let paso = 1; paso < 20; paso++) {
    const p = paso / 20;
    const intermedio = textoIntermedio(desde, hasta, p, paso);
    const largo = intermedio.length;
    assert.ok(Math.abs(largo - largoAnterior) <= 2, "el largo no salta de golpe");
    largoAnterior = largo;
    // Al final del camino, el comienzo ya es el texto nuevo.
    if (p >= 0.9) assert.ok(intermedio.startsWith(hasta.slice(0, 10)), intermedio);
  }
});

test("textoIntermedio: es estable dentro de una misma tanda (no parpadea en cada cuadro)", () => {
  assert.equal(textoIntermedio("Mejor", "Better", 0.4, 3, 1), textoIntermedio("Mejor", "Better", 0.4, 3, 1));
});
