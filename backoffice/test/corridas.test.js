// Filtros, orden y grupos por día de Corridas (diseño §9.3, WP2).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorDia,
  calzaBusqueda,
  contarFiltros,
  filtrarTandas,
  leerParametros,
  ordenarTandas,
  prepararLista,
  resultadosParaMedidor,
  sitiosDe,
} from "../public/corridas/filtros.js";

const tanda = (id, campos) => ({
  id,
  tarea: id.split("/")[0],
  fechaIso: `${id.split("/")[1].replace(/_(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3")}`,
  intentos: 3,
  validos: 3,
  errores: 0,
  logrados: 3,
  ...campos,
});

const WOM_VIEJA = tanda("wom-baja-fibra/2026-11-21_07-16-33", { host: "wom.cl", instruccion: "Encuentra cómo dar de baja tu servicio de Internet Fibra." });
const WOM = tanda("wom-baja-fibra/2026-11-21_07-28-42", { host: "wom.cl", instruccion: "Encuentra cómo dar de baja tu servicio de Internet Fibra." });
const DT = tanda("dt-reclamo-despido/2026-11-21_07-28-43", { host: "dt.gob.cl", validos: 2, errores: 1, logrados: 2, instruccion: "Te despidieron: llega al trámite de reclamo." });
const SII = tanda("sii-exencion-contribuciones/2026-11-20_09-00-00", { host: "sii.cl", logrados: 1, instruccion: "Exención de contribuciones." });
const NULA = tanda("caida/2026-11-18_10-00-00", { host: "caida.cl", validos: 0, errores: 3, logrados: 0 });
const TODAS = [WOM_VIEJA, SII, WOM, DT, NULA];

// 21 nov 2026, 12:00 hora local.
const AHORA = new Date(2026, 10, 21, 12, 0, 0).getTime();

test("leerParametros: valores desconocidos vuelven al valor por defecto", () => {
  assert.deepEqual(leerParametros({}), { q: "", sitio: null, filtro: null, orden: "nuevas", vista: "lista" });
  assert.deepEqual(leerParametros({ q: "  sii ", sitio: "sii.cl", filtro: "errores", orden: "exito", vista: "grilla" }), {
    q: "sii",
    sitio: "sii.cl",
    filtro: "errores",
    orden: "exito",
    vista: "grilla",
  });
  assert.deepEqual(leerParametros({ filtro: "todo", orden: "x", vista: "mosaico" }), { q: "", sitio: null, filtro: null, orden: "nuevas", vista: "lista" });
});

test("búsqueda: sin tildes, sin mayúsculas, en tarea, sitio e instrucción; cada palabra debe calzar", () => {
  assert.equal(calzaBusqueda(DT, "TRAMITE"), true);
  assert.equal(calzaBusqueda(WOM, "wom fibra"), true);
  assert.equal(calzaBusqueda(WOM, "wom sii"), false);
  assert.equal(calzaBusqueda(SII, "sii.cl"), true);
  assert.equal(calzaBusqueda(SII, ""), true);
  assert.deepEqual(filtrarTandas(TODAS, { q: "sii" }).map((t) => t.id), [SII.id]);
});

test("filtros: sitio, con problemas (válidos > logrados) y con errores", () => {
  assert.deepEqual(filtrarTandas(TODAS, { sitio: "wom.cl" }).map((t) => t.id), [WOM_VIEJA.id, WOM.id]);
  assert.deepEqual(filtrarTandas(TODAS, { filtro: "problemas" }).map((t) => t.id), [SII.id]);
  assert.deepEqual(filtrarTandas(TODAS, { filtro: "errores" }).map((t) => t.id), [DT.id, NULA.id]);
  assert.deepEqual(filtrarTandas(TODAS, { filtro: "errores", sitio: "dt.gob.cl" }).map((t) => t.id), [DT.id]);
  assert.deepEqual(filtrarTandas(TODAS, { q: "nada-calza" }), []);
});

test("contarFiltros cuenta cada chip después de la búsqueda y el sitio", () => {
  assert.deepEqual(contarFiltros(TODAS), { todas: 5, problemas: 1, errores: 2 });
  assert.deepEqual(contarFiltros(TODAS, { sitio: "wom.cl" }), { todas: 2, problemas: 0, errores: 0 });
  assert.deepEqual(contarFiltros(TODAS, { q: "dt" }), { todas: 1, problemas: 0, errores: 1 });
});

