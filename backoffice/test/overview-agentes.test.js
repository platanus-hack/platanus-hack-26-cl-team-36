// Bloque de agentes del Overview (spec §3.3, §3.4, §5): cifras, %, n chico, escala, orden de los cuadritos y
// filtro de dispositivo. Los datos son los del contrato §1, que son las cifras exactas del mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTADOS,
  cifraVisible,
  conteosDeRol,
  cuadritosDeFila,
  escalaDelBloque,
  estadosDeLeyenda,
  exito,
  exitoDeRol,
  leerDispositivo,
  modeloDeAgentes,
  ordenarEstados,
  tonoDePorcentaje,
} from "../public/overview/agentes.js";
import { crearFormatos } from "../public/nucleo/formato.js";
import { textoDeExito } from "../public/overview/textos.js";

const RESUMEN = {
  ahora: "2026-11-22T03:36:49.000Z",
  roles: {
    cataloger: { logrado: 72, fallido: 9, en_curso: 1, en_cola: 0 },
    guide: { logrado: 191, fallido: 19, en_curso: 3, en_cola: 3 },
    visitor: {
      all: { logrado: 595, fallido: 128, abandonado: 128, sin_medir: 49, error: 22, en_curso: 0, en_cola: 6 },
      desktop: { logrado: 476, fallido: 84, abandonado: 100, sin_medir: 35, error: 13, en_curso: 0, en_cola: 6 },
      mobile: { logrado: 119, fallido: 44, abandonado: 28, sin_medir: 14, error: 9, en_curso: 0, en_cola: 6 },
    },
    improver: { logrado: 65, fallido: 3, en_curso: 1, en_cola: 3 },
  },
};

const en = crearFormatos("en");
const es = crearFormatos("es");
const porRol = (modelo) => Object.fromEntries(modelo.filas.map((fila) => [fila.rol, fila]));

test("cifras de referencia (spec §5): 82 · 213 · 922 · 69 = 1,286 agents, con su %", () => {
  const modelo = modeloDeAgentes(RESUMEN, "all");
  const filas = porRol(modelo);
  assert.deepEqual(modelo.filas.map((fila) => fila.rol), ["cataloger", "guide", "visitor", "improver"]);
  assert.equal(filas.cataloger.n, 82);
  assert.equal(filas.guide.n, 213);
  assert.equal(filas.visitor.n, 922);
  assert.equal(filas.improver.n, 69);
  assert.equal(modelo.total, 1286);
  assert.equal(en.numero(modelo.total), "1,286");
  assert.deepEqual(
    modelo.filas.map((fila) => textoDeExito(fila.exito, en)),
    ["89%", "91%", "70%", "96%"],
  );
  // 595 / (595 + 128 + 128) = 69,9 % → se redondea a 70 y es verde, como en la maqueta.
  assert.equal(filas.visitor.exito.tono, "logrado");
});

test("con Mobile cambian solo los visitantes: 214 (62 %, naranja) y el total 578", () => {
  const modelo = modeloDeAgentes(RESUMEN, "mobile");
  const filas = porRol(modelo);
  assert.equal(filas.visitor.n, 214);
  assert.equal(textoDeExito(filas.visitor.exito, en), "62%");
  assert.equal(filas.visitor.exito.tono, "aviso");
  assert.equal(modelo.total, 578);
  for (const rol of ["cataloger", "guide", "improver"]) {
    assert.deepEqual(filas[rol].conteos, porRol(modeloDeAgentes(RESUMEN, "all"))[rol].conteos, `${rol} no cambia con el filtro`);
  }
});

test("con Desktop: 708 visitantes (72 %) y el total 1,072", () => {
  const modelo = modeloDeAgentes(RESUMEN, "desktop");
  assert.equal(porRol(modelo).visitor.n, 708);
  assert.equal(textoDeExito(porRol(modelo).visitor.exito, en), "72%");
  assert.equal(modelo.total, 82 + 213 + 708 + 69);
});

