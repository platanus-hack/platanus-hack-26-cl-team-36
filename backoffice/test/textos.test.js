import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import {
  nombreDePagina,
  textoDeConteos,
  textoDeError,
  textoDeFirma,
  textoDeHallazgo,
  textoDeLoQuePaso,
  textoDeTitular,
} from "../public/datos/textos.js";
import datosEn from "../public/i18n/en/datos.js";
import datosEs from "../public/i18n/es/datos.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));

// Un t() mínimo con las reglas de §5.13 (el de la página es nucleo/i18n.js): idioma → es → la clave.
// `comun.senal` es de WP1; aquí va una copia para no depender de su diccionario.
const COMUN = {
  es: { senal: { no_effect: "Sin efecto", went_back: "Volvió atrás", visible_error: "Error visible", security_block: "Bloqueo" } },
  en: { senal: { no_effect: "No effect", went_back: "Went back", visible_error: "Visible error", security_block: "Security block" } },
};
const DICCIONARIOS = { es: { datos: datosEs, comun: COMUN.es }, en: { datos: datosEn, comun: COMUN.en } };
const buscar = (raiz, clave) => clave.split(".").reduce((nodo, parte) => (nodo && typeof nodo === "object" ? nodo[parte] : undefined), raiz);
function crearT(idioma) {
  return (clave, vars = {}) => {
    const valor = buscar(DICCIONARIOS[idioma], clave) ?? buscar(DICCIONARIOS.es, clave);
    if (typeof valor === "function") return valor(vars, { plural: (n, formas) => (n === 1 ? formas.one : formas.other) });
    if (typeof valor === "string") return valor.replace(/\{(\w+)\}/g, (entero, nombre) => (vars[nombre] ?? entero));
    return clave;
  };
}
const es = crearT("es");
const en = crearT("en");

const ARBOL = (objeto) =>
  Object.entries(objeto).flatMap(([clave, valor]) =>
    valor && typeof valor === "object" ? ARBOL(valor).map((hija) => `${clave}.${hija}`) : [clave],
  );

test("es y en tienen el mismo árbol de claves", () => {
  assert.deepEqual(ARBOL(datosEn).sort(), ARBOL(datosEs).sort());
});

test("cada clave que usa lib/ existe en los dos idiomas", () => {
  const claves = [
    ...["internal_error", "api_error", "no_response", "refusal", "juez", "sin_inicio"].map((c) => `error.${c}`),
    ...["done", "blocked", "gave_up", "step_limit", "time_limit", "refusal", "api_error", "no_response", "internal_error", "desconocido"].map((c) => `motivo.${c}`),
    ...["clic", "clic_coordenadas", "doble_clic", "triple_clic", "desplazar", "escribir", "atras", "tecla", "otra"].map((c) => `firma.${c}`),
    ...["volvio", "cambioUrl", "cambioTitulo", "sinCambio", "cambioParcial", "errorVisible", "bloqueoSeguridad", "detalle", "sinRegistro"].map((c) => `loQuePaso.${c}`),
    ...["resultado", "errores", "desvio", "detenido", "demora", "tropiezos", "costo"].map((c) => `hallazgo.${c}`),
    "titular.telarana", "titular.perfiles", "pagina.inicio",
    ...["clic", "desplazamiento", "texto", "tecla", "otra"].map((c) => `conteos.${c}`),
  ];
  for (const diccionario of [datosEs, datosEn]) {
    for (const clave of claves) assert.ok(buscar(diccionario, clave) !== undefined, `falta datos.${clave}`);
  }
});

test("las funciones del diccionario no fallan sin variables", () => {
  for (const diccionario of [datosEs, datosEn]) {
    for (const clave of ARBOL(diccionario)) {
      const valor = buscar(diccionario, clave);
      if (typeof valor !== "function") continue;
      for (const n of [0, 1, 2]) {
        const texto = valor({ n }, { plural: (cuenta, formas) => (cuenta === 1 ? formas.one : formas.other) });
        assert.ok(typeof texto === "string" && texto.length > 0, `${clave} con n=${n}`);
      }
    }
  }
});

