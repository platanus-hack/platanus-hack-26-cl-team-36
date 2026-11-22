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

test("la hoja pone el grupo del Overview justo después de los atajos de todas partes", async () => {
  const { gruposDeLaHoja } = await import("../public/nucleo/atajos.js");
  const fila = (grupo, tecla) => ({ grupo, tecla, descripcion: tecla, mantener: false });
  const grupos = gruposDeLaHoja([fila("corridas", "j"), fila("overview", "ArrowRight"), fila("global", "?"), fila("tanda", "1")]);
  assert.deepEqual(grupos.map(({ grupo }) => grupo), ["global", "overview", "tanda", "corridas"]);
});

test("atajos globales: g o lleva al Overview (#/) y g c a Corridas (#/corridas)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const bloque = app.slice(app.indexOf("function registrarAtajosGlobales"));
  assert.match(bloque, /"g o": \{[^}]*desc\.irAOverview[^}]*navegar\(IR_AL_OVERVIEW\)/);
  assert.match(bloque, /"g c": \{[^}]*desc\.irACorridas[^}]*navegar\(IR_A_CORRIDAS\)/);
  assert.match(app, /const IR_AL_OVERVIEW = hashDe\(\{ tipo: "overview" \}\);/);
  assert.match(app, /const IR_A_CORRIDAS = hashDe\(\{ tipo: "corridas" \}\);/);
  const { hashDe } = await import("../public/nucleo/rutas.js");
  assert.equal(hashDe({ tipo: "overview" }), "#/");
  assert.equal(hashDe({ tipo: "corridas" }), "#/corridas");
  // Sin paleta ⌘K: ni su atajo ni un "/" global (cada vista registra el suyo para su buscador).
  assert.doesNotMatch(app, /paleta|Paleta|"Mod\+k"|"\/":/);
});

test("atajos de la tanda y de la telaraña: un juego chico, sin restos de lo que se sacó", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = (ruta) => readFileSync(new URL(`../public/${ruta}`, import.meta.url), "utf8");
  const atajos = fuente("nucleo/atajos.js");
  assert.doesNotMatch(atajos, /CATALOGO/, "la hoja no tiene una lista escrita a mano que pueda desviarse");
  assert.doesNotMatch(atajos, /"perfiles"/);
  // Las teclas que registra el mapa de caminos: + − 0 (Esc es del marco: suelta la selección o cierra la hoja).
  const telarana = fuente("pantallas/telarana.js");
  const bloque = telarana.slice(telarana.indexOf("ctx.atajos.registrar({"));
  const teclas = [...bloque.matchAll(/^ {4}("[^"]+"|\w+): \{/gm)].map((m) => m[1].replaceAll('"', ""));
  assert.deepEqual(teclas, ["+", "-", "0"]);
  // La tanda: 1 mapa, 2 Replay, 3 Propuesta (sin Resumen ni Perfiles), c y Esc; sin [ ] ni j/k de hallazgos.
  assert.deepEqual((await import("../public/nucleo/rutas.js")).PESTANAS, ["telarana", "replay", "propuesta"]);
  assert.doesNotMatch(atajos, /"resumen"/);
  assert.doesNotMatch(fuente("nucleo/marco-tanda.js"), /desc\.(pestanas|hallazgos|vecinas)/);
});
