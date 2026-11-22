// Estado de la telaraña viva a partir de los eventos v1 (start / step / end) de los agentes: páginas, tramos,
// agentes, finales y atascos. Las cifras que muestran el lienzo y el panel salen de aquí, así siempre coinciden.
// Puro: no toca document ni window, y no sabe de animación (eso es de escena.js).

import { claveDePagina } from "../nucleo/url.js";
import { formaDeTramo, ladeoDeVuelta, ubicarFinal, ubicarFuera } from "./layout.js";

export const FINALES = ["success", "failed", "abandoned", "unmeasured", "error"];
/** El resultado de un final con el vocabulario del backoffice (comun.resultado.*). */
export const RESULTADO_DE_FINAL = { success: "logrado", failed: "fallido", abandoned: "abandonado", unmeasured: "sin_medir", error: "error" };
export const claveDeFinal = (final) => `#${final}`;

// Un agente se traba en una página con dos tropiezos (un paso sin efecto o con error visible) o si pasa este tiempo
// sin cambiar de página: los pasos del Visitante tardan varios segundos cada uno.
export const ATASCO_MS = 25_000;
const TROPIEZOS = 2;
const SENALES_DE_TROPIEZO = new Set(["no_effect", "visible_error"]);

const finalDe = (outcome) => (FINALES.includes(outcome) ? outcome : outcome === "tool_error" ? "error" : "failed");
const claveDe = (pagina) => claveDePagina(pagina?.url, pagina?.title);
const momento = (ts) => {
  const ms = Date.parse(ts ?? "");
  return Number.isFinite(ms) ? ms : null;
};

/**
 * @param {{ ruta?: { url: string, title?: string }[] }} opciones   la ruta recomendada, del inicio a la página final
 */
export function crearModelo({ ruta = [] } = {}) {
  const m = {
    ruta: [],
    nodos: new Map(),
    tramos: new Map(),
    agentes: new Map(),
    iniciados: 0,
    fin: Object.fromEntries(FINALES.map((f) => [f, 0])),
    maxN: 1,
    maxAnillo: 0,
    lados: new Map(),
    vueltas: { "-1": 0, 1: 0 },
    vistos: new Set(),
    version: 0,
  };
  if (ruta.length) ponerRuta(m, ruta);
  return m;
}

export const anilloFinal = (m) => Math.max(m.ruta.length, m.maxAnillo + 1);

function ponerRuta(m, ruta) {
  for (const pagina of ruta) {
    const clave = claveDe(pagina);
    if (m.nodos.has(clave)) continue;
    nodo(m, clave, pagina, { anillo: m.ruta.length, ang: 0, ruta: m.ruta.length });
    m.ruta.push(clave);
  }
  for (let i = 1; i < m.ruta.length; i++) tramo(m, "f", m.ruta[i - 1], m.ruta[i]);
  final(m, "success");
  tramo(m, "f", m.ruta.at(-1), claveDeFinal("success"));
}

function nodo(m, clave, pagina, { anillo = 0, ang = 0, ruta = -1, term = null, origen = null }) {
  let n = m.nodos.get(clave);
  if (n) return n;
  // origen: la página desde la que se descubrió, para que la animación la haga nacer de ahí.
  n = { clave, url: pagina?.url ?? "", titulo: String(pagina?.title ?? "").trim(), anillo: term ? -1 : anillo, ang, ruta, term, origen, atascos: 0, pasaron: 0, count: 0 };
  m.nodos.set(clave, n);
  if (!term) m.maxAnillo = Math.max(m.maxAnillo, anillo);
  return n;
}

function fuera(m, clave, pagina, desde) {
  const ubicacion = ubicarFuera(m.nodos.values(), m.lados, m.nodos.get(desde));
  return nodo(m, clave, pagina, { ...ubicacion, origen: desde });
}

