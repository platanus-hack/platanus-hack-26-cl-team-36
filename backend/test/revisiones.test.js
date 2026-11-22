import { test } from "node:test";
import assert from "node:assert/strict";
import { crearRevisiones, nuevaRevision } from "../revisiones.js";
import { claveRevision, claveUrl } from "../estados.js";
import { agentesFalsos, almacenFalso, tablaFalsa } from "./fakes.js";

const AHORA = "2026-11-21T12:00:00.000Z";
const URL_PAGINA = "https://www.ejemplo.cl/precios/?ref=1";
const NORMALIZADA = "https://ejemplo.cl/precios";

function escenario({ falla, archivos } = {}) {
  const db = tablaFalsa();
  const almacen = almacenFalso(archivos);
  const agentes = agentesFalsos({ falla });
  let n = 0;
  const api = crearRevisiones({ db, almacen, agentes, ahora: () => new Date(AHORA), idRevision: () => `rev-${++n}` });
  return { db, agentes, api };
}

test("nuevaRevision cumple el formato del contrato", () => {
  const revision = nuevaRevision();
  assert.match(revision, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(revision.length <= 40);
  assert.notEqual(revision, nuevaRevision());
});

test("POST de una página nueva: 202, URL y META queued, invoca el conductor", async () => {
  const { db, agentes, api } = escenario();
  const respuesta = await api.solicitar(URL_PAGINA);
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-1", status: "queued" } });
  assert.deepEqual(db.item(claveUrl(NORMALIZADA)), { ...claveUrl(NORMALIZADA), revision: "rev-1", created_at: AHORA });
  assert.deepEqual(db.item(claveRevision("rev-1")), {
    ...claveRevision("rev-1"),
    url: URL_PAGINA,
    host: "ejemplo.cl",
    status: "queued",
    created_at: AHORA,
    updated_at: AHORA,
  });
  assert.deepEqual(agentes.invocaciones, [{ stage: "revision", revision: "rev-1", url: URL_PAGINA }]);
});

test("POST de una página ya vista: 200 con su estado, sin disparar otra revisión", async () => {
  for (const status of ["queued", "running", "failed"]) {
    const { db, agentes, api } = escenario();
    await api.solicitar(URL_PAGINA);
    await db.actualizar(claveRevision("rev-1"), { status });
    const respuesta = await api.solicitar("https://ejemplo.cl/precios");
    assert.deepEqual(respuesta, { estado: 200, datos: { success: true, revision: "rev-1", status } });
    assert.equal(agentes.invocaciones.length, 1);
  }
});

test("POST y GET de una revisión done devuelven el css", async () => {
  const { db, api } = escenario({ archivos: { "ejemplo.cl/improver/r1/tema.css": "html.mi-tema { color: red; }" } });
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "done", css_key: "ejemplo.cl/improver/r1/tema.css" });
  const esperado = {
    estado: 200,
    datos: { success: true, revision: "rev-1", status: "done", css: "html.mi-tema { color: red; }" },
  };
  assert.deepEqual(await api.solicitar(URL_PAGINA), esperado);
  assert.deepEqual(await api.consultar("https://ejemplo.cl/precios/"), esperado);
});

test("force dispara una revisión nueva para una página ya vista", async () => {
  const { db, agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  const respuesta = await api.solicitar(URL_PAGINA, { force: true });
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-2", status: "queued" } });
  assert.equal(db.item(claveUrl(NORMALIZADA)).revision, "rev-2");
  assert.equal(db.item(claveRevision("rev-2")).status, "queued");
  assert.deepEqual(agentes.invocaciones.map((p) => p.revision), ["rev-1", "rev-2"]);
});

test("si la invocación falla, META queda failed con el error", async () => {
  const { db, api } = escenario({ falla: Object.assign(new Error("sin runtime"), { name: "ResourceNotFoundException" }) });
  const respuesta = await api.solicitar(URL_PAGINA);
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-1", status: "failed" } });
  const meta = db.item(claveRevision("rev-1"));
  assert.equal(meta.status, "failed");
  assert.equal(meta.error, "ResourceNotFoundException: sin runtime");
});

test("GET de una página no vista: 404", async () => {
  const { api } = escenario();
  assert.deepEqual(await api.consultar(URL_PAGINA), { estado: 404, datos: { success: false } });
});

test("si otra solicitud ganó la carrera, responde con su revisión", async () => {
  const { db, agentes, api } = escenario();
  const obtener = db.obtener;
  let primera = true;
  // La primera lectura no ve la marca: otra solicitud la escribe justo después.
  db.obtener = async (clave) => {
    if (primera) {
      primera = false;
      await db.registrar([{ item: { ...claveUrl(NORMALIZADA), revision: "otra" }, nueva: true }]);
      await db.registrar([{ item: { ...claveRevision("otra"), status: "queued" }, nueva: true }]);
      return null;
    }
    return obtener(clave);
  };
  assert.deepEqual(await api.solicitar(URL_PAGINA), { estado: 200, datos: { success: true, revision: "otra", status: "queued" } });
  assert.equal(agentes.invocaciones.length, 0);
  assert.equal(db.item(claveRevision("rev-1")), undefined);
});
