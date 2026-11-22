// GET /api/vivo/<revision>/<goal> contra la fuente local (una copia de fixtures/vivo) y una tabla falsa: la traza
// crece entre sondeos, Last-Event-ID, el cierre con `fin` y lo que no es de la tabla.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearFuenteDeArchivos } from "../lib/fuentes/archivos.js";
import { crearRevisiones } from "../lib/revisiones.js";
import { crearServidor } from "../servidor.js";
import { clienteDynamoFalso, comandosDynamo } from "./aws-falso.js";

const TABLA = "chameleon-revisiones";
const FIXTURE = fileURLToPath(new URL("./fixtures/vivo", import.meta.url));
const GUIA = "ejemplo.test/guide/horario/desktop/2026-11-22T12-00-00Z";
const VISITA = "ejemplo.test/visitor/horario/2026-11-22T12-05-00Z";
const AYUDA = { url: "https://www.ejemplo.test/ayuda", title: "Ayuda" };
const HORARIO = { url: "https://www.ejemplo.test/ayuda/horario", title: "Horario" };

const item = (SK, status, campos = {}) => ({ PK: "REV#en-curso", SK, status, updated_at: "2026-11-22T12:05:04Z", ...campos });
const items = [
  { PK: "REV#en-curso", SK: "META", host: "ejemplo.test", url: "https://www.ejemplo.test/", status: "running", goals_total: 1 },
  item("GOAL#horario#guide", "succeeded", { run_key: GUIA, trace_key: `${GUIA}/trace.json` }),
  item("GOAL#horario#visitor", "running", { run_key: VISITA, trace_key: `${VISITA}/desktop/trace.json` }),
];

