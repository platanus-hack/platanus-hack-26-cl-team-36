// La hoja de una revisión fallida: el modelo (public/fallo/modelo.js), su ruta (#/f/<revision>) y qué tarjetas la abren.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ETAPAS, manifiestoDe, modeloDeFalla } from "../public/fallo/modelo.js";
import { enlaceAFallo, hashDe, parsearHash } from "../public/nucleo/rutas.js";
import { abreLaFalla, modeloDeTarjeta } from "../public/overview/tarjetas.js";

const CATALOGO_FALLIDO = {
  revision: "mwqhgg8u-c7d205",
  url: "https://www.aerolineacondor.test/",
  host: "aerolineacondor.test",
  sitio: "Aerolínea Cóndor",
  estado: "failed",
  creada: "2026-11-21T14:08:06.462Z",
  actualizada: "2026-11-21T14:09:37.304Z",
  etapas: { catalog: "fallido", guide: "pendiente", visitor: "pendiente", improver: "pendiente" },
  goals: [],
  capturas: { desktop: { tanda: "aerolineacondor.test/visitor/viajar-mascota/2026-11-22T02-25-00Z", carpeta: "desktop", archivo: "step_00.png" }, mobile: null },
  motivo: { tipo: "catalogador", detalle: null },
  anteriores: 0,
};
const AVANCE = {
  revision: "mwqhgg8u-c7d205",
  host: "aerolineacondor.test",
  catalogo: {
    estado: "failed",
    resultados: [{ archivo: "manifest.json", clave: "aerolineacondor.test/cataloger/2026-11-21T14-08-14Z/manifest.json" }],
  },
  goals: [],
  improver: { estado: "pending", resultados: [] },
};

test("falla en el Catalogador: etapa, motivo, duración, manifest.json y las siguientes sin correr", () => {
  const modelo = modeloDeFalla({ tarjeta: CATALOGO_FALLIDO, avance: AVANCE, revision: "mwqhgg8u-c7d205" });
  assert.equal(modelo.etapa, "catalog");
  assert.deepEqual(modelo.etapas.map((e) => e.estado), ["fallido", "no_corrio", "no_corrio", "no_corrio"]);
  assert.deepEqual(modelo.motivo, { tipo: "catalogador", detalle: null });
  assert.equal(modelo.segundos, 91);
  assert.equal(modelo.manifiesto, "aerolineacondor.test/cataloger/2026-11-21T14-08-14Z/manifest.json");
  assert.deepEqual([modelo.sitio, modelo.host, modelo.url], ["Aerolínea Cóndor", "aerolineacondor.test", "https://www.aerolineacondor.test/"]);
  assert.equal(modelo.captura.archivo, "step_00.png");
});

test("falla en el Diseñador: las anteriores hechas; un motivo desconocido es error; el detalle técnico se guarda", () => {
  const tarjeta = {
    ...CATALOGO_FALLIDO,
    etapas: { catalog: "hecho", guide: "hecho", visitor: "hecho", improver: "fallido" },
    motivo: { tipo: "inventado", detalle: "Boom" },
  };
  const avance = { ...AVANCE, catalogo: { estado: "succeeded", resultados: [] }, improver: { estado: "failed", resultados: [{ archivo: "manifest.json", clave: "x/improver/1/manifest.json" }] } };
  const modelo = modeloDeFalla({ tarjeta, avance });
  assert.equal(modelo.etapa, "improver");
  assert.deepEqual(modelo.etapas.map((e) => e.estado), ["hecho", "hecho", "hecho", "fallido"]);
  assert.deepEqual(modelo.motivo, { tipo: "error", detalle: "Boom" });
  assert.equal(modelo.manifiesto, "x/improver/1/manifest.json");
});

test("sin tarjeta, la etapa sale de la corrida fallida del avance; de la Guía, la del goal que falló", () => {
  const avance = {
    host: "metro.test",
    catalogo: { estado: "succeeded", resultados: [] },
    goals: [
      { goal: "a", guide: { estado: "succeeded", resultados: [{ archivo: "manifest.json", clave: "a/manifest.json" }] } },
      { goal: "b", guide: { estado: "failed", resultados: [{ archivo: "manifest.json", clave: "b/manifest.json" }] } },
    ],
  };
  const modelo = modeloDeFalla({ tarjeta: null, avance, revision: "r1" });
  assert.equal(modelo.etapa, "guide");
  assert.equal(modelo.etapas[1].estado, "fallido");
  assert.equal(modelo.manifiesto, "b/manifest.json");
  assert.equal(modelo.sitio, "metro.test");
  assert.equal(manifiestoDe("visitor", avance), null);
  assert.deepEqual(ETAPAS, ["catalog", "guide", "visitor", "improver"]);
});

test("ruta #/f/<revision>: va y vuelve; una revisión con otro formato no es ruta", () => {
  assert.deepEqual(parsearHash("#/f/mwqhgg8u-c7d205"), { tipo: "fallo", revision: "mwqhgg8u-c7d205", parametros: {} });
  assert.equal(enlaceAFallo("mwqhgg8u-c7d205"), "#/f/mwqhgg8u-c7d205");
  assert.equal(hashDe(parsearHash("#/f/mwqhgg8u-c7d205")), "#/f/mwqhgg8u-c7d205");
  assert.equal(parsearHash("#/f/..%2Fx").tipo, "desconocida");
  assert.equal(parsearHash("#/f/mwqhgg8u-c7d205/otra").tipo, "desconocida");
});

test("abren la falla las fallidas sin tanda propia (la de la captura es de otra revisión); con goal con tanda, su telaraña", () => {
  assert.equal(abreLaFalla(CATALOGO_FALLIDO), true);
  assert.equal(modeloDeTarjeta(CATALOGO_FALLIDO).falla, true);
  const conTanda = { ...CATALOGO_FALLIDO, goals: [{ goal: "g", tanda: "aerolineacondor.test/visitor/g/2026-11-21T14-30-00Z", intentos: [] }] };
  assert.equal(abreLaFalla(conTanda), false);
  assert.equal(abreLaFalla({ ...CATALOGO_FALLIDO, estado: "delivered" }), false);
});
