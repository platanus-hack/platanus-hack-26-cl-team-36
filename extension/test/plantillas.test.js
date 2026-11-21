// Tests de src/content/plantillas.js. Es un content script (no un módulo), así que lo
// cargamos en un contexto aislado con un MiTema y elementos falsos mínimos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const codigo = readFileSync(new URL("../src/content/plantillas.js", import.meta.url), "utf8");
const contexto = { MiTema: {}, URL, location: { href: "https://www.youtube.com/" } };
vm.runInNewContext(codigo, contexto);
const { leer, leerCampos, urlSegura } = contexto.MiTema.plantillas;

// Elemento falso: { texto, atributos, hijos: { selector: elemento | [elementos] } }
function el({ texto = "", atributos = {}, hijos = {} } = {}) {
  const lista = (s) => [].concat(hijos[s] ?? []);
  return {
    textContent: texto,
    getAttribute: (nombre) => atributos[nombre] ?? null,
    querySelector: (s) => lista(s)[0] ?? null,
    querySelectorAll: (s) => lista(s),
  };
}

const video = el({
  hijos: {
    "a.titulo": el({ texto: "  Un   video \n", atributos: { href: "/watch?v=dD33lDxL9K0&pp=x" } }),
    ".fila": el({ hijos: { span: [el({ texto: "1,2 M de vistas" }), el({ texto: "" }), el({ texto: "hace 2 días" })] } }),
  },
});

test("lee texto (normalizando espacios) y atributos", () => {
  assert.equal(leer(video, { selector: "a.titulo" }), "Un video");
  assert.equal(leer(video, { selector: "a.titulo", atributo: "href" }), "/watch?v=dD33lDxL9K0&pp=x");
  assert.equal(leer(video, { selector: ".no-existe" }), "");
});

test("une partes con separador, ignorando las vacías", () => {
  assert.equal(leer(video, { selector: ".fila", partes: "span", separador: " • " }), "1,2 M de vistas • hace 2 días");
});

test("transforma con patrón y formato", () => {
  const regla = { selector: "a.titulo", atributo: "href", patron: "[?&]v=([\\w-]{11})", formato: "https://i.ytimg.com/vi/$1/hqdefault.jpg" };
  assert.equal(leer(video, regla), "https://i.ytimg.com/vi/dD33lDxL9K0/hqdefault.jpg");
  assert.equal(leer(video, { ...regla, patron: "list=(\\w+)" }), "");
});

test("una lista de reglas usa la primera que da algo", () => {
  assert.equal(leer(video, [{ selector: ".no-existe" }, { selector: "a.titulo" }]), "Un video");
});

test("leerCampos arma un objeto por campo", () => {
  assert.deepEqual(
    { ...leerCampos(video, { titulo: { selector: "a.titulo" }, falta: { selector: ".x" } }) },
    { titulo: "Un video", falta: "" },
  );
});

test("urlSegura solo deja pasar http(s)", () => {
  assert.equal(urlSegura("/watch?v=1"), "https://www.youtube.com/watch?v=1");
  assert.equal(urlSegura("https://i.ytimg.com/a.jpg"), "https://i.ytimg.com/a.jpg");
  assert.equal(urlSegura("javascript:alert(1)"), "");
  assert.equal(urlSegura(" JavaScript:alert(1)"), "");
  assert.equal(urlSegura("data:text/html,<script>"), "");
  assert.equal(urlSegura(""), "");
});
