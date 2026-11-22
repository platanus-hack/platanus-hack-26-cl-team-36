// Interruptor «Efectos llamativos» (C2-U3): llamativos (la metamorfosis) o sutiles (un fundido), en los ajustes del
// popup; prefers-reduced-motion manda siempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DURACION_SUTIL, claseDeCambio } from "../src/popup/interruptor.js";

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");
await import("../src/comun/idioma.js");
await import("../src/comun/efectos.js");
const { CLAVE_EFECTOS, EFECTOS, EFECTOS_POR_OMISION, normalizarEfectos } = globalThis.MiTema.efectos;
const { TEXTOS } = globalThis.MiTema.idioma;

const contexto = { MiTema: {}, console };
vm.runInNewContext(leer("content/transicion.js"), contexto);
const { elegirModo, crear } = contexto.MiTema.transicion;

test("la preferencia: clave `efectos`, dos valores y un único valor por omisión, en una constante con nombre", () => {
  assert.equal(CLAVE_EFECTOS, "efectos");
  assert.deepEqual([...EFECTOS], ["llamativos", "sutiles"]);
  assert.ok(EFECTOS.includes(EFECTOS_POR_OMISION));
  assert.equal(EFECTOS_POR_OMISION, "llamativos", "decidido en el ciclo 2: la demo luce la metamorfosis");
  assert.equal(normalizarEfectos("sutiles"), "sutiles");
  assert.equal(normalizarEfectos(undefined), EFECTOS_POR_OMISION, "sin elegir todavía");
  assert.equal(normalizarEfectos("otro"), EFECTOS_POR_OMISION);
  // Cambiar el valor por omisión es tocar una sola línea.
  assert.equal([...leer("comun/efectos.js").matchAll(/const EFECTOS_POR_OMISION = "(\w+)";/g)].length, 1);
});

test("la página: con efectos sutiles, un fundido; con movimiento reducido, el más tranquilo elija lo que elija", () => {
  const base = { visible: true, conTransiciones: true, conClases: true, reducirMovimiento: false };
  assert.equal(elegirModo(true, { ...base, sutil: true }), "sutil");
  assert.equal(elegirModo(false, { ...base, sutil: true }), "sutil");
  assert.equal(elegirModo(true, { ...base, sutil: false }), "entrada");
  assert.equal(elegirModo(true, { ...base, sutil: true, conTransiciones: false }), null, "sin View Transitions, al instante");
  for (const sutil of [true, false]) assert.equal(elegirModo(true, { ...base, sutil, reducirMovimiento: true }), "suave");
  assert.equal(elegirModo(true, { ...base, sutil: true, visible: false }), null);
  // El CSS: sutil dura ≤ 300 ms y suave (movimiento reducido) es más corto todavía.
  const css = leer("content/transicion.css");
  const duracion = (modo) => Number(css.match(new RegExp(`data-mt-transicion="${modo}"\\]::view-transition-group\\(root\\) \\{\\s*animation-duration: (\\d+)ms`))[1]);
  assert.ok(duracion("sutil") <= 300 && duracion("suave") < duracion("sutil"));
});

test("la página: el fundido sutil no marca piezas ni pone el frente, y limpia al terminar", async () => {
  const tarjetas = [0, 1, 2].map(() => ({ atributos: new Map(), setAttribute(n, v) { this.atributos.set(n, v); }, removeAttribute(n) { this.atributos.delete(n); }, getAttribute(n) { return this.atributos.get(n) ?? null; } }));
  const html = { atributos: new Map(), children: [], style: { setProperty() {}, removeProperty() {} }, setAttribute(n, v) { this.atributos.set(n, v); }, removeAttribute(n) { this.atributos.delete(n); }, getAttribute(n) { return this.atributos.get(n) ?? null; }, append(h) { this.children.push(h); } };
  let vt;
  const documento = {
    documentElement: html,
    body: { children: tarjetas },
    visibilityState: "visible",
    createElement: () => ({ append() {} }),
    startViewTransition(callback) {
      let terminar;
      vt = { callback, finished: new Promise((r) => (terminar = r)), ready: Promise.resolve(), terminar: () => terminar(), skipTransition() {} };
      return vt;
    },
  };
  const ventana = { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ display: "block", visibility: "visible" }), CSS: { supports: () => true }, matchMedia: () => ({ matches: false }) };
  const t = crear({ documento, ventana, programar: () => 0, cancelar: () => {} });
  let aplicado = 0;
  t.animar(true, () => aplicado++, { sutil: true });
  assert.equal(html.getAttribute("data-mt-transicion"), "sutil");
  vt.callback();
  assert.equal(aplicado, 1);
  assert.equal(tarjetas.filter((x) => x.atributos.has("data-mt-pieza")).length, 0, "sin piezas");
  assert.equal(html.children.length, 0, "sin frente");
  vt.terminar();
  await new Promise((r) => setImmediate(r));
  assert.equal(html.getAttribute("data-mt-transicion"), null);
});

