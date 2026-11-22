// Tests del motor (src/content/motor.js) con revisiones: corre el archivo en un contexto con DOM y browser simulados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODIGO = readFileSync(new URL("../src/content/motor.js", import.meta.url), "utf8");
const PAGINA = "https://example.com/tienda";

// `respuestas`: lo que contesta el background a cada sendMessage, en orden.
function cargarMotor(...respuestas) {
  const clases = new Set();
  const html = {
    dataset: {},
    classList: {
      contains: (c) => clases.has(c),
      toggle: (c, si) => (si ? clases.add(c) : clases.delete(c), si),
    },
    removeAttribute(nombre) {
      if (nombre === "data-mt-tema") delete this.dataset.mtTema;
    },
  };
  const observadores = [];
  const temporizadores = [];
  const mensajes = [];
  const location = new URL(PAGINA);
  const contexto = {
    console: { info() {}, warn() {}, error() {} },
    document: { documentElement: html, addEventListener() {} },
    location,
    setTimeout: (fn) => temporizadores.push(fn),
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class {
      constructor(fn) {
        observadores.push(fn);
      }
      observe() {}
      disconnect() {}
    },
    browser: {
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
      runtime: {
        sendMessage: async (mensaje) => {
          mensajes.push(mensaje.tipo);
          return respuestas.shift() ?? null;
        },
      },
    },
    MiTema: {
      efectos: { EFECTOS_POR_OMISION: "llamativos", CLAVE_EFECTOS: "efectos", normalizarEfectos: (x) => x },
      idioma: { CLAVE_IDIOMA: "idioma", fijar() {} },
      transicion: { animar() {} },
      features: new Map(),
    },
  };
  vm.runInNewContext(CODIGO, contexto);
  return {
    html,
    mensajes,
    temporizadores,
    navegar: (ruta) => (location.pathname = ruta),
    mutarDom: () => observadores.forEach((fn) => fn([])),
  };
}

const esperar = () => new Promise((listo) => setImmediate(listo));
async function correrTemporizador(motor) {
  motor.temporizadores.shift()();
  await esperar();
}

const ESPERAR = { esperarRevision: { intervaloMs: 15_000, topeMs: 600_000 } };
const TEMA = { id: "rev-abc", nombre: "Revisión abc", features: {}, eventosNavegacion: [], pagina: PAGINA };

test("sin tema ni revisión no toca la página ni deja temporizadores", async () => {
  const motor = cargarMotor(null);
  await esperar();
  assert.deepEqual(motor.mensajes, ["tema:aplicar"]);
  assert.equal(motor.temporizadores.length, 0);
  assert.equal(motor.html.classList.contains("mi-tema"), false);
});

test("sondea mientras la revisión corre y activa el tema cuando llega", async () => {
  const motor = cargarMotor(ESPERAR, ESPERAR, TEMA);
  await esperar();
  await correrTemporizador(motor);
  await correrTemporizador(motor);
  assert.deepEqual(motor.mensajes, ["tema:aplicar", "tema:revision", "tema:revision"]);
  assert.equal(motor.temporizadores.length, 0);
  assert.equal(motor.html.classList.contains("mi-tema"), true);
  assert.equal(motor.html.dataset.mtTema, "rev-abc");
});

test("deja de sondear si la SPA navega a otra página", async () => {
  const motor = cargarMotor(ESPERAR, TEMA);
  await esperar();
  motor.navegar("/otra");
  await correrTemporizador(motor);
  assert.deepEqual(motor.mensajes, ["tema:aplicar"]);
  assert.equal(motor.temporizadores.length, 0);
});

test("un tema de revisión se quita al navegar a otra página de la SPA y vuelve al regresar", async () => {
  const motor = cargarMotor(TEMA);
  await esperar();
  assert.equal(motor.html.classList.contains("mi-tema"), true);

  motor.navegar("/otra");
  motor.mutarDom();
  assert.equal(motor.html.classList.contains("mi-tema"), false);
  assert.equal(motor.html.dataset.mtTema, undefined);

  motor.navegar("/tienda");
  motor.mutarDom();
  assert.equal(motor.html.classList.contains("mi-tema"), true);
  assert.equal(motor.html.dataset.mtTema, "rev-abc");
});
