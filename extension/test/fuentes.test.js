// Tests de las fuentes empaquetadas (src/fuentes/, background/fuentes.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { FUENTES, HOJA_FUENTES, usaFuentes } from "../src/background/fuentes.js";
import { sanearCss } from "../src/background/css-remoto.js";

const ruta = (archivo) => new URL(`../src/${archivo}`, import.meta.url);
const leer = (archivo) => readFileSync(ruta(archivo), "utf8");
const manifest = JSON.parse(leer("manifest.json"));
const hoja = leer(HOJA_FUENTES);
const TOPE_BYTES = 600_000;

test("cada fuente listada es un woff2 con su licencia OFL", () => {
  for (const { familia, archivo, licencia } of FUENTES) {
    const bytes = readFileSync(ruta(archivo));
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${familia}: ${archivo} no es woff2`);
    assert.match(leer(licencia), /SIL Open Font License, Version 1\.1/, `${familia}: falta la OFL`);
  }
});

test("src/fuentes/ no trae archivos sin listar", () => {
  const listados = new Set([HOJA_FUENTES, ...FUENTES.flatMap((f) => [f.archivo, f.licencia])]);
  for (const nombre of readdirSync(ruta("fuentes"))) {
    assert.ok(listados.has(`fuentes/${nombre}`), `fuentes/${nombre} no está en FUENTES`);
  }
});

test("los nombres llevan el prefijo MT y no se repiten", () => {
  const familias = FUENTES.map((f) => f.familia);
  for (const familia of familias) assert.match(familia, /^MT [A-Z]/);
  assert.equal(new Set(familias).size, familias.length);
});

test(`el total de las fuentes queda bajo ${TOPE_BYTES / 1000} KB`, () => {
  const total = [...new Set(FUENTES.map((f) => f.archivo))].reduce((suma, a) => suma + statSync(ruta(a)).size, 0);
  assert.ok(total <= TOPE_BYTES, `pesan ${total} bytes`);
});

test("fuentes.css declara cada familia con su archivo, font-display: swap y su respaldo", () => {
  const caras = [...hoja.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, cuerpo]) => cuerpo);
  for (const { familia, archivo } of FUENTES) {
    const cara = caras.find((c) => c.includes(`font-family: "${familia}";`));
    assert.ok(cara, `falta @font-face de ${familia}`);
    assert.ok(cara.includes(`url("${archivo.replace("fuentes/", "")}")`), `${familia} no apunta a ${archivo}`);
    assert.match(cara, /font-display:\s*swap/);
    assert.ok(caras.some((c) => c.includes(`font-family: "${familia} Fallback";`) && /src:\s*local\(/.test(c)));
  }
  assert.doesNotMatch(hoja.replace(/\/\*[^]*?\*\//g, "").replace(/url\("[\w-]+\.woff2"\)/g, ""), /url\(/, "solo url() relativas a los woff2");
});

test("los woff2 son accesibles desde páginas http(s) y fuentes.css no va en todas las páginas", () => {
  const recursos = manifest.web_accessible_resources.flatMap((w) => w.resources);
  assert.deepEqual(recursos, ["fuentes/*.woff2"]);
  for (const w of manifest.web_accessible_resources) assert.deepEqual(w.matches, ["http://*/*", "https://*/*"]);
  const cssDeTodas = manifest.content_scripts.flatMap((cs) => cs.css ?? []);
  assert.ok(!cssDeTodas.some((c) => c.startsWith("fuentes/")), "las fuentes no van en content_scripts");
});

test("usaFuentes: solo si el tema nombra una fuente empaquetada", () => {
  assert.equal(usaFuentes(null), false);
  assert.equal(usaFuentes(""), false);
  assert.equal(usaFuentes("html.mi-tema body { font-family: Inter, system-ui; }"), false);
  assert.equal(usaFuentes('html.mi-tema body { font-family: "SMT Inter"; }'), false);
  assert.equal(usaFuentes('html.mi-tema body { font-family: "MT Interstate"; }'), false);
  for (const { familia } of FUENTES) {
    assert.equal(usaFuentes(`html.mi-tema h1 { font-family: "${familia}", sans-serif; }`), true, familia);
  }
  assert.equal(usaFuentes("html.mi-tema code { font-family: mt  geist mono, monospace; }"), true);
  assert.equal(usaFuentes('html.mi-tema p { font-family: "MT Inter Fallback"; }'), true);
});

test("un tema saneado conserva el nombre de la familia", () => {
  const { css } = sanearCss('html.mi-tema body { font-family: "MT Source Serif", "MT Source Serif Fallback", serif; }');
  assert.ok(usaFuentes(css));
});

test("el background inyecta fuentes.css solo al inyectar un tema que las nombra", () => {
  const fuente = leer("background/index.js");
  const inyectarTema = fuente.slice(fuente.indexOf("async function inyectarTema"), fuente.indexOf("// ---------- 3."));
  assert.match(inyectarTema, /inyectarFuentes\(tema\.css, target\)/);
  const inyectarFuentes = fuente.slice(fuente.indexOf("async function inyectarFuentes"));
  assert.match(inyectarFuentes, /^[^]*?if \(!usaFuentes\(css\)\) return;[^]*?files: \[HOJA_FUENTES\]/);
  assert.equal(fuente.split("HOJA_FUENTES").length - 1, 2, "solo el import y inyectarFuentes usan la hoja");
});
