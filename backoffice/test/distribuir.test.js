// Distribución de la telaraña (diseño §10.5.1 y §9.3) y cuentas por perfil. Las formas "reales" son copias
// reducidas de las tandas de agents/.runs/ (que no se versionan): wom 07-28 (páginas fusionadas, todo en la
// ruta), dt (intento con error de la herramienta) y sii (títulos inferidos de la URL). fixtures/telarana-sii.json es
// la telaraña derivada de una tanda real y densa (sii 16-24-12: 27 páginas, 54 ramas).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { GIRO_MAXIMO, acomodar, arcoDeVuelta, contarCruces, distribuir, geometria, idDeTerminal, idDeTramoFinal, piezasDeAvance } from "../public/telarana/distribuir.js";
import { anchoDeTramo, claseDeTramo } from "../public/telarana/escena.js";
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
const SII = JSON.parse(readFileSync(new URL("./fixtures/telarana-sii.json", import.meta.url), "utf8"));

// Caja de una estación en la pantalla con detalle medio: el punto (18 px) y debajo la etiqueta de hasta 180 px de
// ancho y 3 líneas (de y − 9 a y + 67).
const ANCHO_DE_ETIQUETA = 180;
const cajaDeEstacion = ({ x, y }) => ({ x0: x - ANCHO_DE_ETIQUETA / 2, x1: x + ANCHO_DE_ETIQUETA / 2, y0: y - 9, y1: y + 67 });
const sePisan = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// ── Forma de los tramos (C3-U1): casi rectas ────────────────────────────

/** Las piezas de un camino SVG ("M x y L x y" o "M x y C …, …, x y …") como cúbicas [p, c1, c2, q]. */
function piezasDelCamino(camino) {
  const n = camino.match(/-?[\d.]+/g).map(Number);
  const punto = (i) => ({ x: n[i], y: n[i + 1] });
  if (/^M[^C]+ L[^C]+$/.test(camino)) return [[punto(0), punto(0), punto(n.length - 2), punto(n.length - 2)]];
  assert.match(camino, /^M[^C]+( C[^C]+){1,}$/, `no es un camino de cúbicas: ${camino}`);
  const piezas = [];
  for (let i = 2; i + 5 < n.length; i += 6) piezas.push([piezas.at(-1)?.[3] ?? punto(0), punto(i), punto(i + 2), punto(i + 4)]);
  return piezas;
}
const enCubica = ([p, c1, c2, q], t) => {
  const u = 1 - t;
  return { x: u ** 3 * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * q.x, y: u ** 3 * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * q.y };
};
const grados = (dx, dy) => (Math.atan2(dy, dx) * 180) / Math.PI;
/**
 * Lo que pidió el usuario para cada pieza de un avance: en sus dos extremos la tangente se aparta a lo más 15° de la
 * recta entre ellos, y la curva no se aleja de esa recta más de un 8 % de su largo. → { angulo, desvio } (el peor).
 */
function cuantoSeDobla(pieza) {
  const [p, c1, c2, q] = pieza;
  const largo = Math.hypot(q.x - p.x, q.y - p.y);
  const recta = grados(q.x - p.x, q.y - p.y);
  const sale = c1.x === p.x && c1.y === p.y ? recta : grados(c1.x - p.x, c1.y - p.y);
  const llega = c2.x === q.x && c2.y === q.y ? recta : grados(q.x - c2.x, q.y - c2.y);
  let desvio = 0;
  for (let k = 1; k < 40; k += 1) {
    const { x, y } = enCubica(pieza, k / 40);
    desvio = Math.max(desvio, Math.abs((q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x)) / largo);
  }
  return { angulo: Math.max(Math.abs(sale - recta), Math.abs(llega - recta)), desvio: desvio / largo };
}
function comprobarCasiRecto(camino, nombre) {
  for (const pieza of piezasDelCamino(camino)) {
    const { angulo, desvio } = cuantoSeDobla(pieza);
    assert.ok(angulo <= 15, `${nombre}: la tangente se aparta ${angulo.toFixed(1)}° de la recta (${camino})`);
    assert.ok(desvio <= 0.08, `${nombre}: se aleja ${(desvio * 100).toFixed(1)} % de la recta (${camino})`);
  }
}
/** Cuánto se sale un recorrido (en px) por encima o por debajo de la altura de sus dos extremos. */
const salidaVertical = (puntos) => {
  const [a, b] = [puntos[0], puntos.at(-1)];
  const ys = puntos.map((p) => p.y);
  return Math.max(0, Math.max(...ys) - Math.max(a.y, b.y), Math.min(a.y, b.y) - Math.min(...ys));
};

