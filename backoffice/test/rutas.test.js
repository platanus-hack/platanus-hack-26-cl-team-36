import { test } from "node:test";
import assert from "node:assert/strict";
import {
  segmentoDePestana,
  DISPOSITIVOS,
  ESTADOS_DE_REVISIONES,
  PESTANAS,
  PESTANAS_DEL_OVERVIEW,
  enlaceARevision,
  enlaceARevisiones,
  enlaceATanda,
  enlaceAVivo,
  extraerIdioma,
  hashDe,
  normalizarPaso,
  origenDeHoja,
  parametrosQueSiguen,
  parsearHash,
  traducirLegado,
} from "../public/nucleo/rutas.js";

const CON_TAREA = "wom.cl/visitor/baja-fibra/2026-11-21T07-28-42Z";

test("Overview: #/ (y el hash vacío) con dispositivo y pestaña, que van y vuelven en ese orden", () => {
  assert.deepEqual(parsearHash(""), { tipo: "overview", parametros: {} });
  assert.deepEqual(parsearHash("#/"), { tipo: "overview", parametros: {} });
  assert.deepEqual(parsearHash("#"), { tipo: "overview", parametros: {} });
  const ruta = parsearHash("#/?pestana=failed&dispositivo=mobile");
  assert.deepEqual(ruta, { tipo: "overview", parametros: { dispositivo: "mobile", pestana: "failed" } });
  assert.equal(hashDe(ruta), "#/?dispositivo=mobile&pestana=failed");
  assert.equal(hashDe({ tipo: "overview", parametros: { pestana: "live" } }), "#/?pestana=live");
  assert.equal(hashDe({ tipo: "overview", parametros: { dispositivo: "desktop" } }), "#/?dispositivo=desktop");
  assert.deepEqual(DISPOSITIVOS, ["all", "desktop", "mobile"]);
  assert.deepEqual(PESTANAS_DEL_OVERVIEW, ["recent", "live", "failed"]);
  // Delivered ya no es un filtro: un enlace viejo cae en All (recent, que no se escribe).
  assert.deepEqual(parsearHash("#/?pestana=delivered&pagina=2").parametros, { pagina: "2" });
  for (const dispositivo of DISPOSITIVOS) {
    for (const pestana of PESTANAS_DEL_OVERVIEW) {
      const hash = hashDe({ tipo: "overview", parametros: { dispositivo, pestana } });
      assert.equal(hashDe(parsearHash(hash)), hash);
    }
  }
});

test("Overview: all y recent no se escriben; un valor o un parámetro desconocido se descarta", () => {
  assert.equal(hashDe({ tipo: "overview", parametros: { dispositivo: "all", pestana: "recent" } }), "#/");
  assert.deepEqual(parsearHash("#/?dispositivo=all&pestana=recent").parametros, {});
  assert.deepEqual(parsearHash("#/?dispositivo=tablet&pestana=todo").parametros, {});
  assert.deepEqual(parsearHash("#/?dispositivo=Mobile&pestana=live").parametros, { pestana: "live" });
  assert.deepEqual(parsearHash("#/?foo=1&dispositivo=mobile").parametros, { dispositivo: "mobile" });
  assert.equal(hashDe({ tipo: "overview", parametros: { dispositivo: "tablet", foo: "1", idioma: "en" } }), "#/");
  // Sin tipo (o con uno que no es una vista) es el Overview.
  assert.equal(hashDe({}), "#/");
});

test("Overview: la búsqueda por link va antes de la página; vacía o demasiado larga se descarta", () => {
  const ruta = parsearHash("#/?pagina=2&link=metro.cl%2Fhorarios&pestana=failed");
  assert.deepEqual(ruta.parametros, { pestana: "failed", link: "metro.cl/horarios", pagina: "2" });
  assert.equal(hashDe(ruta), "#/?pestana=failed&link=metro.cl%2Fhorarios&pagina=2");
  assert.equal(hashDe({ tipo: "overview", parametros: { link: "metro horarios" } }), "#/?link=metro+horarios");
  for (const link of ["", "%20%20", "x".repeat(201)]) assert.deepEqual(parsearHash(`#/?link=${link}`).parametros, {}, link.slice(0, 10));
});

test("Overview: la página va al final y la 1 no se escribe; una que no es entero positivo se descarta", () => {
  const ruta = parsearHash("#/?pagina=3&pestana=failed&dispositivo=mobile");
  assert.deepEqual(ruta.parametros, { dispositivo: "mobile", pestana: "failed", pagina: "3" });
  assert.equal(hashDe(ruta), "#/?dispositivo=mobile&pestana=failed&pagina=3");
  assert.equal(hashDe({ tipo: "overview", parametros: { pestana: "live", pagina: 12 } }), "#/?pestana=live&pagina=12");
  assert.equal(hashDe({ tipo: "overview", parametros: { pestana: "live", pagina: 1 } }), "#/?pestana=live");
  assert.equal(hashDe({ tipo: "overview", parametros: { pagina: null } }), "#/");
  for (const pagina of ["0", "-1", "2.5", "02", "abc", "10000"]) {
    assert.deepEqual(parsearHash(`#/?pagina=${pagina}`).parametros, {}, pagina);
  }
});

