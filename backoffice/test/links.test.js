// Buscar revisiones por link (public/nucleo/links.js): lo comparten la página y el servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGO_MAXIMO_DE_BUSQUEDA, calzaLink, normalizarBusqueda, textoDeLink } from "../public/nucleo/links.js";

test("el link se compara sin protocolo, sin www., sin la barra final y en minúsculas", () => {
  assert.equal(textoDeLink("https://www.Metro.cl/"), "metro.cl");
  assert.equal(textoDeLink("http://uchile.cl/admision/"), "uchile.cl/admision");
  assert.equal(textoDeLink("https://www.dt.gob.cl/portal/1626/w3-channel.html"), "dt.gob.cl/portal/1626/w3-channel.html");
  assert.equal(textoDeLink("metro.cl"), "metro.cl");
  assert.equal(textoDeLink(null), "");
});

test("la búsqueda se guarda sin espacios de más, en minúsculas y con tope", () => {
  assert.equal(normalizarBusqueda("  Metro   Horarios "), "metro horarios");
  assert.equal(normalizarBusqueda("   "), "");
  assert.equal(normalizarBusqueda(undefined), "");
  assert.equal(normalizarBusqueda("x".repeat(500)).length, LARGO_MAXIMO_DE_BUSQUEDA);
});

test("calza: un pedazo del link, el link entero pegado o varias palabras que están todas", () => {
  const url = "https://www.metro.cl/horarios";
  for (const busqueda of ["metro", "METRO.CL", "metro.cl/", "https://www.metro.cl/horarios/", "horarios", "metro horarios", "", "   "]) {
    assert.equal(calzaLink(url, busqueda), true, busqueda);
  }
  for (const busqueda of ["uchile", "metro tarifas", "https://www.metro.cl/tarifas"]) assert.equal(calzaLink(url, busqueda), false, busqueda);
  assert.equal(calzaLink(null, "metro"), false, "sin link no calza nada");
  assert.equal(calzaLink(null, ""), true, "sin búsqueda calza todo");
});