function final(m, resultado, desde = null) {
  const clave = claveDeFinal(resultado);
  if (m.nodos.has(clave)) return m.nodos.get(clave);
  const ang = ubicarFinal(m.nodos.values(), anilloFinal(m), resultado === "success", desde);
  return nodo(m, clave, null, { term: resultado, ang });
}

function tramo(m, tipo, a, b) {
  const clave = `${tipo}:${a}>${b}`;
  let e = m.tramos.get(clave);
  if (e) return e;
  const na = m.nodos.get(a);
  const nb = m.nodos.get(b);
  const forma = formaDeTramo(na, nb, tipo === "b");
  e = {
    clave,
    tipo,
    a,
    b,
    forma,
    ladeo: forma === "ret" ? ladeoDeVuelta(m.vueltas, na, nb) : 0,
    ruta: na.ruta >= 0 && nb.ruta === na.ruta + 1,
    term: nb.term,
    n: 0,
    acciones: {},
  };
  m.tramos.set(clave, e);
  return e;
}

/**
 * Aplica un evento. Devuelve qué cambió ({ tipo, agente }) o null si el evento no aplica (repetido, de un agente
 * desconocido o ya terminado).
 */
export function aplicar(m, ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.id) {
    if (m.vistos.has(ev.id)) return null;
    m.vistos.add(ev.id);
  }
  const ahora = momento(ev.ts);
  if (ev.type === "start") return iniciar(m, ev, ahora);
  const a = m.agentes.get(ev.run_id);
  if (!a || a.final) return null;
  if (ahora !== null) comprobarAtasco(m, a, ahora);
  m.version++;
  if (ev.type === "step") return pasar(m, a, ev, ahora);
  if (ev.type === "end") return terminar(m, a, ev, ahora);
  return null;
}

function iniciar(m, ev, ahora) {
  if (!ev.run_id || m.agentes.has(ev.run_id) || !ev.node) return null;
  if (!m.ruta.length) ponerRuta(m, [ev.node]);
  const clave = claveDe(ev.node);
  if (!m.nodos.has(clave)) fuera(m, clave, ev.node, m.ruta[0]);
  const a = {
    run: ev.run_id,
    agente: ev.agent === "guide" ? "guide" : "visitor",
    perfil: String(ev.attempt ?? ""),
    nodo: clave,
    visitados: new Set(),
    paso: new Map(),
    tramos: new Set(),
    trabado: new Set(),
    pasos: 0,
    tropiezos: 0,
    ultimoMov: ahora,
    atascado: false,
    mov: null,
    serie: 0,
    final: null,
    motivo: "",
    ultima: null,
    maxHito: -1,
    salida: null,
    primera: null,
  };
  m.agentes.set(a.run, a);
  m.iniciados++;
  m.version++;
  marcar(m, a, clave, ev.step ?? 0);
  return { tipo: "inicio", agente: a };
}

function pasar(m, a, ev, ahora) {
  a.pasos++;
  const clave = ev.node ? claveDe(ev.node) : a.nodo;
  if (clave === a.nodo) {
    if (ev.signals?.some((senal) => SENALES_DE_TROPIEZO.has(senal))) a.tropiezos++;
    comprobarAtasco(m, a, ahora);
    return { tipo: "quieto", agente: a };
  }
  const atras = ev.action === "go_back" || !!ev.signals?.includes("went_back");
  irA(m, a, clave, ev.node, { atras, accion: ev.action || "otra", paso: ev.step ?? a.pasos, ahora });
  return { tipo: "paso", agente: a };
}

function irA(m, a, clave, pagina, { atras, accion, paso, ahora }) {
  if (!m.nodos.has(clave)) fuera(m, clave, pagina, a.nodo);
  const desde = m.nodos.get(a.nodo);
  const hasta = m.nodos.get(clave);
  if (!atras && desde.ruta >= 0 && hasta.ruta < 0) {
    a.salida = { desde: desde.ruta, de: desde.clave, pagina: clave };
    a.primera ??= a.salida;
  }
  mover(m, a, tramo(m, atras ? "b" : "f", a.nodo, clave), clave, accion, ahora);
  marcar(m, a, clave, paso);
}

