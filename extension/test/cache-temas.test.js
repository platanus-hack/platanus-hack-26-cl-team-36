// Tests de las respuestas de revisión guardadas (src/background/cache-temas.js) con un storage.local simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAVE_INDICE_TEMAS, claveTema, crearCacheTemas } from "../src/background/cache-temas.js";

// Como storage.local: guarda copias, `get` de una clave o lista, `remove` de una clave o lista. Registra las escrituras.
function crearArea(inicial = {}) {
  const datos = structuredClone(inicial);
  const escrituras = [];
  const lista = (claves) => (Array.isArray(claves) ? claves : [claves]);
  return {
    datos,
    escrituras,
    async get(claves) {
      return Object.fromEntries(lista(claves).filter((c) => c in datos).map((c) => [c, structuredClone(datos[c])]));
    },
    async set(valores) {
      escrituras.push(["set", ...Object.keys(valores)]);
      Object.assign(datos, structuredClone(valores));
    },
    async remove(claves) {
      escrituras.push(["remove", ...lista(claves)]);
      for (const c of lista(claves)) delete datos[c];
    },
  };
}

const silencioso = { warn() {} };
const respuesta = (revision, css = `/* ${revision} */`) => ({ revision, css });
const reloj = () => {
  let t = 0;
  return () => ++t;
};

test("guarda y lee la respuesta de una clave; otra clave no la ve", async () => {
  const cache = crearCacheTemas(crearArea(), { log: silencioso });
  await cache.guardar("api a.cl/x", respuesta("r1"));
  assert.deepEqual(await cache.leer("api a.cl/x"), respuesta("r1"));
  assert.equal(await cache.leer("api a.cl/y"), null);
});

test("escribe el tema antes que el índice", async () => {
  const area = crearArea();
  await crearCacheTemas(area, { log: silencioso }).guardar("x", respuesta("r1"));
  assert.deepEqual(area.escrituras, [["set", claveTema("x")], ["set", CLAVE_INDICE_TEMAS]]);
});

test("una clave que no está en el índice no se usa", async () => {
  const area = crearArea({ [claveTema("x")]: respuesta("r1") });
  assert.equal(await crearCacheTemas(area, { log: silencioso }).leer("x"), null);
});

test("guarda solo los más usados: descarta el de uso más antiguo antes de escribir el nuevo", async () => {
  const area = crearArea();
  const cache = crearCacheTemas(area, { maximo: 2, ahora: reloj(), log: silencioso });
  await cache.guardar("1", respuesta("r1"));
  await cache.guardar("2", respuesta("r2"));
  await cache.leer("1"); // ahora la 2 es la más antigua
  area.escrituras.length = 0;
  await cache.guardar("3", respuesta("r3"));

  const orden = area.escrituras.map((e) => e.join(" "));
  assert.ok(orden.indexOf(`remove ${claveTema("2")}`) < orden.indexOf(`set ${claveTema("3")}`));
  assert.notEqual(orden.indexOf(`remove ${claveTema("2")}`), -1);
  assert.deepEqual(Object.keys(area.datos[CLAVE_INDICE_TEMAS]).sort(), ["1", "3"]);
  assert.equal(await cache.leer("2"), null);
  assert.equal((await cache.leer("1")).revision, "r1");
});

test("no pasa del tope de bytes: descarta los más antiguos y no guarda una respuesta más grande que el tope", async () => {
  const area = crearArea();
  const css = "x".repeat(400);
  const cache = crearCacheTemas(area, { maximoBytes: 1000, ahora: reloj(), log: silencioso });
  await cache.guardar("1", respuesta("r1", css));
  await cache.guardar("2", respuesta("r2", css));
  await cache.guardar("3", respuesta("r3", css));
  assert.deepEqual(Object.keys(area.datos[CLAVE_INDICE_TEMAS]).sort(), ["2", "3"]);
  assert.equal(claveTema("1") in area.datos, false);

  await cache.guardar("4", respuesta("r4", "x".repeat(2000)));
  assert.equal(claveTema("4") in area.datos, false);
  assert.equal("4" in area.datos[CLAVE_INDICE_TEMAS], false);
});

test("guardados en paralelo no pierden entradas del índice", async () => {
  const area = crearArea();
  const cache = crearCacheTemas(area, { log: silencioso });
  await Promise.all(["1", "2", "3"].map((n) => cache.guardar(n, respuesta(`r${n}`))));
  assert.equal(Object.keys(area.datos[CLAVE_INDICE_TEMAS]).length, 3);
});

test("olvidar quita la respuesta y su entrada del índice", async () => {
  const area = crearArea();
  const cache = crearCacheTemas(area, { log: silencioso });
  await cache.guardar("x", respuesta("r1"));
  await cache.olvidar("x");
  assert.equal(await cache.leer("x"), null);
  assert.deepEqual(area.datos[CLAVE_INDICE_TEMAS], {});
});

test("un valor guardado con otra forma no se usa", async () => {
  const area = crearArea({
    [claveTema("x")]: { revision: "r1" },
    [CLAVE_INDICE_TEMAS]: { x: { usadoEn: 1, bytes: 10 } },
  });
  assert.equal(await crearCacheTemas(area, { log: silencioso }).leer("x"), null);
});

test("si el almacén falla, no lanza: lee null y avisa", async () => {
  const avisos = [];
  const roto = { get: async () => Promise.reject(new Error("sin cuota")), set: async () => Promise.reject(new Error("x")) };
  const cache = crearCacheTemas(roto, { log: { warn: (...args) => avisos.push(args) } });
  assert.equal(await cache.leer("x"), null);
  await cache.guardar("x", respuesta("r1"));
  assert.equal(avisos.length, 2);
});
