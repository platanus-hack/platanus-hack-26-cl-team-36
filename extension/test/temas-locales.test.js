// Valida los temas empaquetados en src/temas/ tal como los cargaría la extensión.
// Si alguien agrega un tema o una feature y se le olvida algo, falla aquí.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { normalizarTema } from "../src/background/temas.js";

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");

const manifest = JSON.parse(leer("manifest.json"));
const scriptsCargados = manifest.content_scripts.flatMap((cs) => cs.js ?? []);
const ids = JSON.parse(leer("temas/index.json"));

test("temas/index.json lista al menos un tema", () => {
  assert.ok(Array.isArray(ids) && ids.length > 0);
});

for (const id of ids) {
  test(`tema "${id}"`, () => {
    const datos = JSON.parse(leer(`temas/${id}/tema.json`));
    const css = leer(`temas/${id}/tema.css`);
    const tema = normalizarTema({ ...datos, id, css });

    assert.ok(css.includes("html.mi-tema"), "el CSS debe ir bajo html.mi-tema");

    for (const feature of Object.keys(tema.features)) {
      const archivo = `features/${feature}.js`;
      assert.ok(existsSync(new URL(archivo, src)), `falta ${archivo}`);
      assert.ok(scriptsCargados.includes(archivo), `${archivo} no está en content_scripts del manifest`);
    }
  });
}
