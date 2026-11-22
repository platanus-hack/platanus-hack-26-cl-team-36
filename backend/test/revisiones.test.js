import { test } from "node:test";
import assert from "node:assert/strict";
import { crearRevisiones, nuevaRevision } from "../revisiones.js";
import { crearProyectora } from "../proyectora.js";
import { claveRevision, claveUrl } from "../estados.js";
import { agentesFalsos, almacenFalso, tablaFalsa } from "./fakes.js";

const AHORA = "2026-11-21T12:00:00.000Z";
const URL_PAGINA = "https://www.ejemplo.cl/precios/?ref=1";
const NORMALIZADA = "https://ejemplo.cl/precios";
const PAGINA = "https://www.ejemplo.cl/precios/";

function escenario({ falla, archivos, maxEnCurso } = {}) {
  const db = tablaFalsa();
  const almacen = almacenFalso(archivos);
  const agentes = agentesFalsos({ falla });
  let n = 0;
  const api = crearRevisiones({ db, almacen, agentes, ahora: () => new Date(AHORA), idRevision: () => `rev-${++n}`, maxEnCurso });
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
    url: PAGINA,
    host: "ejemplo.cl",
    status: "queued",
    created_at: AHORA,
    updated_at: AHORA,
  });
  assert.deepEqual(agentes.invocaciones, [{ stage: "revision", revision: "rev-1", url: PAGINA }]);
});

test("POST de una página ya vista: 200 con su estado, sin disparar otra revisión", async () => {
  for (const status of ["queued", "running", "done"]) {
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

test("css solo de un tema.css del improver", async () => {
  const { db, api } = escenario({ archivos: { "otro/secreto.json": "{}" } });
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "done", css_key: "otro/secreto.json" });
  assert.deepEqual((await api.consultar(URL_PAGINA)).datos, { success: true, revision: "rev-1", status: "done" });
});

test("force no duplica una revisión en curso", async () => {
  const { agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  assert.deepEqual(await api.solicitar(URL_PAGINA, { force: true }), {
    estado: 200,
    datos: { success: true, revision: "rev-1", status: "queued" },
  });
  assert.equal(agentes.invocaciones.length, 1);
});

test("force dispara una revisión nueva para una página ya revisada", async () => {
  const { db, agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "failed" });
  const respuesta = await api.solicitar(URL_PAGINA, { force: true });
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-2", status: "queued" } });
  assert.equal(db.item(claveUrl(NORMALIZADA)).revision, "rev-2");
  assert.equal(db.item(claveRevision("rev-2")).status, "queued");
  assert.deepEqual(agentes.invocaciones.map((p) => p.revision), ["rev-1", "rev-2"]);
});

test("POST sin force de una página cuya revisión falló: 202 con una revisión nueva", async () => {
  const { db, agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "failed" });
  const respuesta = await api.solicitar(URL_PAGINA);
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-2", status: "queued" } });
  assert.equal(db.item(claveUrl(NORMALIZADA)).revision, "rev-2");
  assert.deepEqual(agentes.invocaciones.map((p) => p.revision), ["rev-1", "rev-2"]);
});

test("dos POST simultáneos sobre una página fallida crean una sola revisión", async () => {
  const { db, agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "failed" });
  const respuestas = await Promise.all([api.solicitar(URL_PAGINA), api.solicitar(URL_PAGINA)]);
  assert.deepEqual(respuestas.map((r) => r.datos.revision), ["rev-2", "rev-2"]);
  assert.deepEqual(agentes.invocaciones.map((p) => p.revision), ["rev-1", "rev-2"]);
});

test("una revisión en curso sin novedades hace más de una hora se reemplaza; una reciente no", async () => {
  const { db, agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "running", updated_at: "2026-11-21T11:00:00.000Z" });
  assert.equal((await api.solicitar(URL_PAGINA)).estado, 200);
  await db.actualizar(claveRevision("rev-1"), { updated_at: "2026-11-21T10:59:59.000Z" });
  assert.deepEqual(await api.solicitar(URL_PAGINA), { estado: 202, datos: { success: true, revision: "rev-2", status: "queued" } });
  assert.equal((await api.consultar(URL_PAGINA)).datos.revision, "rev-2");
  assert.equal(agentes.invocaciones.length, 2);
});

