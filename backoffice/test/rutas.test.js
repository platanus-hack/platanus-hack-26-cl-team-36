import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PESTANAS,
  enlaceARevision,
  enlaceATanda,
  extraerIdioma,
  hashDe,
  normalizarPaso,
  parsearHash,
  traducirLegado,
} from "../public/nucleo/rutas.js";

const CON_TAREA = "wom.cl/visitor/baja-fibra/2026-11-21T07-28-42Z";

test("Corridas: #/ y sus parámetros van y vuelven", () => {
  assert.deepEqual(parsearHash(""), { tipo: "corridas", parametros: {} });
  assert.deepEqual(parsearHash("#/"), { tipo: "corridas", parametros: {} });
  const hash = "#/?q=sii&sitio=sii.cl&filtro=problemas&orden=exito&vista=grilla";
  const ruta = parsearHash(hash);
  assert.equal(ruta.tipo, "corridas");
  assert.deepEqual(ruta.parametros, { q: "sii", sitio: "sii.cl", filtro: "problemas", orden: "exito", vista: "grilla" });
  assert.equal(hashDe(ruta), hash);
});

test("Revisiones: #/revisiones y #/revisiones/<revision>; una revisión inválida no es ruta", () => {
  assert.deepEqual(parsearHash("#/revisiones"), { tipo: "revisiones", revision: null, parametros: {} });
  assert.deepEqual(parsearHash("#/revisiones/abc-123"), { tipo: "revisiones", revision: "abc-123", parametros: {} });
  assert.equal(hashDe(parsearHash("#/revisiones/abc-123?x=1")), "#/revisiones/abc-123");
  assert.equal(enlaceARevision(), "#/revisiones");
  for (const hash of ["#/revisiones/ABC", "#/revisiones/..%2Fx", `#/revisiones/${"a".repeat(41)}`, "#/revisiones/a/b"]) {
    assert.equal(parsearHash(hash).tipo, "desconocida", hash);
  }
});

test("los valores por defecto y los vacíos no se escriben", () => {
  assert.equal(hashDe({ tipo: "corridas", parametros: { vista: "lista", orden: "nuevas", q: "" } }), "#/");
  assert.equal(hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { paso: "3", intento: null } }), `#/t/${CON_TAREA}/replay?paso=3`);
});

test("orden estable de parámetros, sin importar el orden de entrada", () => {
  const a = hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { z: "1", paso: "4", intento: "mobile" } });
  assert.equal(a, `#/t/${CON_TAREA}/replay?intento=mobile&paso=4&z=1`);
  const b = hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: { pagina: "n2", z: "1", a: "2" } });
  assert.equal(b, `#/t/${CON_TAREA}/telarana?pagina=n2&a=2&z=1`);
});

test("cada pestaña, con y sin tarea, va y vuelve", () => {
  for (const tandaId of [CON_TAREA]) {
    for (const pestana of PESTANAS) {
      const hash = enlaceATanda(tandaId, pestana);
      assert.equal(hash, `#/t/${tandaId}/${pestana}`);
      assert.deepEqual(parsearHash(hash), { tipo: "tanda", tandaId, pestana, parametros: {} });
    }
  }
  assert.deepEqual(PESTANAS, ["telarana", "replay"]);
  // Perfiles ya no existe: su pestaña y su enlace de la v0 son rutas desconocidas.
  assert.equal(parsearHash(`#/t/${CON_TAREA}/perfiles`).tipo, "desconocida");
  assert.equal(parsearHash(`#/perfiles?t=${CON_TAREA}`).tipo, "desconocida");
});

test("#/t/<id> sin pestaña abre el mapa; un enlace viejo a /resumen también", () => {
  const ruta = parsearHash(`#/t/${CON_TAREA}`);
  assert.deepEqual(ruta, { tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: {} });
  assert.equal(hashDe(ruta), `#/t/${CON_TAREA}/telarana`);
  const vieja = parsearHash(`#/t/${CON_TAREA}/resumen?x=1`);
  assert.deepEqual(vieja, { tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: {} });
  assert.equal(hashDe(vieja), `#/t/${CON_TAREA}/telarana`);
  assert.equal(parsearHash("#/t/2026-11-21_07-28-42").tipo, "desconocida");
});

