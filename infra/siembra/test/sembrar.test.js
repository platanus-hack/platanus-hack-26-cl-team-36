import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { sembrar } from "../sembrar.js";

const API = "https://api.test";

// `respuestas`: por "POST <url>" o "GET <url>", una lista que se consume en orden (la última se repite).
function fetchFalso(respuestas) {
  const llamadas = [];
  async function fetch(url, { method = "GET", body } = {}) {
    const pagina = method === "POST" ? JSON.parse(body).url : new URL(url).searchParams.get("url");
    llamadas.push({ method, url, body: body && JSON.parse(body) });
    const lista = respuestas[`${method} ${pagina}`];
    const respuesta = lista.length > 1 ? lista.shift() : lista[0];
    if (respuesta instanceof Error) throw respuesta;
    const [status, datos] = respuesta;
    return { status, json: async () => datos };
  }
  return { fetch, llamadas };
}

function reloj() {
  let t = 0;
  return { ahora: () => t, dormir: async (ms) => void (t += ms) };
}

const rev = (status, revision = "r1") => [200, { success: true, revision, status }];

test("pide cada página, la sigue hasta done o failed y avisa si alguna falló", async () => {
  const { fetch, llamadas } = fetchFalso({
    "POST https://a.cl/": [[202, { success: true, revision: "r1", status: "queued" }]],
    "GET https://a.cl/": [rev("running"), new Error("red caída"), rev("done")],
    "POST https://b.cl/": [[202, { success: true, revision: "r2", status: "queued" }]],
    "GET https://b.cl/": [rev("failed", "r2")],
  });
  const log = [];
  const { ok, paginas } = await sembrar(["https://a.cl/", "https://b.cl/"], { api: API, fetch, ...reloj(), log: (l) => log.push(l) });
  assert.equal(ok, false);
  assert.deepEqual(
    paginas.map(({ url, status, revision }) => [url, status, revision]),
    [
      ["https://a.cl/", "done", "r1"],
      ["https://b.cl/", "failed", "r2"],
    ],
  );
  assert.deepEqual(llamadas[0], { method: "POST", url: `${API}/revisiones`, body: { url: "https://a.cl/" } });
  assert.equal(llamadas.filter((l) => l.method === "POST").length, 2);
  assert.ok(log.some((l) => l.includes("red caída, se reintenta")));
  assert.ok(log.some((l) => l.startsWith("  ✔ done")));
});

test("todas done: ok, y una ya hecha no se consulta de nuevo", async () => {
  const { fetch, llamadas } = fetchFalso({ "POST https://a.cl/": [rev("done")] });
  const { ok } = await sembrar(["https://a.cl/"], { api: API, fetch, ...reloj(), log: () => {} });
  assert.equal(ok, true);
  assert.equal(llamadas.length, 1);
});

test("force va en el POST; un 429 se vuelve a pedir en la vuelta siguiente", async () => {
  const { fetch, llamadas } = fetchFalso({
    "POST https://a.cl/": [[429, { success: false, error: "tope" }], [202, { success: true, revision: "r1", status: "queued" }]],
    "GET https://a.cl/": [rev("done")],
  });
  const { ok } = await sembrar(["https://a.cl/"], { api: API, force: true, fetch, ...reloj(), log: () => {} });
  assert.equal(ok, true);
  assert.deepEqual(
    llamadas.map((l) => [l.method, l.body]),
    [
      ["POST", { url: "https://a.cl/", force: true }],
      ["POST", { url: "https://a.cl/", force: true }],
      ["GET", undefined],
    ],
  );
});

test("una URL repetida se pide una sola vez", async () => {
  const { fetch, llamadas } = fetchFalso({ "POST https://a.cl/": [rev("done")] });
  const { paginas } = await sembrar(["https://a.cl/", "https://a.cl/"], { api: API, fetch, ...reloj(), log: () => {} });
  assert.equal(paginas.length, 1);
  assert.equal(llamadas.length, 1);
});

test("un POST rechazado cuenta como fallida", async () => {
  const { fetch } = fetchFalso({ "POST nada": [[400, { success: false, error: "url inválida" }]] });
  const { ok, paginas } = await sembrar(["nada"], { api: API, fetch, ...reloj(), log: () => {} });
  assert.equal(ok, false);
  assert.deepEqual([paginas[0].status, paginas[0].error], ["failed", "POST 400 url inválida"]);
});

test("al pasar el tope de tiempo deja de esperar y falla", async () => {
  const { fetch } = fetchFalso({ "POST https://a.cl/": [[202, { success: true, revision: "r1", status: "queued" }]], "GET https://a.cl/": [rev("running")] });
  const { ok, paginas } = await sembrar(["https://a.cl/"], { api: API, fetch, ...reloj(), intervaloMs: 1000, topeMs: 5000, log: () => {} });
  assert.equal(ok, false);
  assert.deepEqual([paginas[0].status, paginas[0].error], ["running", "tope de tiempo"]);
});

test("las páginas de demo son las de las tareas de agents/tasks/", async () => {
  const tareas = new URL("../../../agents/tasks/", import.meta.url);
  const demo = JSON.parse(await readFile(new URL("demo.json", tareas), "utf8"));
  const inicios = new Set();
  for (const host of await readdir(tareas, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    for (const archivo of await readdir(new URL(`${host.name}/`, tareas))) {
      inicios.add(JSON.parse(await readFile(new URL(`${host.name}/${archivo}`, tareas), "utf8")).start_url);
    }
  }
  assert.ok(demo.length > 0);
  for (const url of demo) assert.ok(inicios.has(url), `${url} no es el start_url de ninguna tarea`);
});
