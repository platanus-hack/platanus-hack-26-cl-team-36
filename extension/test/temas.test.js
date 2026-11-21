// Tests de la lógica pura de temas (src/background/temas.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { coincideDominio, normalizarTema, temaParaUrl } from "../src/background/temas.js";

const youtube = normalizarTema({ id: "youtube", dominios: ["YouTube.com"], css: "" });
const otro = normalizarTema({ id: "otro", dominios: ["example.org"], css: "" });

test("coincideDominio acepta el dominio y sus subdominios", () => {
  assert.ok(coincideDominio("youtube.com", "youtube.com"));
  assert.ok(coincideDominio("www.youtube.com", "youtube.com"));
  assert.ok(coincideDominio("m.youtube.com", "youtube.com"));
  assert.ok(!coincideDominio("notyoutube.com", "youtube.com"));
  assert.ok(!coincideDominio("youtube.com.evil.net", "youtube.com"));
});

test("temaParaUrl elige el tema según el hostname", () => {
  const temas = [youtube, otro];
  assert.equal(temaParaUrl(temas, "https://www.youtube.com/watch?v=abc")?.id, "youtube");
  assert.equal(temaParaUrl(temas, "https://example.org/")?.id, "otro");
  assert.equal(temaParaUrl(temas, "https://github.com/"), null);
  assert.equal(temaParaUrl(temas, "no es una url"), null);
});

test("normalizarTema completa valores por defecto", () => {
  const tema = normalizarTema({ id: "x", dominios: ["x.com"], css: "" });
  assert.equal(tema.nombre, "x");
  assert.deepEqual(tema.features, {});
  assert.deepEqual(tema.eventosNavegacion, []);
});

test("normalizarTema rechaza temas incompletos", () => {
  assert.throws(() => normalizarTema({ dominios: ["x.com"], css: "" }), /id/);
  assert.throws(() => normalizarTema({ id: "x", dominios: [], css: "" }), /dominios/);
  assert.throws(() => normalizarTema({ id: "x", dominios: ["x.com"] }), /css/);
  assert.throws(
    () => normalizarTema({ id: "x", dominios: ["x.com"], css: "", features: ["modo-foco"] }),
    /features/,
  );
});
