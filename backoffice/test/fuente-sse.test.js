// fuenteSSE (public/telarana/fuente-sse.js) contra un EventSource falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuenteSSE } from "../public/telarana/fuente-sse.js";

class EventSourceFalso {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static abiertas = [];
  constructor(url) {
    this.url = url;
    this.readyState = EventSourceFalso.CONNECTING;
    this.oyentes = new Map();
    EventSourceFalso.abiertas.push(this);
  }
  addEventListener(tipo, oyente) {
    if (!this.oyentes.has(tipo)) this.oyentes.set(tipo, []);
    this.oyentes.get(tipo).push(oyente);
  }
  close() {
    this.readyState = EventSourceFalso.CLOSED;
    this.cerrada = true;
  }
  emitir(tipo, mensaje = {}) {
    if (this.cerrada) return;
    if (tipo === "open") this.readyState = EventSourceFalso.OPEN;
    for (const oyente of this.oyentes.get(tipo) ?? []) oyente(mensaje);
  }
  // Lo que el servidor escribe: `id` + `data` del evento v1, o `event: <tipo>` con su `data`.
  evento(evento) {
    this.emitir("message", { data: JSON.stringify(evento), lastEventId: evento.id });
  }
  con(tipo, datos) {
    this.emitir(tipo, { data: JSON.stringify(datos) });
  }
}

const ev = (run, step, type = "step") => ({ v: 1, id: `${run}|${step}|${type}`, run_id: run, type, step, ts: "2026-11-22T12:00:00Z", agent: "visitor" });
const abrir = (opciones = {}) => {
  const fuente = fuenteSSE("en-curso", "horario", { EventSource: EventSourceFalso, ...opciones });
  return { fuente, es: EventSourceFalso.abiertas.at(-1) };
};

// Cómo consume la fuente montarTelaranaViva: lo de dentro de suscribir() es el estado inicial; lo de después se anima.
function montar(fuente) {
  const inicial = [];
  const animados = [];
  let durante = true;
  const suscripcion = fuente.suscribir((evento) => (durante ? inicial : animados).push(evento.id));
  durante = false;
  return { inicial, animados, suscripcion };
}

test("pide api/vivo/<revision>/<goal> con cada parte codificada", () => {
  fuenteSSE("rev-1", "a b", { EventSource: EventSourceFalso });
  assert.equal(EventSourceFalso.abiertas.at(-1).url, "api/vivo/rev-1/a%20b");
});

test("la ráfaga inicial, hasta `listo`, se entrega de una vez dentro de suscribir(); lo de después llega aparte", async () => {
  const { fuente, es } = abrir();
  let resuelto = false;
  fuente.listo.then(() => (resuelto = true));
  es.emitir("open");
  es.evento(ev("g", 0, "start"));
  es.evento(ev("g", 1));
  es.evento(ev("v", 0, "start"));
  await Promise.resolve();
  assert.equal(resuelto, false, "sin `listo`, el histórico todavía puede seguir llegando");
  es.con("listo", { revision: "en-curso", goal: "horario" });
  await fuente.listo;
  const vista = montar(fuente);
  assert.deepEqual(vista.inicial, ["g|0|start", "g|1|step", "v|0|start"]);
  assert.deepEqual(vista.animados, []);
  es.evento(ev("v", 1));
  assert.deepEqual(vista.animados, ["v|1|step"]);
  assert.equal(fuente.estado, "en-vivo");
});

test("deduplica por id: lo que reenvía una reconexión no se repite", () => {
  const estados = [];
  const { fuente, es: es2 } = abrir({ alEstado: (e) => estados.push(e) });
  es2.emitir("open");
  es2.evento(ev("v", 1));
  es2.con("listo", {});
  const vista = montar(fuente);
  // Corte de red: EventSource queda CONNECTING y reintenta solo, con Last-Event-ID.
  es2.readyState = EventSourceFalso.CONNECTING;
  es2.emitir("error");
  assert.equal(es2.cerrada, undefined, "no se cierra: EventSource reconecta");
  es2.emitir("open");
  es2.evento(ev("v", 1));
  es2.evento(ev("v", 2));
  es2.evento(ev("v", 2));
  es2.con("listo", {});
  assert.deepEqual(vista.inicial, ["v|1|step"]);
  assert.deepEqual(vista.animados, ["v|2|step"]);
  assert.deepEqual(estados, ["conectando", "en-vivo", "reconectando", "en-vivo"]);
  fuente.cerrar();
  assert.equal(es2.cerrada, true);
});