/** Las propiedades del grafo por columnas que pide el diseño, sobre cualquier distribución. */
function comprobarColumnas(d, g, nombre, altoFila = 96) {
  const xDe = (id) => g.posiciones.get(id).x;
  const inicio = d.estaciones.find((e) => e.tipo === "inicio");
  const otras = d.estaciones.filter((e) => e !== inicio);
  for (const e of otras) assert.ok(xDe(inicio.id) < xDe(e.id), `${nombre}: el inicio queda solo a la izquierda (${e.id})`);
  const xMaxPaginas = Math.max(...d.estaciones.map((e) => xDe(e.id)));
  if (d.troncoEsRuta) assert.equal(xDe(d.tronco.at(-1)), xMaxPaginas, `${nombre}: la meta va en la columna de más a la derecha`);
  for (const terminal of d.terminales) assert.ok(xDe(terminal.id) > xMaxPaginas, `${nombre}: ${terminal.id} a la derecha de todas las páginas`);
  for (const tramo of d.tramos) {
    const [a, b] = [g.posiciones.get(tramo.origen), g.posiciones.get(tramo.destino)];
    if (tramo.tipo === "tronco" || tramo.tipo === "avance" || tramo.tipo === "final") assert.ok(a.x < b.x, `${nombre}: ${tramo.id} (${tramo.tipo}) va de izquierda a derecha`);
    if (tramo.tipo === "lateral") assert.equal(a.x, b.x, `${nombre}: ${tramo.id} lateral en la misma columna`);
    if (tramo.tipo === "retroceso") assert.ok(a.x > b.x, `${nombre}: ${tramo.id} vuelve hacia la izquierda`);
  }
  // El tronco es una fila recta.
  for (const id of d.tronco) assert.equal(g.posiciones.get(id).y, 0, `${nombre}: ${id} del tronco en y = 0`);
  // Ninguna etiqueta pisa a otra.
  const cajas = d.estaciones.map((e) => [e.id, cajaDeEstacion(g.posiciones.get(e.id))]);
  for (let i = 0; i < cajas.length; i += 1)
    for (let j = i + 1; j < cajas.length; j += 1) assert.ok(!sePisan(cajas[i][1], cajas[j][1]), `${nombre}: ${cajas[i][0]} y ${cajas[j][0]} se pisan`);
  // Los tramos hacia la derecha son casi rectos (pieza por pieza); las vueltas atrás y los pasos laterales, arcos bajos
  // que no se salen más de 0.6 filas de la altura de sus extremos.
  for (const tramo of d.tramos) {
    if (tramo.tipo === "retroceso" || tramo.tipo === "lateral") {
      const salida = salidaVertical(g.recorridos.get(tramo.id));
      assert.ok(salida <= 0.6 * altoFila, `${nombre}: ${tramo.id} se sale ${salida} px`);
    } else comprobarCasiRecto(g.caminos.get(tramo.id), `${nombre}: ${tramo.id}`);
  }
}