let raiz;
let servidor;
let base;
before(async () => {
  raiz = mkdtempSync(path.join(tmpdir(), "vivo-"));
  cpSync(FIXTURE, raiz, { recursive: true });
  const revisiones = crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, items, { porPagina: 50 }), comandos: comandosDynamo, fuente: crearFuenteDeArchivos({ raiz }) });
  servidor = crearServidor({ raizCorridas: raiz, revisiones, vivo: { intervaloMs: 30, latidoMs: 60, tope: 2 } });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}/backoffice/api/vivo`;
});
after(() => {
  servidor.close();
  rmSync(raiz, { recursive: true, force: true });
});

const traza = (status, pasos) => ({
  schema_version: 1,
  agent: "visitor",
  profile: "desktop",
  status,
  start: { url: "https://www.ejemplo.test/", title: "Inicio" },
  steps: pasos,
});
const paso = (number, antes, despues, segundos) => ({
  number,
  action: "left_click",
  url_before: antes.url,
  title_before: antes.title,
  url: despues.url,
  title: despues.title,
  seconds_since_start: segundos,
  signals: [],
});
const PASOS = [paso(1, { url: "https://www.ejemplo.test/", title: "Inicio" }, AYUDA, 4), paso(2, AYUDA, HORARIO, 7)];
const escribir = (relativa, datos) => writeFileSync(path.join(raiz, ...relativa.split("/")), typeof datos === "string" ? datos : JSON.stringify(datos));

/** Abre el flujo y lee mensajes SSE ({ id, event, data, comentario }) hasta que `listo(mensajes)` o el cierre. */
async function escuchar(url, { cabeceras = {}, listo = () => false, alLeer = () => {} } = {}) {
  const corte = new AbortController();
  const respuesta = await fetch(url, { headers: cabeceras, signal: corte.signal });
  const mensajes = [];
  if (!respuesta.headers.get("content-type")?.startsWith("text/event-stream")) return { respuesta, mensajes, cerrado: true };
  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = "";
  let cerrado = false;
  while (!listo(mensajes)) {
    const { value, done } = await lector.read();
    if (done) {
      cerrado = true;
      break;
    }
    resto += value;
    let corteEn;
    while ((corteEn = resto.indexOf("\n\n")) >= 0) {
      const bloque = resto.slice(0, corteEn);
      resto = resto.slice(corteEn + 2);
      const mensaje = {};
      for (const linea of bloque.split("\n")) {
        if (linea.startsWith(":")) mensaje.comentario = linea.slice(1).trim();
        const [, campo, valor] = /^(id|event|data): (.*)$/.exec(linea) ?? [];
        if (campo) mensaje[campo] = campo === "data" ? JSON.parse(valor) : valor;
      }
      mensajes.push(mensaje);
      await alLeer(mensajes);
    }
  }
  if (!cerrado) corte.abort();
  return { respuesta, mensajes, cerrado };
}
const eventos = (mensajes) => mensajes.filter((m) => m.id);

test("al conectar manda lo conocido y la ruta; después solo lo nuevo de la traza que crece; latido", async () => {
  let crecio = false;
  const { respuesta, mensajes } = await escuchar(`${base}/en-curso/horario`, {
    listo: (m) => m.some((x) => x.data?.step === 2 && x.data.agent === "visitor") && m.some((x) => x.comentario === "ping"),
    alLeer: (m) => {
      // A medio escribir primero (se usa la última buena) y después con un paso más.
      if (crecio || !m.some((x) => x.event === "ruta")) return;
      crecio = true;
      escribir(`${VISITA}/desktop/trace.json`, '{"status": "running", "steps": [');
      setTimeout(() => escribir(`${VISITA}/desktop/trace.json`, traza("running", PASOS)), 80);
    },
  });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get("x-accel-buffering"), "no");
  assert.match(respuesta.headers.get("content-security-policy"), /connect-src 'self'/);
  const ids = eventos(mensajes).map((m) => m.id);
  assert.deepEqual(ids, [
    `${GUIA}|guia|0|start`, `${GUIA}|guia|1|step`, `${GUIA}|guia|2|step`, `${GUIA}|guia|2|end`,
    `${VISITA}|desktop|0|start`, `${VISITA}|desktop|1|step`, `${VISITA}|desktop|2|step`,
  ]);
  assert.ok(eventos(mensajes).every((m) => m.data.id === m.id && m.data.v === 1 && m.data.revision === "en-curso" && m.data.host === "ejemplo.test"));
  const ruta = mensajes.find((m) => m.event === "ruta");
  assert.deepEqual(ruta.data.map((p) => p.title), ["Inicio", "Ayuda", "Horario"]);
  assert.equal(ruta.data[0].url, "https://ejemplo.test/");
  assert.equal(mensajes.filter((m) => m.event === "ruta").length, 1, "la ruta sale una vez mientras no cambia");
});

test("Last-Event-ID: al reconectar no reenvía lo ya entregado", async () => {
  escribir(`${VISITA}/desktop/trace.json`, traza("running", PASOS));
  const { mensajes } = await escuchar(`${base}/en-curso/horario`, {
    cabeceras: { "Last-Event-ID": `${VISITA}|desktop|1|step` },
    listo: (m) => m.some((x) => x.event === "ruta"),
  });
  assert.deepEqual(eventos(mensajes).map((m) => m.id), [`${VISITA}|desktop|2|step`]);
});

test("el Visitante termina: sale su end, después fin, y se cierra", async () => {
  escribir(`${VISITA}/desktop/trace.json`, traza("running", PASOS));
  const { mensajes, cerrado } = await escuchar(`${base}/en-curso/horario`, {
    cabeceras: { "Last-Event-ID": `${VISITA}|desktop|2|step` },
    alLeer: (m) => {
      if (m.length !== 1) return;
      escribir(`${VISITA}/desktop/run.json`, { ...traza("succeeded", PASOS), end_reason: "done", duration_s: 9, verdict: { outcome: "success" } });
      items.find((i) => i.SK === "GOAL#horario#visitor").status = "succeeded";
    },
  });
  assert.equal(cerrado, true);
  const [fin] = eventos(mensajes);
  assert.deepEqual([fin.id, fin.data.outcome, fin.data.end_reason], [`${VISITA}|desktop|2|end`, "success", "done"]);
  assert.deepEqual(mensajes.at(-1), { event: "fin", data: { revision: "en-curso", goal: "horario", estado: "succeeded" } });
});

test("revisión o goal que no están en la tabla: 404, sin abrir el flujo", async () => {
  for (const ruta of ["no-existe/horario", "en-curso/otro-goal", "en-curso/..%2F..%2Fsecreto", "EN_CURSO/horario", "en-curso/horario/mas"]) {
    const respuesta = await fetch(`${base}/${ruta}`);
    assert.equal(respuesta.status, 404, ruta);
    assert.match(respuesta.headers.get("content-type"), /json/);
  }
});

test("tope de conexiones: la que sobra recibe 503 y el cupo vuelve al cerrar", async () => {
  items.find((i) => i.SK === "GOAL#horario#visitor").status = "running";
  const abiertas = [new AbortController(), new AbortController()];
  const respuestas = await Promise.all(abiertas.map((c) => fetch(`${base}/en-curso/horario`, { signal: c.signal })));
  assert.deepEqual(respuestas.map((r) => r.status), [200, 200]);
  assert.equal((await fetch(`${base}/en-curso/horario`)).status, 503);
  abiertas.forEach((c) => c.abort());
  await new Promise((listo) => setTimeout(listo, 50));
  const otra = new AbortController();
  assert.equal((await fetch(`${base}/en-curso/horario`, { signal: otra.signal })).status, 200);
  otra.abort();
});
