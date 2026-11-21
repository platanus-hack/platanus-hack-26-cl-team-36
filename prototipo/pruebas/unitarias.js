/**
 * Pruebas unitarias del saneador de CSS y de la regla del patrón de ruta. Se abren en Firefox
 * (las carga `e2e.py`, o a mano sirviendo `prototipo/` por HTTP) porque el saneador usa el
 * analizador de CSS del navegador. Los resultados quedan en `window.resultados`.
 */

import { calcularPatronRuta, describirPagina } from "../extension/rutas.js";
import { LARGO_MAXIMO_CSS, sanearCss } from "../extension/saneador.js";

/** @type {Array<{ nombre: string, ok: boolean, detalle: string }>} */
const resultados = [];

/**
 * @param {string} nombre
 * @param {() => boolean} comprobacion
 * @param {() => unknown} [detalle]
 */
function probar(nombre, comprobacion, detalle = () => "") {
  let ok = false;
  let texto = "";
  try {
    ok = comprobacion() === true;
    if (!ok) texto = JSON.stringify(detalle());
  } catch (error) {
    texto = String(error);
  }
  resultados.push({ nombre, ok, detalle: texto });
}

/** Seis reglas inofensivas, para que lo eliminado en cada caso quede bajo el 30 %. */
const RELLENO = "i{top:1px} b{top:2px} u{top:3px} s{top:4px} q{top:5px} em{top:6px}";
/** @param {string} css */
const conRelleno = (css) => sanearCss(`${css}\n${RELLENO}`);

// --- Saneador ---

probar("añade !important a cada declaración", () => {
  const r = sanearCss("a { color: red; margin: 0 4px }");
  return !r.rechazada && r.css.includes("color: red !important") && r.css.includes("margin: 0px 4px !important");
}, () => sanearCss("a { color: red; margin: 0 4px }"));

probar("elimina @import y lo cuenta", () => {
  const r = conRelleno('@import url("http://ejemplo.test/x.css"); a { color: red }');
  return !r.rechazada && !r.css.includes("@import") && r.eliminadas === 1 && r.total === 8;
}, () => conRelleno('@import url("http://ejemplo.test/x.css"); a { color: red }'));

probar("elimina @font-face y @namespace", () => {
  const css = '@namespace svg url(http://www.w3.org/2000/svg); @font-face { font-family: X; src: local("Arial") } a { color: red }';
  const r = sanearCss(`${css} ${RELLENO} ${RELLENO}`);
  return !r.rechazada && !r.css.includes("@font-face") && !r.css.includes("@namespace") && r.eliminadas === 2;
}, () => sanearCss(`@namespace svg url(http://www.w3.org/2000/svg); @font-face { font-family: X; src: local("Arial") } a { color: red } ${RELLENO} ${RELLENO}`));

probar("elimina la declaración con url() y conserva el resto de la regla", () => {
  const r = conRelleno('a { color: red; background-image: url("http://ejemplo.test/x.png") }');
  return !r.rechazada && !r.css.includes("url(") && r.css.includes("color: red !important") && r.declaraciones_eliminadas === 1 && r.eliminadas === 0;
}, () => conRelleno('a { color: red; background-image: url("http://ejemplo.test/x.png") }'));

probar("detecta url() escrita con escapes", () => {
  const r = conRelleno("a { color: red; background-image: u\\72l(http://ejemplo.test/x.png) }");
  return !r.css.toLowerCase().includes("ejemplo.test") && r.css.includes("color: red !important");
}, () => conRelleno("a { color: red; background-image: u\\72l(http://ejemplo.test/x.png) }"));

probar("abreviatura background con url(): se va la imagen, queda el color", () => {
  const r = conRelleno("a { background: url(http://ejemplo.test/x.png) rgb(9, 9, 9) }");
  return !r.css.includes("url(") && r.css.includes("rgb(9, 9, 9)");
}, () => conRelleno("a { background: url(http://ejemplo.test/x.png) rgb(9, 9, 9) }"));

probar("elimina image-set()", () => {
  const r = conRelleno('a { color: red; background-image: image-set("x.png" 1x) }');
  return !r.css.includes("image-set(") && r.css.includes("color: red !important");
}, () => conRelleno('a { color: red; background-image: image-set("x.png" 1x) }'));

probar("elimina una propiedad personalizada con url()", () => {
  const r = conRelleno("a { --fondo: url(http://ejemplo.test/x.png); color: red }");
  return !r.css.includes("url(") && r.css.includes("color: red !important");
}, () => conRelleno("a { --fondo: url(http://ejemplo.test/x.png); color: red }"));

probar("content solo admite \"\", none y normal", () => {
  const r = conRelleno('a::before { content: "Oferta falsa"; color: red } b::before { content: "" } u::after { content: none } s::after { content: normal }');
  return !r.css.includes("Oferta falsa") && r.css.includes('content: "" !important') && r.css.includes("content: none !important") && r.css.includes("content: normal !important");
}, () => conRelleno('a::before { content: "Oferta falsa"; color: red } b::before { content: "" } u::after { content: none } s::after { content: normal }'));

