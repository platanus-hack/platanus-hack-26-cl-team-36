// Cámara de la telaraña: el nivel de detalle de las etiquetas según el zoom y las medidas de telarana.css de las que
// depende.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detalleDeZoom } from "../public/telarana/camara.js";

test("detalleDeZoom: bajo de lejos, medio, alto de cerca", () => {
  assert.equal(detalleDeZoom(0.4), "bajo");
  assert.equal(detalleDeZoom(0.59), "bajo");
  assert.equal(detalleDeZoom(0.6), "medio");
  assert.equal(detalleDeZoom(1.3), "medio");
  assert.equal(detalleDeZoom(1.31), "alto");
});

test("telarana.css: anillos de la telaraña y marca de atasco que no se encoge", () => {
  const css = readFileSync(new URL("../public/estilos/telarana.css", import.meta.url), "utf8");
  assert.match(css, /\.guia-anillo \{[^}]*stroke:/);
  assert.match(css, /data-detalle="bajo"\] \.estacion-nombre \{ -webkit-line-clamp: 2;/);
  // La marca de atasco: ancho propio (en Firefox se encogía a una raya sin ícono) y el ícono no se encoge.
  assert.match(css, /\.estacion-atasco \{ width: max-content; \}/);
  assert.match(css, /\.estacion-atasco svg \{ flex: none;/);
});
