// Distribución de la telaraña radial (diseño §10.5.1 y §9.3) y sus cuentas. Las formas "reales" son copias
// reducidas de las tandas de agents/.runs/ (que no se versionan): wom 07-28 (páginas fusionadas, todo en la
// ruta), dt (intento con error de la herramienta) y sii (títulos inferidos de la URL).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { LIMITE_ANGULAR, distribuir, geometriaRadial, idDeTramoFinal } from "../public/telarana/distribuir.js";
import {
  finalesPorPagina,
  hitosDeRuta,
  intentosPorPagina,
  pasoDeLlegada,
  salidasDePagina,
  totalesDeTerminales,
  vecindario,
} from "../public/telarana/cuentas.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const VIEJA = "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z";
const NUEVA = "demo.cl/visitor/tarea-demo/2026-11-21T11-00-00Z";

const SIN_FINALES = { logrado: 0, fallido: 0, abandonado: 0, error: 0 };
const pagina = (id, extra = {}) => ({ id, esInicio: false, visitas: 1, finales: { ...SIN_FINALES }, ...extra });
const rama = (origen, destino, intentos = 1, extra = {}) => ({ id: `${origen}>${destino}`, origen, destino, intentos, ...extra });

// wom-baja-fibra 2026-11-21_07-28-42: 4 páginas tras fusionar n5 y n6 en n2; los 3 siguen la ruta.
const WOM = {
  paginas: [
    pagina("n1", { esInicio: true, visitas: 3 }),
    pagina("n2", { visitas: 3 }),
    pagina("n3", { visitas: 3 }),
    pagina("n4", { visitas: 3, finales: { ...SIN_FINALES, logrado: 3 } }),
  ],
  ramas: [rama("n1", "n2", 3, { resultado: "mixto" }), rama("n2", "n3", 3, { resultado: "exito" }), rama("n3", "n4", 3, { resultado: "exito" })],
  ruta: { paginas: ["n1", "n2", "n3", "n4"] },
};

// dt-reclamo-despido 2026-11-21_07-28-42: Móvil termina con error de la herramienta en n2.
const DT = {
  paginas: [
    pagina("n1", { esInicio: true, visitas: 3 }),
    pagina("n2", { visitas: 3, finales: { ...SIN_FINALES, error: 1 } }),
    pagina("n3", { visitas: 2, finales: { ...SIN_FINALES, logrado: 2 } }),
  ],
  ramas: [rama("n1", "n2", 3, { resultado: "exito" }), rama("n2", "n3", 2, { resultado: "exito" })],
  ruta: { paginas: ["n1", "n2", "n3"] },
};

const enCelda = (d) => d.estaciones.map((e) => `${e.capa}:${e.fila}`);
const porId = (lista) => new Map(lista.map((x) => [x.id, x]));

test("entrada vacía → salida vacía", () => {
  for (const entrada of [undefined, null, {}, { paginas: [], ramas: [], ruta: null }]) {
    const d = distribuir(entrada);
    assert.deepEqual(d, { estaciones: [], terminales: [], tramos: [], tronco: [], troncoEsRuta: false, capas: 0, filaMin: 0, filaMax: 0 });
    const g = geometriaRadial(d);
    assert.equal(g.posiciones.size, 0);
    assert.equal(g.caminos.size, 0);
    assert.deepEqual(g.caja, { x: 0, y: 0, ancho: 0, alto: 0 });
  }
});

test("wom 07-28: un tronco recto con las 4 páginas y una sola terminal «Logrado 3»", () => {
  const d = distribuir(WOM);
  assert.deepEqual(d.tronco, ["n1", "n2", "n3", "n4"]);
  assert.equal(d.troncoEsRuta, true);
  assert.deepEqual(d.estaciones.map((e) => [e.id, e.capa, e.fila, e.tipo, e.hito]), [
    ["n1", 0, 0, "inicio", 0],
    ["n2", 1, 0, "hito", 1],
    ["n3", 2, 0, "hito", 2],
    ["n4", 3, 0, "hito", 3],
  ]);
  assert.deepEqual(d.terminales, [{ id: "fin:logrado", resultado: "logrado", capa: 4, fila: 0, total: 3 }]);
  assert.deepEqual(d.tramos.map((t) => [t.id, t.tipo]), [
    ["n1>n2", "tronco"],
    ["n2>n3", "tronco"],
    ["n3>n4", "tronco"],
    ["n4>fin:logrado", "final"],
  ]);
  assert.equal(d.capas, 4);
  assert.equal(d.filaMin, 0);
  assert.equal(d.filaMax, 0);
  const g = geometriaRadial(d);
  for (const id of ["n1>n2", "n2>n3", "n3>n4"]) assert.match(g.caminos.get(id), /^M[-\d.]+ 0 L[-\d.]+ 0$/, "el tronco es una recta en y = 0");
});