test("Corridas: #/corridas y sus parámetros van y vuelven", () => {
  assert.deepEqual(parsearHash("#/corridas"), { tipo: "corridas", parametros: {} });
  const hash = "#/corridas?q=sii&sitio=sii.cl&filtro=problemas&orden=exito&vista=grilla";
  const ruta = parsearHash(hash);
  assert.equal(ruta.tipo, "corridas");
  assert.deepEqual(ruta.parametros, { q: "sii", sitio: "sii.cl", filtro: "problemas", orden: "exito", vista: "grilla" });
  assert.equal(hashDe(ruta), hash);
  assert.equal(hashDe({ tipo: "corridas" }), "#/corridas");
  assert.equal(parsearHash("#/corridas/otra").tipo, "desconocida");
});

test("enlaces viejos a Corridas (#/?q=…) se reescriben a #/corridas?… solo con sus parámetros", () => {
  const viejo = "#/?vista=grilla&q=sii&dispositivo=mobile&orden=exito&filtro=problemas&sitio=sii.cl&x=1";
  assert.deepEqual(traducirLegado(viejo), {
    destino: "#/corridas?q=sii&sitio=sii.cl&filtro=problemas&orden=exito&vista=grilla",
    aviso: null,
  });
  const ruta = parsearHash(viejo);
  assert.equal(ruta.tipo, "legado");
  assert.equal(ruta.destino, "#/corridas?q=sii&sitio=sii.cl&filtro=problemas&orden=exito&vista=grilla");
  assert.equal(ruta.aviso, null);
  // Cualquiera de esos parámetros basta, aunque traiga el valor por defecto (que no se escribe).
  for (const [hash, destino] of [
    ["#/?q=sii", "#/corridas?q=sii"],
    ["#/?sitio=wom.cl", "#/corridas?sitio=wom.cl"],
    ["#/?filtro=errores", "#/corridas?filtro=errores"],
    ["#/?orden=nuevas", "#/corridas"],
    ["#/?vista=lista&pestana=live", "#/corridas"],
  ]) {
    assert.deepEqual(parsearHash(hash), { tipo: "legado", destino, aviso: null }, hash);
  }
  // Sin parámetros de Corridas (o vacíos) es el Overview, no un enlace viejo.
  assert.equal(traducirLegado("#/"), null);
  assert.equal(traducirLegado("#/?dispositivo=mobile"), null);
  assert.equal(parsearHash("#/?q=").tipo, "overview");
});

test("Revisiones: #/revisiones y #/revisiones/<revision>; una revisión inválida no es ruta", () => {
  assert.deepEqual(parsearHash("#/revisiones"), { tipo: "revisiones", revision: null, parametros: {} });
  assert.deepEqual(parsearHash("#/revisiones/abc-123"), { tipo: "revisiones", revision: "abc-123", parametros: {} });
  assert.equal(hashDe(parsearHash("#/revisiones/abc-123?x=1")), "#/revisiones/abc-123");
  assert.equal(hashDe(parsearHash("#/revisiones/abc-123?estado=failed")), "#/revisiones/abc-123");
  assert.equal(enlaceARevision(), "#/revisiones");
  for (const hash of ["#/revisiones/ABC", "#/revisiones/..%2Fx", `#/revisiones/${"a".repeat(41)}`, "#/revisiones/a/b/c"]) {
    assert.equal(parsearHash(hash).tipo, "desconocida", hash);
  }
});

test("En vivo: #/revisiones/<revision>/<goal> va y vuelve; un goal inválido no es ruta", () => {
  const ruta = parsearHash("#/revisiones/abc-123/planificar-viaje?x=1");
  assert.deepEqual(ruta, { tipo: "vivo", revision: "abc-123", goal: "planificar-viaje", parametros: {} });
  assert.equal(hashDe(ruta), "#/revisiones/abc-123/planificar-viaje");
  assert.equal(enlaceAVivo("abc-123", "horario"), "#/revisiones/abc-123/horario");
  for (const hash of ["#/revisiones/abc/Horario", "#/revisiones/abc/..%2Fx", "#/revisiones/ABC/horario", "#/revisiones/abc/a_b"]) {
    assert.equal(parsearHash(hash).tipo, "desconocida", hash);
  }
});

