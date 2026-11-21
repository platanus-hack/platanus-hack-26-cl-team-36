import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { SITIOS, temaParaUrl } from "../temas.js";

test("YouTube y Gmail tienen tema; otros sitios no", () => {
  assert.equal(temaParaUrl("https://www.youtube.com"), "youtube");
  assert.equal(temaParaUrl("https://m.youtube.com"), "youtube");
  assert.equal(temaParaUrl("https://mail.google.com"), "gmail");
  assert.equal(temaParaUrl("https://www.google.com"), null);
  assert.equal(temaParaUrl("https://notyoutube.com"), null);
  assert.equal(temaParaUrl("https://youtube.com.evil.net"), null);
});

test("una URL inválida lanza error", () => {
  assert.throws(() => temaParaUrl("no es una url"), TypeError);
});

// Mientras los temas vivan en la extensión, cada id debe existir allá.
test("cada tema existe en extension/src/temas/", () => {
  for (const { tema } of SITIOS) {
    const archivo = new URL(`../../extension/src/temas/${tema}/tema.json`, import.meta.url);
    assert.ok(existsSync(archivo), `Falta extension/src/temas/${tema}/ (tema.json + tema.css)`);
  }
});
