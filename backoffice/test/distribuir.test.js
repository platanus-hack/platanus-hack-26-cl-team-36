// Distribución de la telaraña (diseño §10.5.1 y §9.3), sus dos caminos y las cuentas del panel. Las formas "reales" son copias
// reducidas de las tandas de agents/.runs/ (que no se versionan): wom 07-28 (páginas fusionadas, todo en la
// ruta), dt (intento con error de la herramienta) y sii (títulos inferidos de la URL). fixtures/telarana-sii.json es
// la telaraña derivada de una tanda real y densa (sii 16-24-12: 27 páginas, 54 ramas).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { GIRO_MAXIMO, acomodar, arcoDeAtajo, contarCruces, curvaSuave, distribuir, geometria, piezasDeAvance } from "../public/telarana/distribuir.js";
import { CAMINOS, caminoDeTramo } from "../public/telarana/escena.js";
import { finalesPorPagina, hitosDeRuta, intentosPorPagina, pasoDeLlegada, salidasDePagina, totalesDeFinales, vecindario } from "../public/telarana/cuentas.js";

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
  const diferencia = (x, y) => Math.abs(((x - y + 540) % 360) - 180); // en grados, entre 0 y 180 (también hacia la izquierda)
  return { angulo: Math.max(diferencia(sale, recta), diferencia(llega, recta)), desvio: desvio / largo };
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
function comprobarColumnas(d, g, nombre) {
  const xDe = (id) => g.posiciones.get(id).x;
  const inicio = d.estaciones.find((e) => e.tipo === "inicio");
  const otras = d.estaciones.filter((e) => e !== inicio);
  for (const e of otras) assert.ok(xDe(inicio.id) < xDe(e.id), `${nombre}: el inicio queda solo a la izquierda (${e.id})`);
  const xMaxPaginas = Math.max(...d.estaciones.map((e) => xDe(e.id)));
  if (d.troncoEsRuta) assert.equal(xDe(d.tronco.at(-1)), xMaxPaginas, `${nombre}: la meta va en la columna de más a la derecha`);
  for (const tramo of d.tramos) {
    const [a, b] = [g.posiciones.get(tramo.origen), g.posiciones.get(tramo.destino)];
    if (tramo.tipo === "tronco" || tramo.tipo === "avance") assert.ok(a.x < b.x, `${nombre}: ${tramo.id} (${tramo.tipo}) va de izquierda a derecha`);
    if (tramo.tipo === "lateral") assert.equal(a.x, b.x, `${nombre}: ${tramo.id} lateral en la misma columna`);
    if (tramo.tipo === "retroceso") assert.ok(a.x > b.x, `${nombre}: ${tramo.id} vuelve hacia la izquierda`);
  }
  // El tronco es una fila recta: el inicio al medio a la izquierda y la meta al medio a la derecha.
  for (const id of d.tronco) assert.equal(g.posiciones.get(id).y, 0, `${nombre}: ${id} del tronco en y = 0`);
  assert.ok(!("terminales" in d), `${nombre}: sin terminales: la meta es lo de más a la derecha`);
  // Ninguna etiqueta pisa a otra.
  const cajas = d.estaciones.map((e) => [e.id, cajaDeEstacion(g.posiciones.get(e.id))]);
  for (let i = 0; i < cajas.length; i += 1)
    for (let j = i + 1; j < cajas.length; j += 1) assert.ok(!sePisan(cajas[i][1], cajas[j][1]), `${nombre}: ${cajas[i][0]} y ${cajas[j][0]} se pisan`);
  // Todos los tramos son rectas o curvas suaves (pieza por pieza): los avances, las vueltas atrás y los pasos laterales.
  for (const tramo of d.tramos) comprobarCasiRecto(g.caminos.get(tramo.id), `${nombre}: ${tramo.id}`);
  comprobarRectosDePuntaAPunta(d, g, nombre);
}

const distanciaAlSegmento = (p, a, b) => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
/**
 * C4-1, lo que pidió el usuario por tercera vez: cada tramo hacia la derecha es una recta de punta a punta. En cada
 * parada (o muestra, en el arco de un atajo) dobla a lo más 15° y ningún punto se aleja de la recta entre sus dos
 * puntas más de un 8 % de su largo; ninguno pasa a menos de 8 px del punto de una estación que no es una de sus puntas.
 */
