import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarOpciones, normalizar, puntuar } from "../public/nucleo/buscar.js";

test("normalizar quita tildes y pasa a minúsculas", () => {
  assert.equal(normalizar("Telaraña ÉXITO"), "telarana exito");
});

test("tildes: «telarana» encuentra «Telaraña»", () => {
  assert.equal(puntuar("Telaraña", "telarana"), 3);
  assert.equal(puntuar("telarana", "Telaraña"), 3);
});

test("prefijo 3 > comienzo de palabra 2 > subsecuencia 1 > nada", () => {
  assert.equal(puntuar("sii-exencion-contribuciones", "sii"), 3);
  assert.equal(puntuar("wom-baja-fibra", "baja"), 2);
  assert.equal(puntuar("Información Sobre tu Internet Fibra", "fibra"), 2);
  assert.equal(puntuar("wom-baja-fibra", "wbf"), 1);
  assert.equal(puntuar("replay", "rply"), 1);
  assert.equal(puntuar("dt-reclamo-despido", "sii"), null);
  assert.equal(puntuar("wom", "xyz"), null);
});

test("varias palabras: todas deben calzar", () => {
  assert.equal(puntuar("wom-baja-fibra 21 nov 07:28 wom.cl", "wom 07"), 2);
  assert.equal(puntuar("wom-baja-fibra", "wom sii"), null);
});

test("filtrarOpciones ordena por puntaje, prefiere el título y es estable", () => {
  const opciones = [
    { id: "a", titulo: "dt-reclamo-despido", subtitulo: "dt.gob.cl" },
    { id: "b", titulo: "Replay", subtitulo: "sii-exencion" },
    { id: "c", titulo: "sii-exencion-contribuciones" },
    { id: "d", titulo: "otra sii" },
    { id: "e", titulo: "sii-otra" },
  ];
  assert.deepEqual(filtrarOpciones(opciones, "sii").map((o) => o.id), ["c", "e", "d", "b"]);
  assert.deepEqual(filtrarOpciones(opciones, "").map((o) => o.id), ["a", "b", "c", "d", "e"]);
});

test("las subsecuencias sueltas se descartan si hay calces buenos", () => {
  const opciones = [{ titulo: "rapido" }, { titulo: "replay" }];
  assert.deepEqual(filtrarOpciones(opciones, "rep").map((o) => o.titulo), ["replay"]);
  assert.deepEqual(filtrarOpciones(opciones, "rpl").map((o) => o.titulo), ["replay"]);
});

test("límite", () => {
  const opciones = Array.from({ length: 80 }, (_, i) => ({ titulo: `tanda ${i}` }));
  assert.equal(filtrarOpciones(opciones, "tanda").length, 50);
  assert.equal(filtrarOpciones(opciones, "tanda", 5).length, 5);
  assert.equal(filtrarOpciones(opciones, "", 3).length, 3);
});
