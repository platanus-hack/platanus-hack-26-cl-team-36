import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PESTANAS,
  enlaceATanda,
  extraerIdioma,
  hashDe,
  normalizarPaso,
  parsearHash,
  traducirLegado,
} from "../public/nucleo/rutas.js";

const CON_TAREA = "wom-baja-fibra/2026-11-21_07-28-42";
const SIN_TAREA = "2026-11-21_07-28-42";

test("Corridas: #/ y sus parámetros van y vuelven", () => {
  assert.deepEqual(parsearHash(""), { tipo: "corridas", parametros: {} });
  assert.deepEqual(parsearHash("#/"), { tipo: "corridas", parametros: {} });
  const hash = "#/?q=sii&sitio=sii.cl&filtro=problemas&orden=exito&vista=grilla";
  const ruta = parsearHash(hash);
  assert.equal(ruta.tipo, "corridas");
  assert.deepEqual(ruta.parametros, { q: "sii", sitio: "sii.cl", filtro: "problemas", orden: "exito", vista: "grilla" });
  assert.equal(hashDe(ruta), hash);
});

test("los valores por defecto y los vacíos no se escriben", () => {
  assert.equal(hashDe({ tipo: "corridas", parametros: { vista: "lista", orden: "nuevas", q: "" } }), "#/");
  assert.equal(hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { modo: "despues", paso: "3", ver: null } }), `#/t/${CON_TAREA}/replay?paso=3`);
});

test("orden estable de parámetros, sin importar el orden de entrada", () => {
  const a = hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { senales: "1", paso: "4", intento: "mobile", modo: "antes", ver: "video" } });
  assert.equal(a, `#/t/${CON_TAREA}/replay?intento=mobile&paso=4&modo=antes&ver=video&senales=1`);
  const b = hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: { vista: "3d", paso: "2", historia: "mobile", pagina: "n2", perfil: "hurried", z: "1", a: "2" } });
  assert.equal(b, `#/t/${CON_TAREA}/telarana?perfil=hurried&pagina=n2&historia=mobile&paso=2&vista=3d&a=2&z=1`);
});

test("cada pestaña, con y sin tarea, va y vuelve", () => {
  for (const tandaId of [CON_TAREA, SIN_TAREA]) {
    for (const pestana of PESTANAS) {
      const hash = enlaceATanda(tandaId, pestana);
      assert.equal(hash, `#/t/${tandaId}/${pestana}`);
      assert.deepEqual(parsearHash(hash), { tipo: "tanda", tandaId, pestana, parametros: {} });
    }
  }
  const perfiles = parsearHash(`#/t/${CON_TAREA}/perfiles?orden=-pasos`);
  assert.deepEqual(perfiles.parametros, { orden: "-pasos" });
  assert.equal(hashDe(perfiles), `#/t/${CON_TAREA}/perfiles?orden=-pasos`);
});

test("#/t/<id> sin pestaña es el Resumen", () => {
  const ruta = parsearHash(`#/t/${CON_TAREA}`);
  assert.deepEqual(ruta, { tipo: "tanda", tandaId: CON_TAREA, pestana: "resumen", parametros: {} });
  assert.equal(hashDe(ruta), `#/t/${CON_TAREA}/resumen`);
  assert.equal(enlaceATanda(SIN_TAREA), `#/t/${SIN_TAREA}/resumen`);
});

test("alias dentro de una tanda: perfil= en Replay e nodo= en la Telaraña", () => {
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/replay?perfil=mobile&paso=2`).parametros, { intento: "mobile", paso: "2" });
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/telarana?nodo=n5`).parametros, { pagina: "n5" });
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/replay?perfil=a&intento=b`).parametros, { intento: "b" });
  assert.equal(hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { perfil: "mobile" } }), `#/t/${CON_TAREA}/replay?intento=mobile`);
});

test("pestaña desconocida, tanda sin fecha o ruta inventada → desconocida", () => {
  assert.equal(parsearHash(`#/t/${CON_TAREA}/inventario`).tipo, "desconocida");
  assert.equal(parsearHash("#/t/wom-baja-fibra").tipo, "desconocida");
  assert.equal(parsearHash(`#/t/${CON_TAREA}/replay/extra`).tipo, "desconocida");
  assert.equal(parsearHash("#/no-existe").tipo, "desconocida");
  assert.equal(parsearHash("#/%E0%A4%A").tipo, "desconocida");
  assert.equal(parsearHash("#/no-existe").hash, "#/no-existe");
});

test("enlaces de la v0 se traducen a la tanda", () => {
  assert.deepEqual(traducirLegado(`#/telarana?t=${CON_TAREA}&perfil=hurried`), {
    destino: `#/t/${CON_TAREA}/telarana?perfil=hurried`,
    aviso: null,
  });
  assert.deepEqual(traducirLegado("#/replay?t=dt-reclamo-despido/2026-11-21_07-28-42&perfil=mobile&paso=3"), {
    destino: "#/t/dt-reclamo-despido/2026-11-21_07-28-42/replay?intento=mobile&paso=3",
    aviso: null,
  });
  assert.deepEqual(traducirLegado(`#/perfiles?t=${CON_TAREA}`), { destino: `#/t/${CON_TAREA}/perfiles`, aviso: null });
  assert.equal(traducirLegado(`#/t/${CON_TAREA}/replay`), null);
  const legado = parsearHash(`#/replay?t=${CON_TAREA}&perfil=mobile`);
  assert.equal(legado.tipo, "legado");
  assert.equal(legado.destino, `#/t/${CON_TAREA}/replay?intento=mobile`);
});

test("enlaces viejos sin t → Corridas con aviso", () => {
  for (const hash of ["#/telarana", "#/replay?perfil=mobile&paso=2", "#/perfiles?x=1"]) {
    const ruta = parsearHash(hash);
    assert.equal(ruta.tipo, "legado");
    assert.equal(ruta.destino, "#/");
    assert.equal(ruta.aviso, "comun.aviso.enlaceSinTanda");
  }
});

test("idioma= se separa del hash y nunca vuelve a escribirse", () => {
  assert.deepEqual(extraerIdioma("#/?idioma=en"), { idioma: "en", hash: "#/" });
  assert.deepEqual(extraerIdioma(`#/t/${CON_TAREA}/replay?idioma=es&paso=2`), { idioma: "es", hash: `#/t/${CON_TAREA}/replay?paso=2` });
  assert.deepEqual(extraerIdioma("#/?q=sii"), { idioma: null, hash: "#/?q=sii" });
  assert.equal(hashDe({ tipo: "corridas", parametros: { idioma: "en", q: "x" } }), "#/?q=x");
});

test("tandaId con caracteres especiales se codifica por segmento", () => {
  const hash = enlaceATanda("tarea con espacio/2026-11-21_07-28-42");
  assert.equal(hash, "#/t/tarea%20con%20espacio/2026-11-21_07-28-42/resumen");
  assert.equal(parsearHash(hash).tandaId, "tarea con espacio/2026-11-21_07-28-42");
});

test("normalizarPaso: vacío, inválido, fuera de rango", () => {
  assert.deepEqual(normalizarPaso(null, 12), { paso: 1, aviso: null });
  assert.deepEqual(normalizarPaso("4", 12), { paso: 4, aviso: null });
  assert.deepEqual(normalizarPaso("abc", 12), { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: "abc" } } });
  assert.deepEqual(normalizarPaso("0", 12), { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: "0" } } });
  assert.deepEqual(normalizarPaso("40", 12), { paso: 12, aviso: { clave: "comun.estado.pasoFueraDeRango", vars: { total: 12 } } });
});
