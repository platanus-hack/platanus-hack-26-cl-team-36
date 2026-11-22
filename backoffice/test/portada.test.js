// La portada está en inglés en el HTML y portada.js la pasa a español con su diccionario ES: cada clave que usa el
// HTML tiene su español, y el diccionario no guarda claves que nadie usa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../portada/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../portada/portada.js", import.meta.url), "utf8");

const clavesDelHtml = new Set([...html.matchAll(/data-i18n(?:-html|-alt|-aria-label)?="([^"]+)"/g)].map(([, clave]) => clave));
const bloque = /const ES = \{([\s\S]*?)\n\};/.exec(script)?.[1] ?? "";
const clavesDelDiccionario = new Set([...bloque.matchAll(/^ {2}"?([\w.-]+)"?:/gm)].map(([, clave]) => clave));
// La descripción de la página no tiene atributo: portada.js la cambia por su nombre.
const PROPIAS_DEL_SCRIPT = new Set(["descripcion"]);

test("portada: cada texto marcado en el HTML tiene su español en portada.js", () => {
  assert.ok(clavesDelHtml.size > 50, `muy pocas claves en el HTML (${clavesDelHtml.size})`);
  const faltan = [...clavesDelHtml].filter((clave) => !clavesDelDiccionario.has(clave));
  assert.deepEqual(faltan, []);
});

test("portada: el diccionario español no tiene claves que el HTML no usa", () => {
  const sobran = [...clavesDelDiccionario].filter((clave) => !clavesDelHtml.has(clave) && !PROPIAS_DEL_SCRIPT.has(clave));
  assert.deepEqual(sobran, []);
});

test("portada: en inglés por defecto, con el selector EN | ES", () => {
  assert.match(html, /<html lang="en"/);
  assert.match(html, /data-idioma="en" aria-pressed="true"/);
  assert.match(html, /data-idioma="es" aria-pressed="false"/);
});