probar("elimina content con attr() y contadores", () => {
  const r = conRelleno("a::after { content: attr(href); color: red } b::after { content: counter(x); color: red }");
  return !r.css.includes("attr(") && !r.css.includes("counter(");
}, () => conRelleno("a::after { content: attr(href); color: red } b::after { content: counter(x); color: red }"));

probar("@keyframes: sin !important y sin url()", () => {
  const r = conRelleno("@keyframes girar { from { opacity: 0; background-image: url(http://ejemplo.test/x.png) } to { opacity: 1 } } a { animation: girar 1s }");
  const fotogramas = r.css.slice(r.css.indexOf("@keyframes"), r.css.indexOf("}", r.css.lastIndexOf("opacity: 1")) + 1);
  return r.css.includes("@keyframes girar") && !fotogramas.includes("!important") && !r.css.includes("url(");
}, () => conRelleno("@keyframes girar { from { opacity: 0; background-image: url(http://ejemplo.test/x.png) } to { opacity: 1 } } a { animation: girar 1s }"));

probar("sanea dentro de @media", () => {
  const r = conRelleno("@media (min-width: 10px) { a { color: red; background-image: url(x.png) } }");
  return r.css.includes("@media") && r.css.includes("color: red !important") && !r.css.includes("url(");
}, () => conRelleno("@media (min-width: 10px) { a { color: red; background-image: url(x.png) } }"));

probar("conserva abreviaturas con var() y les pone !important", () => {
  const r = sanearCss("a { background: var(--fondo); margin: var(--margen); color: var(--texto) }");
  return !r.rechazada && r.css.includes("background: var(--fondo) !important") && r.css.includes("margin: var(--margen) !important") && r.css.includes("color: var(--texto) !important");
}, () => sanearCss("a { background: var(--fondo); margin: var(--margen); color: var(--texto) }"));

probar("elimina una abreviatura con var() y url()", () => {
  const r = conRelleno("a { background: var(--color) url(http://ejemplo.test/x.png); color: red }");
  return !r.css.includes("url(") && r.css.includes("color: red !important");
}, () => conRelleno("a { background: var(--color) url(http://ejemplo.test/x.png); color: red }"));

probar("rechaza la piel si se elimina más del 30 % de las reglas", () => {
  const r = sanearCss("a { background-image: url(x.png) } b { background-image: url(y.png) } i { color: red }");
  return r.rechazada && r.css === "" && r.eliminadas === 2 && r.total === 3;
}, () => sanearCss("a { background-image: url(x.png) } b { background-image: url(y.png) } i { color: red }"));

probar("rechaza más de 30 000 caracteres", () => {
  const r = sanearCss(`a { color: red } /*${"x".repeat(LARGO_MAXIMO_CSS)}*/`);
  return r.rechazada && r.css === "";
});

probar("rechaza texto que no es CSS", () => sanearCss("esto no es una hoja de estilos").rechazada);
probar("rechaza una piel vacía", () => sanearCss("   ").rechazada);

// --- Patrón de ruta ---

/** @type {Array<[string, string]>} */
const CASOS_PATRON = [
  ["/wiki/Chile", "/wiki/*"],
  ["/item", "/item"],
  ["/", "/"],
  ["", "/"],
  ["/a/b/c", "/a/*"],
  ["/wiki/", "/wiki"],
];
for (const [ruta, esperado] of CASOS_PATRON) {
  probar(`patron_ruta de "${ruta}" es "${esperado}"`, () => calcularPatronRuta(ruta) === esperado, () => calcularPatronRuta(ruta));
}

const PUENTE = "http://127.0.0.1:8765";
probar("describe una página web sin consulta ni fragmento", () => {
  const pagina = describirPagina("https://es.wikipedia.org/wiki/Chile?x=1#historia", PUENTE);
  return pagina?.sitio === "es.wikipedia.org" && pagina.patron_ruta === "/wiki/*";
});
probar("/item?id=1 da el patrón /item", () => describirPagina("https://ejemplo.test/item?id=1", PUENTE)?.patron_ruta === "/item");
probar("no adapta el puente local", () => describirPagina("http://127.0.0.1:8765/salud", PUENTE) === null);
probar("sí adapta otro puerto de 127.0.0.1", () => describirPagina("http://127.0.0.1:3000/", PUENTE)?.sitio === "127.0.0.1");
probar("no adapta about:", () => describirPagina("about:blank", PUENTE) === null);
probar("no adapta moz-extension:", () => describirPagina("moz-extension://abc/panel.html", PUENTE) === null);
probar("no adapta file:", () => describirPagina("file:///tmp/x.html", PUENTE) === null);

// --- Resultados ---

const lista = document.getElementById("resultados");
for (const resultado of resultados) {
  const linea = document.createElement("li");
  linea.textContent = `${resultado.ok ? "✓" : "✗"} ${resultado.nombre}${resultado.detalle ? ` — ${resultado.detalle}` : ""}`;
  lista?.append(linea);
}
/** @type {any} */ (window).resultados = resultados;
