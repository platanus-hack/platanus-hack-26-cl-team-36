// Tests de src/content/transicion.js. Es un content script (no un módulo): lo cargamos en
// un contexto aislado y probamos la lógica pura y la limpieza con un documento falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const codigo = readFileSync(new URL("../src/content/transicion.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/content/transicion.css", import.meta.url), "utf8");
const contexto = { MiTema: {}, console };
vm.runInNewContext(codigo, contexto);
const { BALDES, distancia, balde, elegirPiezas, seMovio, elegirModo, crear } = contexto.MiTema.transicion;

const VIEWPORT = { ancho: 1000, alto: 800 };
const caja = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test("distancia al punto más cercano y al más lejano del rectángulo", () => {
  const origen = { x: 1000, y: 0 };
  assert.equal(distancia(caja(900, 0, 100, 100), origen), 0); // toca la esquina
  assert.equal(distancia(caja(0, 300, 600, 100), origen), Math.hypot(400, 300));
  assert.equal(distancia(caja(0, 300, 600, 100), origen, true), Math.hypot(1000, 400));
});

test("el balde crece con la distancia al botón (esquina superior derecha)", () => {
  assert.equal(balde(caja(950, 0, 50, 50), VIEWPORT), 0);
  assert.equal(balde(caja(0, 750, 50, 50), VIEWPORT), BALDES - 1);
  const medio = balde(caja(400, 300, 100, 100), VIEWPORT);
  assert.ok(medio > 0 && medio < BALDES - 1);
  // Al desactivar se mide al punto más lejano: nunca antes que al activar.
  assert.ok(balde(caja(400, 300, 100, 100), VIEWPORT, true) >= medio);
});

// Árbol falso: { nombre, rect, hoja, display, hijos }
function nodo(nombre, rect, hijos = [], extra = {}) {
  return { nombre, rect, hijos, ...extra };
}
const accesos = {
  hijos: (n) => n.hijos,
  medir: (n) => (n.oculto ? null : n.contents ? { soloHijos: true } : { rect: n.rect, hoja: !!n.hoja }),
  viewport: VIEWPORT,
};
const nombres = (piezas) => Array.from(piezas, (p) => p.nodo.nombre); // array de este contexto

test("elige bloques medianos y baja dentro de los contenedores grandes", () => {
  const tarjetas = [0, 1, 2, 3].map((i) => nodo(`tarjeta${i}`, caja(250 * i, 100, 230, 200)));
  const grilla = nodo("grilla", caja(0, 100, 1000, 700), tarjetas);
  const cabecera = nodo("cabecera", caja(0, 0, 1000, 60), [nodo("logo", caja(10, 10, 120, 40)), nodo("buscador", caja(300, 10, 400, 40))]);
  const cuerpo = nodo("body", caja(0, 0, 1000, 800), [cabecera, grilla]);
  const piezas = elegirPiezas(cuerpo, accesos);
  assert.deepEqual(nombres(piezas), ["logo", "buscador", "tarjeta0", "tarjeta1", "tarjeta2", "tarjeta3"]);
  assert.ok(piezas.every((p) => Number.isInteger(p.balde) && p.rect));
});

test("ignora lo invisible, lo diminuto y lo que está fuera de pantalla; display: contents se atraviesa", () => {
  const cuerpo = nodo("body", caja(0, 0, 1000, 800), [
    nodo("oculto", caja(0, 0, 200, 200), [], { oculto: true }),
    nodo("icono", caja(0, 0, 10, 10)),
    nodo("abajo", caja(0, 2000, 300, 300)),
    nodo("envoltorio", null, [nodo("adentro", caja(0, 300, 200, 200))], { contents: true }),
  ]);
  assert.deepEqual(nombres(elegirPiezas(cuerpo, accesos)), ["adentro"]);
});

test("una hoja enorme (p. ej. un video a pantalla completa) queda con el fondo", () => {
  const cuerpo = nodo("body", caja(0, 0, 1000, 800), [nodo("video", caja(0, 0, 1000, 800), [], { hoja: true })]);
  assert.deepEqual(nombres(elegirPiezas(cuerpo, accesos)), []);
});

test("respeta el máximo y lo que se pide omitir", () => {
  const muchas = Array.from({ length: 60 }, (_, i) => nodo(`p${i}`, caja((i % 10) * 100, Math.floor(i / 10) * 100, 90, 90)));
  const cuerpo = nodo("body", caja(0, 0, 1000, 800), muchas);
  assert.equal(elegirPiezas(cuerpo, { ...accesos, maximo: 40 }).length, 40);
  const sinPares = elegirPiezas(cuerpo, { ...accesos, omitir: (n) => Number(n.nombre.slice(1)) % 2 === 0 });
  assert.ok(sinPares.every((p) => Number(p.nodo.nombre.slice(1)) % 2 === 1));
});