function terminar(m, a, ev, ahora) {
  const resultado = finalDe(ev.outcome);
  if (ev.node) {
    const clave = claveDe(ev.node);
    if (clave !== a.nodo) irA(m, a, clave, ev.node, { atras: false, accion: "otra", paso: ev.step ?? a.pasos, ahora });
  }
  const t = final(m, resultado, m.nodos.get(a.nodo));
  const ultima = a.nodo;
  mover(m, a, tramo(m, "f", a.nodo, t.clave), t.clave, "end", ahora);
  a.final = resultado;
  a.ultima = ultima;
  a.motivo = String(ev.end_reason ?? "");
  a.visitados.add(t.clave);
  m.fin[resultado]++;
  t.count++;
  return { tipo: "fin", agente: a };
}

function marcar(m, a, clave, paso) {
  const n = m.nodos.get(clave);
  if (!a.visitados.has(clave)) {
    n.pasaron++;
    a.paso.set(clave, paso);
  }
  a.visitados.add(clave);
  if (n.ruta > a.maxHito) a.maxHito = n.ruta;
}

function mover(m, a, e, hasta, accion, ahora) {
  if (!a.tramos.has(e.clave)) {
    a.tramos.add(e.clave);
    e.n++;
    e.acciones[accion] = (e.acciones[accion] ?? 0) + 1;
    m.maxN = Math.max(m.maxN, e.n);
  }
  a.mov = e.clave;
  a.serie++;
  a.nodo = hasta;
  if (ahora !== null) a.ultimoMov = ahora;
  a.tropiezos = 0;
  a.atascado = false;
}

function comprobarAtasco(m, a, ahora) {
  if (a.final || a.atascado) return false;
  const lento = ahora !== null && a.ultimoMov !== null && ahora - a.ultimoMov > ATASCO_MS;
  if (!lento && a.tropiezos < TROPIEZOS) return false;
  a.atascado = true;
  if (!a.trabado.has(a.nodo)) {
    a.trabado.add(a.nodo);
    m.nodos.get(a.nodo).atascos++;
  }
  m.version++;
  return true;
}

/** Marca los agentes en curso que llevan demasiado sin moverse (en vivo, entre eventos). */
export function revisarAtascos(m, ahora) {
  let alguno = false;
  for (const a of m.agentes.values()) if (comprobarAtasco(m, a, ahora)) alguno = true;
  return alguno;
}

export const terminados = (m) => FINALES.reduce((total, f) => total + m.fin[f], 0);
export const enCurso = (m) => m.iniciados - terminados(m);

/**
 * Por hito k de la ruta: x[k] = intentos válidos que lo alcanzaron; de los que no pasaron de k, a qué página fuera
 * de la ruta se fueron (fugas[k]), cuántos terminaron en la ruta (term[k]) y cuántos siguen ahí (aqui[k]).
 * y = intentos válidos iniciados (sin errores de la herramienta).
 */
export function cifras(m) {
  const L = m.ruta.length;
  const x = Array(L).fill(0);
  const fugas = m.ruta.map(() => new Map());
  const term = Array(L).fill(0);
  const aqui = Array(L).fill(0);
  let y = 0;
  for (const a of m.agentes.values()) {
    if (a.final === "error") continue;
    y++;
    for (let k = 0; k <= a.maxHito; k++) x[k]++;
    const k = a.maxHito;
    if (k < 0 || k === L - 1) continue;
    const donde = m.nodos.get(a.final ? a.ultima : a.nodo);
    if (donde.ruta < 0 && a.salida) fugas[k].set(a.salida.pagina, (fugas[k].get(a.salida.pagina) ?? 0) + 1);
    else if (a.final) term[k]++;
    else aqui[k]++;
  }
  return { y, x, fugas, term, aqui };
}

