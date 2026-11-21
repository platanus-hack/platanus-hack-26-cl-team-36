import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTecla, teclaDelEvento } from "../public/nucleo/atajos.js";

const evento = (key, extra = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });
const conAltGr = (key) => ({ ...evento(key, { ctrlKey: true, altKey: true }), getModifierState: (m) => m === "AltGraph" });

test("[ y ] valen con Option (Mac) y AltGr (Windows/Linux), como en teclados español y latinoamericano", () => {
  assert.equal(teclaDelEvento(evento("[", { altKey: true }), { mac: true }), "[");
  assert.equal(teclaDelEvento(evento("]", { altKey: true, shiftKey: true }), { mac: true }), "]");
  assert.equal(teclaDelEvento(conAltGr("["), { mac: false }), "[");
  // Sin getModifierState, Ctrl+Alt en un símbolo también es AltGr.
  assert.equal(teclaDelEvento(evento("]", { ctrlKey: true, altKey: true }), { mac: false }), "]");
  assert.equal(teclaDelEvento(evento("[")), normalizarTecla("["));
});

test("en letras y teclas con nombre los modificadores siguen contando", () => {
  assert.equal(teclaDelEvento(evento("k", { metaKey: true }), { mac: true }), "Mod+k");
  assert.equal(teclaDelEvento(evento("k", { ctrlKey: true }), { mac: false }), "Mod+k");
  assert.equal(teclaDelEvento(evento("N", { shiftKey: true }), { mac: true }), "Shift+n");
  assert.equal(teclaDelEvento(evento("p", { altKey: true }), { mac: false }), "Alt+p");
  assert.equal(teclaDelEvento(evento("ArrowRight", { altKey: true }), { mac: true }), "Alt+ArrowRight");
  assert.equal(teclaDelEvento(evento("?", { shiftKey: true }), { mac: true }), "?");
  assert.equal(teclaDelEvento(evento("Alt", { altKey: true })), null);
  assert.equal(teclaDelEvento(evento("AltGraph")), null);
});