test("Revisiones: ?estado=live|done|failed|historial filtra la lista; enlaceARevisiones arma el enlace", () => {
  assert.deepEqual(ESTADOS_DE_REVISIONES, ["live", "done", "failed", "historial"]);
  for (const estado of ESTADOS_DE_REVISIONES) {
    const hash = `#/revisiones?estado=${estado}`;
    assert.deepEqual(parsearHash(hash), { tipo: "revisiones", revision: null, parametros: { estado } });
    assert.equal(hashDe(parsearHash(hash)), hash);
    assert.equal(enlaceARevisiones(estado), hash);
  }
  assert.equal(enlaceARevisiones(), "#/revisiones");
  assert.equal(enlaceARevisiones(null), "#/revisiones");
  assert.equal(enlaceARevisiones("running"), "#/revisiones");
  assert.deepEqual(parsearHash("#/revisiones?estado=running&x=1").parametros, {});
});

test("los valores por defecto y los vacíos no se escriben", () => {
  assert.equal(hashDe({ tipo: "corridas", parametros: { vista: "lista", orden: "nuevas", q: "" } }), "#/corridas");
  assert.equal(hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { paso: "3", intento: null } }), `#/t/${CON_TAREA}/replay?paso=3`);
});

test("orden estable de parámetros, sin importar el orden de entrada", () => {
  const a = hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "replay", parametros: { z: "1", paso: "4", intento: "mobile" } });
  assert.equal(a, `#/t/${CON_TAREA}/replay?intento=mobile&paso=4&z=1`);
  const b = hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: { pagina: "n2", z: "1", a: "2" } });
  assert.equal(b, `#/t/${CON_TAREA}/path-map?pagina=n2&a=2&z=1`);
});

test("cada pestaña, con y sin tarea, va y vuelve", () => {
  for (const tandaId of [CON_TAREA]) {
    for (const pestana of PESTANAS) {
      const hash = enlaceATanda(tandaId, pestana);
      assert.equal(hash, `#/t/${tandaId}/${segmentoDePestana(pestana)}`);
      assert.deepEqual(parsearHash(hash), { tipo: "tanda", tandaId, pestana, parametros: {} });
    }
  }
  assert.deepEqual(PESTANAS, ["telarana", "replay", "propuesta"]);
  assert.equal(segmentoDePestana("telarana"), "path-map");
  // Perfiles ya no existe: su pestaña y su enlace de la v0 son rutas desconocidas.
  assert.equal(parsearHash(`#/t/${CON_TAREA}/perfiles`).tipo, "desconocida");
  assert.equal(parsearHash(`#/perfiles?t=${CON_TAREA}`).tipo, "desconocida");
});

test("#/t/<id> sin pestaña abre el mapa; un enlace viejo a /resumen también", () => {
  const ruta = parsearHash(`#/t/${CON_TAREA}`);
  assert.deepEqual(ruta, { tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: {} });
  assert.equal(hashDe(ruta), `#/t/${CON_TAREA}/path-map`);
  const vieja = parsearHash(`#/t/${CON_TAREA}/resumen?x=1`);
  assert.deepEqual(vieja, { tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: {} });
  assert.equal(hashDe(vieja), `#/t/${CON_TAREA}/path-map`);
  assert.equal(parsearHash("#/t/2026-11-21_07-28-42").tipo, "desconocida");
});

test("alias dentro de una tanda: perfil= en Replay e nodo= en la Telaraña", () => {
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/replay?perfil=mobile&paso=2`).parametros, { intento: "mobile", paso: "2" });
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/path-map?nodo=n5`).parametros, { pagina: "n5" });
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
    destino: `#/t/${CON_TAREA}/path-map?perfil=hurried`,
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
    assert.equal(ruta.destino, "#/corridas");
    assert.equal(ruta.aviso, "comun.aviso.enlaceSinTanda");
  }
});

test("idioma= se separa del hash y nunca vuelve a escribirse", () => {
  assert.deepEqual(extraerIdioma("#/?idioma=en"), { idioma: "en", hash: "#/" });
  assert.deepEqual(extraerIdioma("#/?idioma=es&pestana=live"), { idioma: "es", hash: "#/?pestana=live" });
  assert.deepEqual(extraerIdioma(`#/t/${CON_TAREA}/replay?idioma=es&paso=2`), { idioma: "es", hash: `#/t/${CON_TAREA}/replay?paso=2` });
  assert.deepEqual(extraerIdioma("#/corridas?q=sii"), { idioma: null, hash: "#/corridas?q=sii" });
  assert.equal(hashDe({ tipo: "corridas", parametros: { idioma: "en", q: "x" } }), "#/corridas?q=x");
  assert.equal(hashDe({ tipo: "overview", parametros: { idioma: "en", pestana: "failed" } }), "#/?pestana=failed");
});

