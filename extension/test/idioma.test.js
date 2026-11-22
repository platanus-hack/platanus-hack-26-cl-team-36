// Tests del diccionario (src/comun/idioma.js), de su carga en los content scripts y del
// cambio inmediato del texto del popup (src/popup/idioma.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import "../src/comun/idioma.js";
import { ponerTexto } from "../src/popup/idioma.js";

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

test("los textos propios de los temas vienen por idioma y con claves que la cartelera conoce", () => {
  const claves = Object.keys(TEXTOS.es)
    .filter((clave) => clave.startsWith("cartelera."))
    .map((clave) => clave.slice("cartelera.".length));
  for (const id of readdirSync(new URL("temas/", src))) {
    const tema = JSON.parse(leer(`temas/${id}/tema.json`));
    for (const vista of [].concat(tema.features?.vista ?? [])) {
      const textos = vista.opciones?.textos;
      if (!textos) continue;
      assert.deepEqual(Object.keys(textos).sort(), Object.keys(TEXTOS).sort(), `la vista "${vista.id}" debe traer textos en cada idioma`);
      for (const [idioma, porIdioma] of Object.entries(textos)) {
        for (const clave of Object.keys(porIdioma)) assert.ok(claves.includes(clave), `"${clave}" (${idioma}) no lo usa la cartelera`);
      }
    }
  }
});

test("los content scripts que muestran texto lo sacan del diccionario", () => {
  assert.match(leer("features/modo-foco.js"), /MiTema\.idioma\.texto\(.*"foco\./);
  assert.match(leer("componentes/cartelera.js"), /MiTema\.idioma\.t\(/);
  assert.doesNotMatch(leer("features/modo-foco.js"), /"🎯 /);
});

// ---------- Textos del popup ----------

test("ponerTexto actualiza solo el texto y evita escrituras repetidas", () => {
  let actual = "Enviar";
  let escrituras = 0;
  const nodo = { get textContent() { return actual; }, set textContent(valor) { actual = valor; escrituras++; } };
  ponerTexto(nodo, "Enviar");
  assert.equal(escrituras, 0);
  ponerTexto(nodo, "Send");
  assert.equal(actual, "Send");
  assert.equal(escrituras, 1);
  ponerTexto(nodo, "Send");
  assert.equal(escrituras, 1);
});

test("el nombre del control de la barra aclara alcance global en ambos idiomas", () => {
  assert.equal(t("es", "accion.encendida"), "Chameleon Mode: encendido en los sitios compatibles");
  assert.equal(t("es", "accion.apagada"), "Chameleon Mode: apagado en todos los sitios");
  assert.equal(t("en", "accion.encendida"), "Chameleon Mode: on for supported sites");
  assert.equal(t("en", "accion.apagada"), "Chameleon Mode: off for all sites");
});
