import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { crearFuente } from "../lib/fuente.js";
import { crearFuenteDeArchivos } from "../lib/fuentes/archivos.js";
import { leerTanda, listarTandas } from "../lib/tandas.js";
import { crearServidor } from "../servidor.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const ID = "tarea-demo/2026-11-21_10-00-00";
const leer = (relativa) => readFileSync(`${RAIZ}/${ID}/${relativa}`);
const texto = async (cuerpo) => Buffer.concat(await cuerpo.toArray()).toString("latin1");

test("fuente de archivos: ids, perfiles, JSON, archivos y rangos", async () => {
  const fuente = crearFuenteDeArchivos({ raiz: RAIZ });
  assert.equal(fuente.descripcion, "backoffice/test/fixtures/corridas");
  assert.deepEqual((await fuente.listarIds()).sort(), [ID, "tarea-demo/2026-11-21_11-00-00"]);
  assert.deepEqual((await fuente.listarPerfiles(ID)).sort(), ["first_time", "hurried", "mobile"]);
  assert.equal((await fuente.leerJson(ID, "route_tree.json")).task_id, "tarea-demo");
  assert.equal((await fuente.leerJson(ID, "first_time/run.json")).profile, "first_time");
  assert.equal(await fuente.leerJson(ID, "no-existe.json"), null);
  assert.equal(await fuente.existe(ID, "first_time/step_01.png"), true);
  assert.equal(await fuente.existe(ID, "first_time/video.webm"), false);
  assert.equal(await fuente.existe(ID, "first_time"), false, "una carpeta no es un archivo");
  assert.equal(await fuente.abrirArchivo(ID, "first_time/step_99.png"), null);

  const entero = await fuente.abrirArchivo(ID, "first_time/step_01.png");
  const bytes = leer("first_time/step_01.png");
  assert.equal(entero.tamano, bytes.length);
  assert.equal(entero.rango, null);
  assert.equal(await texto(entero.cuerpo), bytes.toString("latin1"));

  const parte = await fuente.abrirArchivo(ID, "first_time/step_01.png", { inicio: 1, fin: 3 });
  assert.deepEqual(parte.rango, { inicio: 1, fin: 3 });
  assert.equal(await texto(parte.cuerpo), bytes.subarray(1, 4).toString("latin1"));
  const final = await fuente.abrirArchivo(ID, "first_time/step_01.png", { fin: 5 });
  assert.deepEqual(final.rango, { inicio: bytes.length - 5, fin: bytes.length - 1 });
  final.cuerpo.destroy();
  const fuera = await fuente.abrirArchivo(ID, "first_time/step_01.png", { inicio: 10_000 });
  assert.deepEqual([fuera.cuerpo, fuera.rango], [null, null]);
});

test("fuente de archivos: la carpeta archivo/ nunca se lista, y se puede abrir como raíz", async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), "corridas-"));
  const tanda = (...partes) => {
    mkdirSync(path.join(raiz, ...partes), { recursive: true });
    writeFileSync(path.join(raiz, ...partes, "route_tree.json"), "{}");
  };
  try {
    tanda("tarea", "2026-11-21_20-00-00");
    tanda("archivo", "2026-11-21_10-00-00");
    tanda("archivo", "2026-11-21-4-exploradores", "tarea", "2026-11-21_10-00-00");
    assert.deepEqual(await crearFuenteDeArchivos({ raiz }).listarIds(), ["tarea/2026-11-21_20-00-00"]);
    const archivada = crearFuenteDeArchivos({ raiz: path.join(raiz, "archivo", "2026-11-21-4-exploradores") });
    assert.deepEqual(await archivada.listarIds(), ["tarea/2026-11-21_10-00-00"]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("crearFuente elige la fuente por tipo", () => {
  assert.equal(crearFuente({ tipo: "archivos", raiz: RAIZ }).descripcion, "backoffice/test/fixtures/corridas");
  assert.throws(() => crearFuente({ tipo: "s3" }), /Fuente desconocida: s3/);
});

// Una fuente en memoria: prueba que tandas.js y el servidor funcionan con cualquier implementación.
function crearFuenteFalsa(archivos) {
  const ids = [...new Set(Object.keys(archivos).map((ruta) => ruta.split("/").slice(0, 2).join("/")))];
  const de = (id, relativa) => archivos[`${id}/${relativa}`];
  return {
    descripcion: "memoria://corridas",
    listarIds: async () => ids,
    listarPerfiles: async (id) =>
      [...new Set(Object.keys(archivos).filter((r) => r.startsWith(`${id}/`)).map((r) => r.split("/")[2]).filter((p) => !p.includes(".")))],
    leerJson: async (id, relativa) => (de(id, relativa) ? JSON.parse(de(id, relativa)) : null),
    existe: async (id, relativa) => de(id, relativa) !== undefined,
    abrirArchivo: async (id, relativa, rango) => {
      const bytes = de(id, relativa);
      if (!bytes) return null;
      const inicio = rango?.inicio ?? 0;
      const fin = Math.min(rango?.fin ?? bytes.length - 1, bytes.length - 1);
      return { cuerpo: Readable.from([bytes.subarray(inicio, fin + 1)]), tamano: bytes.length, rango: rango ? { inicio, fin } : null };
    },
  };
}

const ARCHIVOS = Object.fromEntries(
  ["route_tree.json", "criteria.json", "first_time/run.json", "first_time/step_01.png", "hurried/run.json", "mobile/run.json"].map(
    (relativa) => [`${ID}/${relativa}`, leer(relativa)],
  ),
);

let servidor;
let base;
before(async () => {
  servidor = crearServidor({ fuente: crearFuenteFalsa(ARCHIVOS) });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

test("tandas.js lee de una fuente en memoria", async () => {
  const fuente = crearFuenteFalsa(ARCHIVOS);
  const { carpeta, tandas } = await listarTandas(fuente);
  assert.equal(carpeta, "memoria://corridas");
  assert.deepEqual(tandas.map((t) => t.id), [ID]);
  const tanda = await leerTanda(fuente, ID);
  assert.deepEqual(tanda.intentos.map((i) => i.id), ["first_time", "hurried", "mobile"]);
  assert.equal(await leerTanda(fuente, "tarea-demo/2099-01-01_00-00-00"), null);
});

test("el servidor funciona con una fuente en memoria", async () => {
  const lista = await (await fetch(`${base}/api/tandas`)).json();
  assert.deepEqual([lista.carpeta, lista.tandas.map((t) => t.id)], ["memoria://corridas", [ID]]);
  assert.equal((await (await fetch(`${base}/api/tandas/${ID}`)).json()).kpis.intentos, 3);
  const captura = await fetch(`${base}/archivos/${ID}/first_time/step_01.png`);
  assert.equal(captura.status, 200);
  assert.equal(captura.headers.get("content-type"), "image/png");
  assert.equal((await captura.arrayBuffer()).byteLength, ARCHIVOS[`${ID}/first_time/step_01.png`].length);
  const parte = await fetch(`${base}/archivos/${ID}/first_time/step_01.png`, { headers: { Range: "bytes=0-3" } });
  assert.equal(parte.status, 206);
  assert.equal((await parte.arrayBuffer()).byteLength, 4);
  assert.equal((await fetch(`${base}/archivos/${ID}/first_time/run.json`)).status, 404);
});