test("tandaId con caracteres especiales se codifica por segmento", () => {
  const hash = enlaceATanda("localhost:8080/visitor/baja/2026-11-21T07-28-42Z");
  assert.equal(hash, "#/t/localhost%3A8080/visitor/baja/2026-11-21T07-28-42Z/path-map");
  assert.equal(parsearHash(hash).tandaId, "localhost:8080/visitor/baja/2026-11-21T07-28-42Z");
});

test("un tandaId que armaría otra ruta no es una tanda", () => {
  for (const hash of [
    "#/t/..%2F..%2Fx/visitor/a/2026-01-01T00-00-00Z/path-map",
    "#/t/../visitor/a/2026-01-01T00-00-00Z/path-map",
    "#/t/s.cl/visitor/.oculta/2026-01-01T00-00-00Z/path-map",
    "#/t/s.cl/visitor/a%5Cb/2026-01-01T00-00-00Z/path-map",
    "#/t/s.cl/guide/a/2026-01-01T00-00-00Z/path-map",
  ]) {
    assert.equal(parsearHash(hash).tipo, "desconocida", hash);
  }
  assert.equal(parsearHash("#/t/wom.cl/visitor/baja-fibra-2/2026-01-01T00-00-00Z_01/path-map").tipo, "tanda");
  assert.equal(parsearHash("#/t/wom.cl/visitor/baja-fibra/2026-01-01T00-00-00Z_00/path-map").tipo, "desconocida");
});

test("normalizarPaso: vacío, inválido, fuera de rango", () => {
  assert.deepEqual(normalizarPaso(null, 12), { paso: 1, aviso: null });
  assert.deepEqual(normalizarPaso("4", 12), { paso: 4, aviso: null });
  assert.deepEqual(normalizarPaso("abc", 12), { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: "abc" } } });
  assert.deepEqual(normalizarPaso("0", 12), { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: "0" } } });
  assert.deepEqual(normalizarPaso("40", 12), { paso: 12, aviso: { clave: "comun.estado.pasoFueraDeRango", vars: { total: 12 } } });
});

test("la pestaña Propuesta lleva la vista y el dispositivo en la URL, en ese orden", () => {
  assert.equal(
    hashDe({ tipo: "tanda", tandaId: CON_TAREA, pestana: "propuesta", parametros: { dispositivo: "mobile", vista: "n6" } }),
    `#/t/${CON_TAREA}/propuesta?vista=n6&dispositivo=mobile`,
  );
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/propuesta?vista=n6`), { tipo: "tanda", tandaId: CON_TAREA, pestana: "propuesta", parametros: { vista: "n6" } });
});

test("la hoja vuelve a la vista de la que vino; por enlace directo, al Overview", () => {
  assert.deepEqual(origenDeHoja({ tipo: "overview" }, "#/?pestana=live"), { clave: "overview", hash: "#/?pestana=live", conFondo: true });
  assert.deepEqual(origenDeHoja({ tipo: "revisiones", revision: "r1" }, "#/revisiones/r1"), { clave: "revisiones", hash: "#/revisiones/r1", conFondo: true });
  assert.deepEqual(origenDeHoja(null), { clave: "overview", hash: "#/", conFondo: false });
  assert.deepEqual(origenDeHoja({ tipo: "tanda" }, "#/t/x"), { clave: "overview", hash: "#/", conFondo: false });
  assert.deepEqual(origenDeHoja({ tipo: "desconocida" }, "#/nada"), { clave: "overview", hash: "#/", conFondo: false });
});

test("al cambiar de pestaña sigue solo la traza elegida", () => {
  assert.deepEqual(parametrosQueSiguen({ intento: "mobile", paso: "3", pagina: "n2" }), { intento: "mobile" });
  assert.deepEqual(parametrosQueSiguen({}), {});
  assert.equal(enlaceATanda(CON_TAREA, "telarana", { pagina: "n2", intento: "mobile" }), `#/t/${CON_TAREA}/path-map?intento=mobile&pagina=n2`);
});

test("el segmento anterior /telarana sigue abriendo el path map y su hash canónico es /path-map", () => {
  const vieja = parsearHash(`#/t/${CON_TAREA}/telarana?nodo=n5`);
  assert.deepEqual(vieja, { tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: { pagina: "n5" } });
  assert.equal(hashDe(vieja), `#/t/${CON_TAREA}/path-map?pagina=n5`);
  assert.deepEqual(parsearHash(`#/t/${CON_TAREA}/path-map`), { tipo: "tanda", tandaId: CON_TAREA, pestana: "telarana", parametros: {} });
});
