// Tests del saneamiento de las features que llegan de la API (src/background/tema-remoto.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_CADENA, MAX_ITEMS, MAX_VISTAS, sanearTema } from "../src/background/tema-remoto.js";

const METRO = JSON.parse(readFileSync(new URL("fixtures/metro/tema.json", import.meta.url), "utf8"));

const tarea = (extra = {}) => ({ titulo: { es: "Horarios", en: "Hours" }, enlace: "/horarios", ...extra });
const lanzador = (extra = {}) => ({ id: "tareas", contenedor: "#ancla", componente: "lanzador", datos: [tarea()], ...extra });
const conVistas = (...vistas) => sanearTema({ features: { vista: vistas } });

test("el kit de metro.cl pasa entero, sin rechazos", () => {
  assert.deepEqual(sanearTema(METRO), { features: METRO.features, rechazos: [] });
});

test("sin tema o sin features: nada que montar y nada que reclamar", () => {
  assert.deepEqual(sanearTema(undefined), { features: {}, rechazos: [] });
  assert.deepEqual(sanearTema({ nombre: "x" }), { features: {}, rechazos: [] });
  assert.deepEqual(sanearTema([1]).features, {});
  assert.deepEqual(sanearTema({ features: [] }).features, {});
});

test("enlaces que salen del sitio descartan la vista", () => {
  for (const enlace of ["//evil.com/x", "/\\evil.com", "https://otro.cl", "/\t/evil.com", "javascript:alert(1)", "/a?javascript:x", "horarios"]) {
    const { features, rechazos } = conVistas(lanzador({ datos: [tarea({ enlace })] }));
    assert.deepEqual(features, {}, enlace);
    assert.equal(rechazos.length, 1, enlace);
    assert.match(rechazos[0], /^vista "tareas"\.datos\[0\]\.enlace: .*se descarta la vista/, enlace);
  }
});

test("rutas y destino también deben ser rutas relativas", () => {
  assert.deepEqual(conVistas(lanzador({ rutas: ["//evil.com"] })).features, {});
  const atajo = METRO.features.vista[0];
  const { features, rechazos } = conVistas({ ...atajo, opciones: { ...atajo.opciones, destino: "https://otro.cl/buscar" } });
  assert.deepEqual(features, {});
  assert.match(rechazos[0], /opciones\.destino/);
});

test("componente desconocido o feature desconocida se descartan con su razón", () => {
  const { features, rechazos } = sanearTema({
    features: { vista: [lanzador(), lanzador({ id: "otra", componente: "iframe" })], "modo-foco": {}, aviso: { texto: "hola" } },
  });
  assert.deepEqual(features, { vista: [lanzador()], "modo-foco": {} });
  assert.deepEqual(rechazos, ['vista "otra": componente desconocido "iframe" (se descarta la vista)', 'feature desconocida "aviso"']);
});

test("cadenas largas, selectores largos y textos que no son string o { es, en }", () => {
  const largo = "a".repeat(MAX_CADENA + 1);
  assert.deepEqual(conVistas(lanzador({ datos: [tarea({ detalle: largo })] })).features, {});
  assert.deepEqual(conVistas(lanzador({ contenedor: `#${largo}` })).features, {});
  assert.deepEqual(conVistas(lanzador({ datos: [tarea({ titulo: 42 })] })).features, {});
  assert.deepEqual(conVistas(lanzador({ datos: [tarea({ titulo: { es: ["x"] } })] })).features, {});
  assert.deepEqual(conVistas(lanzador({ datos: [tarea({ titulo: {} })] })).features, {});
});

