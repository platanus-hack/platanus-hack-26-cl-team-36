import { test } from "node:test";
import assert from "node:assert/strict";
import { acentoDelTema, hostDeRevision, hostSinWww, nombreDeHost, nombreDelSitio, rutaComparable, rutaDeUrl } from "../lib/sitio.js";

test("host de la revisión: el de META sin www.; si falta, el del URL", () => {
  assert.equal(hostDeRevision({ host: "movilsur.test", url: "https://www.movilsur.test/" }), "movilsur.test");
  assert.equal(hostDeRevision({ host: "www.Movilsur.test" }), "movilsur.test");
  assert.equal(hostDeRevision({ url: "https://www.tiendavolcan.test/ofertas" }), "tiendavolcan.test");
  assert.equal(hostDeRevision({ url: "no es un url" }), null);
  assert.equal(hostDeRevision({}), null);
  assert.equal(hostSinWww(undefined), null);
});

test("ruta: el pathname del URL; para comparar, sin barra final", () => {
  assert.equal(rutaDeUrl("https://www.tiendavolcan.test/ofertas"), "/ofertas");
  assert.equal(rutaDeUrl("https://www.movilsur.test"), "/");
  assert.equal(rutaDeUrl("https://www.movilsur.test/?q=1#x"), "/");
  assert.equal(rutaDeUrl(null), null);
  assert.equal(rutaComparable("https://a.test/ofertas/"), "/ofertas");
  assert.equal(rutaComparable("https://a.test/"), "/");
});

test("nombre del sitio: el último segmento del título que no es genérico", () => {
  for (const [titulo, esperado] of [
    ["Inicio - Aerolínea Cóndor", "Aerolínea Cóndor"],
    ["Ofertas | Tienda Volcán", "Tienda Volcán"],
    ["Inicio | Aguas del Maule", "Aguas del Maule"],
    ["Nosotros · Clínica Austral", "Clínica Austral"],
    ["Clínica Austral", "Clínica Austral"],
    ["Tienda Volcán | Inicio", "Tienda Volcán"],
    ["Banco Andino — Página de inicio", "Banco Andino"],
    ["HOME – Telco Pacífico", "Telco Pacífico"],
    ["¡Bienvenidos! · Municipalidad de Los Pinos", "Municipalidad de Los Pinos"],
    ["Pagina de Inicio | Portada | Welcome", "movilsur"],
    ["Inicio", "movilsur"],
    ["", "movilsur"],
    [null, "movilsur"],
    ["Móvil Sur - Planes-y-precios", "Planes-y-precios"],
  ]) {
    assert.equal(nombreDelSitio(titulo, "www.movilsur.test"), esperado, String(titulo));
  }
});

test("nombre del host: sin www., TLD ni puerto", () => {
  assert.equal(nombreDeHost("www.movilsur.test"), "movilsur");
  assert.equal(nombreDeHost("bancoandino.cl"), "bancoandino");
  assert.equal(nombreDeHost("tramites.gob.cl"), "tramites.gob");
  assert.equal(nombreDeHost("localhost:8080"), "localhost");
  assert.equal(nombreDeHost(""), "");
});

test("acento del tema: solo un hex de --mi-acento, en minúsculas", () => {
  const tema = (valor) => `/* Tema */\nhtml.mi-tema { --mi-fondo: #fff; --mi-acento: ${valor}; --mi-texto: #111; }`;
  assert.equal(acentoDelTema(tema("#D35609")), "#d35609");
  assert.equal(acentoDelTema(tema("#abc")), "#abc");
  assert.equal(acentoDelTema(tema("#11223344")), "#11223344");
  assert.equal(acentoDelTema(tema("#d35609 !important")), "#d35609");
  assert.equal(acentoDelTema("html.mi-tema{--mi-acento:#0A0B0C}"), "#0a0b0c");
  for (const malo of ["red", "#abcd", "#12345", "rgb(1, 2, 3)", "var(--x)", "url(javascript:alert(1))", "#abc #def", "#abc\\9", ""]) {
    assert.equal(acentoDelTema(tema(malo)), null, malo);
  }
  assert.equal(acentoDelTema("/* --mi-acento: #fff; */ html.mi-tema { color: red; }"), null, "un comentario no cuenta");
  assert.equal(acentoDelTema(null), null);
  assert.equal(acentoDelTema("html.mi-tema { --mi-fondo: #fff; }"), null);
});
