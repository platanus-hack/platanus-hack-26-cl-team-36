// Ajuste a la vista de la telaraña (C2-2): con el zoom del ajuste, el nombre de cada estación cabe en su fila y no se
// monta sobre el punto o la marca de atasco de la estación de abajo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ZOOM_MAXIMO, ZOOM_MINIMO, altoDeFilaPara, cabeLaEtiqueta, detalleDeZoom, zoomLegible } from "../public/telarana/camara.js";
import { ALTO_FILA } from "../public/telarana/distribuir.js";

const zooms = (desde, hasta) => {
  const lista = [];
  for (let k = desde; k <= hasta + 1e-9; k = Math.round((k + 0.01) * 100) / 100) lista.push(k);
  return lista;
};

test("detalleDeZoom: 2 líneas de lejos, 3 en el medio, detalles de cerca", () => {
  assert.equal(detalleDeZoom(0.5), "bajo");
  assert.equal(detalleDeZoom(0.79), "bajo");
  assert.equal(detalleDeZoom(0.8), "medio");
  assert.equal(detalleDeZoom(1.3), "medio");
  assert.equal(detalleDeZoom(1.31), "alto");
});

test("zoomLegible: con la fila de siempre, los nombres caben desde ~0.6 y de ahí en adelante", () => {
  const k = zoomLegible(ALTO_FILA);
  assert.ok(k > 0.5 && k < 0.65, `zoom legible ${k}`);
  assert.equal(cabeLaEtiqueta(Math.round((k - 0.01) * 100) / 100, ALTO_FILA), false, "justo antes no cabe");
  for (const z of zooms(k, ZOOM_MAXIMO)) assert.ok(cabeLaEtiqueta(z, ALTO_FILA), `con k = ${z} el nombre no cabe`);
});

test("altoDeFilaPara: la fila más baja (de a 4 px, desde la de siempre) en que el nombre cabe con ese zoom", () => {
  assert.equal(altoDeFilaPara(1, ALTO_FILA), ALTO_FILA);
  assert.equal(altoDeFilaPara(5, ALTO_FILA), ALTO_FILA, "un zoom fuera de rango se acota");
  let anterior = Infinity;
  for (const k of zooms(ZOOM_MINIMO, 1.3)) {
    const alto = altoDeFilaPara(k, ALTO_FILA);
    assert.ok(alto >= ALTO_FILA && alto % 4 === 0, `k = ${k}: ${alto}`);
    assert.ok(cabeLaEtiqueta(k, alto), `k = ${k}: con ${alto} px no cabe`);
    if (alto - 4 >= ALTO_FILA) assert.equal(cabeLaEtiqueta(k, alto - 4), false, `k = ${k}: ${alto - 4} px ya alcanzaba`);
    // Mirando de más lejos hacen falta filas más altas (en px de escena), salvo al pasar de 2 a 3 líneas.
    if (detalleDeZoom(k) === "bajo") assert.ok(alto <= anterior, `k = ${k}`);
    anterior = alto;
  }
  // El mapa de la sii a 1440 px (k ≈ 0.44) estira sus filas; de cerca no hace falta.
  assert.ok(altoDeFilaPara(0.44, ALTO_FILA) > ALTO_FILA);
  assert.equal(zoomLegible(altoDeFilaPara(0.44, ALTO_FILA)) <= 0.44, true);
});

test("las medidas de cabeLaEtiqueta son las de telarana.css", () => {
  const css = readFileSync(new URL("../public/estilos/telarana.css", import.meta.url), "utf8");
  assert.match(css, /\.estacion \{[^}]*transform: translate\(-50%, -9px\);[^}]*gap: 6px;/);
  assert.match(css, /\.estacion-punto \{[^}]*width: 18px; height: 18px;[^}]*transform: scale\(max\(1, calc\(0\.8 \/ var\(--k\)\)\)\);/);
  assert.match(css, /\.estacion-etiqueta \{[^}]*transform: scale\(max\(1, calc\(0\.9 \/ var\(--k\)\)\)\);[^}]*padding: 2px 4px;/);
  assert.match(css, /\.estacion-nombre \{[^}]*line-height: 16px;[^}]*-webkit-line-clamp: 3;/);
  assert.match(css, /data-detalle="bajo"\] \.estacion-nombre \{ -webkit-line-clamp: 2;/);
  assert.match(css, /:is\(\[data-detalle="bajo"\], \[data-detalle="medio"\]\) \.estacion-detalle \{ display: none; \}/);
  // La marca de atasco: ancho propio (en Firefox se encogía a una raya sin ícono) y el ícono no se encoge.
  assert.match(css, /\.estacion-atasco \{ width: max-content; \}/);
  assert.match(css, /\.estacion-atasco svg \{ flex: none;/);
});