test("dt: el error de la herramienta es una terminal propia (no «Abandonado») con su tramo final", () => {
  const d = distribuir(DT);
  assert.deepEqual(d.terminales.map((t) => [t.id, t.fila, t.total]), [
    ["fin:logrado", 0, 2],
    ["fin:error", 1, 1],
  ]);
  const final = d.tramos.find((t) => t.id === idDeTramoFinal("n2", "error"));
  assert.deepEqual(final, { id: "n2>fin:error", origen: "n2", destino: "fin:error", tipo: "final", intentos: 1, resultado: "error" });
  assert.ok(!d.terminales.some((t) => t.resultado === "abandonado"));
});

test("fixture con vuelta atrás: desvío que vuelve arriba y retroceso tipado", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const d = distribuir(tanda.telarana);
  const estaciones = porId(d.estaciones);
  assert.deepEqual(d.tronco, ["n1", "n2", "n3"]);
  // n4 («Planes») vuelve al inicio: va arriba aunque Móvil falle ahí.
  assert.equal(estaciones.get("n4").capa, 1);
  assert.equal(estaciones.get("n4").fila, -1);
  const tramos = porId(d.tramos);
  assert.equal(tramos.get("n1>n4").tipo, "avance");
  assert.equal(tramos.get("n4>n1").tipo, "retroceso");
  assert.deepEqual(d.terminales.map((t) => [t.resultado, t.fila]), [["logrado", 0], ["fallido", 1]]);
});

test("fixture con ciclo y páginas fusionadas: rama que solo falla abajo y ciclo como retroceso", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const d = distribuir(tanda.telarana);
  const estaciones = porId(d.estaciones);
  // n4 se fusionó en n2 (alias): no hay estación n4.
  assert.ok(!estaciones.has("n4"));
  assert.equal(estaciones.get("n5").fila, 1);
  assert.equal(estaciones.get("n6").fila, 1);
  assert.equal(estaciones.get("n5").capa, 1);
  assert.equal(estaciones.get("n6").capa, 2);
  const tramos = porId(d.tramos);
  assert.equal(tramos.get("n5>n6").tipo, "avance");
  assert.equal(tramos.get("n6>n5").tipo, "retroceso");
  // Error de la herramienta (Móvil en n2) y el fallo de Senior en n5.
  assert.deepEqual(d.terminales.map((t) => [t.resultado, t.fila, t.total]), [["logrado", 0, 2], ["fallido", 1, 1], ["error", 2, 1]]);
});