test("las fichas de dispositivo llevan los visitantes de cada uno y marcan la elegida", () => {
  assert.deepEqual(modeloDeAgentes(RESUMEN, "all").dispositivos, [
    { id: "all", n: 922, seleccionado: true },
    { id: "desktop", n: 708, seleccionado: false },
    { id: "mobile", n: 214, seleccionado: false },
  ]);
  assert.deepEqual(
    modeloDeAgentes(RESUMEN, "mobile").dispositivos.map((d) => d.seleccionado),
    [false, false, true],
  );
});

test("un dispositivo desconocido vale all", () => {
  assert.equal(leerDispositivo("tablet"), "all");
  assert.equal(leerDispositivo(undefined), "all");
  assert.equal(modeloDeAgentes(RESUMEN, "tablet").dispositivo, "all");
});

test("en_cola nunca entra en la cifra, pero sí se dibuja (contorno)", () => {
  const conteos = conteosDeRol(RESUMEN, "improver");
  assert.equal(conteos.en_cola, 3);
  assert.equal(cifraVisible(conteos), 69);
  const cuadritos = cuadritosDeFila(conteos);
  assert.deepEqual(cuadritos.at(-1), { estado: "en_cola", n: 3 });
  assert.equal(cuadritos.reduce((suma, grupo) => suma + grupo.n, 0), 72);
});

test("los cuadritos van en el orden logrado, fallido, abandonado, sin medir, error, detenido, en curso, en cola", () => {
  assert.deepEqual(ESTADOS, ["logrado", "fallido", "abandonado", "sin_medir", "error", "detenido", "en_curso", "en_cola"]);
  const conteos = { en_cola: 1, en_curso: 2, detenido: 1, error: 1, sin_medir: 1, abandonado: 1, fallido: 1, logrado: 1 };
  assert.deepEqual(cuadritosDeFila(conteos).map((grupo) => grupo.estado), ESTADOS);
  assert.deepEqual(ordenarEstados(["en_cola", "en_curso", "logrado", "error", "raro", "fallido"]), ["logrado", "fallido", "error", "en_curso", "en_cola", "raro"]);
  // Los estados en 0 no dejan cuadritos.
  assert.deepEqual(cuadritosDeFila(conteosDeRol(RESUMEN, "cataloger")), [
    { estado: "logrado", n: 72 },
    { estado: "fallido", n: 9 },
    { estado: "en_curso", n: 1 },
  ]);
});

test("% de visitantes: logrados / (logrados + fallidos + abandonó); los otros roles: logrados / (logrados + fallidos)", () => {
  const conteos = { logrado: 6, fallido: 2, abandonado: 2, sin_medir: 50, error: 50 };
  assert.equal(exitoDeRol(conteos, "visitor").medidos, 10);
  assert.equal(exitoDeRol(conteos, "visitor").pct, 60);
  assert.equal(exitoDeRol(conteos, "guide").medidos, 8);
  assert.equal(exitoDeRol(conteos, "guide").pct, 75);
});

test("n chico: con 5 medidos o menos va el conteo x/y; sin medidos, «—»", () => {
  assert.equal(textoDeExito(exito(3, 4), en), "3/4");
  assert.equal(textoDeExito(exito(5, 5), en), "5/5");
  assert.equal(textoDeExito(exito(5, 6), en), "83%");
  assert.equal(textoDeExito(exito(0, 0), en), "—");
  assert.equal(exito(0, 0).tono, "neutro");
  // El arranque vacío (artboard 5): el catalogador con 1 logrado es 1/1, no 100 %.
  const primera = { roles: { cataloger: { logrado: 1 }, guide: { logrado: 1, en_curso: 2 }, visitor: { all: { logrado: 1, en_curso: 3, en_cola: 8 } }, improver: { en_cola: 1 } } };
  const filas = porRol(modeloDeAgentes(primera, "all"));
  assert.equal(textoDeExito(filas.cataloger.exito, en), "1/1");
  assert.equal(textoDeExito(filas.improver.exito, en), "—");
  assert.equal(filas.improver.n, 0);
  assert.equal(modeloDeAgentes(primera, "all").total, 1 + 3 + 4 + 0);
});