test("entrada vacía → salida vacía", () => {
  for (const entrada of [undefined, null, {}, { paginas: [], ramas: [], ruta: null }]) {
    const d = distribuir(entrada);
    assert.deepEqual(d, { estaciones: [], terminales: [], tramos: [], tronco: [], troncoEsRuta: false, capas: 0, filaMin: 0, filaMax: 0 });
    const g = geometria(d);
    assert.equal(g.posiciones.size, 0);
    assert.equal(g.caminos.size, 0);
    assert.deepEqual(g.caja, { x: 0, y: 0, ancho: 0, alto: 0 });
    assert.equal(contarCruces(d, g), 0);
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
  for (const id of ["n1>n2", "n2>n3", "n3>n4", "n4>fin:logrado"]) assert.match(g.caminos.get(id), /^M[-\d.]+ 0 L[-\d.]+ 0$/, "el tronco es una recta en y = 0");
  comprobarColumnas(d, g, "wom");
});

test("dt: el error de la herramienta es una terminal propia (no «Abandonado») con su tramo final", () => {
  const d = distribuir(DT);
  assert.deepEqual(d.terminales.map((t) => [t.id, t.capa, t.total]), [
    ["fin:logrado", 3, 2],
    ["fin:error", 3, 1],
  ]);
  assert.equal(d.terminales[0].fila, 0, "Logrado sigue la fila de la ruta");
  assert.ok(d.terminales[1].fila >= 0.5, "Error, separado de Logrado");
  const final = d.tramos.find((t) => t.id === idDeTramoFinal("n2", "error"));
  assert.deepEqual({ ...final, escalas: final.escalas.map((e) => e.capa) }, { id: "n2>fin:error", origen: "n2", destino: "fin:error", tipo: "final", intentos: 1, resultado: "error", escalas: [2] });
  assert.ok(!d.terminales.some((t) => t.resultado === "abandonado"));
  comprobarColumnas(d, geometria(d), "dt");
});

test("fixture con vuelta atrás: la vuelta es un arco bajo de n4 a n1, hacia afuera del tronco", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const d = distribuir(tanda.telarana);
  const estaciones = porId(d.estaciones);
  assert.deepEqual(d.tronco, ["n1", "n2", "n3"]);
  assert.equal(estaciones.get("n4").capa, 1);
  assert.notEqual(estaciones.get("n4").fila, 0, "n4 no pisa el tronco");
  const tramos = porId(d.tramos);
  assert.equal(tramos.get("n1>n4").tipo, "avance");
  assert.equal(tramos.get("n4>n1").tipo, "retroceso");
  const g = geometria(d);
  // Una sola cúbica de n4 a n1 que se sale hacia afuera del tronco (del lado de n4) a lo más 0.375 filas.
  const n4 = g.posiciones.get("n4");
  const [[p, c1, c2, q]] = piezasDelCamino(g.caminos.get("n4>n1"));
  assert.deepEqual([p, q], [n4, { x: 0, y: 0 }]);
  assert.equal(Math.sign(c1.y - n4.y), Math.sign(n4.y), "hacia afuera del tronco");
  assert.equal(c1.y, c2.y);
  const salida = salidaVertical(g.recorridos.get("n4>n1"));
  assert.ok(salida > 0 && salida <= 0.375 * 96 + 0.1, `se sale ${salida}`);
  comprobarColumnas(d, g, "vieja");
});

test("fixture con ciclo y páginas fusionadas: ciclo como retroceso y terminales a la derecha", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  const d = distribuir(tanda.telarana);
  const estaciones = porId(d.estaciones);
  // n4 se fusionó en n2 (alias): no hay estación n4.
  assert.ok(!estaciones.has("n4"));
  assert.equal(estaciones.get("n5").capa, 1);
  assert.equal(estaciones.get("n6").capa, 2);
  const tramos = porId(d.tramos);
  assert.equal(tramos.get("n5>n6").tipo, "avance");
  assert.equal(tramos.get("n6>n5").tipo, "retroceso");
  // Error de la herramienta (Móvil en n2) y el fallo de Senior en n5.
  assert.deepEqual(d.terminales.map((t) => [t.resultado, t.total]), [["logrado", 2], ["fallido", 1], ["error", 1]]);
  comprobarColumnas(d, geometria(d), "nueva");
});