test("sitiosDe: de más a menos tandas, luego por nombre", () => {
  assert.deepEqual(sitiosDe(TODAS), [
    { host: "wom.cl", n: 2 },
    { host: "caida.cl", n: 1 },
    { host: "dt.gob.cl", n: 1 },
    { host: "sii.cl", n: 1 },
  ]);
});

test("orden nuevas y viejas por fecha, estable por id", () => {
  assert.deepEqual(ordenarTandas(TODAS, "nuevas").map((t) => t.id), [DT.id, WOM.id, WOM_VIEJA.id, SII.id, NULA.id]);
  assert.deepEqual(ordenarTandas(TODAS, "viejas").map((t) => t.id), [NULA.id, SII.id, WOM_VIEJA.id, WOM.id, DT.id]);
  assert.deepEqual(ordenarTandas(TODAS).map((t) => t.id), ordenarTandas(TODAS, "nuevas").map((t) => t.id));
  assert.deepEqual(ordenarTandas(TODAS, "desconocido").map((t) => t.id), ordenarTandas(TODAS, "nuevas").map((t) => t.id));
});

test("orden exito: menor éxito primero (sin válidos arriba), luego más errores, luego más nuevas", () => {
  assert.deepEqual(ordenarTandas(TODAS, "exito").map((t) => t.id), [NULA.id, SII.id, DT.id, WOM.id, WOM_VIEJA.id]);
});

test("orden tarea: A→Z y, dentro de una tarea, más nuevas primero", () => {
  assert.deepEqual(ordenarTandas(TODAS, "tarea").map((t) => t.id), [NULA.id, DT.id, SII.id, WOM.id, WOM_VIEJA.id]);
});

test("ordenarTandas no muta la lista recibida", () => {
  const copia = [...TODAS];
  ordenarTandas(TODAS, "viejas");
  assert.deepEqual(TODAS, copia);
});

test("agruparPorDia: hoy, ayer y fecha, con un ahora fijo", () => {
  const grupos = agruparPorDia(ordenarTandas(TODAS, "nuevas"), AHORA);
  assert.deepEqual(
    grupos.map((g) => [g.tipo, g.dia, g.tandas.length]),
    [
      ["hoy", "2026-11-21", 3],
      ["ayer", "2026-11-20", 1],
      ["fecha", "2026-11-18", 1],
    ],
  );
  // Al día siguiente, el 21 pasa a ser "ayer".
  const manana = new Date(2026, 10, 22, 0, 30).getTime();
  assert.deepEqual(agruparPorDia(ordenarTandas(TODAS, "nuevas"), manana).map((g) => g.tipo), ["ayer", "fecha", "fecha"]);
  // El 1 de un mes: ayer es el último día del mes anterior.
  const primero = new Date(2026, 11, 1, 9).getTime();
  assert.deepEqual(agruparPorDia([tanda("x/2026-11-30_23-00-00", {})], primero).map((g) => g.tipo), ["ayer"]);
  assert.deepEqual(agruparPorDia([], AHORA), []);
  assert.deepEqual(agruparPorDia([{ id: "sin-fecha" }], AHORA).map((g) => g.tipo), ["sinFecha"]);
});

test("prepararLista agrupa por día solo con orden por fecha", () => {
  const conDias = prepararLista(TODAS, {}, AHORA);
  assert.equal(conDias.grupos.length, 3);
  assert.equal(conDias.total, 5);
  assert.deepEqual(conDias.cuentas, { todas: 5, problemas: 1, errores: 2 });
  const porExito = prepararLista(TODAS, { orden: "exito" }, AHORA);
  assert.deepEqual(porExito.grupos.map((g) => g.tipo), ["todas"]);
  assert.equal(porExito.grupos[0].tandas.length, 5);
  const filtrada = prepararLista(TODAS, { filtro: "errores", q: "dt" }, AHORA);
  assert.deepEqual(filtrada.visibles.map((t) => t.id), [DT.id]);
  assert.deepEqual(filtrada.cuentas, { todas: 1, problemas: 0, errores: 1 });
});

test("resultadosParaMedidor: logrados, fallidos, abandonados y errores, estable", () => {
  const perfiles = [
    { intento: "a", resultado: "error" },
    { intento: "b", resultado: "logrado" },
    { intento: "c", resultado: "fallido" },
    { intento: "d", resultado: "logrado" },
    { intento: "e", resultado: "abandonado" },
  ];
  assert.deepEqual(resultadosParaMedidor(perfiles).map((p) => p.intento), ["b", "d", "c", "e", "a"]);
  assert.deepEqual(resultadosParaMedidor(undefined), []);
});
