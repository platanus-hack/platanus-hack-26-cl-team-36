// Distribución de la telaraña (diseño §10.5.1 y §9.3) y cuentas por perfil. Las formas "reales" son copias
// reducidas de las tandas de agents/.runs/ (que no se versionan): wom 07-28 (páginas fusionadas, todo en la
// ruta), dt (intento con error de la herramienta) y sii (títulos inferidos de la URL). fixtures/telarana-sii.json es
// la telaraña derivada de una tanda real y densa (sii 16-24-12: 27 páginas, 54 ramas).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { acomodar, contarCruces, distribuir, geometria, idDeTerminal, idDeTramoFinal } from "../public/telarana/distribuir.js";
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
/** ¿El segmento horizontal o vertical (p, q) entra en la caja? */
const segmentoEnCaja = (p, q, c) => Math.max(p.x, q.x) > c.x0 && Math.min(p.x, q.x) < c.x1 && Math.max(p.y, q.y) > c.y0 && Math.min(p.y, q.y) < c.y1;

/** Las propiedades del grafo por columnas que pide el diseño, sobre cualquier distribución. */
function comprobarColumnas(d, g, nombre) {
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
  // Las vueltas atrás y los pasos laterales no atraviesan la etiqueta de ninguna otra estación.
  for (const tramo of d.tramos.filter((t) => t.tipo === "retroceso" || t.tipo === "lateral")) {
    const puntos = g.recorridos.get(tramo.id);
    for (const [id, caja] of cajas) {
      if (id === tramo.origen || id === tramo.destino) continue;
      for (let i = 1; i < puntos.length; i += 1) assert.ok(!segmentoEnCaja(puntos[i - 1], puntos[i], caja), `${nombre}: ${tramo.id} cruza ${id}`);
    }
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

test("fixture con vuelta atrás: la vuelta va por el pasillo entre las dos columnas, fuera de las etiquetas", async () => {
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
  // Sale de n4 hacia la izquierda, baja (o sube) por el pasillo x = 220 − 110 − 6 y entra a n1 por su derecha.
  const puntos = g.recorridos.get("n4>n1");
  assert.deepEqual(puntos.map((p) => p.x), [220, 104, 104, 0]);
  assert.deepEqual([puntos[1].y, puntos[2].y], [g.posiciones.get("n4").y, 0]);
  assert.match(g.caminos.get("n4>n1"), /^M220 -?[\d.]+ L.* Q104 .* L0 0$/);
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

test("paso lateral a la misma columna: tipo «lateral», rodea por el pasillo de la derecha", () => {
  const d = distribuir({
    paginas: [pagina("a", { esInicio: true }), pagina("b"), pagina("c"), pagina("x")],
    ramas: [rama("a", "b"), rama("b", "c"), rama("a", "x"), rama("x", "b")],
    ruta: { paginas: ["a", "b", "c"] },
  });
  const tramos = porId(d.tramos);
  assert.equal(porId(d.estaciones).get("x").capa, 1);
  assert.equal(tramos.get("x>b").tipo, "lateral");
  const g = geometria(d);
  assert.deepEqual(g.recorridos.get("x>b").map((p) => p.x), [220, 336, 336, 220]);
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

test("geometría: x = capa·220, y = fila·96; los avances son curvas horizontales por sus paradas", async () => {
  const tanda = await leerTanda(RAIZ, VIEJA);
  const d = distribuir(tanda.telarana);
  const g = geometria(d);
  for (const e of d.estaciones) assert.deepEqual(g.posiciones.get(e.id), { x: e.capa * 220, y: Math.round(e.fila * 96 * 10) / 10 });
  assert.deepEqual(g.posiciones.get(idDeTerminal("logrado")), { x: 3 * 220, y: 0 });
  const n4 = g.posiciones.get("n4");
  assert.equal(g.caminos.get("n1>n4"), `M0 0 C110 0, 110 ${n4.y}, 220 ${n4.y}`);
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
  // Los barridos de baricentro dejan menos cruces que el orden inicial (un solo barrido).
  const unBarrido = distribuir(SII, { barridos: 1 });
  const cruces = contarCruces(d, g);
  const crucesConUnBarrido = contarCruces(unBarrido, geometria(unBarrido));
  assert.ok(cruces < crucesConUnBarrido, `${cruces} cruces con barridos, ${crucesConUnBarrido} con uno solo`);
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