function comprobarRectosDePuntaAPunta(d, g, nombre) {
  const puntos = d.estaciones.map((e) => ({ id: e.id, ...g.posiciones.get(e.id) }));
  for (const tramo of d.tramos.filter((t) => ["tronco", "avance"].includes(t.tipo))) {
    const recorrido = g.recorridos.get(tramo.id);
    const [a, z] = [recorrido[0], recorrido.at(-1)];
    const largo = Math.hypot(z.x - a.x, z.y - a.y);
    for (let i = 1; i + 1 < recorrido.length; i += 1) {
      const [p, q, r] = [recorrido[i - 1], recorrido[i], recorrido[i + 1]];
      let giro = Math.abs(grados(r.x - q.x, r.y - q.y) - grados(q.x - p.x, q.y - p.y));
      if (giro > 180) giro = 360 - giro;
      assert.ok(giro <= 15, `${nombre}: ${tramo.id} dobla ${giro.toFixed(1)}° en (${q.x}, ${q.y})`);
      const desvio = Math.abs((z.x - a.x) * (q.y - a.y) - (z.y - a.y) * (q.x - a.x)) / largo / largo;
      assert.ok(desvio <= 0.08, `${nombre}: ${tramo.id} se aleja ${(desvio * 100).toFixed(1)} % de la recta entre sus puntas`);
    }
    for (const punto of puntos) {
      if (punto.id === tramo.origen || punto.id === tramo.destino) continue;
      const cerca = recorrido.slice(1).some((q, i) => distanciaAlSegmento(punto, recorrido[i], q) < 8);
      assert.ok(!cerca, `${nombre}: ${tramo.id} pasa sobre el punto de ${punto.id}`);
    }
  }
}

test("entrada vacía → salida vacía", () => {
  for (const entrada of [undefined, null, {}, { paginas: [], ramas: [], ruta: null }]) {
    const d = distribuir(entrada);
    assert.deepEqual(d, { estaciones: [], tramos: [], tronco: [], troncoEsRuta: false, capas: 0, filaMin: 0, filaMax: 0 });
    const g = geometria(d);
    assert.equal(g.posiciones.size, 0);
    assert.equal(g.caminos.size, 0);
    assert.deepEqual(g.caja, { x: 0, y: 0, ancho: 0, alto: 0 });
    assert.equal(contarCruces(d, g), 0);
  }
});

test("wom 07-28: un tronco recto con las 4 páginas, todo camino feliz", () => {
  const d = distribuir(WOM);
  assert.deepEqual(d.tronco, ["n1", "n2", "n3", "n4"]);
  assert.equal(d.troncoEsRuta, true);
  assert.deepEqual(d.estaciones.map((e) => [e.id, e.capa, e.fila, e.tipo, e.hito]), [
    ["n1", 0, 0, "inicio", 0],
    ["n2", 1, 0, "hito", 1],
    ["n3", 2, 0, "hito", 2],
    ["n4", 3, 0, "hito", 3],
  ]);
  assert.deepEqual(d.tramos.map((t) => [t.id, t.tipo, caminoDeTramo(t, d.troncoEsRuta)]), [
    ["n1>n2", "tronco", "feliz"],
    ["n2>n3", "tronco", "feliz"],
    ["n3>n4", "tronco", "feliz"],
  ]);
  assert.equal(d.capas, 4);
  assert.equal(d.filaMin, 0);
  assert.equal(d.filaMax, 0);
  const g = geometria(d);
  for (const id of ["n1>n2", "n2>n3", "n3>n4"]) assert.match(g.caminos.get(id), /^M[-\d.]+ 0 L[-\d.]+ 0$/, "el tronco es una recta en y = 0");
  comprobarColumnas(d, g, "wom");
});

test("dt: la meta es la última página (sin terminales de resultado a su derecha)", () => {
  const d = distribuir(DT);
  assert.deepEqual(d.estaciones.map((e) => [e.id, e.capa, e.fila]), [["n1", 0, 0], ["n2", 1, 0], ["n3", 2, 0]]);
  assert.deepEqual(d.tramos.map((t) => t.tipo), ["tronco", "tronco"]);
  assert.equal(d.capas, 3);
  comprobarColumnas(d, geometria(d), "dt");
});

