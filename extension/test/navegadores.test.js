// La extensión corre en Firefox y en Chrome con el mismo src/ (ver CLAUDE.md, "Firefox y Chrome").
// Estos tests cuidan lo que rompería uno de los dos navegadores sin que se note probando en el otro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import "../src/comun/idioma.js";

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");
const manifest = JSON.parse(leer("manifest.json"));
const archivosJs = (carpeta = "") =>
  readdirSync(new URL(carpeta, src), { recursive: true })
    .filter((archivo) => archivo.endsWith(".js"))
    .map((archivo) => carpeta + archivo);

test("el background es el mismo módulo en Firefox (scripts) y en Chrome (service_worker)", () => {
  const { scripts, service_worker: serviceWorker, type } = manifest.background;
  assert.deepEqual(scripts, [serviceWorker], "background.scripts debe ser [background.service_worker]");
  assert.equal(type, "module");
});

test("Chrome 148 o superior: `browser.*` nativo y listeners de onMessage que responden con una promesa", () => {
  // Antes de la 148 no existe `browser` en Chrome y onMessage ignora la promesa que devuelven
  // los listeners del background y de content/captura.js (el remitente recibe undefined).
  assert.ok(Number(manifest.minimum_chrome_version) >= 148, "minimum_chrome_version debe ser 148 o más");
});

test("el código usa `browser.*`, nunca `chrome.*`", () => {
  for (const archivo of archivosJs()) {
    const usos = leer(archivo).match(/\bchrome\.\w+/g);
    assert.equal(usos, null, `${archivo} usa ${usos?.join(", ")}: cámbialo por browser.*`);
  }
});

test("el background no usa APIs que no existen en un service worker", () => {
  const prohibidas = /\b(window|localStorage|sessionStorage|XMLHttpRequest|DOMParser|createObjectURL)\b/;
  for (const archivo of archivosJs("background/")) {
    const uso = leer(archivo).match(prohibidas);
    assert.equal(uso, null, `${archivo} usa ${uso?.[1]}, que no existe en el service worker de Chrome`);
  }
});

test("los textos visibles no nombran un navegador", () => {
  const recorrer = (valor, ruta) => {
    if (typeof valor === "string") {
      assert.doesNotMatch(valor, /firefox|chrome|mozilla/i, `${ruta} nombra un navegador: usa "el navegador"`);
    } else {
      for (const [clave, interior] of Object.entries(valor)) recorrer(interior, `${ruta}.${clave}`);
    }
  };
  recorrer(globalThis.MiTema.idioma.TEXTOS, "TEXTOS");
});
