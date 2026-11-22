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

test("la hoja de atajos muestra solo lo registrado ahora, por grupo y una fila por descripción", async () => {
  const { gruposDeLaHoja } = await import("../public/nucleo/atajos.js");
  const vivos = [
    { grupo: "telarana", tecla: "+", descripcion: "Acercar / alejar", mantener: false },
    { grupo: "telarana", tecla: "-", descripcion: "Acercar / alejar", mantener: false },
    { grupo: "telarana", tecla: "0", descripcion: "Ajustar", mantener: false },
    { grupo: "tanda", tecla: "1", descripcion: "Pestañas", mantener: false },
    { grupo: "tanda", tecla: "2", descripcion: "Pestañas", mantener: false },
    { grupo: "global", tecla: "?", descripcion: "Ver los atajos", mantener: false },
  ];
  assert.deepEqual(gruposDeLaHoja(vivos), [
    { grupo: "global", filas: [{ descripcion: "Ver los atajos", teclas: ["?"], mantener: false }] },
    { grupo: "tanda", filas: [{ descripcion: "Pestañas", teclas: ["1", "2"], mantener: false }] },
    {
      grupo: "telarana",
      filas: [
        { descripcion: "Acercar / alejar", teclas: ["+", "-"], mantener: false },
        { descripcion: "Ajustar", teclas: ["0"], mantener: false },
      ],
    },
  ]);
  assert.deepEqual(gruposDeLaHoja([]), []);
});

test("atajos de la tanda y de la telaraña: un juego chico, sin restos de lo que se sacó", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = (ruta) => readFileSync(new URL(`../public/${ruta}`, import.meta.url), "utf8");
  const atajos = fuente("nucleo/atajos.js");
  assert.doesNotMatch(atajos, /CATALOGO/, "la hoja no tiene una lista escrita a mano que pueda desviarse");
  assert.doesNotMatch(atajos, /"perfiles"/);
  // Las teclas que registra la telaraña: + − 0 y Esc, nada más.
  const telarana = fuente("pantallas/telarana.js");
  const bloque = telarana.slice(telarana.indexOf("ctx.atajos.registrar({"));
  const teclas = [...bloque.matchAll(/^ {4}("[^"]+"|\w+): \{/gm)].map((m) => m[1].replaceAll('"', ""));
  assert.deepEqual(teclas, ["+", "-", "0", "Escape"]);
  // La tanda: 1–3 (sin Perfiles), [ ] y c.
  assert.deepEqual((await import("../public/nucleo/rutas.js")).PESTANAS, ["resumen", "telarana", "replay"]);
});