test("en español las cifras y el % salen de Intl del idioma (1.286; 89 %)", () => {
  assert.match(textoDeExito(exito(72, 81), es), /^89\s?%$/u);
  assert.equal(es.numero(1286), "1.286");
});

test("tono del %: verde desde 70, naranja desde 60, si no el rojo de texto", () => {
  assert.equal(tonoDePorcentaje(70), "logrado");
  assert.equal(tonoDePorcentaje(69), "aviso");
  assert.equal(tonoDePorcentaje(60), "aviso");
  assert.equal(tonoDePorcentaje(59), "fallido");
  assert.equal(tonoDePorcentaje(null), "neutro");
  assert.equal(exito(1, 2).tono, "fallido");
  assert.equal(exito(2, 3).tono, "aviso");
});

test("escala: sobre 2.000 cuadritos en la fila más grande, un solo k = ceil(máx / 2000) para todo el bloque", () => {
  assert.equal(escalaDelBloque([{ logrado: 2000 }, { logrado: 5 }]), 1);
  assert.equal(escalaDelBloque([{ logrado: 2001 }]), 2);
  assert.equal(escalaDelBloque([{ logrado: 3000, en_cola: 1001 }, { logrado: 10 }]), 3);
  const grande = { roles: { cataloger: { logrado: 50 }, guide: { logrado: 10 }, visitor: { all: { logrado: 4500, fallido: 1, en_cola: 1 } }, improver: { logrado: 3 } } };
  const modelo = modeloDeAgentes(grande, "all");
  assert.equal(modelo.k, 3);
  const filas = porRol(modelo);
  // Cada estado conserva al menos un cuadrito (ceil), y la cifra sigue siendo la real.
  assert.deepEqual(filas.visitor.cuadritos, [
    { estado: "logrado", n: 1500 },
    { estado: "fallido", n: 1 },
    { estado: "en_cola", n: 1 },
  ]);
  assert.deepEqual(filas.cataloger.cuadritos, [{ estado: "logrado", n: 17 }]);
  assert.equal(filas.visitor.n, 4501);
  assert.equal(modeloDeAgentes(RESUMEN, "all").k, 1);
});

test("leyenda: siempre los 6 resultados; detenido y en cola solo si hay cuadritos así", () => {
  const base = ["logrado", "fallido", "abandonado", "sin_medir", "error", "en_curso"];
  assert.deepEqual(estadosDeLeyenda([{ logrado: 3 }]), base);
  assert.deepEqual(modeloDeAgentes(RESUMEN, "all").leyenda, [...base, "en_cola"]);
  assert.deepEqual(estadosDeLeyenda([{ detenido: 1 }]), ["logrado", "fallido", "abandonado", "sin_medir", "error", "detenido", "en_curso"]);
  const sinCola = { roles: { cataloger: { logrado: 1 }, guide: {}, visitor: { all: {}, desktop: {}, mobile: {} }, improver: {} } };
  assert.deepEqual(modeloDeAgentes(sinCola, "all").leyenda, base);
});

test("tolera una respuesta vacía o parcial (sin romper ni inventar cifras)", () => {
  const vacio = modeloDeAgentes(null, "mobile");
  assert.equal(vacio.total, 0);
  assert.deepEqual(vacio.filas.map((fila) => fila.n), [0, 0, 0, 0]);
  // Visitantes sin desglose por dispositivo: cuentan en All y quedan en 0 en Desktop/Mobile.
  const plano = { roles: { visitor: { logrado: 4, fallido: 1 } } };
  assert.equal(conteosDeRol(plano, "visitor", "all").logrado, 4);
  assert.equal(conteosDeRol(plano, "visitor", "mobile").logrado, 0);
  // Valores raros (negativos, texto) cuentan 0.
  assert.equal(cifraVisible(conteosDeRol({ roles: { guide: { logrado: -3, fallido: "x", en_curso: 2.7 } } }, "guide")), 2);
});
