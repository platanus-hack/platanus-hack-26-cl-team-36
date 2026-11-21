import { test } from "node:test";
import assert from "node:assert/strict";
import { crearFormatos } from "../public/nucleo/formato.js";

const es = crearFormatos("es");
const en = crearFormatos("en");
const FECHA = "2026-11-21T07:28:42";
const ahora = new Date("2026-11-21T08:00:42").getTime();

test("fechas legibles y cortas", () => {
  assert.equal(es.fechaLegible(FECHA), "21 nov 2026, 07:28");
  assert.equal(en.fechaLegible(FECHA), "Nov 21, 2026, 07:28");
  assert.equal(es.fechaCorta(FECHA), "21 nov 07:28");
  assert.equal(en.fechaCorta(FECHA), "Nov 21, 07:28");
  assert.equal(es.fechaCorta("2026-11-21_07-28-42"), "21 nov 07:28");
  assert.equal(es.fechaLegible(null), "");
  assert.equal(en.fechaLegible("no es fecha"), "");
});

test("tiempo relativo con un ahora fijo", () => {
  assert.equal(es.tiempoRelativo(FECHA, ahora), "hace 32 min");
  assert.equal(en.tiempoRelativo(FECHA, ahora), "32 min ago");
  assert.equal(es.tiempoRelativo(FECHA, new Date("2026-11-21T10:28:42").getTime()), "hace 3 h");
  assert.equal(en.tiempoRelativo(FECHA, new Date("2026-11-21T10:28:42").getTime()), "3 hr ago");
  assert.equal(es.tiempoRelativo(FECHA, new Date("2026-11-22T07:28:42").getTime()), "ayer");
  assert.equal(en.tiempoRelativo(FECHA, new Date("2026-11-22T07:28:42").getTime()), "yesterday");
  assert.equal(es.tiempoRelativo(FECHA, new Date(FECHA).getTime() + 5000), "ahora");
  assert.equal(es.tiempoRelativo(undefined, ahora), "");
});

test("duración", () => {
  for (const fmt of [es, en]) {
    assert.equal(fmt.duracion(41), "41 s");
    assert.equal(fmt.duracion(65), "1 min 5 s");
    assert.equal(fmt.duracion(120), "2 min");
    assert.equal(fmt.duracion(null), "");
    assert.equal(fmt.duracion("41"), "");
  }
});

test("conteo: par, nulo y porcentaje solo con más de 5", () => {
  for (const fmt of [es, en]) {
    assert.equal(fmt.conteo({ n: 2, de: 3 }), "2/3");
    assert.equal(fmt.conteo(null), "—");
    assert.equal(fmt.conteo({ n: 2, de: 3 }, { porcentaje: true }), "2/3");
  }
  assert.match(es.conteo({ n: 8, de: 12 }, { porcentaje: true }), /^8\/12 · 67\s?%$/u);
  assert.equal(en.conteo({ n: 8, de: 12 }, { porcentaje: true }), "8/12 · 67%");
});

test("listas y números según el idioma", () => {
  assert.equal(es.lista(["A", "B", "C"]), "A, B y C");
  assert.equal(en.lista(["A", "B", "C"]), "A, B, and C");
  assert.equal(es.lista(["A"]), "A");
  assert.equal(es.numero(0.06), "0,06");
  assert.equal(en.numero(0.06), "0.06");
  assert.equal(es.numero(1234.5), "1.234,5");
  assert.equal(en.numero(1234.5), "1,234.5");
  assert.equal(es.numero(null), "");
});

test("primera frase y modelo", () => {
  assert.equal(es.primeraFrase("La captura muestra la ayuda. Después hay más."), "La captura muestra la ayuda.");
  assert.equal(es.primeraFrase("Primera línea\nsegunda"), "Primera línea");
  assert.equal(es.primeraFrase("x".repeat(200), 20), `${"x".repeat(19)}…`);
  assert.equal(es.primeraFrase(null), "");
  assert.equal(es.modelo("claude-sonnet-5-5"), "Sonnet 5.5");
  assert.equal(es.modelo("claude-opus-5-5"), "Opus 5.5");
  assert.equal(es.modelo("claude-haiku-4"), "Haiku 4");
  assert.equal(es.modelo("otro-modelo"), "otro-modelo");
});

test("idioma desconocido cae en español y los formatos se reutilizan", () => {
  assert.equal(crearFormatos("fr").idioma, "es");
  assert.equal(crearFormatos("es"), es);
});

test("hora y tiempo con hora: dos tandas de la misma hora relativa se distinguen", () => {
  assert.equal(es.hora(FECHA), "07:28");
  assert.equal(en.hora("2026-11-21_19-05-00"), "19:05");
  assert.equal(es.tiempoConHora(FECHA, ahora), "hace 32 min · 07:28");
  assert.equal(en.tiempoConHora(FECHA, ahora), "32 min ago · 07:28");
  assert.equal(es.tiempoConHora("no es fecha", ahora), "");
});
