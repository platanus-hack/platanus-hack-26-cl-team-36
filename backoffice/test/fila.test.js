// Filas de fichas que se desplazan de lado (nucleo/fila.js): la ficha elegida a la vista y los bordes con fichas ocultas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOLGURA, bordesOcultos, desplazamientoParaVer } from "../public/nucleo/fila.js";

const fila = { desplazado: 0, visible: 600, total: 1400 };

test("desplazamientoParaVer: trae la ficha entera a la vista, con holgura, sin pasarse de los extremos", () => {
  // Ya a la vista: no se mueve.
  assert.equal(desplazamientoParaVer({ izquierda: 100, ancho: 150 }, fila), 0);
  // A la derecha, fuera: su borde derecho queda HOLGURA px antes del borde de la fila.
  assert.equal(desplazamientoParaVer({ izquierda: 900, ancho: 200 }, fila), 900 + 200 - 600 + HOLGURA);
  // A la izquierda, fuera: su borde izquierdo queda HOLGURA px después.
  assert.equal(desplazamientoParaVer({ izquierda: 300, ancho: 100 }, { ...fila, desplazado: 500 }), 300 - HOLGURA);
  // Nunca antes de 0 ni después del máximo.
  assert.equal(desplazamientoParaVer({ izquierda: 5, ancho: 50 }, { ...fila, desplazado: 400 }), 0);
  assert.equal(desplazamientoParaVer({ izquierda: 1300, ancho: 100 }, fila), 800);
});

test("bordesOcultos: dice de qué lado quedan fichas sin ver", () => {
  assert.deepEqual(bordesOcultos(fila), { izquierda: false, derecha: true });
  assert.deepEqual(bordesOcultos({ ...fila, desplazado: 400 }), { izquierda: true, derecha: true });
  assert.deepEqual(bordesOcultos({ ...fila, desplazado: 800 }), { izquierda: true, derecha: false });
  assert.deepEqual(bordesOcultos({ desplazado: 0, visible: 600, total: 600 }), { izquierda: false, derecha: false });
});

test("los intentos del Replay usan la fila desplazable", () => {
  const cabecera = readFileSync(new URL("../public/replay/cabecera.js", import.meta.url), "utf8");
  for (const fuente of [cabecera]) {
    assert.match(fuente, /fila-desplazable/);
    assert.match(fuente, /mostrarEnFila\(/);
    assert.match(fuente, /seguirBordes\(/);
  }
  assert.match(readFileSync(new URL("../public/estilos/componentes.css", import.meta.url), "utf8"), /\.fila-desplazable\[data-mas-derecha\]/);
});
