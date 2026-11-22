// Tests de los temas guardados (src/background/cache-temas.js) con un storage.local simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAVE_INDICE_TEMAS, claveTema, crearCacheTemas } from "../src/background/cache-temas.js";

// Como storage.local: guarda copias, `get` de una clave o lista, `remove` de una clave o lista.
function crearArea(inicial = {}) {
  const datos = structuredClone(inicial);
  const lista = (claves) => (Array.isArray(claves) ? claves : [claves]);
  return {
    datos,
    async get(claves) {
      return Object.fromEntries(lista(claves).filter((c) => c in datos).map((c) => [c, structuredClone(datos[c])]));
    },
    async set(valores) {
      Object.assign(datos, structuredClone(valores));
    },
    async remove(claves) {
      for (const c of lista(claves)) delete datos[c];
    },
  };
}

const silencioso = { warn() {} };
const tema = (revision) => ({ id: `rev-${revision}`, nombre: `Revisión ${revision}`, css: `/* ${revision} */`, features: {} });
const reloj = () => {
  let t = 0;
  return () => ++t;
};

test("guarda y lee el tema de una página; otra página no lo ve", async () => {
  const cache = crearCacheTemas(crearArea(), { log: silencioso });
  await cache.guardar("https://a.cl/x", "r1", tema("r1"));
  assert.deepEqual(await cache.leer("https://a.cl/x"), { revision: "r1", tema: tema("r1") });
  assert.equal(await cache.leer("https://a.cl/y"), null);
});

test("guarda solo los más usados: descarta el de uso más antiguo y borra su clave", async () => {
  const area = crearArea();
  const cache = crearCacheTemas(area, { maximo: 2, ahora: reloj(), log: silencioso });
  await cache.guardar("https://a.cl/1", "r1", tema("r1"));
  await cache.guardar("https://a.cl/2", "r2", tema("r2"));
  await cache.leer("https://a.cl/1"); // ahora la 2 es la más antigua
  await cache.guardar("https://a.cl/3", "r3", tema("r3"));

  assert.deepEqual(Object.keys(area.datos[CLAVE_INDICE_TEMAS]).sort(), ["https://a.cl/1", "https://a.cl/3"]);
  assert.equal(claveTema("https://a.cl/2") in area.datos, false);
  assert.equal(await cache.leer("https://a.cl/2"), null);
  assert.equal((await cache.leer("https://a.cl/1")).revision, "r1");
});

test("guardados en paralelo no pierden entradas del índice", async () => {
  const area = crearArea();
  const cache = crearCacheTemas(area, { log: silencioso });
  await Promise.all(["1", "2", "3"].map((n) => cache.guardar(`https://a.cl/${n}`, `r${n}`, tema(`r${n}`))));
  assert.equal(Object.keys(area.datos[CLAVE_INDICE_TEMAS]).length, 3);
});

test("olvidar quita el tema y su entrada del índice", async () => {
  const area = crearArea();
  const cache = crearCacheTemas(area, { log: silencioso });
  await cache.guardar("https://a.cl/x", "r1", tema("r1"));
  await cache.olvidar("https://a.cl/x");
  assert.equal(await cache.leer("https://a.cl/x"), null);
  assert.deepEqual(area.datos[CLAVE_INDICE_TEMAS], {});
});

test("un valor guardado con otra forma no se usa", async () => {
  const area = crearArea({ [claveTema("https://a.cl/x")]: { revision: "r1", tema: { id: "rev-r1" } } });
  assert.equal(await crearCacheTemas(area, { log: silencioso }).leer("https://a.cl/x"), null);
});

test("si el almacén falla, no lanza: lee null y avisa", async () => {
  const avisos = [];
  const roto = { get: async () => Promise.reject(new Error("sin cuota")), set: async () => Promise.reject(new Error("x")) };
  const cache = crearCacheTemas(roto, { log: { warn: (...args) => avisos.push(args) } });
  assert.equal(await cache.leer("https://a.cl/x"), null);
  await cache.guardar("https://a.cl/x", "r1", tema("r1"));
  assert.equal(avisos.length, 2);
});
