// Nombres visibles de las estaciones (C2-7): si varias páginas empiezan igual, lo que las distingue va adelante.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARACTERES_VISIBLES, etiquetasDeEstaciones } from "../public/telarana/nombres.js";

const paginas = (nombres) => Object.keys(nombres).map((id) => ({ id }));
const etiquetar = (nombres, opciones) => Object.fromEntries(etiquetasDeEstaciones(paginas(nombres), (p) => nombres[p.id], opciones));
const visibles = (etiquetas) => Object.values(etiquetas).map((texto) => texto.slice(0, CARACTERES_VISIBLES).toLowerCase());

test("nombres únicos: quedan tal cual", () => {
  const nombres = { n1: "Inicio · WOM", n2: "Centro de Ayuda", n3: "Internet Fibra" };
  assert.deepEqual(etiquetar(nombres), nombres);
});

test("mismo título con distinta ruta: la ruta adelante, sin barra ni extensión ni el comienzo que comparten", () => {
  const etiquetas = etiquetar({
    n4: "Preguntas Frecuentes · /001_165_6464.htm",
    n10: "Preguntas Frecuentes · /001_165_6463.htm",
    n7: "Preguntas Frecuentes de Avalúos y Contribuciones de Bienes Raíces · /arbol_faqs_aval_contrib_bbrr_2118.htm",
    n8: "Preguntas Frecuentes de Avalúos y Contribuciones de Bienes Raíces · /arbol_faqs_aval_contrib_bbrr_2581.htm",
    n6: "Preguntas Frecuentes de Avalúos y Contribuciones de Bienes Raíces · /faqs_aval_contrib_bbrr.htm",
    n12: "Impuesto territorial",
  });
  assert.equal(etiquetas.n4, "…6464 · Preguntas Frecuentes");
  assert.equal(etiquetas.n10, "…6463 · Preguntas Frecuentes");
  assert.equal(etiquetas.n7, "…2118 · Preguntas Frecuentes de Avalúos y Contribuciones de Bienes Raíces");
  assert.equal(etiquetas.n6, "faqs_aval_contrib_bbrr · Preguntas Frecuentes de Avalúos y Contribuciones de Bienes Raíces");
  assert.equal(etiquetas.n12, "Impuesto territorial");
  assert.equal(new Set(visibles(etiquetas)).size, 6);
});

test("títulos que solo difieren al final: la parte que los distingue adelante", () => {
  const etiquetas = etiquetar({ a: "Medicina - Facultad de Medicina - Pregrado", b: "Medicina - Facultad de Medicina - Postgrado" });
  assert.deepEqual(etiquetas, { a: "Pregrado · Medicina - Facultad de Medicina", b: "Postgrado · Medicina - Facultad de Medicina" });
});

test("si aun así se ven iguales: un número adelante desde la segunda; las de la ruta conservan su nombre", () => {
  const nombres = {
    n9: "Inicio · Loading https://sso.ejemplo.cl/auth?state=1",
    n19: "Inicio · Loading https://sso.ejemplo.cl/auth?state=2",
    n12: "Ingreso de reclamo por despido - DT",
    n18: "Ingreso de Reclamo por Despido - DT",
  };
  const etiquetas = etiquetar(nombres, { primeras: ["n18"] });
  assert.equal(etiquetas.n9, nombres.n9);
  assert.equal(etiquetas.n19, `#2 · ${nombres.n19}`);
  assert.equal(etiquetas.n18, nombres.n18, "la de la ruta conserva el nombre");
  assert.equal(etiquetas.n12, `#2 · ${nombres.n12}`);
  assert.equal(new Set(visibles(etiquetas)).size, 4);
});

test("sin idioma propio: los datos de la corrida no se traducen (el «Inicio» viene de nombreDePagina)", () => {
  const etiquetas = etiquetar({ a: "Home · Centro de ayuda de la empresa · /uno.html", b: "Home · Centro de ayuda de la empresa · /dos.html" });
  assert.deepEqual(etiquetas, { a: "uno · Home · Centro de ayuda de la empresa", b: "dos · Home · Centro de ayuda de la empresa" });
  // Si ya se distinguen en lo que se ve, no se tocan.
  assert.deepEqual(etiquetar({ a: "Ayuda · /uno.html", b: "Ayuda · /dos.html" }), { a: "Ayuda · /uno.html", b: "Ayuda · /dos.html" });
});
