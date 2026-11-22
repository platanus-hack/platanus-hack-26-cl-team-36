// Tests del saneamiento de las features que llegan de la API (src/background/tema-remoto.js). El contrato con
// el improver (lo que arma tema_json.py pasa sin rechazos) está en agents/app/web_designer/tests/test_contrato.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_ITEMS, MAX_PALABRAS, MAX_VISTAS, sanearTema, validarVista } from "../src/background/tema-remoto.js";

const METRO = JSON.parse(readFileSync(new URL("fixtures/metro/tema.json", import.meta.url), "utf8"));
const ATAJO = METRO.features.vista.find((v) => v.componente === "atajo");

const tarea = (extra = {}) => ({ titulo: { es: "Horarios", en: "Hours" }, enlace: "/horarios", ...extra });
const lanzador = (extra = {}) => ({ id: "tareas", contenedor: "#ancla", componente: "lanzador", datos: [tarea()], opciones: {}, ...extra });
const conVistas = (...vistas) => sanearTema({ features: { vista: vistas } });
const conOpciones = (opciones) => ({ ...ATAJO, opciones: { ...ATAJO.opciones, ...opciones } });

test("el kit de metro.cl pasa entero, sin rechazos", () => {
  assert.deepEqual(sanearTema(METRO), { features: METRO.features, rechazos: [] });
});

test("sin tema o sin features: nada que montar y nada que reclamar", () => {
  assert.deepEqual(sanearTema(undefined), { features: {}, rechazos: [] });
  assert.deepEqual(sanearTema({ nombre: "x" }), { features: {}, rechazos: [] });
  assert.deepEqual(sanearTema([1]).features, {});
  assert.deepEqual(sanearTema({ features: [] }).features, {});
  assert.deepEqual(sanearTema({ features: { vista: {} } }).rechazos, ["`vista` no es una lista"]);
});

test("un item que no valida se descarta solo y la vista sigue; si no queda ninguno, se va la vista", () => {
  for (const enlace of ["//evil.com/x", "/\\evil.com", "https://otro.cl", "/\t/evil.com", "/con espacio", "/a b", "horarios", "/x\n"]) {
    const { features, rechazos } = conVistas(lanzador({ datos: [tarea(), tarea({ enlace })] }));
    assert.deepEqual(features.vista[0].datos, [tarea()], JSON.stringify(enlace));
    assert.match(rechazos[0], /^vista "tareas", item descartado: datos\[1\]\.enlace/, JSON.stringify(enlace));
  }
  const { features, rechazos } = conVistas(lanzador({ datos: [tarea({ enlace: "//evil.com" })] }));
  assert.deepEqual(features, {});
  assert.match(rechazos.at(-1), /^vista "tareas" descartada: \$\.datos: 0 elementos/);
  assert.equal(conVistas(lanzador({ datos: [tarea({ enlace: "/estación/baquedano" })] })).features.vista.length, 1);
});

test("rutas y destino también deben ser rutas relativas, de hasta 200 caracteres", () => {
  assert.deepEqual(conVistas(lanzador({ rutas: ["//evil.com"] })).features, {});
  const { features, rechazos } = conVistas(conOpciones({ destino: "https://otro.cl/buscar" }));
  assert.deepEqual(features, {});
  assert.match(rechazos[0], /\$\.opciones\.destino/);
  assert.equal(conVistas(conOpciones({ destino: `/${"a".repeat(199)}` })).features.vista.length, 1);
  assert.deepEqual(conVistas(conOpciones({ destino: `/${"a".repeat(200)}` })).features, {});
});

test("componente fuera del kit remoto o feature desconocida se descartan con su razón", () => {
  const { features, rechazos } = sanearTema({
    features: { vista: [lanzador(), lanzador({ id: "otra", componente: "cartelera" })], "modo-foco": {}, aviso: {} },
  });
  assert.deepEqual(features, { vista: [lanzador()] });
  assert.deepEqual(rechazos, ['feature desconocida "modo-foco"', 'feature desconocida "aviso"', 'componente no permitido: "cartelera"']);
});

test("una clave que el esquema no conoce descarta el item o la vista, como en tema_json.py", () => {
  const { features, rechazos } = conVistas(lanzador({ datos: [tarea(), tarea({ imagen: "https://rastreo.com/pixel.gif" })] }));
  assert.deepEqual(features.vista[0].datos, [tarea()]);
  assert.match(rechazos[0], /clave no permitida "imagen"/);
  for (const extra of [{ items: "li" }, { campos: {} }, { accion: { selector: "a" } }, { script: "x" }]) {
    assert.deepEqual(conVistas(lanzador(extra)).features, {}, Object.keys(extra)[0]);
  }
});