test("con el tope de revisiones en curso: 429 sin crear nada", async () => {
  const { db, agentes, api } = escenario({ maxEnCurso: 2 });
  await api.solicitar("https://a.cl/");
  await api.solicitar("https://b.cl/");
  const respuesta = await api.solicitar(URL_PAGINA);
  assert.equal(respuesta.estado, 429);
  assert.equal(respuesta.datos.success, false);
  assert.match(respuesta.datos.error, /2 revisiones en curso/);
  assert.equal(db.item(claveUrl(NORMALIZADA)), undefined);
  assert.equal(agentes.invocaciones.length, 2);

  // Una página ya vista responde igual, y al terminar una se libera el cupo.
  assert.equal((await api.solicitar("https://a.cl/")).estado, 200);
  await db.actualizar(claveRevision("rev-1"), { status: "done" });
  assert.equal((await api.solicitar(URL_PAGINA)).estado, 202);
});

test("una revisión en curso sin novedades hace más de una hora no cuenta para el tope", async () => {
  const { db, api } = escenario({ maxEnCurso: 1 });
  await api.solicitar("https://a.cl/");
  await db.actualizar(claveRevision("rev-1"), { updated_at: "2026-11-21T10:59:59.000Z" });
  assert.equal((await api.solicitar(URL_PAGINA)).estado, 202);
});

test("si la invocación falla, META queda failed con el error", async () => {
  const { db, api } = escenario({ falla: Object.assign(new Error("sin runtime"), { name: "ResourceNotFoundException" }) });
  const respuesta = await api.solicitar(URL_PAGINA);
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-1", status: "failed" } });
  const meta = db.item(claveRevision("rev-1"));
  assert.equal(meta.status, "failed");
  assert.equal(meta.error, "ResourceNotFoundException: sin runtime");
});

const TIMEOUT = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError", incierta: true });

test("si la invocación no se confirma (timeout), META queda queued y se reintenta pasada la hora", async () => {
  const { db, api } = escenario({ falla: TIMEOUT });
  const respuesta = await api.solicitar(URL_PAGINA);
  assert.deepEqual(respuesta, { estado: 202, datos: { success: true, revision: "rev-1", status: "queued" } });
  assert.equal(db.item(claveRevision("rev-1")).status, "queued");
  assert.equal((await api.solicitar(URL_PAGINA)).estado, 200);
  await db.actualizar(claveRevision("rev-1"), { updated_at: "2026-11-21T10:59:59.000Z" });
  assert.equal((await api.solicitar(URL_PAGINA)).datos.revision, "rev-2");
});

test("un conductor que sí recibió la invocación con timeout lleva META a done", async () => {
  const { db, api } = escenario({ falla: TIMEOUT });
  await api.solicitar(URL_PAGINA);
  const clave = "ejemplo.cl/conductor/20261121T120000Z/manifest.json";
  const almacen = almacenFalso({ [clave]: { agent: "conductor", status: "succeeded", revision: "rev-1" } });
  await crearProyectora({ db, almacen })(clave);
  assert.equal(db.item(claveRevision("rev-1")).status, "done");
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
      await db.registrar([{ item: { ...claveUrl(NORMALIZADA), revision: "otra" }, reemplaza: null }]);
      await db.registrar([{ item: { ...claveRevision("otra"), status: "queued", updated_at: AHORA }, reemplaza: null }]);
      return null;
    }
    return obtener(clave);
  };
  assert.deepEqual(await api.solicitar(URL_PAGINA), { estado: 200, datos: { success: true, revision: "otra", status: "queued" } });
  assert.equal(agentes.invocaciones.length, 0);
  assert.equal(db.item(claveRevision("rev-1")), undefined);
});

test("dos force simultáneos: solo uno reemplaza la revisión", async () => {
  const { db, agentes, api } = escenario();
  await api.solicitar(URL_PAGINA);
  await db.actualizar(claveRevision("rev-1"), { status: "done" });
  const [a, b] = await Promise.all([api.solicitar(URL_PAGINA, { force: true }), api.solicitar(URL_PAGINA, { force: true })]);
  assert.deepEqual([a.estado, b.estado].sort(), [200, 202]);
  assert.equal(agentes.invocaciones.length, 2);
  assert.equal(db.item(claveUrl(NORMALIZADA)).revision, a.estado === 202 ? a.datos.revision : b.datos.revision);
});

test("si la transacción choca siempre, lanza en vez de responder", async () => {
  const { db, api } = escenario();
  db.registrar = async () => false;
  await assert.rejects(api.solicitar(URL_PAGINA), /No se pudo registrar/);
});