test("seMovio distingue un cambio de estilo de un cambio de lugar o tamaño", () => {
  const antes = caja(100, 100, 200, 100);
  assert.equal(seMovio(antes, caja(104, 98, 204, 104)), false);
  assert.equal(seMovio(antes, caja(400, 100, 200, 100)), true);
  assert.equal(seMovio(antes, caja(100, 100, 200, 180)), true);
});

test("elegirModo: pestañas ocultas, reducir movimiento y respaldo sin View Transitions", () => {
  const base = { visible: true, conTransiciones: true, conClases: true, reducirMovimiento: false };
  assert.equal(elegirModo(true, base), "entrada");
  assert.equal(elegirModo(false, base), "salida");
  assert.equal(elegirModo(true, { ...base, visible: false }), null);
  assert.equal(elegirModo(true, { ...base, reducirMovimiento: true }), "suave");
  assert.equal(elegirModo(true, { ...base, reducirMovimiento: true, conTransiciones: false }), null);
  assert.equal(elegirModo(true, { ...base, conClases: false }), "ligera");
  assert.equal(elegirModo(false, { ...base, conTransiciones: false }), null);
});

// ---------- animar() con un documento falso ----------

class Elemento {
  constructor(localName, rect = null, hijos = []) {
    this.localName = localName;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.id = "";
    this.rect = rect;
    this.children = hijos;
    this.atributos = new Map();
    this.conectado = true;
  }
  setAttribute(n, v) { this.atributos.set(n, String(v)); }
  removeAttribute(n) { this.atributos.delete(n); }
  getAttribute(n) { return this.atributos.get(n) ?? null; }
  getClientRects() { return this.rect ? [this.rect] : []; }
  append(hijo) { this.children = [...this.children, hijo]; hijo.padre = this; }
  remove() { if (this.padre) this.padre.children = this.padre.children.filter((h) => h !== this); }
}

function entornoFalso({ conTransiciones = true, reducir = false } = {}) {
  const tarjetas = [0, 1, 2].map((i) => new Elemento("article", caja(300 * i, 100, 250, 200)));
  const cuerpo = new Elemento("body", caja(0, 0, 1000, 800), tarjetas);
  const html = new Elemento("html", caja(0, 0, 1000, 800), [cuerpo]);
  const transiciones = [];
  const documento = {
    documentElement: html,
    body: cuerpo,
    visibilityState: "visible",
    createElement: (nombre) => new Elemento(nombre),
  };
  if (conTransiciones) {
    documento.startViewTransition = (callback) => {
      let terminar;
      const vt = {
        callback,
        saltada: false,
        finished: new Promise((r) => (terminar = r)),
        ready: Promise.resolve(),
        correr() { callback(); },
        terminar() { terminar(); },
        skipTransition() { this.saltada = true; terminar(); },
      };
      transiciones.push(vt);
      return vt;
    };
  }
  const temporizadores = new Map();
  let siguiente = 1;
  const entorno = {
    documento,
    ventana: {
      innerWidth: 1000,
      innerHeight: 800,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      CSS: { supports: () => true },
      matchMedia: () => ({ matches: reducir }),
    },
    programar: (fn) => { temporizadores.set(siguiente, fn); return siguiente++; },
    cancelar: (id) => temporizadores.delete(id),
  };
  return { entorno, html, tarjetas, transiciones, temporizadores };
}

const tick = () => new Promise((r) => setImmediate(r));
const marcadas = (tarjetas) => tarjetas.filter((t) => t.atributos.has("data-mt-ola")).length;

test("entrada: marca piezas, cambia dentro de la transición y limpia al terminar", async () => {
  const { entorno, html, tarjetas, transiciones } = entornoFalso();
  const t = crear(entorno);
  let aplicado = 0;
  t.animar(true, () => aplicado++);

  assert.equal(html.getAttribute("data-mt-transicion"), "entrada");
  assert.equal(marcadas(tarjetas), 3); // marcadas antes de la captura
  assert.equal(aplicado, 0); // el cambio va dentro de la transición

  transiciones[0].correr();
  assert.equal(aplicado, 1);
  assert.ok(html.children.some((h) => h.id === "mt-frente"));

  transiciones[0].terminar();
  await tick();
  assert.equal(html.getAttribute("data-mt-transicion"), null);
  assert.equal(marcadas(tarjetas), 0);
  assert.ok(!html.children.some((h) => h.id === "mt-frente"));
  assert.equal(t.enCurso(), null);
});