test("textos: { es, en } con los dos idiomas y hasta 160 caracteres", () => {
  for (const titulo of ["Horarios", { es: "Horarios" }, { es: "a".repeat(161), en: "b" }, { es: ["x"], en: "y" }]) {
    assert.deepEqual(conVistas(lanzador({ datos: [tarea({ titulo })] })).features, {}, JSON.stringify(titulo));
  }
});

test("topes: vistas, items, fijos e invertir", () => {
  const vistas = Array.from({ length: MAX_VISTAS + 1 }, (_, i) => lanzador({ id: `v${i}` }));
  const { features, rechazos } = conVistas(...vistas);
  assert.equal(features.vista.length, MAX_VISTAS);
  assert.deepEqual(rechazos, [`vista "v${MAX_VISTAS}" descartada: repetida o sobre el máximo de ${MAX_VISTAS}`]);
  assert.deepEqual(conVistas(lanzador({ datos: Array.from({ length: MAX_ITEMS.lanzador + 1 }, () => tarea()) })).features, {});

  const fijos = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, "x"]));
  assert.equal(conVistas(conOpciones({ fijos: fijos(6) })).features.vista.length, 1);
  assert.deepEqual(conVistas(conOpciones({ fijos: fijos(7) })).features, {});
  assert.deepEqual(conVistas(conOpciones({ fijos: { "a b": "x" } })).features, {});
  assert.deepEqual(conVistas(conOpciones({ invertir: ["inicio", "otro"] })).features, {});
});

test("nombres de parámetro: letras, números y _.[]- hasta 40; un \\n final no valida", () => {
  const conNombre = (nombre) => ({ ...ATAJO, opciones: { destino: "/x" }, datos: [{ ...ATAJO.datos[0], nombre }] });
  assert.equal(validarVista(conNombre("q[inicio]"))[0].datos[0].nombre, "q[inicio]");
  for (const nombre of ["inicio\n", "a b", "x".repeat(41), ""]) assert.equal(validarVista(conNombre(nombre))[0], null, JSON.stringify(nombre));
});

test("una vista sin id, con id inválido o repetido, o un atajo sin destino se descarta", () => {
  assert.deepEqual(conVistas(lanzador({ id: undefined })).features, {});
  assert.deepEqual(conVistas(lanzador({ id: "Tareas" })).features, {});
  assert.deepEqual(conVistas(lanzador({ id: "tareas\n" })).features, {});
  assert.equal(conVistas(lanzador(), lanzador()).features.vista.length, 1);
  assert.deepEqual(conVistas({ ...ATAJO, opciones: { textos: ATAJO.opciones.textos } }).features, {});
});

test("claves como __proto__ o constructor no se toman por propiedades del esquema", () => {
  const datos = [JSON.parse('{"titulo": {"es": "a", "en": "b"}, "enlace": "/x", "__proto__": {"x": 1}}'), tarea({ constructor: "x" })];
  const { features } = conVistas(lanzador({ datos: [tarea(), ...datos] }));
  assert.deepEqual(features.vista[0].datos, [tarea()]);
});

test("buscador: hasta 40 tareas con grupo y hasta 12 palabras por idioma", () => {
  const buscador = (datos, opciones = {}) => ({ id: "buscar", contenedor: "body", componente: "buscador", datos, opciones });
  const muchas = Array.from({ length: MAX_ITEMS.buscador }, (_, i) => tarea({ enlace: `/t${i}`, grupo: { es: "Viajes", en: "Trips" } }));
  assert.equal(conVistas(buscador(muchas, { teclas: true, sugeridas: 6 })).features.vista[0].datos.length, MAX_ITEMS.buscador);
  assert.deepEqual(conVistas(buscador([...muchas, tarea()])).features, {});
  const palabras = (n) => ({ es: Array.from({ length: n }, (_, i) => `p${i}`) });
  assert.equal(conVistas(buscador([tarea({ palabras: palabras(MAX_PALABRAS) })])).features.vista.length, 1);
  assert.deepEqual(conVistas(buscador([tarea({ palabras: palabras(MAX_PALABRAS + 1) })])).features, {});
});
