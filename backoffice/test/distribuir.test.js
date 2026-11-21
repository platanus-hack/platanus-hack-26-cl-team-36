// Distribución de la telaraña (diseño §10.5.1 y §9.3) y cuentas por perfil. Las formas "reales" son copias
// reducidas de las tandas de agents/.runs/ (que no se versionan): wom 07-28 (páginas fusionadas, todo en la
// ruta), dt (intento con error de la herramienta) y sii (títulos inferidos de la URL).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { distribuir, geometria, idDeTerminal, idDeTramoFinal } from "../public/telarana/distribuir.js";
import {
  activosDePerfil,
  duracionDePaso,
  finalesPorPagina,
  hitosDeRuta,
  intentosPorPagina,
  pasoDeLlegada,
  perfilVecino,
  recorridoDeHistoria,
  salidasDePagina,
  totalesDeTerminales,
  vecindario,
} from "../public/telarana/cuentas.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const VIEJA = "tarea-demo/2026-11-21_10-00-00";
const NUEVA = "tarea-demo/2026-11-21_11-00-00";

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
    const g = geometria(d);
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
  const g = geometria(d);
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

test("fixture con vuelta atrás: desvío que vuelve arriba, retroceso tipado y arco sobre la fila más alta", async () => {
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
  const g = geometria(d);
  // Arco: los dos puntos de control a (filaMin − 0.8)·altoFila = −1.8·96.
  assert.equal(g.caminos.get("n4>n1"), "M220 -96 C220 -172.8, 0 -172.8, 0 0");
  assert.ok(g.caja.y <= -172.8 - 60, "la caja incluye el arco y el margen");
});

test("fixture con ciclo y páginas fusionadas: rama que solo falla abajo, ciclo como retroceso por debajo", async () => {
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
  const g = geometria(d);
  // Los dos extremos están bajo el tronco: el arco va por debajo de la fila más baja (filaMax + 0.8).
  const yA = (d.filaMax + 0.8) * 96;
  assert.equal(g.caminos.get("n6>n5"), `M440 96 C440 ${Math.round(yA * 10) / 10}, 220 ${Math.round(yA * 10) / 10}, 220 96`);
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
  const g = geometria(d);
  assert.match(g.caminos.get("x>b"), /^M220 -96 C308 -96, 308 0, 220 0$/);
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
  assert.deepEqual([...geometria(distribuir(revuelta)).caminos], [...geometria(base).caminos]);
});

test("geometría: horizontal x = capa·220, y = fila·96; vertical intercambia los ejes", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const d = distribuir(tanda.telarana);
  const h = geometria(d);
  const v = geometria(d, { orientacion: "vertical" });
  assert.deepEqual(h.posiciones.get("n4"), { x: 220, y: -96 });
  assert.deepEqual(v.posiciones.get("n4"), { x: -150, y: 120 });
  assert.deepEqual(h.posiciones.get(idDeTerminal("logrado")), { x: 3 * 220, y: 0 });
  assert.deepEqual(v.posiciones.get(idDeTerminal("logrado")), { x: 0, y: 3 * 120 });
  // En vertical el tronco baja recto y el arco de vuelta va a la izquierda.
  assert.match(v.caminos.get("n1>n2"), /^M0 0 L0 120$/);
  assert.match(v.caminos.get("n4>n1"), /^M-150 120 C-270 120, -270 0, 0 0$/);
  // Avance: cúbica horizontal con los controles en el punto medio.
  assert.equal(h.caminos.get("n1>n4"), "M0 0 C110 0, 110 -96, 220 -96");
  assert.equal(v.caminos.get("n1>n4"), "M0 0 C0 60, -150 60, -150 120");
  for (const caja of [h.caja, v.caja]) for (const valor of Object.values(caja)) assert.equal(valor, Math.round(valor * 10) / 10);
});

