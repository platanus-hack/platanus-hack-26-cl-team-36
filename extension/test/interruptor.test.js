// Contratos del control principal: estado global, recursos de marca y accesibilidad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");

test("el interruptor ofrece nombre, estado y alcance a tecnologías de asistencia", () => {
  const html = leer("popup/popup.html");
  const boton = html.match(/<button[^>]*id="mt-interruptor"[^>]*>/)[0];
  assert.match(boton, /type="button"/);
  assert.match(boton, /aria-pressed="false"/);
  assert.match(boton, /aria-labelledby="mt-interruptor-nombre mt-estado"/);
  assert.match(boton, /aria-describedby="mt-alcance mt-estado-ayuda"/);
  assert.match(html, /id="mt-alcance"[^>]*data-mt-texto="interruptor.alcance"/);
  assert.match(html, /id="mt-pagina"[^>]*role="status"/);
});

test("ON y OFF son activos locales independientes y la marca permanece encendida", () => {
  const html = leer("popup/popup.html");
  for (const nombre of ["on", "off"]) {
    assert.match(html, new RegExp(`src="\.\./icons/extension-${nombre}\.svg"`));
    assert.ok(existsSync(new URL(`icons/extension-${nombre}.svg`, src)));
  }
  assert.match(html, /class="mt-marca" src="\.\.\/brand\/logo-horizontal-on-dark\.svg"/);
  const css = leer("popup/interruptor.css");
  assert.match(css, /body\[data-activo="si"\] \.mt-simbolo-on/);
  assert.match(css, /body\[data-activo="si"\] \.mt-simbolo-off/);
  assert.doesNotMatch(css, /filter:|\.mt-marca/);
});

test("el panel no mantiene decoraciones ni listeners de animación del camaleón", () => {
  assert.doesNotMatch(leer("popup/popup.html"), /mt-(aura|runa|sello|chispas|parpado)/);
  assert.doesNotMatch(leer("popup/popup.js"), /interruptor\.js|requestAnimationFrame|pointermove/);
  assert.doesNotMatch(leer("popup/interruptor.css"), /infinite|@keyframes/);
  assert.match(leer("popup/interruptor.css"), /@media \(prefers-reduced-motion: reduce\)/);
});
