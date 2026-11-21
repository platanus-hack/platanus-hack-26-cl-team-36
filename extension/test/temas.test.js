// Tests de la lógica pura de temas (src/background/temas.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTema, resolverTema } from "../src/background/temas.js";

test("normalizarTema completa valores por defecto", () => {
  const tema = normalizarTema({ id: "x", css: "" });
  assert.deepEqual(tema, { id: "x", nombre: "x", css: "", features: {}, eventosNavegacion: [] });
});

test("normalizarTema rechaza temas incompletos o ids raros", () => {
  assert.throws(() => normalizarTema({ css: "" }), /id/);
  assert.throws(() => normalizarTema({ id: "../otro", css: "" }), /id/);
  assert.throws(() => normalizarTema({ id: "x" }), /css/);
  assert.throws(() => normalizarTema({ id: "x", css: "", features: ["modo-foco"] }), /features/);
});

// Registro de logs para verificar qué se avisó sin ensuciar la salida.
function crearLog() {
  const log = { warn: [], debug: [], error: [] };
  return { log, registro: { warn: (...a) => log.warn.push(a), debug: (...a) => log.debug.push(a), error: (...a) => log.error.push(a) } };
}

const temaYoutube = { id: "youtube", css: "" };
const cargarTema = async (id) => ({ ...temaYoutube, id });

test("resolverTema: si la API dice success, carga ese tema", async () => {
  const tema = await resolverTema("https://www.youtube.com/watch?v=1", {
    consultarApi: async () => "youtube",
    cargarTema,
  });
  assert.equal(tema.id, "youtube");
});

test("resolverTema: si la API dice fail, no hay tema", async () => {
  const { log, registro } = crearLog();
  const tema = await resolverTema("https://example.com", { consultarApi: async () => null, cargarTema, log: registro });
  assert.equal(tema, null);
  assert.equal(log.warn.length, 0);
});

test("resolverTema: si la API está caída, no hay tema y se avisa", async () => {
  const { log, registro } = crearLog();
  let cargo = false;
  const tema = await resolverTema("https://www.youtube.com", {
    consultarApi: async () => {
      throw new TypeError("NetworkError");
    },
    cargarTema: async () => {
      cargo = true;
    },
    log: registro,
  });
  assert.equal(tema, null);
  assert.equal(cargo, false, "no debe cargar el tema local si la API no respondió");
  assert.equal(log.warn.length, 1);
});

test("resolverTema: si la API pide un tema que no existe en la extensión, no hay tema", async () => {
  const { log, registro } = crearLog();
  const tema = await resolverTema("https://nuevo.com", {
    consultarApi: async () => "nuevo",
    cargarTema: async () => {
      throw new Error("404");
    },
    log: registro,
  });
  assert.equal(tema, null);
  assert.match(log.error[0][0], /"nuevo"/);
});