test("`ruta` avisa con la lista de páginas cuando cambia y queda a mano en fuente.ruta", () => {
  const rutas = [];
  const { fuente, es } = abrir({ alRuta: (ruta) => rutas.push(ruta) });
  const ruta = [{ url: "https://ejemplo.test/", title: "Inicio" }, { url: "https://ejemplo.test/ayuda", title: "Ayuda" }];
  es.con("ruta", ruta);
  es.con("ruta", ruta);
  assert.deepEqual(rutas, [ruta], "la misma ruta de una reconexión no avisa otra vez");
  assert.deepEqual(fuente.ruta, ruta);
  fuente.cerrar();
});

test("`fin` cierra el EventSource (no reconecta), marca terminado y cumple listo", async () => {
  const estados = [];
  const { fuente, es } = abrir({ alEstado: (e) => estados.push(e) });
  es.emitir("open");
  es.evento(ev("v", 1));
  es.con("listo", {});
  const vista = montar(fuente);
  es.evento(ev("v", 1, "end"));
  es.con("fin", { revision: "en-curso", goal: "horario", estado: "succeeded" });
  assert.equal(es.cerrada, true);
  assert.equal(fuente.estado, "terminado");
  assert.deepEqual(estados, ["conectando", "en-vivo", "terminado"]);
  assert.deepEqual(vista.animados, ["v|1|end"]);
  // El error que sigue al cierre del servidor ya no cambia nada.
  es.cerrada = false;
  es.emitir("error");
  assert.equal(fuente.estado, "terminado");
  await fuente.listo;
});

test("un goal terminado al conectar: histórico, listo y fin llegan juntos y todo es estado inicial", async () => {
  const { fuente, es } = abrir();
  es.emitir("open");
  es.evento(ev("v", 0, "start"));
  es.evento(ev("v", 0, "end"));
  es.con("listo", {});
  es.con("fin", {});
  await fuente.listo;
  const vista = montar(fuente);
  assert.deepEqual(vista.inicial, ["v|0|start", "v|0|end"]);
  assert.equal(fuente.estado, "terminado");
});

test("el servidor la rechaza (404, 503): estado error y listo se cumple igual, para no esperar para siempre", async () => {
  const { fuente, es } = abrir();
  es.readyState = EventSourceFalso.CLOSED;
  es.emitir("error");
  await fuente.listo;
  assert.equal(fuente.estado, "error");
});

test("cerrar() desde la suscripción suelta al oyente y cierra la conexión", () => {
  const { fuente, es } = abrir();
  es.emitir("open");
  const vista = montar(fuente);
  vista.suscripcion.cerrar();
  assert.equal(es.cerrada, true);
  es.cerrada = false;
  es.evento(ev("v", 9));
  assert.deepEqual(vista.animados, []);
});

test("un mensaje que no es JSON se ignora", () => {
  const { fuente, es } = abrir();
  const vista = montar(fuente);
  es.emitir("message", { data: "{roto", lastEventId: "x" });
  es.emitir("ruta", { data: "no" });
  assert.deepEqual(vista.animados, []);
  assert.equal(fuente.ruta, null);
});

test("sin `listo` del servidor, listo se cumple igual al tope y lo recibido hasta ahí es estado inicial", async () => {
  const { fuente, es } = abrir({ topeListoMs: 30 });
  es.emitir("open");
  es.evento(ev("v", 0, "start"));
  // Una conexión que reintenta en bucle: nunca llega `listo`.
  es.readyState = EventSourceFalso.CONNECTING;
  es.emitir("error");
  const inicio = Date.now();
  await fuente.listo;
  assert.ok(Date.now() - inicio < 500);
  const vista = montar(fuente);
  assert.deepEqual(vista.inicial, ["v|0|start"]);
  es.evento(ev("v", 1));
  assert.deepEqual(vista.animados, ["v|1|step"]);
  fuente.cerrar();
});

test("lo entregado en suscribir() no se guarda: lo nuevo va directo al oyente", () => {
  const { fuente, es } = abrir();
  es.evento(ev("v", 0, "start"));
  montar(fuente);
  es.evento(ev("v", 1));
  // Una segunda suscripción ya no recibe nada guardado.
  assert.deepEqual(montar(fuente).inicial, []);
  fuente.cerrar();
});