test("las piezas que el tema mueve se sueltan antes de la captura nueva", () => {
  const { entorno, tarjetas, transiciones } = entornoFalso();
  crear(entorno).animar(true, () => (tarjetas[0].rect = caja(600, 500, 250, 200)));
  transiciones[0].correr();
  assert.equal(tarjetas[0].atributos.has("data-mt-ola"), false);
  assert.equal(tarjetas[1].atributos.has("data-mt-ola"), true);
});

test("otro clic a mitad de camino: la anterior se salta y limpia, y la nueva queda sola", async () => {
  const { entorno, html, tarjetas, transiciones } = entornoFalso();
  const t = crear(entorno);
  t.animar(true, () => {});
  transiciones[0].correr();
  t.animar(false, () => {});

  assert.equal(transiciones[0].saltada, true);
  assert.equal(html.getAttribute("data-mt-transicion"), "salida");
  assert.equal(html.children.filter((h) => h.id === "mt-frente").length, 0); // el frente viejo se fue

  await tick(); // el `finished` de la primera llega tarde: no debe tocar la segunda
  assert.equal(html.getAttribute("data-mt-transicion"), "salida");
  assert.equal(marcadas(tarjetas), 3);

  transiciones[1].correr();
  transiciones[1].terminar();
  await tick();
  assert.equal(html.getAttribute("data-mt-transicion"), null);
  assert.equal(marcadas(tarjetas), 0);
});

test("reducir movimiento: fundido sin piezas ni frente", async () => {
  const { entorno, html, tarjetas, transiciones } = entornoFalso({ reducir: true });
  crear(entorno).animar(true, () => {});
  assert.equal(html.getAttribute("data-mt-transicion"), "suave");
  transiciones[0].correr();
  assert.equal(marcadas(tarjetas), 0);
  assert.ok(!html.children.some((h) => h.id === "mt-frente"));
});

test("sin View Transitions: aplica al instante, versión ligera y limpieza por temporizador", () => {
  const { entorno, html, tarjetas, temporizadores } = entornoFalso({ conTransiciones: false });
  const t = crear(entorno);
  let aplicado = 0;
  t.animar(true, () => aplicado++);
  assert.equal(aplicado, 1);
  assert.equal(html.getAttribute("data-mt-transicion"), "ligera");
  assert.equal(marcadas(tarjetas), 3);

  [...temporizadores.values()].forEach((fn) => fn());
  assert.equal(html.getAttribute("data-mt-transicion"), null);
  assert.equal(marcadas(tarjetas), 0);

  t.animar(false, () => aplicado++); // al desactivar sin View Transitions: instantáneo
  assert.equal(aplicado, 2);
  assert.equal(html.getAttribute("data-mt-transicion"), null);
});

test("pestaña oculta: cambio instantáneo, sin tocar nada más", () => {
  const { entorno, html, tarjetas, transiciones } = entornoFalso();
  entorno.documento.visibilityState = "hidden";
  let aplicado = 0;
  crear(entorno).animar(true, () => aplicado++);
  assert.equal(aplicado, 1);
  assert.equal(transiciones.length, 0);
  assert.equal(html.getAttribute("data-mt-transicion"), null);
  assert.equal(marcadas(tarjetas), 0);
});

test("el CSS tiene una regla por balde y todo va bajo html[data-mt-transicion]", () => {
  for (let k = 0; k < BALDES; k++) {
    assert.match(css, new RegExp(`\\[data-mt-ola="${k}"\\] \\{ view-transition-class: mt-ola mt-b${k};`));
    assert.match(css, new RegExp(`::view-transition-group\\(\\*\\.mt-b${k}\\) \\{ --mt-k: ${k};`));
  }
  const sinCuerpos = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^{}]*\}/g, "{}");
  const selectores = sinCuerpos
    .replace(/@keyframes[^{]*\{(\s*[^{}]*\{\})*\s*\}/g, "")
    .replace(/@property[^{]*\{\}/g, "")
    .split("{}")
    .flatMap((s) => s.split(/,(?![^()]*\))/)) // comas fuera de paréntesis
    .map((s) => s.trim())
    .filter(Boolean);
  assert.ok(selectores.length > 20);
  for (const selector of selectores) assert.ok(selector.startsWith("html[data-mt-transicion"), selector);
});