test("fixture con vuelta atrás: la vuelta es una curva suave de n4 a n1, hacia afuera del tronco", async () => {
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
  // Una sola cúbica de n4 a n1, combada hacia afuera del tronco (del lado de n4) y casi recta.
  const n4 = g.posiciones.get("n4");
  const [pieza] = piezasDelCamino(g.caminos.get("n4>n1"));
  assert.deepEqual([pieza[0], pieza[3]], [n4, { x: 0, y: 0 }]);
  const medio = enCubica(pieza, 0.5);
  assert.equal(Math.sign(medio.y - n4.y / 2), Math.sign(n4.y), "hacia afuera del tronco");
  const { angulo, desvio } = cuantoSeDobla(pieza);
  assert.ok(angulo <= 15 && desvio <= 0.066 && desvio > 0.05, `${angulo}° · ${desvio}`);
  comprobarColumnas(d, g, "vieja");
});

test("fixture con ciclo y páginas fusionadas: el ciclo es una vuelta atrás, del camino ineficiente", async () => {
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
  assert.equal(caminoDeTramo(tramos.get("n6>n5"), d.troncoEsRuta), "ineficiente");
  assert.equal(caminoDeTramo(tramos.get("n5>n6"), d.troncoEsRuta), "ineficiente");
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

test("paso lateral a la misma columna: tipo «lateral», una curva suave hacia la derecha entre las dos alturas", () => {
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
  assert.ok(puntos.every((p) => p.x >= 220) && Math.max(...puntos.map((p) => p.x)) > 222, "por la derecha de la columna");
  assert.ok(Math.max(...puntos.map((p) => p.x)) - 220 <= 0.065 * Math.abs(b.y - x.y) + 0.1, "apenas combada");
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
  // Sin ruta no hay camino feliz: el eje es solo el camino más transitado.
  assert.ok(d.tramos.every((t) => caminoDeTramo(t, d.troncoEsRuta) === "ineficiente"));
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

test("sii 16-24-12 (tanda real, 27 páginas): inicio al medio a la izquierda, meta al medio a la derecha, páginas a los dos lados", () => {
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
  // Con el tronco al medio algunos tramos lo cruzan (antes, con todo debajo, eran 2).
  assert.ok(cruces <= 7, `medido al escribir la prueba: 7 (hay ${cruces})`);
  // Las 25 páginas fuera del tronco, parejas a los dos lados (13 encima, 12 debajo).
  const fuera = d.estaciones.filter((e) => !d.tronco.includes(e.id));
  const [encima, debajo] = [fuera.filter((e) => e.fila < 0).length, fuera.filter((e) => e.fila > 0).length];
  assert.ok(Math.abs(encima - debajo) <= 2, `encima ${encima}, debajo ${debajo}`);
});

test("cuentas del panel: finales por página, totales e hitos de la ruta", async () => {
  const tanda = await leerTanda(RAIZ, NUEVA);
  assert.deepEqual(totalesDeFinales(finalesPorPagina(tanda)), { logrado: 2, fallido: 1, abandonado: 0, error: 1 });
  // Los hitos cuentan solo intentos válidos: el error de Móvil no cuenta.
  assert.deepEqual(hitosDeRuta(tanda), [
    { pagina: "n1", n: 3, de: 3 },
    { pagina: "n2", n: 2, de: 3 },
    { pagina: "n3", n: 2, de: 3 },
  ]);
});

test("vecindario: la estación, sus tramos y sus vecinas", () => {
  const d = distribuir(DT);
  assert.deepEqual([...vecindario(d, "n2")].sort(), ["n1", "n1>n2", "n2", "n2>n3", "n3"]);
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

test("avance de un tramo: una recta, aunque baje o suba mucho", () => {
  const d = { estaciones: [{ id: "a", capa: 0, fila: 0 }, { id: "b", capa: 1, fila: 3 }], tramos: [{ id: "a>b", origen: "a", destino: "b", tipo: "avance", escalas: [] }] };
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
    tramos: [{ id: "a>b", origen: "a", destino: "b", tipo: "avance", escalas: [{ capa: 1, fila: 1 }, { capa: 2, fila: 2 }] }],
  };
  assert.equal(geometria(d).caminos.get("a>b"), "M0 0 L660 288");
});

test("la forma de un tramo no depende de dónde quedan los nombres de otras estaciones", () => {
  // a → b baja dos filas; c está una fila arriba de b, en su misma columna: su nombre queda en el camino. El tramo no
  // se dobla para esquivarlo: es la misma recta con c o sin c, y con cualquier caja de nombre.
  const d = {
    estaciones: [{ id: "a", capa: 0, fila: 0 }, { id: "c", capa: 1, fila: 1 }, { id: "b", capa: 1, fila: 2 }],
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

test("vuelta atrás entre columnas vecinas a la misma altura: una curva suave, no un arco alto", () => {
  const altoFila = 96;
  const d = {
    estaciones: [{ id: "n3", capa: 1, fila: 0 }, { id: "n4", capa: 2, fila: 0 }, { id: "n9", capa: 2, fila: -1 }],
    tramos: [{ id: "n4>n3", origen: "n4", destino: "n3", tipo: "retroceso", escalas: [] }],
  };
  const puntos = geometria(d, { altoFila }).recorridos.get("n4>n3");
  const salida = salidaVertical(puntos);
  assert.ok(salida > 0 && salida <= 0.065 * 220 + 0.1, `se sale ${salida}`);
  assert.ok(Math.min(...puntos.map((p) => p.y)) < 0, "en el tronco, por arriba");
  // No vuelve por el mismo lugar: cada x aparece una vez (va siempre hacia la izquierda).
  for (let i = 1; i < puntos.length; i += 1) assert.ok(puntos[i].x < puntos[i - 1].x);
  // No depende de quién está cerca (n9 justo arriba): la misma curva sin n9.
  assert.deepEqual(geometria({ ...d, estaciones: d.estaciones.slice(0, 2) }, { altoFila }).caminos, geometria(d, { altoFila }).caminos);
  // Debajo del tronco, la curva va por debajo.
  const [a, c1, , b] = curvaSuave({ x: 440, y: 192 }, { x: 220, y: 96 });
  assert.ok(c1.y > a.y + ((b.y - a.y) * 1) / 3, "combada hacia abajo");
});

test("en las tandas reales: todos los tramos rectos o curvas suaves", async () => {
  const fixtures = await Promise.all([VIEJA, NUEVA].map(async (id) => (await leerTanda(RAIZ, id)).telarana));
  for (const [nombre, entrada] of [["sii", SII], ["wom", WOM], ["dt", DT], ["vieja", fixtures[0]], ["nueva", fixtures[1]]]) {
    const d = distribuir(entrada);
    for (const altoFila of [96, 124]) comprobarColumnas(d, geometria(d, { altoFila }), `${nombre} (fila ${altoFila})`);
  }
});

test("dos caminos y nada más: feliz (la ruta recomendada) e ineficiente (todo lo demás), los mismos en la leyenda", () => {
  assert.deepEqual(CAMINOS, ["feliz", "ineficiente"]);
  assert.equal(caminoDeTramo({ tipo: "tronco" }, true), "feliz");
  for (const tipo of ["avance", "retroceso", "lateral"]) assert.equal(caminoDeTramo({ tipo }, true), "ineficiente");
  assert.equal(caminoDeTramo({ tipo: "tronco" }, false), "ineficiente", "sin ruta no hay camino feliz");
  const pantalla = readFileSync(new URL("../public/pantallas/telarana.js", import.meta.url), "utf8");
  assert.match(pantalla, /`tramo tramo-\$\{camino\}`/, "la muestra de la leyenda usa la clase del camino");
  assert.doesNotMatch(pantalla, /3d|inclinar|historia|perfilVecino|atasco/i, "sin vista 3D, historia, filtro de perfil ni atascos");
  const estilos = readFileSync(new URL("../public/estilos/telarana.css", import.meta.url), "utf8");
  for (const camino of CAMINOS) assert.match(estilos, new RegExp(`\\.tramo-${camino} \\{ --tono:`));
  assert.doesNotMatch(estilos, /data-vista="3d"|\.terminal|\.particula|\.estacion-atasco/);
});

test("C4-1: el tramo largo que antes hacía una carpa en una parada ahora es una recta de punta a punta", () => {
  // a (inicio) → m (meta) es el tronco; a → p → m y b → q → m a los lados, y un tramo largo a → r (r también da la
  // respuesta: va a la columna de la meta). Sus paradas van sobre la recta y son las páginas las que se corren.
  const d = distribuir({
    paginas: [
      pagina("a", { esInicio: true, visitas: 8 }),
      pagina("b", { visitas: 6 }),
      pagina("c", { visitas: 6 }),
      pagina("m", { visitas: 6, finales: { ...SIN_FINALES, logrado: 6 } }),
      pagina("p", { visitas: 3 }),
      pagina("q", { visitas: 2 }),
      pagina("r", { visitas: 2, finales: { ...SIN_FINALES, logrado: 2 } }),
    ],
    ramas: [rama("a", "b", 6), rama("b", "c", 6), rama("c", "m", 6), rama("a", "p", 3), rama("p", "m", 3), rama("b", "q", 2), rama("q", "m", 2), rama("a", "r", 2)],
    ruta: { paginas: ["a", "b", "c", "m"] },
  });
  for (const altoFila of [96, 124]) {
    const g = geometria(d, { altoFila });
    comprobarColumnas(d, g, `carpa (fila ${altoFila})`, altoFila);
    const largo = d.tramos.find((t) => t.id === "a>r");
    assert.ok(largo.escalas.length >= 2, "el tramo largo salta columnas");
    assert.match(g.caminos.get(largo.id), /^M[^C]+ L[^C]+$/, "se dibuja como una sola recta");
  }
  assert.ok(contarCruces(d, geometria(d)) <= 1);
});

test("C4-1: un atajo entre dos estaciones del tronco es un arco bajo por encima, sin pasar por las que salta", () => {
  // a → b → c → m es el tronco y a → c lo salta: una recta iría por encima del punto de b.
  const d = distribuir({
    paginas: [pagina("a", { esInicio: true, visitas: 4 }), pagina("b", { visitas: 4 }), pagina("c", { visitas: 4 }), pagina("m", { visitas: 4, finales: { ...SIN_FINALES, logrado: 4 } })],
    ramas: [rama("a", "b", 3), rama("b", "c", 3), rama("a", "c", 1), rama("c", "m", 4)],
    ruta: { paginas: ["a", "b", "c", "m"] },
  });
  const atajo = d.tramos.find((t) => t.id === "a>c");
  assert.equal(atajo.atajo, 1);
  assert.ok(atajo.escalas.every((e) => e.fila < 0), "le reserva lugar encima del tronco");
  for (const altoFila of [96, 124]) {
    const g = geometria(d, { altoFila });
    comprobarColumnas(d, g, `atajo (fila ${altoFila})`, altoFila);
    const ys = g.recorridos.get("a>c").map((p) => p.y);
    assert.ok(Math.min(...ys) < -8 && Math.max(...ys) <= 0, "va por encima del tronco");
  }
  // Bajo y casi recto: a lo más 6.5 % de su largo, y sale a menos de 15° de la recta.
  const [p, c1, , q] = arcoDeAtajo({ x: 0, y: 0 }, { x: 440, y: 0 }, 200);
  assert.ok(Math.abs(0.75 * c1.y) <= 0.065 * 440 + 1e-9);
  assert.ok(Math.abs(grados(c1.x - p.x, c1.y - p.y)) <= 15);
  assert.equal(q.x, 440);
});

test("C4-1: en la tanda real de sii, tramos rectos sin enredar más que antes", () => {
  const d = distribuir(SII);
  for (const altoFila of [96, 124]) comprobarRectosDePuntaAPunta(d, geometria(d, { altoFila }), `sii (fila ${altoFila})`);
  assert.ok(contarCruces(d, geometria(d)) <= 7, "con el tronco al medio, a lo más los 7 medidos al escribir la prueba");
});
