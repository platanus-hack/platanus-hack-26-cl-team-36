// Tests del saneamiento del CSS remoto (src/background/css-remoto.js), con las reglas del diseñador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BYTES_CSS, MAX_PROFUNDIDAD, sanearCss } from "../src/background/css-remoto.js";

const sin = (css) => sanearCss(css).css;

test("deja pasar un tema correcto bajo html.mi-tema", () => {
  const { css, rechazos } = sanearCss("html.mi-tema body { color: #111 !important; background: white; }");
  assert.equal(css, "html.mi-tema body {\n  color: #111 !important;\n  background: white;\n}\n");
  assert.deepEqual(rechazos, []);
});

test("pone cada selector de primer nivel bajo html.mi-tema", () => {
  assert.equal(sin("body, :root, html.x { color: red }"), "html.mi-tema body, html.mi-tema, html.mi-tema.x {\n  color: red;\n}\n");
  assert.match(sin("@media (max-width: 600px) { a { color: red } }"), /@media \(max-width: 600px\) \{\n {2}html\.mi-tema a \{/);
});

test("descarta lo que carga recursos o ejecuta código", () => {
  const peligrosos = [
    "background: url(https://malo.example/x.png)",
    "background: URL ( 'x' )",
    "background-image: image-set('a.png' 1x)",
    "width: expression(alert(1))",
    "background: javascript:alert(1)",
    "behavior: x",
    "-moz-binding: none",
    "content: '\\75 rl(x)'",
    "content: src(x)",
  ];
  for (const declaracion of peligrosos) {
    const { css, rechazos } = sanearCss(`html.mi-tema a { color: red; ${declaracion}; }`);
    assert.equal(css, "html.mi-tema a {\n  color: red;\n}\n", declaracion);
    assert.equal(rechazos.length, 1, declaracion);
  }
});

test("descarta at-reglas no permitidas y keyframes sin prefijo mt-", () => {
  for (const css of [
    "@import url(x.css);",
    "@import 'x.css';",
    "@font-face { font-family: x; }",
    "@layer a, b;",
    "@layer a { a { color: red } }",
    "@namespace svg 'x';",
    "@keyframes fadeIn { from { opacity: 0 } }",
  ]) {
    assert.equal(sin(css), "", css);
  }
  assert.match(sin("@keyframes mt-entra { from { opacity: 0 } to { opacity: 1 } }"), /@keyframes mt-entra/);
});

test("descarta la regla entera si el selector es peligroso, y anidadas fuera de ámbito", () => {
  assert.equal(sin("a[href=url(x)] { color: red }"), "");
  assert.equal(sin("a { :not(&) b { color: red } }"), "");
  assert.equal(sin("a { & b { color: red } }"), "html.mi-tema a {\n  & b {\n    color: red;\n  }\n}\n");
});

test("cadenas rotas, demasiado largas, comentarios y basura no pasan", () => {
  assert.equal(sin("a { content: 'abc\n'; }"), "");
  assert.equal(sin(`a { content: '${"x".repeat(201)}'; }`), "");
  assert.equal(sin("/* hola */ a { color: red }"), "html.mi-tema a {\n  color: red;\n}\n");
  assert.equal(sin("color: red;"), "");
  assert.equal(sin("```css\na { color: red }\n```"), "html.mi-tema a {\n  color: red;\n}\n");
});

test("valores raros o enormes dan CSS vacío sin lanzar", () => {
  assert.equal(sin(undefined), "");
  assert.equal(sin(42), "");
  assert.equal(sin("   "), "");
  assert.equal(sin(`a { color: red } ${" ".repeat(MAX_BYTES_CSS)}`), "");
});

test("un anidamiento hostil no agota la pila: CSS vacío sin lanzar", () => {
  for (const css of ["a{".repeat(60_000), "@media x{".repeat(20_000), `${"a{".repeat(MAX_PROFUNDIDAD + 1)}color:red`]) {
    assert.deepEqual(sanearCss(css), { css: "", rechazos: ["anidamiento demasiado profundo"] });
  }
  assert.match(sin(`${"a{".repeat(MAX_PROFUNDIDAD)}color:red`), /color:red;/);
});
