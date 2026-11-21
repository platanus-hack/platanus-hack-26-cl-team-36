// Valida los temas empaquetados en src/temas/<id>/ tal como los cargaría la extensión.
// Si alguien agrega un tema o una feature y se le olvida algo, falla aquí.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { normalizarTema } from "../src/background/temas.js";

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");

const manifest = JSON.parse(leer("manifest.json"));
const scriptsCargados = manifest.content_scripts.flatMap((cs) => cs.js ?? []);
const ids = readdirSync(new URL("temas/", src), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

test("hay al menos un tema", () => {
  assert.ok(ids.length > 0);
});

for (const id of ids) {
  test(`tema "${id}"`, () => {
    assert.ok(existsSync(new URL(`temas/${id}/tema.json`, src)), "falta tema.json");
    assert.ok(existsSync(new URL(`temas/${id}/tema.css`, src)), "falta tema.css");

    const datos = JSON.parse(leer(`temas/${id}/tema.json`));
    const css = leer(`temas/${id}/tema.css`);
    const tema = normalizarTema({ ...datos, id, css });

    assert.ok(css.includes("html.mi-tema"), "el CSS debe ir bajo html.mi-tema");

    for (const feature of Object.keys(tema.features)) {
      const archivo = `features/${feature}.js`;
      assert.ok(existsSync(new URL(archivo, src)), `falta ${archivo}`);
      assert.ok(scriptsCargados.includes(archivo), `${archivo} no está en content_scripts del manifest`);
    }

    for (const vista of [].concat(tema.features.vista ?? [])) {
      for (const clave of ["id", "contenedor", "items", "campos", "componente"]) {
        assert.ok(vista[clave], `la vista "${vista.id}" no tiene \`${clave}\``);
      }
      const archivo = `componentes/${vista.componente}.js`;
      assert.ok(existsSync(new URL(archivo, src)), `la vista "${vista.id}" pide ${archivo}, que no existe`);
      assert.ok(scriptsCargados.includes(archivo), `${archivo} no está en content_scripts del manifest`);
    }
  });
}

test("los componentes se cargan después de content/plantillas.js y antes del motor", () => {
  const posicion = (archivo) => scriptsCargados.indexOf(archivo);
  for (const archivo of scriptsCargados.filter((a) => a.startsWith("componentes/") || a.startsWith("features/"))) {
    assert.ok(posicion(archivo) > posicion("content/plantillas.js"), `${archivo} debe ir después de content/plantillas.js`);
    assert.ok(posicion(archivo) < posicion("content/motor.js"), `${archivo} debe ir antes de content/motor.js`);
  }
});