function sinRestos(texto) {
  assert.doesNotMatch(texto, /\{|undefined|null|NaN|\[object|datos\.|comun\./, texto);
}

test("tanda nueva: titular y hallazgos en español e inglés", async () => {
  const tanda = await leerTanda(RAIZ, "tarea-demo/2026-11-21_11-00-00");
  assert.equal(textoDeTitular(tanda.titulares.tanda, tanda, es), "2 de 3 llegan a la respuesta. No llega: Adulto mayor.");
  assert.equal(textoDeTitular(tanda.titulares.tanda, tanda, en), "2 of 3 reach the answer. Did not reach it: Adulto mayor.");
  assert.deepEqual(tanda.hallazgos.map((h) => textoDeHallazgo(h, tanda, es)), [
    "2 de 3 llegan a la respuesta. No llega: Adulto mayor.",
    "Un intento no cuenta: error de la herramienta (Móvil).",
    "Adulto mayor deja la ruta en «Inicio» hacia «Sin titulo · ?x=1» (paso 1) y no vuelve.",
    "Adulto mayor termina en «Sin titulo · ?x=1» tras 3 pasos: se rindió.",
    "Apurado da 7 pasos seguidos en «Ayuda» (la ruta: 1): 6 desplazamientos, 1 clic.",
    "2 pasos con tropiezos: Apurado, paso 4 (sin efecto); Adulto mayor, paso 3 (volvió atrás).",
  ]);
  assert.deepEqual(tanda.hallazgos.map((h) => textoDeHallazgo(h, tanda, en)), [
    "2 of 3 reach the answer. Did not reach it: Adulto mayor.",
    "One attempt does not count: tool error (Móvil).",
    "Adulto mayor leaves the route at «Home» towards «Sin titulo · ?x=1» (step 1) and does not come back.",
    "Adulto mayor ends at «Sin titulo · ?x=1» after 3 steps: gave up.",
    "Apurado takes 7 steps in a row on «Ayuda» (the route: 1): 6 scrolls, 1 click.",
    "2 steps with stumbles: Apurado, step 4 (no effect); Adulto mayor, step 3 (went back).",
  ]);
  // La ruta del evaluador de esta tanda tiene 4 pasos, como la mediana: no hay hallazgo de costo. Su texto:
  const costo = { id: "costo", nivel: "info", clave: "datos.hallazgo.costo", vars: { pasosMediana: 4, pasosIdeales: 2 }, intento: null, paso: null, pagina: null };
  assert.equal(textoDeHallazgo(costo, tanda, es), "La mediana es de 4 pasos; la ruta recomendada usa 2.");
  assert.equal(textoDeHallazgo(costo, tanda, en), "The median is 4 steps; the recommended route takes 2.");
  assert.equal(textoDeTitular(tanda.titulares.telarana, tanda, es), "La ruta recomendada tiene 2 tramos y 4 pasos; 2 de 3 la siguen.");
  assert.equal(textoDeTitular(tanda.titulares.perfiles, tanda, es), "Adulto mayor no llega a la respuesta (1 intento por perfil).");
  assert.equal(textoDeTitular(tanda.titulares.perfiles, tanda, en), "Adulto mayor does not reach the answer (1 attempt per profile).");
});

test("el titular de Corridas se resuelve con el resumen de la tanda", async () => {
  const tanda = await leerTanda(RAIZ, "tarea-demo/2026-11-21_11-00-00");
  const resumen = { perfiles: tanda.intentos.map((i) => ({ intento: i.id, perfil: i.perfil, nombre: i.nombrePerfil })) };
  assert.equal(textoDeTitular(tanda.titulares.tanda, resumen, es), "2 de 3 llegan a la respuesta. No llega: Adulto mayor.");
});

test("todo lo de las dos tandas se escribe sin restos de claves ni variables", async () => {
  for (const id of ["tarea-demo/2026-11-21_10-00-00", "tarea-demo/2026-11-21_11-00-00"]) {
    const tanda = await leerTanda(RAIZ, id);
    for (const t of [es, en]) {
      for (const hallazgo of tanda.hallazgos) sinRestos(textoDeHallazgo(hallazgo, tanda, t));
      for (const titular of Object.values(tanda.titulares)) sinRestos(textoDeTitular(titular, tanda, t));
      for (const pagina of tanda.telarana.paginas) sinRestos(nombreDePagina(pagina, t));
      for (const intento of tanda.intentos) {
        for (const paso of intento.pasos) {
          sinRestos(textoDeFirma(paso.firma, t));
          sinRestos(textoDeLoQuePaso(paso.loQuePaso, t));
        }
      }
    }
  }
});

// Tandas reducidas a lo que usan los textos, con las cifras reales de agents/.runs/ (§2.6).
const resultado = (vars) => ({ clave: "datos.hallazgo.resultado", vars: { intentos: [], ...vars } });
const WOM = {
  intentos: [{ id: "first_time", nombrePerfil: "Primera vez" }, { id: "hurried", nombrePerfil: "Apurado" }, { id: "mobile", nombrePerfil: "Móvil" }],
  telarana: { paginas: [{ id: "n1", tituloTipo: "inicio", tituloCorto: null }] },
};

test("las frases de los datos reales, en español e inglés", () => {
  const todos = resultado({ total: 3, validos: 3, logrados: 3, directos: 3, siguen: 3, errores: 0 });
  assert.equal(textoDeTitular(todos, WOM, es), "Los 3 llegan a la respuesta por la ruta recomendada.");
  assert.equal(textoDeTitular(todos, WOM, en), "All 3 reach the answer by the recommended route.");
  const dt = resultado({ total: 3, validos: 2, logrados: 2, directos: 2, siguen: 2, errores: 1 });
  assert.equal(textoDeTitular(dt, WOM, es), "Los 2 intentos válidos llegan a la respuesta por la ruta recomendada.");
  assert.equal(textoDeTitular(dt, WOM, en), "The 2 valid attempts reach the answer by the recommended route.");
  const demora = {
    clave: "datos.hallazgo.demora",
    vars: { intento: "mobile", pagina: "n1", pasos: 6, rutaPasos: 3, conteos: { clic: 5, desplazamiento: 0, texto: 1, tecla: 0, otra: 0 } },
  };
  assert.equal(textoDeHallazgo(demora, WOM, es), "Móvil da 6 pasos seguidos en «Inicio» (la ruta: 3): 5 clics, 1 texto.");
  assert.equal(textoDeHallazgo(demora, WOM, en), "Móvil takes 6 steps in a row on «Home» (the route: 3): 5 clicks, 1 text entry.");
  const tropiezos = { clave: "datos.hallazgo.tropiezos", vars: { pasos: 1, casos: [{ intento: "mobile", paso: 4, senal: "no_effect" }] } };
  assert.equal(textoDeHallazgo(tropiezos, WOM, es), "1 paso con tropiezos: Móvil, paso 4 (sin efecto).");
  const telarana = { clave: "datos.titular.telarana", vars: { hayRuta: true, tramos: 3, pasosIdeales: 8, siguen: 3, validos: 3 } };
  assert.equal(textoDeTitular(telarana, WOM, es), "La ruta recomendada tiene 3 tramos y 8 pasos; los 3 la siguen.");
  assert.equal(textoDeTitular(telarana, WOM, en), "The recommended route has 3 legs and 8 steps; all 3 follow it.");
  const costo = { clave: "datos.hallazgo.costo", vars: { pasosMediana: 8, pasosIdeales: 5 } };
  assert.equal(textoDeHallazgo(costo, WOM, es), "La mediana es de 8 pasos; la ruta recomendada usa 5.");
  const vacia = resultado({ total: 0, validos: 0, logrados: 0, errores: 0 });
  assert.equal(textoDeTitular(vacia, WOM, es), "La tanda no tiene intentos registrados.");
  assert.equal(textoDeTitular(vacia, WOM, en), "This batch has no recorded attempts.");
  const sinValidos = resultado({ total: 1, validos: 0, logrados: 0, errores: 1 });
  assert.equal(textoDeTitular(sinValidos, WOM, es), "Ningún intento válido: el único intento falló por un error de la herramienta.");
  const otroCamino = resultado({ total: 3, validos: 3, logrados: 3, directos: 1, errores: 0 });
  assert.equal(textoDeTitular(otroCamino, WOM, es), "Los 3 llegan a la respuesta; 2 por otro camino.");
  const perfiles = { clave: "datos.titular.perfiles", vars: { caso: "masPasos", intentos: ["mobile"], pasos: 12, pasosIdeales: 8, perfiles: 3, unoPorPerfil: true } };
  assert.equal(textoDeTitular(perfiles, WOM, es), "Móvil necesita 12 pasos; la ruta, 8 (1 intento por perfil).");
});

test("titular de una tanda donde todos llegan pero alguien lo pasa mal", () => {
  const titular = (vars) => ({ clave: "datos.titular.tanda", nivel: "dificultad", vars: { validos: 3, errores: 0, ...vars } });
  const masPasos = titular({ caso: "masPasos", intento: "hurried", pasos: 12, pasosIdeales: 5 });
  assert.equal(textoDeTitular(masPasos, WOM, es), "Los 3 llegan a la respuesta, pero Apurado tarda 12 pasos (la ruta: 5).");
  assert.equal(textoDeTitular(masPasos, WOM, en), "All 3 reach the answer, but Apurado takes 12 steps (the route: 5).");
  const demora = titular({ caso: "demora", intento: "mobile", pagina: "n1", pasos: 6 });
  assert.equal(textoDeTitular(demora, WOM, es), "Los 3 llegan a la respuesta, pero Móvil da 6 pasos seguidos en «Inicio».");
  assert.equal(textoDeTitular(demora, WOM, en), "All 3 reach the answer, but Móvil takes 6 steps in a row on «Home».");
  const tropiezos = titular({ validos: 2, errores: 1, caso: "tropiezos", pasos: 1 });
  assert.equal(textoDeTitular(tropiezos, WOM, es), "Los 2 intentos válidos llegan a la respuesta, pero hay 1 paso con tropiezos.");
  assert.equal(textoDeTitular(tropiezos, WOM, en), "The 2 valid attempts reach the answer, but 1 step has stumbles.");
});

test("firmas, lo que pasó, conteos, errores y nombres de página", () => {
  const firma = (extra) => ({ objetivo: null, direccion: null, cantidad: null, x: 380, y: 549, original: "clic en (380, 549)", ...extra });
  assert.equal(textoDeFirma(firma({ tipo: "clic", objetivo: "Buscar tema" }), es), "clic «Buscar tema»");
  assert.equal(textoDeFirma(firma({ tipo: "clic", objetivo: "Buscar tema" }), en), "click «Buscar tema»");
  assert.equal(textoDeFirma(firma({ tipo: "clic_coordenadas" }), es), "clic en (380, 549)");
  assert.equal(textoDeFirma(firma({ tipo: "desplazar", direccion: "abajo", cantidad: 10 }), es), "desplazar ↓ ×10");
  assert.equal(textoDeFirma(firma({ tipo: "desplazar", direccion: "arriba", cantidad: 10 }), en), "scroll ↑ ×10");
  assert.equal(textoDeFirma(firma({ tipo: "escribir", objetivo: "baja" }), en), "type «baja»");
  assert.equal(textoDeFirma(firma({ tipo: "otra", original: "zoom x2" }), en), "zoom x2");
  assert.equal(textoDeFirma(firma({ tipo: "inventado", original: "algo" }), es), "algo");
  assert.equal(textoDeFirma(null, es), "");

  const loQuePaso = [{ clave: "cambioUrl", vars: { de: "e.test/", a: "e.test/ayuda" } }, { clave: "cambioTitulo", vars: { titulo: "Ayuda" } }];
  assert.equal(textoDeLoQuePaso(loQuePaso, es), "Pasó de e.test/ a e.test/ayuda. La página se llama «Ayuda».");
  assert.equal(textoDeLoQuePaso([], en), "No changes recorded.");
  assert.equal(textoDeLoQuePaso([{ clave: "cambioParcial", vars: { porcentaje: 25 } }], es), "Cambió el 25 % de la pantalla, en la misma página.");

  assert.equal(textoDeConteos({ clic: 2, desplazamiento: 7, texto: 1 }, es), "7 desplazamientos, 2 clics, 1 texto");
  assert.equal(textoDeConteos({ clic: 0 }, es), "");

  const error = { tipo: "internal_error", resumen: "Page.screenshot: …", detalle: "Error: Page.screenshot: …\nCall log:" };
  assert.deepEqual(textoDeError(error, es), { titulo: "Falló el navegador del evaluador", resumen: error.resumen, detalle: error.detalle });
  assert.equal(textoDeError(error, en).titulo, "The evaluator's browser failed");
  assert.equal(textoDeError(null, es), null);

  assert.equal(nombreDePagina({ tituloTipo: "inicio", tituloCorto: null }, en), "Home");
  assert.equal(nombreDePagina({ tituloTipo: "inicio", tituloCorto: "m.sitio.cl" }, es), "Inicio · m.sitio.cl");
  assert.equal(nombreDePagina({ tituloTipo: "inicio", tituloCorto: "m.sitio.cl" }, en), "Home · m.sitio.cl");
  assert.equal(nombreDePagina({ tituloTipo: "url", tituloCorto: "Impuesto territorial" }, es), "Impuesto territorial");
  assert.equal(nombreDePagina(null, es), "");
});