test("el motor lee los efectos guardados, los sigue si cambian y se los pasa a la transición", () => {
  const motor = leer("content/motor.js");
  assert.match(motor, /storage\.local\.get\(\[[^\]]*CLAVE_EFECTOS[^\]]*\]\)/);
  assert.match(motor, /CLAVE_EFECTOS in cambios/);
  assert.match(motor, /\{ sutil: efectos === "sutiles" \}/);
  const manifest = JSON.parse(leer("manifest.json"));
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf("comun/efectos.js") > js.indexOf("content/registro.js") && js.indexOf("comun/efectos.js") < js.indexOf("content/motor.js"));
});

test("el camaleón: con efectos sutiles se funde (sin despertar ni dormirse); la primera pintura no anima", () => {
  assert.equal(claseDeCambio("no", "si", "sutiles"), "cambio-sutil");
  assert.equal(claseDeCambio("si", "no", "sutiles"), "cambio-sutil");
  assert.equal(claseDeCambio("no", "si", "llamativos"), "despertando");
  assert.equal(claseDeCambio("si", "no", undefined), "durmiendo");
  assert.equal(claseDeCambio("cargando", "si", "sutiles"), null);
  const css = leer("popup/interruptor.css");
  assert.match(css, new RegExp(`\\.mt-control\\.mt-cambio-sutil \\.mt-cuerpo \\{\\s*animation: mt-fundido ${DURACION_SUTIL}ms`));
  // Movimiento reducido: también con efectos sutiles queda el fundido corto (y nada más).
  const reducido = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reducido, /\.mt-control:is\(\.mt-despertando, \.mt-durmiendo, \.mt-cambio-sutil\)/);
});

test("el interruptor «Efectos llamativos»: role=switch con aria-checked, nombre y descripción ES/EN, en los ajustes", () => {
  const html = leer("popup/popup.html");
  const boton = html.match(/<button[^>]*id="mt-efectos"[^>]*>/)[0];
  assert.match(boton, /type="button"/);
  assert.match(boton, /role="switch"/);
  assert.match(boton, /aria-checked="true"/);
  assert.match(boton, /aria-labelledby="mt-efectos-etiqueta"/);
  assert.match(boton, /aria-describedby="mt-efectos-ayuda"/);
  assert.match(html, /id="mt-efectos-etiqueta" data-mt-texto="efectos.etiqueta">Efectos llamativos</);
  assert.match(html, /id="mt-efectos-ayuda" data-mt-texto="efectos.ayuda">/);
  assert.equal(TEXTOS.en["efectos.etiqueta"], "Bold effects");
  assert.ok(TEXTOS.es["efectos.ayuda"] && TEXTOS.en["efectos.ayuda"]);
  const ajustes = html.slice(html.indexOf('id="mt-ajustes"'));
  assert.ok(ajustes.includes('id="mt-efectos"'), "vive en la hoja de ajustes");
  assert.match(leer("popup/popup.css"), /\.mt-efectos:focus-visible[^{]*\{[^}]*outline: 2px solid/);
  // El popup lo dibuja, lo guarda y lo sigue si cambia en otra ventana.
  const js = leer("popup/popup.js");
  assert.match(js, /setAttribute\("aria-checked", String\(estado\.efectos === "llamativos"\)\)/);
  assert.match(js, /storage\.local\s*\.set\(\{ \[CLAVE_EFECTOS\]: estado\.efectos \}\)/);
  assert.match(js, /CLAVE_EFECTOS in cambios/);
  assert.match(js, /dataset\.efectos = estado\.efectos/);
});

test("cambiar de idioma no mueve la vista de opinión: las opciones reservan dos líneas en los dos idiomas", () => {
  const css = leer("popup/popup.css");
  assert.match(css, /\.mt-opcion-texto \{[^}]*min-height: 2\.4em;/);
  assert.match(css, /\.mt-opcion \{[^}]*line-height: 1\.2;/, "2.4em = dos líneas de 1.2");
});
