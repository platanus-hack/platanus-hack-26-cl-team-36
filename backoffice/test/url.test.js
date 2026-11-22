import { test } from "node:test";
import assert from "node:assert/strict";
import * as lib from "../lib/url.js";
import { claveDePagina as claveDeNodoCrudo } from "../lib/paginas.js";
import * as navegador from "../public/nucleo/url.js";

const URLS = [
  "https://www.ejemplo.test/",
  "https://ejemplo.test/ayuda/?utm_source=x&b=2&a=1",
  "http://WWW.Ejemplo.test:8080/a#/spa",
  "https://ejemplo.test/a#seccion",
  "https://ejemplo.test/planes?utm_source=x",
  "no es una url",
];

test("public/nucleo/url.js normaliza igual que lib/url.js", () => {
  for (const url of URLS) {
    assert.equal(navegador.normalizarUrl(url), lib.normalizarUrl(url), url);
    assert.equal(navegador.rutaSinConsulta(url), lib.rutaSinConsulta(url), url);
    assert.equal(navegador.claveDeNodo(url, " Ayuda "), lib.claveDeNodo(url, " Ayuda "), url);
  }
});

test("claveDePagina une las variantes de consulta como lib/paginas.js y deja solos los nodos sin título", () => {
  assert.equal(navegador.claveDePagina("https://www.ejemplo.test/ayuda?q=baja", "Ayuda"), navegador.claveDePagina("https://ejemplo.test/ayuda", "Ayuda"));
  assert.equal(navegador.claveDePagina("https://ejemplo.test/ayuda?q=1", "Ayuda"), claveDeNodoCrudo({ id: "n1", url: "https://ejemplo.test/ayuda?q=1", title: "Ayuda" }));
  assert.notEqual(navegador.claveDePagina("https://ejemplo.test/x?x=1", ""), navegador.claveDePagina("https://ejemplo.test/x?x=2", ""));
});