test("callejones sin salida junto a la página de la que salieron, sin compartir lugar", () => {
  const d = distribuir({
    paginas: [
      pagina("a", { esInicio: true, visitas: 5 }),
      pagina("b", { visitas: 4 }),
      pagina("c", { visitas: 4, finales: { ...SIN_FINALES, logrado: 3 } }),
      pagina("planes", { visitas: 2 }),
      pagina("roto", { visitas: 1, finales: { ...SIN_FINALES, fallido: 1 } }),
      pagina("roto2", { visitas: 1, finales: { ...SIN_FINALES, abandonado: 1 } }),
      pagina("hoja", { visitas: 1 }),
    ],
    ramas: [rama("a", "b", 3), rama("b", "c", 3), rama("a", "planes", 2), rama("planes", "c", 1), rama("a", "roto", 1), rama("a", "roto2", 1), rama("planes", "hoja", 1)],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const estaciones = porId(d.estaciones);
  const celdas = enCelda(d);
  assert.equal(new Set(celdas).size, celdas.length, "dos estaciones no comparten (capa, fila)");
  // hoja (callejón) sale de planes: queda una columna a la derecha y a menos de una fila de su altura (la parada de
  // planes → c, que pasa por la misma columna, puede empujarla un poco).
  assert.equal(estaciones.get("hoja").capa, estaciones.get("planes").capa + 1);
  assert.ok(Math.abs(estaciones.get("hoja").fila - estaciones.get("planes").fila) < 1);
  // Dos páginas de la misma columna quedan al menos a una fila.
  for (const x of d.estaciones) for (const y of d.estaciones) if (x !== y && x.capa === y.capa) assert.ok(Math.abs(x.fila - y.fila) >= 1, `${x.id} y ${y.id}`);
  assert.equal(porId(d.tramos).get("planes>c").tipo, "avance");
  assert.deepEqual(d.tronco, ["a", "b", "c"]);
  comprobarColumnas(d, geometria(d), "callejones");
});

test("paso lateral a la misma columna: tipo «lateral», un arco hacia la derecha entre las dos alturas", () => {
  const d = distribuir({
    paginas: [pagina("a", { esInicio: true }), pagina("b"), pagina("c"), pagina("x")],
    ramas: [rama("a", "b"), rama("b", "c"), rama("a", "x"), rama("x", "b")],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const tramos = porId(d.tramos);
  assert.equal(porId(d.estaciones).get("x").capa, 1);
  assert.equal(tramos.get("x>b").tipo, "lateral");
  const g = geometria(d);
  const puntos = g.recorridos.get("x>b");
  const [x, b] = [g.posiciones.get("x"), g.posiciones.get("b")];
  assert.deepEqual([puntos[0], puntos.at(-1)], [x, b]);
  assert.ok(puntos.every((p) => p.x >= 220) && Math.max(...puntos.map((p) => p.x)) > 260, "por la derecha de la columna");
  assert.equal(salidaVertical(puntos), 0, "entre las dos alturas");
  comprobarColumnas(d, g, "lateral");
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
  comprobarColumnas(d, geometria(d), "sin ruta");
});

test("sin ruta: la página donde más lo lograron va a la columna de la meta", () => {
  const d = distribuir({
    paginas: [pagina("i", { esInicio: true }), pagina("p", { finales: { ...SIN_FINALES, logrado: 2 } }), pagina("q"), pagina("r")],
    ramas: [rama("i", "p", 1), rama("i", "q", 4), rama("q", "r", 2)],
    ruta: null,
  });
  const estaciones = porId(d.estaciones);
  assert.equal(estaciones.get("p").capa, 3, "p (capa 1 por pasos) queda a la derecha de r (capa 2)");
  assert.equal(d.capas, 4);
});

test("empate en el camino más transitado: decide el id", () => {
  const d = distribuir({
    paginas: [pagina("i", { esInicio: true }), pagina("b"), pagina("a")],
    ramas: [rama("i", "b", 2), rama("i", "a", 2)],
    ruta: null,
  });
  assert.deepEqual(d.tronco, ["i", "a"]);
});

test("páginas sin camino desde el inicio van a una columna nueva; ramas a páginas desconocidas se ignoran", () => {
  const d = distribuir({
    paginas: [pagina("i", { esInicio: true }), pagina("j"), pagina("suelta")],
    ramas: [rama("i", "j"), rama("j", "fantasma"), rama("j", "j")],
    ruta: { paginas: ["i", "j"] },
  });
  assert.equal(porId(d.estaciones).get("suelta").capa, 2);
  assert.equal(porId(d.estaciones).get("j").capa, 3, "la meta, a la derecha de la página suelta");
  assert.deepEqual(d.tramos.map((t) => t.id), ["i>j"]);
});

test("determinista con la entrada en otro orden", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  for (const entrada of [tanda.telarana, SII]) {
    const base = distribuir(entrada);
    const revuelta = {
      paginas: [...entrada.paginas].reverse(),
      ramas: [...entrada.ramas].sort(() => 0.5 - Math.random()).reverse(),
      ruta: entrada.ruta,
    };
    assert.deepEqual(distribuir(revuelta), base);
    assert.deepEqual([...geometria(distribuir(revuelta)).caminos], [...geometria(base).caminos]);
  }
});

test("geometría: x = capa·220, y = fila·96; un avance entre columnas vecinas es una recta", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const d = distribuir(tanda.telarana);
  const g = geometria(d);
  for (const e of d.estaciones) assert.deepEqual(g.posiciones.get(e.id), { x: e.capa * 220, y: Math.round(e.fila * 96 * 10) / 10 });
  assert.deepEqual(g.posiciones.get(idDeTerminal("logrado")), { x: 3 * 220, y: 0 });
  // n1 → n4 llega a la columna de n2 a otra altura: una recta, aunque pase cerca del nombre de n2.
  const n4 = g.posiciones.get("n4");
  assert.equal(g.posiciones.get("n2").y, 0);
  assert.equal(g.caminos.get("n1>n4"), `M0 0 L220 ${n4.y}`);
  for (const valor of Object.values(g.caja)) assert.equal(valor, Math.round(valor * 10) / 10);
  for (const [, camino] of g.caminos) assert.doesNotMatch(camino, /NaN|Infinity/);
});

test("acomodar: respeta el orden y la separación, y se acerca a lo deseado", () => {
  assert.deepEqual(acomodar([0, 0, 0], [1, 1, 1], [1, 1]), [-1, 0, 1]);
  assert.deepEqual(acomodar([-5, 0, 5], [1, 1, 1], [1, 1]), [-5, 0, 5]);
  // Con un peso enorme, el del medio se queda donde quiere y los otros se apartan.
  const [a, b, c] = acomodar([2, 0, -2], [1, 1e6, 1], [1, 1]);
  assert.ok(Math.abs(b) < 1e-5 && Math.abs(a + 1) < 1e-5 && Math.abs(c - 1) < 1e-5);
});

test("sii 16-24-12 (tanda real, 27 páginas): inicio a la izquierda, meta a la derecha, sin etiquetas pisadas y menos cruces", () => {
  const d = distribuir(SII);
  const g = geometria(d);
  comprobarColumnas(d, g, "sii");
  assert.deepEqual(d.tronco, ["n1", "n12"]);
  assert.equal(porId(d.estaciones).get("n12").capa, d.capas - 1);
  // La ruta n1 → n12 salta columnas: pasa recta (y = 0) por sus paradas.
  const tronco = d.tramos.find((t) => t.tipo === "tronco");
  assert.ok(tronco.escalas.length > 0 && tronco.escalas.every((e) => e.fila === 0));
  assert.match(g.caminos.get(tronco.id), /^M0 0 L[\d.]+ 0$/);
  // Los barridos de baricentro no dejan más cruces que el orden inicial (un solo barrido).
  const unBarrido = distribuir(SII, { barridos: 1 });
  const cruces = contarCruces(d, g);
  const crucesConUnBarrido = contarCruces(unBarrido, geometria(unBarrido));
  assert.ok(cruces <= crucesConUnBarrido, `${cruces} cruces con barridos, ${crucesConUnBarrido} con uno solo`);
  assert.ok(cruces <= 2, `medido al escribir la prueba: 2 (hay ${cruces})`);
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

// ── C3-U1: tramos casi rectos; la distribución, no la forma, evita los nombres ──

test("avance de un tramo: una recta, aunque baje o suba mucho", () => {
  const d = { estaciones: [{ id: "a", capa: 0, fila: 0 }, { id: "b", capa: 1, fila: 3 }], terminales: [], tramos: [{ id: "a>b", origen: "a", destino: "b", tipo: "avance", escalas: [] }] };
  assert.equal(geometria(d).caminos.get("a>b"), "M0 0 L220 288");
  const { angulo, desvio } = cuantoSeDobla(piezasDelCamino("M0 0 L220 288")[0]);
  assert.ok(angulo === 0 && desvio < 1e-9);
});

test("avance con paradas: cada pieza casi recta; en una parada que dobla poco, la tangente es continua", () => {
  const puntos = [{ x: 0, y: 0 }, { x: 220, y: 96 }, { x: 440, y: 288 }];
  const piezas = piezasDeAvance(puntos);
  assert.equal(piezas.length, 2);
  for (const pieza of piezas) {
    const { angulo, desvio } = cuantoSeDobla(pieza);
    assert.ok(angulo <= GIRO_MAXIMO + 1e-9 && desvio <= 0.08, `${angulo}° · ${desvio}`);
  }
  // La parada dobla ~18°: llega y sale con la misma tangente (sin esquina).
  const [[, , entrada, parada], [desde, salida]] = piezas;
  assert.deepEqual(parada, desde);
  const [g1, g2] = [grados(parada.x - entrada.x, parada.y - entrada.y), grados(salida.x - parada.x, salida.y - parada.y)];
  assert.ok(Math.abs(g1 - g2) < 1e-6, `${g1} · ${g2}`);
  // Una parada que dobla mucho (90°): cada pieza sigue casi recta; queda una esquina chica en la parada.
  for (const pieza of piezasDeAvance([{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 440, y: 440 }])) assert.ok(cuantoSeDobla(pieza).angulo <= GIRO_MAXIMO + 1e-9);
  // Y en el dibujo: todo en una recta → una sola recta, sin paradas visibles.
  const d = {
    estaciones: [{ id: "a", capa: 0, fila: 0 }, { id: "b", capa: 3, fila: 3 }],
    terminales: [],
    tramos: [{ id: "a>b", origen: "a", destino: "b", tipo: "avance", escalas: [{ capa: 1, fila: 1 }, { capa: 2, fila: 2 }] }],
  };
  assert.equal(geometria(d).caminos.get("a>b"), "M0 0 L660 288");
});

test("la forma de un tramo no depende de dónde quedan los nombres de otras estaciones", () => {
  // a → b baja dos filas; c está una fila arriba de b, en su misma columna: su nombre queda en el camino. El tramo no
  // se dobla para esquivarlo: es la misma recta con c o sin c, y con cualquier caja de nombre.
  const d = {
    estaciones: [{ id: "a", capa: 0, fila: 0 }, { id: "c", capa: 1, fila: 1 }, { id: "b", capa: 1, fila: 2 }],
    terminales: [],
    tramos: [{ id: "a>b", origen: "a", destino: "b", tipo: "avance", escalas: [] }],
  };
  const g = geometria(d);
  assert.equal(g.caminos.get("a>b"), "M0 0 L220 192");
  assert.equal(geometria({ ...d, estaciones: d.estaciones.filter((e) => e.id !== "c") }).caminos.get("a>b"), g.caminos.get("a>b"));
  for (const etiqueta of [{ ancho: 40, alto: 20, arriba: 15 }, { ancho: 400, alto: 200, arriba: 0 }]) {
    assert.deepEqual([...geometria(d, { etiqueta }).caminos], [...g.caminos]);
  }
  // En una tanda real, igual.
  const sii = distribuir(SII);
  assert.deepEqual([...geometria(sii, { etiqueta: { ancho: 10, alto: 10, arriba: 0 } }).caminos], [...geometria(sii).caminos]);
});

test("las páginas se reparten a los dos lados del tronco (no todas debajo)", () => {
  // Del inicio salen 4 páginas que llegan a la meta: el tronco queda al medio, con páginas arriba y abajo.
  const laterales = ["p1", "p2", "p3", "p4"];
  const d = distribuir({
    paginas: [pagina("a", { esInicio: true, visitas: 6 }), pagina("b", { visitas: 6 }), pagina("c", { visitas: 6, finales: { ...SIN_FINALES, logrado: 6 } }), ...laterales.map((id, i) => pagina(id, { visitas: 4 - i }))],
    ramas: [rama("a", "b", 6), rama("b", "c", 6), ...laterales.flatMap((id) => [rama("a", id), rama(id, "c")])],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const filas = laterales.map((id) => porId(d.estaciones).get(id).fila);
  assert.equal(filas.filter((f) => f < 0).length, 2, `arriba: ${filas}`);
  assert.equal(filas.filter((f) => f > 0).length, 2, `abajo: ${filas}`);
  assert.equal(Math.max(...filas.map(Math.abs)), 2, "ninguna a más de dos filas del tronco");
  const g = geometria(d);
  comprobarColumnas(d, g, "a los dos lados");
  assert.equal(contarCruces(d, g), 0);
  // En la tanda real de sii también hay estaciones a los dos lados.
  const sii = distribuir(SII);
  assert.ok(sii.estaciones.some((e) => e.fila < 0) && sii.estaciones.some((e) => e.fila > 0));
});

test("vuelta atrás entre columnas vecinas a la misma altura: un arco bajo de verdad, no un pico", () => {
  const altoFila = 96;
  const d = {
    estaciones: [{ id: "n3", capa: 1, fila: 0 }, { id: "n4", capa: 2, fila: 0 }, { id: "n9", capa: 2, fila: -1 }],
    terminales: [],
    tramos: [{ id: "n4>n3", origen: "n4", destino: "n3", tipo: "retroceso", escalas: [] }],
  };
  const puntos = geometria(d, { altoFila }).recorridos.get("n4>n3");
  const salida = salidaVertical(puntos);
  assert.ok(salida >= 0.3 * altoFila && salida <= 0.6 * altoFila, `se sale ${salida}`);
  assert.ok(Math.min(...puntos.map((p) => p.y)) < 0, "en el tronco, por arriba");
  // No vuelve por el mismo lugar: cada x aparece una vez (va siempre hacia la izquierda).
  for (let i = 1; i < puntos.length; i += 1) assert.ok(puntos[i].x < puntos[i - 1].x);
  // No depende de quién está cerca (n9 justo arriba): el mismo arco sin n9.
  assert.deepEqual(geometria({ ...d, estaciones: d.estaciones.slice(0, 2) }, { altoFila }).caminos, geometria(d, { altoFila }).caminos);
  // Debajo del tronco, el arco va por debajo.
  const [, c1] = arcoDeVuelta({ x: 440, y: 192 }, { x: 220, y: 96 }, altoFila);
  assert.equal(c1.y, 192 + 0.5 * altoFila);
});

test("en las tandas reales: tramos hacia la derecha casi rectos y vueltas atrás bajas", async () => {
  const fixtures = await Promise.all([VIEJA, NUEVA].map(async (id) => (await leerTanda(RAIZ, id)).telarana));
  for (const [nombre, entrada] of [["sii", SII], ["wom", WOM], ["dt", DT], ["vieja", fixtures[0]], ["nueva", fixtures[1]]]) {
    const d = distribuir(entrada);
    for (const altoFila of [96, 124]) {
      const g = geometria(d, { altoFila });
      comprobarColumnas(d, g, `${nombre} (fila ${altoFila})`, altoFila);
      // Ninguna vuelta atrás abarca menos de 0.3 filas (sería un pico sobre la fila).
      for (const tramo of d.tramos.filter((t) => t.tipo === "retroceso")) {
        const ys = g.recorridos.get(tramo.id).map((p) => p.y);
        assert.ok(Math.max(...ys) - Math.min(...ys) >= 0.3 * altoFila, `${nombre}: ${tramo.id} abarca ${Math.max(...ys) - Math.min(...ys)} px`);
      }
    }
  }
});

test("vueltas atrás y pasos laterales: un solo tono neutro, el mismo en la leyenda", () => {
  for (const resultado of ["exito", "mixto", "fallo", "abandono", "error", undefined]) {
    assert.equal(claseDeTramo({ tipo: "retroceso", resultado }), "secundario");
    assert.equal(claseDeTramo({ tipo: "lateral", resultado }), "secundario");
  }
  assert.equal(claseDeTramo({ tipo: "avance", resultado: "fallo" }), "fallo");
  // Finos aunque muchos hayan vuelto por ahí.
  assert.equal(anchoDeTramo({ tipo: "retroceso", intentos: 8 }), 3);
  assert.equal(anchoDeTramo({ tipo: "lateral", intentos: 1 }), 1.75);
  const pantalla = readFileSync(new URL("../public/pantallas/telarana.js", import.meta.url), "utf8");
  assert.match(pantalla, /`tramo-\$\{tipo\} tramo-\$\{claseDeTramo\(\{ tipo \}\)\}`/, "la muestra de la leyenda usa claseDeTramo");
  const estilos = readFileSync(new URL("../public/estilos/telarana.css", import.meta.url), "utf8");
  assert.match(estilos, /\.tramo-secundario \{ --tono:/);
});
