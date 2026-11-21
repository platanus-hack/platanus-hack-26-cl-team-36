// Tests del interruptor animado (src/popup/interruptor.js + .css + la sección .mt-control de popup.html).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DURACION, decidirTransicion, direccionMirada } from "../src/popup/interruptor.js";

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");
const html = leer("popup/popup.html");
const css = leer("popup/interruptor.css");
const seccion = html.slice(html.indexOf('<section class="mt-control"'), html.indexOf("</section>", html.indexOf('<section class="mt-control"')));

// ---------- Lógica ----------

test("decidirTransicion: solo anima entre apagado y encendido, nunca la primera pintura", () => {
  assert.equal(decidirTransicion("no", "si"), "despertando");
  assert.equal(decidirTransicion("si", "no"), "durmiendo");
  for (const [anterior, nuevo] of [
    ["cargando", "si"],
    ["cargando", "no"],
    [null, "si"],
    ["si", "si"],
    ["no", "no"],
    ["si", "cargando"],
  ]) {
    assert.equal(decidirTransicion(anterior, nuevo), null, `${anterior} → ${nuevo}`);
  }
});

test("direccionMirada: vector hacia el puntero, de largo 1 lejos y menor cerca", () => {
  assert.deepEqual(direccionMirada({ x: 0, y: 0 }, { x: 200, y: 0 }), { x: 1, y: 0 });
  assert.deepEqual(direccionMirada({ x: 0, y: 0 }, { x: 0, y: -40 }), { x: 0, y: -0.5 });
  assert.deepEqual(direccionMirada({ x: 10, y: 10 }, { x: 10, y: 10 }), { x: 0, y: 0 });
  const { x, y } = direccionMirada({ x: 0, y: 0 }, { x: -300, y: 400 });
  assert.ok(Math.abs(Math.hypot(x, y) - 1) < 0.01);
  assert.ok(x < 0 && y > 0);
});

// Fin de cada animación de una transformación (retraso + duración), con el índice --mt-i en sus
// extremos (0 y el último elemento) y el retraso por chispa --mt-r en su máximo.
// Parte una entrada de `animation` por espacios que no estén dentro de paréntesis.
function partes(texto) {
  const salida = [""];
  let nivel = 0;
  for (const letra of texto.trim()) {
    if (letra === "(") nivel++;
    if (letra === ")") nivel--;
    if (letra === " " && nivel === 0) salida.push("");
    else salida[salida.length - 1] += letra;
  }
  return salida.filter(Boolean);
}

function finesDeAnimacion(clase) {
  const fines = [];
  for (const [, selector, cuerpo] of css.matchAll(new RegExp(`([^{}]*\\.mt-${clase}[^{]*)\\{([^}]*)\\}`, "g"))) {
    const animacion = cuerpo.match(/animation:\s*([^;]+);/)?.[1];
    if (!animacion) continue;
    const ultimo = selector.includes("mt-runa") ? 11 : 43;
    for (const entrada of animacion.split(/,(?![^(]*\))/)) {
      if (/infinite/.test(entrada)) continue;
      for (const i of [0, ultimo]) {
        const texto = entrada.replaceAll("var(--mt-i, 0)", String(i)).replaceAll("var(--mt-r)", "80ms");
        const tiempos = partes(texto)
          .filter((parte) => /^(calc\(|\d+ms$)/.test(parte))
          .map((parte) => Function(`return (${parte.replace(/^calc/, "").replaceAll("ms", "")})`)());
        fines.push({ selector: selector.trim(), fin: tiempos.reduce((suma, t) => suma + t, 0) });
      }
    }
  }
  return fines;
}

test("DURACION cubre las animaciones de cada transformación", () => {
  for (const [clase, total] of Object.entries(DURACION)) {
    const fines = finesDeAnimacion(clase);
    assert.ok(fines.length > 10, `sin animaciones para .mt-${clase}`);
    for (const { selector, fin } of fines) assert.ok(fin <= total, `${selector}: termina a los ${fin} ms > ${total} ms`);
  }
});

// ---------- Marcado ----------

test("el camaleón en línea es el logo de la marca: mismas escamas del espectro, en orden", () => {
  const logo = leer("icons/icon.svg");
  const delLogo = [...logo.matchAll(/<path d="([^"]+)" fill="url\(#e(\d+)\)"\/>/g)].map((m) => [m[1], m[2]]);
  const escamas = [...seccion.matchAll(/<path class="mt-escama" d="([^"]+)" fill="url\(#mt-e(\d+)\)"/g)].map((m) => [m[1], m[2]]);
  const brillos = [...seccion.matchAll(/<path class="mt-brillo" d="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(delLogo.length, 44);
  assert.deepEqual(escamas, delLogo, "regenerar la sección desde src/icons/icon.svg");
  assert.deepEqual(brillos, delLogo.map(([d]) => d));
  for (const [, n] of delLogo) {
    const original = logo.match(new RegExp(`<linearGradient id="e${n}"[^>]*>(.*?)</linearGradient>`))[0];
    assert.ok(seccion.includes(original.replace(`id="e${n}"`, `id="mt-e${n}"`)), `degradado mt-e${n} distinto del logo`);
  }
});

test("la sección es decorativa salvo el botón, y no tiene ids repetidos ni referencias rotas", () => {
  assert.match(seccion, /<button type="button" class="mt-interruptor" id="mt-interruptor" aria-pressed="[^"]*"/);
  assert.match(seccion, /<span class="mt-oculto-visual">[^<]+<\/span>/, "el botón necesita nombre accesible");
  for (const clase of ["mt-aura", "mt-onda", "mt-anillo", "mt-disco", "mt-chispas"]) {
    assert.match(seccion, new RegExp(`<span class="${clase}" aria-hidden="true">`));
  }
  assert.doesNotMatch(seccion, /<img\b/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos en popup.html");
  for (const [, ref] of (seccion + css).matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), `falta #${ref}`);
});

test("interruptor.css: keyframes definidos, prefijo mt- y versión con movimiento reducido", () => {
  const definidos = new Set([...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]));
  for (const nombre of definidos) assert.match(nombre, /^mt-/);
  const usados = new Set();
  for (const [, valor] of css.matchAll(/animation:\s*([^;]+);/g)) {
    for (const [nombre] of valor.matchAll(/(?<![-\w])mt-[\w-]+/g)) usados.add(nombre);
  }
  for (const nombre of usados) assert.ok(definidos.has(nombre), `@keyframes ${nombre} no existe`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /\.mt-camaleon[^{]*\{[^}]*filter/, "el logo nunca lleva filtros");
});

test("interruptor.js: sin innerHTML y solo escribe propiedades personalizadas en style", () => {
  const js = leer("popup/interruptor.js");
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML/);
  for (const [, prop] of js.matchAll(/style\.setProperty\("([^"]+)"/g)) assert.match(prop, /^--mt-/);
  assert.doesNotMatch(js, /\.style\.(?!setProperty)/);
});
