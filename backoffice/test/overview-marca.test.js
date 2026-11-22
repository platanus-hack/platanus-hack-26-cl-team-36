// Color de marca e inicial de un sitio (spec §3.6): el píxel (4,4) de la captura de escritorio, o un color
// estable por host; la inicial clara u oscura según el contraste.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  colorDeRespaldo,
  contraste,
  esHex,
  hexDePixel,
  hostLimpio,
  inicial,
  luminancia,
  textoSobre,
} from "../public/overview/marca.js";

test("píxel → hex en minúsculas; uno casi transparente no da color", () => {
  assert.equal(hexDePixel(Uint8ClampedArray.from([235, 96, 10, 255])), "#eb600a");
  assert.equal(hexDePixel([0, 0, 0, 255]), "#000000");
  assert.equal(hexDePixel([255, 255, 255, 127]), null);
  assert.equal(hexDePixel([1, 2]), null);
  assert.equal(hexDePixel(null), null);
});

test("color de respaldo: estable por host (sin www. ni mayúsculas), hex y distinto entre sitios", () => {
  const color = colorDeRespaldo("movilsur.test");
  assert.match(color, /^#[0-9a-f]{6}$/);
  assert.equal(colorDeRespaldo("www.MovilSur.test"), color);
  assert.equal(colorDeRespaldo("movilsur.test"), color);
  const otros = ["tiendavolcan.test", "bancoandino.test", "unilitoral.test", "clinicaaustral.test"].map(colorDeRespaldo);
  assert.equal(new Set([color, ...otros]).size, 5);
  assert.match(colorDeRespaldo(""), /^#[0-9a-f]{6}$/);
  assert.equal(hostLimpio(" WWW.Banco.test "), "banco.test");
});

test("contraste WCAG: blanco sobre negro 21, igual consigo mismo 1", () => {
  assert.equal(luminancia("#ffffff"), 1);
  assert.equal(luminancia("#000"), 0);
  assert.equal(Math.round(contraste("#ffffff", "#000000")), 21);
  assert.equal(contraste("#eb600a", "#eb600a"), 1);
  assert.equal(contraste("rojo", "#000"), null);
});

test("inicial clara mientras llegue a 3:1 (los colores de marca de la maqueta), oscura sobre colores claros", () => {
  for (const marca of ["#EB600A", "#C41E24", "#005493", "#0B4F8A", "#008C95", "#D6286E", "#1E78C8", "#1F7A4D", "#5B2A86", "#2C3E50"]) {
    assert.equal(textoSobre(marca), "claro", marca);
  }
  assert.equal(textoSobre("#ffffff"), "oscuro");
  assert.equal(textoSobre("#f3d34a"), "oscuro");
  assert.equal(textoSobre("#2ee6c5"), "oscuro");
  assert.equal(textoSobre("no-es-color"), "claro");
  // El respaldo de cualquier host es legible con una de las dos.
  for (const host of ["a.test", "b.test", "movilsur.test", "zz.cl"]) {
    const fondo = colorDeRespaldo(host);
    const letra = textoSobre(fondo) === "claro" ? "#f5f5f7" : "#0b0b10";
    assert.ok(contraste(fondo, letra) >= 3, `${host}: ${fondo}`);
  }
});

test("solo hex válidos pasan como color (acento del tema, marca)", () => {
  assert.equal(esHex("#007e86"), true);
  assert.equal(esHex("#abc"), true);
  assert.equal(esHex("#11223344"), true);
  assert.equal(esHex("#12345"), false);
  assert.equal(esHex("red"), false);
  assert.equal(esHex("#fff;background:url(x)"), false);
  assert.equal(esHex(null), false);
});

test("inicial: la primera letra del nombre del sitio, en mayúscula (o la del host)", () => {
  assert.equal(inicial("Móvil Sur", "movilsur.test"), "M");
  assert.equal(inicial("aerolínea Cóndor"), "A");
  assert.equal(inicial("Ñandú"), "Ñ");
  assert.equal(inicial("  ", "www.unilitoral.test"), "U");
  assert.equal(inicial("", ""), "·");
  assert.equal(inicial("Éxito"), "É");
});
