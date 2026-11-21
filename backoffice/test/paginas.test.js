import { test } from "node:test";
import assert from "node:assert/strict";
import { claveDePagina, quitarSufijo, sufijoComun, titularPaginas, tituloDesdeRuta, unirNodos } from "../lib/paginas.js";

const nodo = (id, url, title) => ({ id, url, title, visits: 1, profiles: [], is_start: false, endings: {} });
const pagina = (url, titulo, consulta = "") => ({ url, titulo, variantes: [{ consulta }] });

test("se unen los nodos con la misma URL sin consulta y el mismo título (wom 07-28)", () => {
  const titulo = "Toda las Dudas que Tengas | Centro de Ayuda | WOM";
  const { grupos, alias, paginaDeNodo } = unirNodos([
    nodo("n1", "https://wom.cl/", "WOM | Planes"),
    nodo("n2", "https://wom.cl/centro-de-ayuda?s=dar+de+baja+fibra", titulo),
    nodo("n3", "https://wom.cl/centro-de-ayuda/category/internet-fibra/index.html", "Información | Centro de Ayuda | WOM"),
    nodo("n5", "https://wom.cl/centro-de-ayuda", titulo),
    nodo("n6", "https://wom.cl/centro-de-ayuda?s=baja+fibra", titulo),
  ]);
  assert.deepEqual(grupos.map((g) => [g.id, g.nodos.map((n) => n.id)]), [["n1", ["n1"]], ["n2", ["n2", "n5", "n6"]], ["n3", ["n3"]]]);
  assert.deepEqual(alias, { n5: "n2", n6: "n2" });
  assert.equal(paginaDeNodo.get("n6"), "n2");
});

test("no se unen los nodos sin título ni los de distinto título", () => {
  const { grupos } = unirNodos([
    nodo("n1", "https://sii.cl/x?a=1", ""),
    nodo("n2", "https://sii.cl/x?a=2", ""),
    nodo("n3", "https://sii.cl/x?a=3", "Otra"),
    nodo("n4", "https://sii.cl/x", "Otra distinta"),
  ]);
  assert.equal(grupos.length, 4);
  assert.notEqual(claveDePagina(nodo("a", "https://e.test/", "")), claveDePagina(nodo("b", "https://e.test/", "")));
});

test("sufijo común de los títulos de un sitio", () => {
  assert.deepEqual(
    sufijoComun([
      "WOM | Planes Móviles, Prepago e Internet Hogar al mejor precio",
      "Toda las Dudas que Tengas | Centro de Ayuda | WOM",
      "Información Sobre tu Internet Fibra | Centro de Ayuda | WOM",
      "Verifica de tu Internet Fibra | Centro de Ayuda | WOM",
    ]),
    ["Centro de Ayuda", "WOM"],
  );
  assert.deepEqual(
    sufijoComun(["Inicio - DT - Dirección del Trabajo", "Trabajadores - DT - Dirección del Trabajo", "Ingreso de Reclamo por Despido - DT - Dirección del Trabajo"]),
    ["DT", "Dirección del Trabajo"],
  );
  assert.deepEqual(sufijoComun(["SII | Servicio de Impuestos Internos", "", ""]), []);
  assert.equal(quitarSufijo("Trabajadores - DT - Dirección del Trabajo", ["DT", "Dirección del Trabajo"]), "Trabajadores");
  assert.equal(quitarSufijo("WOM", ["WOM"]), "WOM", "si no queda nada, el título queda igual");
});

test("título desde la URL cuando la página no tiene título", () => {
  assert.equal(tituloDesdeRuta("https://sii.cl/destacados/ley_reconstruccion"), "Ley reconstruccion");
  assert.equal(tituloDesdeRuta("https://sii.cl/destacados/ley_reconstruccion/medidas_tributarias/impuesto_territorial"), "Impuesto territorial");
  assert.equal(tituloDesdeRuta("https://e.test/ayuda/como-dar-de-baja.html"), "Como dar de baja");
  assert.equal(tituloDesdeRuta("https://e.test/"), null);
});

test("títulos cortos: inicio, sitio, URL y repetidos", () => {
  const paginas = titularPaginas([
    pagina("https://dt.gob.cl/portal/1626/w3-channel.html", "Inicio - DT - Dirección del Trabajo"),
    pagina("https://dt.gob.cl/portal/1626/w3-propertyvalue-26864.html", "Trabajadores - DT - Dirección del Trabajo"),
    pagina("https://homer.sii.cl/", "SII | Servicio de Impuestos Internos"),
    pagina("https://sii.cl/destacados/ley_reconstruccion", ""),
    pagina("https://e.test/sin-titulo?x=1", "", "x=1"),
    pagina("https://e.test/sin-titulo?x=2", "", "x=2"),
    pagina("https://e.test/a/planes", "Planes"),
    pagina("https://e.test/b/precios", "Planes"),
  ]);
  assert.deepEqual(paginas.map((p) => [p.tituloTipo, p.tituloCorto]), [
    ["sitio", "Inicio"],
    ["sitio", "Trabajadores"],
    ["inicio", null],
    ["url", "Ley reconstruccion"],
    ["url", "Sin titulo · ?x=1"],
    ["url", "Sin titulo · ?x=2"],
    ["sitio", "Planes · /planes"],
    ["sitio", "Planes · /precios"],
  ]);
});