test("cuentas por perfil: finales, terminales, activos y hitos de la ruta", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const todos = totalesDeTerminales(finalesPorPagina(tanda));
  assert.deepEqual(todos, { logrado: 2, fallido: 1, abandonado: 0, error: 1 });
  const movil = totalesDeTerminales(finalesPorPagina(tanda, "mobile"));
  assert.deepEqual(movil, { logrado: 0, fallido: 0, abandonado: 0, error: 1 });
  assert.equal(activosDePerfil(tanda, null), null);
  const activos = activosDePerfil(tanda, "senior");
  for (const id of ["n1", "n5", "n6", "n1>n5", "n5>n6", "n6>n5", "n5>fin:fallido", "fin:fallido"]) assert.ok(activos.has(id), id);
  assert.ok(!activos.has("n2") && !activos.has("fin:logrado"));
  // Los hitos cuentan solo intentos válidos: el error de Móvil no cuenta.
  assert.deepEqual(hitosDeRuta(tanda), [
    { pagina: "n1", n: 3, de: 3 },
    { pagina: "n2", n: 2, de: 3 },
    { pagina: "n3", n: 2, de: 3 },
  ]);
  assert.deepEqual(hitosDeRuta(tanda, "mobile"), [
    { pagina: "n1", n: 0, de: 0 },
    { pagina: "n2", n: 0, de: 0 },
    { pagina: "n3", n: 0, de: 0 },
  ]);
});

test("vecindario: la estación, sus tramos y sus vecinas, dentro del filtro", () => {
  const d = distribuir(DT);
  assert.deepEqual([...vecindario(d, "n2")].sort(), ["fin:error", "n1", "n1>n2", "n2", "n2>fin:error", "n2>n3", "n3"]);
  const soloError = new Set(["n2>fin:error"]);
  assert.deepEqual([...vecindario(d, "n2", soloError)].sort(), ["fin:error", "n2", "n2>fin:error"]);
});

test("intentos por página, paso de llegada y salidas", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const hurried = tanda.intentos.find((i) => i.id === "hurried");
  assert.equal(pasoDeLlegada(hurried, "nada"), null);
  const enPlanes = intentosPorPagina(tanda, "n4").map(({ intento, paso }) => [intento.id, paso]);
  assert.deepEqual(enPlanes.map(([id]) => id).sort(), ["hurried", "mobile"]);
  for (const [, paso] of enPlanes) assert.ok(Number.isInteger(paso) && paso >= 1);
  assert.deepEqual(intentosPorPagina(tanda, "n4", "first_time"), []);
  assert.deepEqual(salidasDePagina(tanda, "n1").map((r) => r.id), ["n1>n2", "n1>n4"].sort((a, b) => {
    const ra = tanda.telarana.ramas.find((r) => r.id === a);
    const rb = tanda.telarana.ramas.find((r) => r.id === b);
    return rb.intentos - ra.intentos || a.localeCompare(b);
  }));
  assert.deepEqual(salidasDePagina(tanda, "n1", "mobile").map((r) => r.id), ["n1>n4"]);
});

test("historia: un paso por paso del intento, tramos al cambiar de página y el final", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const hurried = tanda.intentos.find((i) => i.id === "hurried");
  const { pasos, ids } = recorridoDeHistoria(hurried);
  assert.equal(pasos.length, hurried.pasos.length);
  assert.ok(pasos.every((paso, i) => paso.numero === hurried.pasos[i].numero));
  for (const id of ["n1", "n4", "n2", "n3", "n1>n4", "n4>n1", "n1>n2", "n2>n3", "n3>fin:logrado", "fin:logrado"]) assert.ok(ids.has(id), id);
  const cambios = pasos.filter((paso) => paso.tramo).map((paso) => paso.tramo);
  assert.deepEqual(cambios, ["n1>n4", "n4>n1", "n1>n2", "n2>n3"]);
  // Un intento con error de la herramienta termina en la terminal de error.
  const nueva = await leerTanda(RAIZ, NUEVA);
  const movil = nueva.intentos.find((i) => i.id === "mobile");
  assert.ok(recorridoDeHistoria(movil).ids.has("fin:error"));
});

test("perfil vecino da la vuelta pasando por «todos»; duración de un paso acotada", () => {
  const perfiles = ["a", "b"];
  assert.equal(perfilVecino(perfiles, null, 1), "a");
  assert.equal(perfilVecino(perfiles, "b", 1), null);
  assert.equal(perfilVecino(perfiles, null, -1), "b");
  assert.equal(perfilVecino(perfiles, "desconocido", 1), "a");
  assert.equal(duracionDePaso({ duracion: 0.2 }), 400);
  assert.equal(duracionDePaso({ duracion: 3 }), 1500);
  assert.equal(duracionDePaso({ duracion: 60 }), 2500);
  assert.equal(duracionDePaso({}), 1000);
});
