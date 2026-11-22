// Ajuste a la vista de la telaraña (C2-2): con el zoom del ajuste, el nombre de cada estación cabe en su fila y no se
// monta sobre el punto o la marca de atasco de la estación de abajo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALTO_MINIMO_DEL_LIENZO, ZOOM_MAXIMO, ZOOM_MINIMO, altoDeFilaPara, altoDelLienzo, cabeLaEtiqueta, detalleDeZoom, franjaConMasEstaciones, zoomLegible } from "../public/telarana/camara.js";
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

test("altoDelLienzo: llena lo que queda de la ventana bajo el lienzo, con un mínimo", () => {
  // Firefox a 1440×900: la ventana mide ~815 px; con el lienzo a 290 px queda de 509 px y termina 16 px sobre el borde.
  assert.equal(altoDelLienzo(815, 290), 509);
  assert.ok(290 + altoDelLienzo(815, 290) <= 815);
  assert.equal(altoDelLienzo(683, 250.6), 416, "redondea hacia abajo: nunca se pasa del borde");
  // Sin lugar (teléfono con la cabecera alta): el mínimo, y se desplaza la página.
  assert.equal(altoDelLienzo(500, 400), ALTO_MINIMO_DEL_LIENZO);
  assert.equal(ALTO_MINIMO_DEL_LIENZO, 320);
  // La hoja de estilos usa ese alto en el lienzo y en el panel lateral.
  const css = readFileSync(new URL("../public/estilos/telarana.css", import.meta.url), "utf8");
  assert.match(css, /\.lienzo \{[^}]*height: var\(--alto-del-lienzo/);
  assert.match(css, /\.panel-telarana \{ max-height: var\(--alto-del-lienzo/);
});

test("franjaConMasEstaciones: el mapa alto se encuadra donde quedan más estaciones (y las importantes)", () => {
  // Cinco páginas arriba del tronco y una abajo: la franja de 300 px se queda con las de arriba y el tronco.
  const puntos = [-400, -300, -200, -100, 0, 500].map((y) => ({ y, peso: 1 }));
  assert.equal(franjaConMasEstaciones(puntos, 300, 0), 300, "de y = −300 a y = 0");
  // Si la de abajo es una terminal (vale por diez), la franja la incluye.
  const conTerminal = puntos.map((p) => (p.y === 500 ? { ...p, peso: 10 } : p));
  assert.ok(-franjaConMasEstaciones(conTerminal, 600, 0) <= 500 && -franjaConMasEstaciones(conTerminal, 600, 0) + 600 >= 500);
  // Con margen: deja lugar arriba del primer punto.
  assert.equal(franjaConMasEstaciones([{ y: 0, peso: 1 }], 200, 40), 40);
  // Con más margen arriba (los botones de zoom), el primer punto baja y la franja útil se acorta.
  assert.equal(franjaConMasEstaciones([{ y: 0, peso: 1 }], 200, 40, 100), 100);
  assert.equal(franjaConMasEstaciones([0, 70].map((y) => ({ y, peso: 1 })), 200, 40, 100), 100, "y = 70 ya no cabe: queda la de y = 0");
  assert.equal(franjaConMasEstaciones([], 200), null);
});

test("el lienzo deja lugar para la leyenda debajo (se lee en la primera vista)", () => {
  const pantalla = readFileSync(new URL("../public/pantallas/telarana.js", import.meta.url), "utf8");
  assert.match(pantalla, /leyenda\.getBoundingClientRect\(\)\.bottom - caja\.bottom/);
  assert.match(pantalla, /altoDelLienzo\(window\.innerHeight, arriba, MARGEN_BAJO_EL_LIENZO \+ bajoElLienzo\)/);
});
