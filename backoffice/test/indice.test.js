// El índice del almacén (lib/indice.js): qué cuenta y qué vuelve a leer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearIndice, mapearEnParalelo } from "../lib/indice.js";
import { almacenEnMemoria } from "./almacen-en-memoria.js";

const CATALOGO = "demo.cl/cataloger/2026-11-21T09-00-00Z";
const GUIA = "demo.cl/guide/tarea/desktop/2026-11-21T09-10-00Z";
const CERRADA = "demo.cl/visitor/tarea/2026-11-21T10-00-00Z";
const EN_CURSO = "demo.cl/visitor/tarea/2026-11-21T11-00-00Z";

const run = (outcome, viewport = "1024x768", extra = {}) => ({
  viewport,
  start: { url: "https://www.demo.cl/", title: "Inicio - Demo", screenshot: "step_00.png" },
  verdict: { outcome },
  ...extra,
});

function almacen() {
  return almacenEnMemoria({
    [`${CATALOGO}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${GUIA}/manifest.json`]: JSON.stringify({ status: "running" }),
    [`${CERRADA}/manifest.json`]: JSON.stringify({ status: "succeeded" }),
    [`${CERRADA}/desktop/run.json`]: JSON.stringify(run("success")),
    [`${CERRADA}/mobile/run.json`]: JSON.stringify(run("failed", "390x844")),
    [`${CERRADA}/mobile-2/run.json`]: "{ roto",
    [`${CERRADA}/mobile-3/trace.json`]: JSON.stringify({ status: "running", profile: "mobile" }),
    [`${CERRADA}/../fuera/run.json`]: JSON.stringify(run("success")),
    [`${EN_CURSO}/manifest.json`]: JSON.stringify({ status: "running" }),
    [`${EN_CURSO}/desktop/run.json`]: JSON.stringify(run("abandoned")),
    [`${EN_CURSO}/mobile/trace.json`]: JSON.stringify({ status: "running", profile: "mobile" }),
    [`${EN_CURSO}/desktop-2/trace.json`]: JSON.stringify({ status: "succeeded", profile: "desktop" }),
  });
}

const resumen = (corridas) =>
  Object.fromEntries(corridas.map((c) => [c.clave, c.intentos ? [c.status, c.intentos.map((i) => `${i.carpeta}:${i.estado}/${i.dispositivo}`)] : c.status]));

test("índice: el estado de cada corrida y los intentos de cada tanda, con sus en curso", async () => {
  const indice = crearIndice(almacen());
  const { corridas, porClave } = await indice.leer();
  assert.deepEqual(resumen(corridas), {
    [CATALOGO]: "succeeded",
    [GUIA]: "running",
    [CERRADA]: ["succeeded", ["desktop:logrado/desktop", "mobile:fallido/mobile", "mobile-2:error/desktop"]],
    [EN_CURSO]: ["running", ["desktop:abandonado/desktop", "mobile:en_curso/mobile"]],
  });
  assert.equal(porClave.get(CERRADA).intentos[0].titulo, "Inicio - Demo");
  assert.deepEqual([porClave.get(GUIA).rol, porClave.get(GUIA).goal, porClave.get(GUIA).host], ["guide", "tarea", "demo.cl"]);
});

test("índice: lo cerrado se lee una vez; de lo abierto, solo el manifest, las trazas y las carpetas sin run.json", async () => {
  const fuente = almacen();
  const indice = crearIndice(fuente);
  await indice.leer();
  fuente.lecturas.length = 0;
  await indice.leer();
  assert.deepEqual(fuente.lecturas.sort(), [
    `${EN_CURSO}/desktop-2/run.json`,
    `${EN_CURSO}/desktop-2/trace.json`,
    `${EN_CURSO}/manifest.json`,
    `${EN_CURSO}/mobile/run.json`,
    `${EN_CURSO}/mobile/trace.json`,
    `${GUIA}/manifest.json`,
  ].sort());

  // La tanda termina: se lee una última vez y queda guardada.
  fuente.escribir(`${EN_CURSO}/mobile/run.json`, run("success", "390x844"));
  fuente.escribir(`${EN_CURSO}/manifest.json`, { status: "failed" });
  fuente.escribir(`${GUIA}/manifest.json`, { status: "succeeded" });
  const { porClave } = await indice.leer();
  assert.deepEqual(porClave.get(EN_CURSO).intentos.map((i) => `${i.carpeta}:${i.estado}`), ["desktop:abandonado", "mobile:logrado"]);
  fuente.lecturas.length = 0;
  await indice.leer();
  assert.deepEqual(fuente.lecturas, [], "todo cerrado: solo se vuelve a listar");

  // Una corrida nueva aparece en la pasada siguiente.
  fuente.escribir("demo.cl/improver/2026-11-21T12-00-00Z/manifest.json", { status: "running" });
  assert.equal((await indice.leer()).porClave.get("demo.cl/improver/2026-11-21T12-00-00Z").status, "running");
});

test("índice: una clave que no es de corrida no se lee; una corrida que falla al leerse se omite sin tumbar el resto", async (t) => {
  const fuente = almacen();
  const indice = crearIndice(fuente);
  assert.equal(await indice.corrida("demo.cl/visitor/../../etc"), null);
  assert.equal(await indice.corrida("demo.cl/guide/tarea/tablet/2026-11-21T09-10-00Z"), null);
  assert.deepEqual(fuente.lecturas, []);

  const consola = t.mock.method(console, "error", () => {});
  const leerJsonDetallado = fuente.leerJsonDetallado;
  fuente.leerJsonDetallado = async (id, relativa) => {
    if (id === GUIA) throw new Error("AccessDenied");
    return leerJsonDetallado(id, relativa);
  };
  const primera = await indice.leer();
  assert.equal(primera.porClave.has(GUIA), false);
  assert.equal(primera.corridas.length, 3);
  await indice.leer();
  assert.equal(consola.mock.callCount(), 1, "se avisa una vez");
});

test("mapearEnParalelo: conserva el orden y no pasa del límite", async () => {
  let enVuelo = 0;
  let maximo = 0;
  const resultado = await mapearEnParalelo([5, 1, 4, 2, 3], 2, async (n) => {
    enVuelo += 1;
    maximo = Math.max(maximo, enVuelo);
    await new Promise((listo) => setTimeout(listo, n));
    enVuelo -= 1;
    return n * 10;
  });
  assert.deepEqual(resultado, [50, 10, 40, 20, 30]);
  assert.equal(maximo, 2);
  assert.deepEqual(await mapearEnParalelo([], 3, async () => 1), []);
});