test("alias dentro de una tanda: perfil= en Replay e nodo= en la Telaraña", () => {
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/replay?perfil=mobile&paso=2`).parametros, { intento: "mobile", paso: "2" });
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/telarana?nodo=n5`).parametros, { pagina: "n5" });
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/replay?perfil=a&intento=b`).parametros, { intento: "b" });
  assert.equal(hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { perfil: "mobile" } }), `#/t/${CON_TAREA}/replay?intento=mobile`);
});

test("pestaña desconocida, tanda sin fecha o ruta inventada → desconocida", () => {
  assert.equal(parsearHash(`#/t/${CON_TAREA}/inventario`).tipo, "desconocida");
  assert.equal(parsearHash("#/t/wom.cl/visitor/baja-fibra").tipo, "desconocida");
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
  assert.deepEqual(traducirLegado("#/replay?t=dt.gob.cl/visitor/reclamo-despido/2026-11-21T07-28-42Z&perfil=mobile&paso=3"), {
    destino: "#/t/dt.gob.cl/visitor/reclamo-despido/2026-11-21T07-28-42Z/replay?intento=mobile&paso=3",
    aviso: null,
  });
  assert.equal(traducirLegado(`#/perfiles?t=${CON_TAREA}`), null);
  assert.equal(traducirLegado(`#/t/${CON_TAREA}/replay`), null);
  const legado = parsearHash(`#/replay?t=${CON_TAREA}&perfil=mobile`);
  assert.equal(legado.tipo, "legado");
  assert.equal(legado.destino, `#/t/${CON_TAREA}/replay?intento=mobile`);
});

test("enlaces viejos sin t → Corridas con aviso", () => {
  for (const hash of ["#/telarana", "#/replay?perfil=mobile&paso=2"]) {
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
  const hash = enlaceATanda("localhost:8080/visitor/baja/2026-11-21T07-28-42Z");
  assert.equal(hash, "#/t/localhost%3A8080/visitor/baja/2026-11-21T07-28-42Z/telarana");
  assert.equal(parsearHash(hash).tandaId, "localhost:8080/visitor/baja/2026-11-21T07-28-42Z");
});

test("un tandaId que armaría otra ruta no es una tanda", () => {
  for (const hash of [
    "#/t/..%2F..%2Fx/visitor/a/2026-01-01T00-00-00Z/telarana",
    "#/t/../visitor/a/2026-01-01T00-00-00Z/telarana",
    "#/t/s.cl/visitor/.oculta/2026-01-01T00-00-00Z/telarana",
    "#/t/s.cl/visitor/a%5Cb/2026-01-01T00-00-00Z/telarana",
    "#/t/s.cl/guide/a/2026-01-01T00-00-00Z/telarana",
  ]) {
    assert.equal(parsearHash(hash).tipo, "desconocida", hash);
  }
  assert.equal(parsearHash("#/t/wom.cl/visitor/baja-fibra-2/2026-01-01T00-00-00Z_01/telarana").tipo, "tanda");
  assert.equal(parsearHash("#/t/wom.cl/visitor/baja-fibra/2026-01-01T00-00-00Z_00/telarana").tipo, "desconocida");
});

test("normalizarPaso: vacío, inválido, fuera de rango", () => {
  assert.deepEqual(normalizarPaso(null, 12), { paso: 1, aviso: null });
  assert.deepEqual(normalizarPaso("4", 12), { paso: 4, aviso: null });
  assert.deepEqual(normalizarPaso("abc", 12), { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: "abc" } } });
  assert.deepEqual(normalizarPaso("0", 12), { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: "0" } } });
  assert.deepEqual(normalizarPaso("40", 12), { paso: 12, aviso: { clave: "comun.estado.pasoFueraDeRango", vars: { total: 12 } } });
});