test("topes: vistas, items y campos", () => {
  const vistas = Array.from({ length: MAX_VISTAS + 1 }, (_, i) => lanzador({ id: `v${i}` }));
  const { features, rechazos } = conVistas(...vistas);
  assert.equal(features.vista.length, MAX_VISTAS);
  assert.deepEqual(rechazos, [`vista "v${MAX_VISTAS}": más de ${MAX_VISTAS} vistas`]);

  assert.deepEqual(conVistas(lanzador({ datos: Array.from({ length: MAX_ITEMS + 1 }, () => tarea()) })).features, {});

  const campos = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`c${i}`, { selector: "a" }]));
  assert.deepEqual(conVistas(lanzador({ datos: undefined, items: "li", campos })).features, {});
});

test("las imágenes y las claves desconocidas se descartan solas; la vista sigue", () => {
  const { features, rechazos } = conVistas(
    lanzador({ datos: [tarea({ imagen: "https://rastreo.com/pixel.gif" })], extra: 1 }),
    { id: "lista", contenedor: "ul", componente: "cartelera", items: "li", campos: { titulo: { selector: "a" }, enlace: { selector: "a", atributo: "href" }, imagen: { selector: "img", atributo: "src" } } },
  );
  assert.deepEqual(features.vista[0], lanzador());
  assert.deepEqual(Object.keys(features.vista[1].campos), ["titulo", "enlace"]);
  assert.equal(rechazos.length, 3);
  assert.match(rechazos.join("\n"), /imagen.*no se aceptan/);
  assert.match(rechazos.join("\n"), /se descarta `extra`/);
});

test("patrón: largo, cuantificadores anidados o inválido descartan la vista; uno sano pasa", () => {
  const plantilla = (patron) => lanzador({ datos: undefined, items: "li", campos: { titulo: { selector: "a", patron } } });
  for (const patron of ["(a+)+$", "([a-z]*)*", "(", "a".repeat(MAX_CADENA + 1)]) {
    assert.deepEqual(conVistas(plantilla(patron)).features, {}, patron);
  }
  assert.equal(conVistas(plantilla("v=([\\w-]+)")).features.vista.length, 1);
});

test("un enlace armado con formato debe quedar en el sitio", () => {
  const plantilla = (formato) =>
    lanzador({ datos: undefined, items: "li", campos: { titulo: { selector: "a" }, enlace: { selector: "a", atributo: "href", patron: "v=(\\w+)", formato } } });
  assert.deepEqual(conVistas(plantilla("https://evil.com/$1")).features, {});
  assert.equal(conVistas(plantilla("/watch?v=$1")).features.vista.length, 1);
});

test("una vista sin datos ni plantilla, sin id, con id repetido o un atajo sin destino se descarta", () => {
  assert.deepEqual(conVistas(lanzador({ datos: undefined })).features, {});
  assert.deepEqual(conVistas(lanzador({ id: undefined })).features, {});
  assert.equal(conVistas(lanzador(), lanzador()).features.vista.length, 1);
  const atajo = METRO.features.vista[0];
  assert.deepEqual(conVistas({ ...atajo, opciones: { textos: atajo.opciones.textos } }).features, {});
});

test("un campo __proto__ no cambia el prototipo de lo saneado", () => {
  const campos = JSON.parse('{"titulo": {"selector": "a"}, "__proto__": {"selector": "b"}}');
  const { features } = conVistas(lanzador({ datos: undefined, items: "li", campos }));
  const saneados = features.vista[0].campos;
  assert.equal(Object.getPrototypeOf(saneados), Object.prototype);
  assert.deepEqual(Object.keys(saneados), ["titulo", "__proto__"]);
});

test("modo-foco: rutas relativas y ancla; si no cumple, se descarta la feature", () => {
  assert.deepEqual(sanearTema({ features: { "modo-foco": { rutas: ["/"], ancla: "#menu" } } }).features, {
    "modo-foco": { rutas: ["/"], ancla: "#menu" },
  });
  const { features, rechazos } = sanearTema({ features: { "modo-foco": { rutas: ["//evil.com"] } } });
  assert.deepEqual(features, {});
  assert.match(rechazos[0], /^modo-foco\.rutas\[0\]: .*se descarta la feature/);
});
