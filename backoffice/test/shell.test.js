import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENLACE_EN_CURSO, MARCA, revisionesEnCurso } from "../public/nucleo/shell.js";

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");

test("barra superior: marca y revisiones en curso; sin buscador, navegación, idioma, cajón ni barra lateral", () => {
  const shell = leer("../public/nucleo/shell.js");
  const html = leer("../public/index.html");
  // Lo que queda: la marca y la píldora.
  for (const pieza of ["marca-logo", "barra-en-curso"]) assert.match(shell, new RegExp(pieza));
  // Sin el buscador ⌘K ni su paleta: cada vista busca lo suyo (el Overview, sus revisiones por link).
  assert.doesNotMatch(shell, /barra-buscar|Paleta/);
  assert.doesNotMatch(html, /id="paleta"/);
  // Lo que se fue (contrato §6): enlaces de sección, marca de sección actual, menú, cajón y el selector EN | ES (el
  // idioma se cambia con ?idioma=).
  assert.doesNotMatch(shell, /el\("nav"|aria-current|barra-menu|cajon|backoffice:ruta|barra-idioma|cambiarIdioma|IDIOMAS/);
  // Tampoco la insignia "backoffice" junto al logo (contrato §7.2).
  assert.doesNotMatch(shell, /marca-insignia|marca\.producto/);
  assert.match(html, /<header class="barra-superior" id="barra-superior"><\/header>/);
  assert.doesNotMatch(html, /id="cajon"|id="lateral"/);
});

test("la píldora cuenta las revisiones running (las detenidas incluidas), lleva a Live y se oculta sin tabla", () => {
  assert.equal(ENLACE_EN_CURSO, "#/?pestana=live");
  const tabla = (...estados) => ({ disponible: true, revisiones: estados.map((estado) => ({ estado })) });
  assert.equal(revisionesEnCurso(tabla("running", "queued", "running", "done", "failed")), 2);
  assert.equal(revisionesEnCurso(tabla("queued", "done")), 0);
  assert.equal(revisionesEnCurso(tabla()), 0);
  assert.equal(revisionesEnCurso({ disponible: false }), null);
  assert.equal(revisionesEnCurso(null), null);
  assert.equal(revisionesEnCurso({ disponible: true }), null);
});

test("la marca es la de docs/marca sin cambios: firma horizontal y, donde no cabe, el símbolo a color", () => {
  const kit = (archivo) => readFileSync(new URL(`../../docs/marca/chameleonmode-v1/assets/${archivo}`, import.meta.url));
  const publico = (archivo) => readFileSync(new URL(`../public/${archivo}`, import.meta.url));
  assert.deepEqual(publico(MARCA.logo.src), kit("logo-horizontal-on-dark.svg"));
  assert.deepEqual(publico(MARCA.simbolo.src), kit("symbol-color.svg"));
  assert.deepEqual(publico("icono.svg"), kit("favicon.svg"));
  for (const archivo of [MARCA.logo.src, MARCA.simbolo.src, "icono.svg"]) {
    const svg = publico(archivo).toString("utf8");
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|<use|\son[a-z]+=|javascript:|xlink:href|@import/i, archivo);
    assert.deepEqual(svg.match(/url\((?!#)[^)]*\)/g), null, `${archivo}: solo referencias internas`);
  }
  // La firma horizontal no baja de su mínimo de marca (180 px); el corte al símbolo es el mismo en el CSS.
  const css = leer("../public/estilos/shell.css");
  assert.match(css, /\.marca-logo \{[^}]*width: 180px;[^}]*max-width: none;/);
  const inicio = css.indexOf(`@media ${MARCA.soloSimbolo} {`);
  assert.notEqual(inicio, -1, "el CSS cambia al símbolo en el mismo ancho que el <picture> (MARCA.soloSimbolo)");
  const bloque = css.slice(inicio, css.indexOf("\n}\n", inicio));
  assert.match(bloque, /\.marca-logo \{ width: 36px; height: 36px; \}/);
});