/** Las páginas fuera de la ruta adonde se fue la gente, de más a menos: [{ clave, n, desde }] (desde: el hito). */
export function dondeSeVan(c) {
  const porPagina = new Map();
  c.fugas.forEach((fugas, hito) => {
    for (const [clave, n] of fugas) {
      const d = porPagina.get(clave) ?? { clave, n: 0, porHito: [] };
      d.n += n;
      d.porHito.push([hito, n]);
      porPagina.set(clave, d);
    }
  });
  return [...porPagina.values()]
    .map(({ clave, n, porHito }) => ({ clave, n, desde: porHito.sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] }))
    .sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
}

/** Por tramo, cuántos de los agentes que pasaron por él ya terminaron y cuántos lo lograron. */
export function finDeTramos(m) {
  const porTramo = new Map();
  for (const a of m.agentes.values()) {
    if (!a.final) continue;
    for (const clave of a.tramos) {
      const d = porTramo.get(clave) ?? { hechos: 0, ok: 0 };
      d.hechos++;
      if (a.final === "success") d.ok++;
      porTramo.set(clave, d);
    }
  }
  return porTramo;
}

const porN = (a, b) => b.n - a.n || a.clave.localeCompare(b.clave);

/** Lo que el panel muestra de una página fijada. */
export function detalleDePagina(m, clave) {
  const tramos = [...m.tramos.values()];
  return {
    nodo: m.nodos.get(clave),
    entran: tramos.filter((e) => e.b === clave && e.n).sort(porN),
    salen: tramos.filter((e) => e.a === clave && e.n && !e.term).sort(porN),
    finales: tramos.filter((e) => e.a === clave && e.term && e.n).sort(porN),
    intentos: [...m.agentes.values()].filter((a) => a.visitados.has(clave)).map((a) => ({ run: a.run, paso: a.paso.get(clave) })),
  };
}

/** Lo que el panel muestra de un tramo fijado: cómo terminaron los que pasaron por él ("" = en curso). */
export function detalleDeTramo(m, clave) {
  const e = m.tramos.get(clave);
  const pasaron = [...m.agentes.values()].filter((a) => a.tramos.has(clave));
  const resultados = new Map();
  for (const a of pasaron) resultados.set(a.final ?? "", (resultados.get(a.final ?? "") ?? 0) + 1);
  return { tramo: e, pasaron, resultados: [...resultados].sort((a, b) => b[1] - a[1]) };
}

/**
 * Qué se resalta al apuntar o fijar algo: un agente (t: "a"), una página (t: "n") o un tramo (t: "e"). Se
 * resaltan los agentes que pasaron por ahí con todo su recorrido.
 */
export function resaltado(m, foco) {
  const hl = { on: !!foco, agentes: new Set(), tramos: new Set(), nodos: new Set() };
  if (!foco) return hl;
  const agentes = foco.t === "a" ? [m.agentes.get(foco.k)].filter(Boolean) : m.agentes.values();
  for (const a of agentes) {
    if (foco.t === "n" && !a.visitados.has(foco.k)) continue;
    if (foco.t === "e" && !a.tramos.has(foco.k)) continue;
    hl.agentes.add(a.run);
    for (const k of a.tramos) hl.tramos.add(k);
    for (const k of a.visitados) hl.nodos.add(k);
  }
  const vecino = (e) => {
    hl.tramos.add(e.clave);
    hl.nodos.add(e.a);
    hl.nodos.add(e.b);
  };
  if (foco.t === "n") {
    hl.nodos.add(foco.k);
    for (const e of m.tramos.values()) if (e.a === foco.k || e.b === foco.k) vecino(e);
  }
  if (foco.t === "e" && m.tramos.has(foco.k)) vecino(m.tramos.get(foco.k));
  return hl;
}