test("rama que vuelve al tronco va arriba, rama que solo falla va abajo, y no se pisan", () => {
  const d = distribuir({
    paginas: [
      pagina("a", { esInicio: true, visitas: 5 }),
      pagina("b", { visitas: 4 }),
      pagina("c", { visitas: 4, finales: { ...SIN_FINALES, logrado: 3 } }),
      pagina("planes", { visitas: 2 }),
      pagina("roto", { visitas: 1, finales: { ...SIN_FINALES, fallido: 1 } }),
      pagina("roto2", { visitas: 1, finales: { ...SIN_FINALES, abandonado: 1 } }),
    ],
    ramas: [rama("a", "b", 3), rama("b", "c", 3), rama("a", "planes", 2), rama("planes", "c", 1), rama("a", "roto", 1), rama("a", "roto2", 1)],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const estaciones = porId(d.estaciones);
  assert.equal(estaciones.get("planes").fila, -1);
  assert.ok(estaciones.get("roto").fila > 0);
  assert.ok(estaciones.get("roto2").fila > 0);
  const celdas = enCelda(d);
  assert.equal(new Set(celdas).size, celdas.length, "dos estaciones no comparten (capa, fila)");
  // Mismo número de visitas y baricentro: desempata el id.
  assert.equal(estaciones.get("roto").fila, 1);
  assert.equal(estaciones.get("roto2").fila, 2);
  assert.deepEqual(d.terminales.map((t) => [t.resultado, t.fila]), [["logrado", 0], ["fallido", 1], ["abandonado", 2]]);
  // planes (capa 1) → c (capa 2): avance; el tronco no se mueve.
  assert.equal(porId(d.tramos).get("planes>c").tipo, "avance");
  assert.deepEqual(d.tronco, ["a", "b", "c"]);
});

test("rama lateral a la misma capa que el tronco se dibuja como avance, no como vuelta atrás", () => {
  const d = distribuir({
    paginas: [pagina("a", { esInicio: true }), pagina("b"), pagina("c"), pagina("x")],
    ramas: [rama("a", "b"), rama("b", "c"), rama("a", "x"), rama("x", "b")],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const tramos = porId(d.tramos);
  assert.equal(porId(d.estaciones).get("x").capa, 1);
  assert.equal(tramos.get("x>b").tipo, "avance");
});

test("sin ruta: el tronco es el camino más transitado y troncoEsRuta es false", () => {
  const d = distribuir({
    paginas: [pagina("i", { esInicio: true }), pagina("p"), pagina("q"), pagina("r")],
    ramas: [rama("i", "p", 1), rama("i", "q", 4), rama("q", "r", 2), rama("q", "i", 3)],
    ruta: null,
  });
  assert.deepEqual(d.tronco, ["i", "q", "r"]);
  assert.equal(d.troncoEsRuta, false);
  const estaciones = porId(d.estaciones);
  assert.equal(estaciones.get("i").tipo, "inicio");
  assert.equal(estaciones.get("q").tipo, "pagina");
  assert.equal(estaciones.get("q").hito, null);
  assert.equal(porId(d.tramos).get("q>i").tipo, "retroceso");
});

test("empate en el camino más transitado: decide el id", () => {
  const d = distribuir({
    paginas: [pagina("i", { esInicio: true }), pagina("b"), pagina("a")],
    ramas: [rama("i", "b", 2), rama("i", "a", 2)],
    ruta: null,
  });
  assert.deepEqual(d.tronco, ["i", "a"]);
});

test("páginas sin camino desde el inicio van a una capa nueva; ramas a páginas desconocidas se ignoran", () => {
  const d = distribuir({
    paginas: [pagina("i", { esInicio: true }), pagina("j"), pagina("suelta")],
    ramas: [rama("i", "j"), rama("j", "fantasma"), rama("j", "j")],
    ruta: { paginas: ["i", "j"] },
  });
  assert.equal(porId(d.estaciones).get("suelta").capa, 2);
  assert.deepEqual(d.tramos.map((t) => t.id), ["i>j"]);
});

test("determinista con la entrada en otro orden", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const base = distribuir(tanda.telarana);
  const revuelta = {
    paginas: [...tanda.telarana.paginas].reverse(),
    ramas: [...tanda.telarana.ramas].sort(() => 0.5 - Math.random()).reverse(),
    ruta: tanda.telarana.ruta,
  };
  assert.deepEqual(distribuir(revuelta), base);
  assert.deepEqual([...geometriaRadial(distribuir(revuelta)).caminos], [...geometriaRadial(base).caminos]);
});

test("cuentas: finales, terminales y hitos de la ruta", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const todos = totalesDeTerminales(finalesPorPagina(tanda));
  assert.deepEqual(todos, { logrado: 2, fallido: 1, abandonado: 0, sin_medir: 0, error: 1 });
  // Los hitos cuentan solo intentos válidos: el error de Móvil no cuenta.
  assert.deepEqual(hitosDeRuta(tanda), [
    { pagina: "n1", n: 3, de: 3 },
    { pagina: "n2", n: 2, de: 3 },
    { pagina: "n3", n: 2, de: 3 },
  ]);
});

test("vecindario: la estación, sus tramos y sus vecinas", () => {
  const d = distribuir(DT);
  assert.deepEqual([...vecindario(d, "n2")].sort(), ["fin:error", "n1", "n1>n2", "n2", "n2>fin:error", "n2>n3", "n3"]);
});

test("intentos por página, paso de llegada y salidas", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const hurried = tanda.intentos.find((i) => i.id === "hurried");
  assert.equal(pasoDeLlegada(hurried, "nada"), null);
  const enPlanes = intentosPorPagina(tanda, "n4").map(({ intento, paso }) => [intento.id, paso]);
  assert.deepEqual(enPlanes.map(([id]) => id).sort(), ["hurried", "mobile"]);
  for (const [, paso] of enPlanes) assert.ok(Number.isInteger(paso) && paso >= 1);
  assert.deepEqual(salidasDePagina(tanda, "n1").map((r) => r.id), ["n1>n2", "n1>n4"].sort((a, b) => {
    const ra = tanda.telarana.ramas.find((r) => r.id === a);
    const rb = tanda.telarana.ramas.find((r) => r.id === b);
    return rb.intentos - ra.intentos || a.localeCompare(b);
  }));
});

// ── Telaraña radial ─────────────────────────────────────────────────────

test("radial dt: inicio al centro, un anillo por capa, la ruta sobre el eje y el error fuera del eje", () => {
  const g = geometriaRadial(distribuir(DT), { paso: 190 });
  assert.deepEqual(g.posiciones.get("n1"), { x: 0, y: 0 });
  assert.deepEqual(g.posiciones.get("n2"), { x: 190, y: 0 });
  assert.deepEqual(g.posiciones.get("n3"), { x: 380, y: 0 });
  assert.deepEqual(g.anillos.map((a) => [a.capa, a.radio]), [[1, 190], [2, 380], [3, 570]]);
  // Logrado sigue el eje un anillo más allá de n3; el error cae junto a n2, en el anillo siguiente y abajo del eje.
  assert.deepEqual(g.posiciones.get("fin:logrado"), { x: 570, y: 0 });
  const error = g.polares.get("fin:error");
  assert.equal(error.anillo, 2);
  assert.ok(error.angulo > 0 && g.posiciones.get("fin:error").y > 0);
  for (const id of ["n1>n2", "n2>n3", "n3>fin:logrado"]) assert.match(g.caminos.get(id), /^M[\d.]+ 0 L[\d.]+ 0$/, "el eje es recto");
  assert.equal(g.rayos.length, 16);
  assert.equal(geometriaRadial(distribuir(DT), { rayos: 0, caida: 0 }).rayos.length, 0, "como en la pantalla: sin rayos");
  assert.ok(g.caja.x < -190 && g.caja.y < -190, "la caja incluye el primer anillo entero");
  // Eje hacia abajo: x e y se intercambian.
  const abajo = geometriaRadial(distribuir(DT), { eje: "abajo" });
  assert.deepEqual(abajo.posiciones.get("n3"), { x: 0, y: 380 });
});

test("radial: desvíos repartidos por ángulo sin pisarse, arriba los que vuelven y abajo los que fallan", () => {
  const d = distribuir({
    paginas: [
      pagina("a", { esInicio: true, visitas: 5 }),
      pagina("b", { visitas: 4 }),
      pagina("c", { visitas: 4, finales: { ...SIN_FINALES, logrado: 3 } }),
      pagina("planes", { visitas: 2 }),
      ...["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => pagina(id, { finales: { ...SIN_FINALES, fallido: 1 } })),
    ],
    ramas: [rama("a", "b", 3), rama("b", "c", 3), rama("a", "planes", 2), rama("planes", "c", 1), ...["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => rama("a", id))],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const espacio = 150;
  const g = geometriaRadial(d, { espacio });
  assert.ok(g.polares.get("planes").angulo < 0, "planes vuelve a la ruta: arriba");
  for (const id of ["r1", "r2", "r3", "r4", "r5", "r6"]) assert.ok(g.polares.get(id).angulo > 0, `${id} solo falla: abajo`);
  // Ningún par de nodos del mismo anillo queda a menos de `espacio` (medido sobre el arco).
  const porAnillo = new Map();
  for (const [id, p] of g.polares) if (p.anillo) porAnillo.set(p.anillo, [...(porAnillo.get(p.anillo) ?? []), { id, ...p }]);
  for (const [anillo, nodos] of porAnillo) {
    const radio = g.anillos.find((a) => a.capa === anillo).radio;
    for (const n of nodos) assert.ok(Math.abs(n.angulo) <= LIMITE_ANGULAR + 1e-9);
    for (let i = 0; i < nodos.length; i += 1)
      for (let j = i + 1; j < nodos.length; j += 1) assert.ok(Math.abs(nodos[i].angulo - nodos[j].angulo) * radio >= espacio - 0.5, `${nodos[i].id} y ${nodos[j].id}`);
  }
  // El anillo 1 creció para que quepan los seis desvíos de un lado.
  assert.ok(g.anillos[0].radio > 190);
  assert.ok(g.anillos.every((a, i) => i === 0 || a.radio > g.anillos[i - 1].radio), "los radios crecen hacia afuera");
});

test("radial: vueltas atrás como arcos, ciclos sin romperse y determinista", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const g = geometriaRadial(distribuir(tanda.telarana));
  const vuelta = g.caminos.get("n6>n5");
  assert.ok(vuelta && vuelta.split("L").length > 3, "el retroceso es una curva, no una recta");
  for (const [, d] of g.caminos) assert.doesNotMatch(d, /NaN|Infinity/);
  for (const [, p] of g.posiciones) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  const ciclo = geometriaRadial(distribuir({ paginas: [pagina("i", { esInicio: true }), pagina("j"), pagina("k")], ramas: [rama("i", "j"), rama("j", "k"), rama("k", "i"), rama("k", "j")], ruta: null }));
  assert.equal(ciclo.posiciones.size, 3);
  assert.deepEqual([...geometriaRadial(distribuir(tanda.telarana)).caminos], [...g.caminos]);
  assert.equal(geometriaRadial(distribuir({})).posiciones.size, 0);
});
