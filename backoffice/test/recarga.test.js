// Cliente: si un import() de una pantalla falla (un despliegue nuevo), la página se recarga una sola vez por versión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recargarUnaVez, versionDe } from "../public/nucleo/recarga.js";

function almacenEnMemoria() {
  const datos = new Map();
  return { getItem: (clave) => datos.get(clave) ?? null, setItem: (clave, valor) => datos.set(clave, String(valor)) };
}

test("versionDe lee la versión de la URL del módulo", () => {
  assert.equal(versionDe("https://chameleonmode.app/backoffice/v/3571642f9c87/nucleo/recarga.js"), "3571642f9c87");
  assert.equal(versionDe("https://chameleonmode.app/backoffice/nucleo/recarga.js"), "");
});

test("recarga una vez por versión: un módulo que de verdad falta no recarga en bucle", () => {
  const almacen = almacenEnMemoria();
  let recargas = 0;
  const recargar = () => (recargas += 1);
  assert.equal(recargarUnaVez({ version: "a", almacen, recargar }), true);
  const otraVez = recargarUnaVez({ version: "a", almacen, recargar });
  assert.equal(otraVez, false, "ya recargó esta versión: muestra el aviso");
  assert.equal(recargas, 1);
  assert.equal(recargarUnaVez({ version: "b", almacen, recargar }), true, "otro despliegue: recarga de nuevo");
  assert.equal(recargas, 2);
});

test("sin sessionStorage (o si falla), no recarga", () => {
  let recargas = 0;
  const recargar = () => (recargas += 1);
  assert.equal(recargarUnaVez({ version: "a", almacen: null, recargar }), false);
  const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => {} };
  assert.equal(recargarUnaVez({ version: "a", almacen: roto, recargar }), false);
  assert.equal(recargas, 0);
});
