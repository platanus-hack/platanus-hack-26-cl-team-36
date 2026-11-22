// Telaraña viva: modelo por eventos, cifras del panel (panel-spec, criterios puros), layout estable y fuenteDeTanda.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { crearFuente } from "../lib/fuente.js";
import {
  FINALES,
  aplicar,
  cifras,
  claveDeFinal,
  crearModelo,
  detalleDePagina,
  dondeSeVan,
  enCurso,
  revisarAtascos,
  terminados,
} from "../public/telarana/modelo.js";
import { LIMITE, PASO, puntoDeTramo, radio } from "../public/telarana/layout.js";
import { DURACION_COMPRIMIDA_MS, HUECO_MAX_MS, eventosDeTanda, fuenteDeTanda, horarioComprimido, rutaDeTanda } from "../public/telarana/fuente-tanda.js";
import { abreArmado } from "../public/pantallas/telarana.js";
import { claveDePagina } from "../public/nucleo/url.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const TANDA = "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z";
const NUEVA = "demo.cl/visitor/tarea-demo/2026-11-21T11-00-00Z";
const leer = (id) => leerTanda(crearFuente({ tipo: "archivos", raiz: RAIZ }), id);

const web = (nombre) => ({ url: `https://sitio.test/${nombre.toLowerCase()}`, title: nombre });
const RUTA = ["Inicio", "Ayuda", "Baja", "Listo"].map(web);
const clave = (p) => claveDePagina(p.url, p.title);

// Eventos de un agente: una lista de páginas (o "atras:<página>") y un final.
function agente(run, paginas, outcome, { t0 = 0, dt = 3000 } = {}) {
  let t = t0;
  const ts = () => new Date(Date.UTC(2026, 10, 22) + t).toISOString();
  const eventos = [{ v: 1, id: `${run}|0|start`, run_id: run, attempt: "desktop", agent: "visitor", type: "start", step: 0, ts: ts(), node: web(paginas[0]), signals: [] }];
  paginas.slice(1).forEach((p, i) => {
    t += dt;
    const atras = p.startsWith("atras:");
    eventos.push({ v: 1, id: `${run}|${i + 1}|step`, run_id: run, type: "step", step: i + 1, ts: ts(), action: atras ? "go_back" : "left_click", node: web(atras ? p.slice(6) : p), signals: [] });
  });
  if (outcome) {
    t += dt;
    eventos.push({ v: 1, id: `${run}|${paginas.length}|end`, run_id: run, type: "end", step: paginas.length, ts: ts(), node: web(paginas.at(-1).replace("atras:", "")), outcome });
  }
  return eventos;
}

// Una tanda en vivo a medias: unos terminaron, otros siguen.
function escenario() {
  return [
    agente("r1", ["Inicio", "Ayuda", "Baja", "Listo"], "success"),
    agente("r2", ["Inicio", "Planes"], "failed"),
    agente("r3", ["Inicio", "Ayuda", "Soporte", "Planes"], "abandoned"),
    agente("r4", ["Inicio", "Planes", "atras:Inicio", "Ayuda", "Baja", "Listo"], "success"),
    agente("r5", ["Inicio", "Ayuda", "Baja"], null),
    agente("r6", ["Inicio", "Ayuda", "Soporte"], null),
    agente("r7", ["Inicio", "Ayuda"], "failed"),
    agente("r8", ["Inicio"], "error"),
    agente("r9", ["Inicio", "Ayuda", "Baja", "Tarifas"], "failed"),
  ]
    .flat()
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function armar(eventos = escenario()) {
  const m = crearModelo({ ruta: RUTA });
  for (const ev of eventos) aplicar(m, ev);
  return m;
}

test("cifras: y son los intentos válidos y x nunca sube de un hito al siguiente (criterio 1)", () => {
  const m = armar();
  const c = cifras(m);
  assert.equal(c.y, 8, "el error de la herramienta no cuenta");
  assert.deepEqual(c.x, [8, 7, 4, 2]);
  for (let k = 1; k < c.x.length; k++) assert.ok(c.x[k] <= c.x[k - 1]);
});

test("cifras: lo que se pierde entre hitos son fugas, finales en la ruta y los que siguen ahí (criterio 2)", () => {
  const c = cifras(armar());
  for (let k = 0; k < c.x.length - 1; k++) {
    const fugas = [...c.fugas[k].values()].reduce((t, n) => t + n, 0);
    assert.equal(c.x[k] - c.x[k + 1], fugas + c.term[k] + c.aqui[k], `hito ${k + 1}`);
  }
  assert.deepEqual(Object.fromEntries([...c.fugas[0]].map(([k, n]) => [k.split(" | ")[1], n])), { Planes: 1 });
  assert.deepEqual(Object.fromEntries([...c.fugas[1]].map(([k, n]) => [k.split(" | ")[1], n])), { Soporte: 2 }, "la fuga es la primera página fuera de la ruta");
  assert.equal(c.term[1], 1, "r7 terminó en Ayuda");
  assert.equal(c.aqui[2], 1, "r5 sigue en Baja");
});

test("dondeSeVan: solo páginas fuera de la ruta, de más a menos, con el hito del que salieron más (criterio 7)", () => {
  const m = armar();
  const lista = dondeSeVan(cifras(m));
  assert.ok(lista.length);
  for (const { clave: k } of lista) assert.ok(m.nodos.get(k).ruta < 0);
  for (let i = 1; i < lista.length; i++) assert.ok(lista[i].n <= lista[i - 1].n);
  assert.deepEqual(
    lista.map(({ clave: k, n, desde }) => [k.split(" | ")[1], n, desde]),
    [["Soporte", 2, 1], ["Planes", 1, 0], ["Tarifas", 1, 2]],
  );
});

test("en curso más los finales es el total de intentos (criterio 9)", () => {
  const m = armar();
  assert.equal(enCurso(m) + terminados(m), m.iniciados);
  assert.equal(enCurso(m), 2);
  assert.equal(m.nodos.get(claveDeFinal("success")).count, m.fin.success);
});

test("los ×n de una página coinciden con los conteos de sus tramos (criterio 6)", () => {
  const m = armar();
  const ayuda = detalleDePagina(m, clave(web("Ayuda")));
  for (const e of [...ayuda.entran, ...ayuda.salen]) {
    const pasaron = [...m.agentes.values()].filter((a) => a.tramos.has(e.clave)).length;
    assert.equal(e.n, pasaron, e.clave);
  }
  assert.equal(ayuda.salen[0].b, clave(web("Baja")), "el tramo más transitado primero");
  assert.ok(ayuda.salen.find((e) => e.b === clave(web("Baja"))).ruta);
  assert.equal(ayuda.intentos.length, m.nodos.get(clave(web("Ayuda"))).pasaron);
});

test("un evento repetido (mismo id) no cuenta dos veces", () => {
  const eventos = escenario();
  const m = armar([...eventos, ...eventos]);
  assert.deepEqual(cifras(m), cifras(armar(eventos)));
  assert.equal(m.iniciados, 9);
});

test("volver atrás es un tramo de vuelta y no una fuga", () => {
  const m = armar();
  const vuelta = [...m.tramos.values()].find((e) => e.tipo === "b");
  assert.equal(vuelta.a, clave(web("Planes")));
  assert.equal(vuelta.forma, "ret");
  assert.equal(m.agentes.get("r4").primera.pagina, clave(web("Planes")));
});

test("atascos: dos tropiezos en una página, o demasiado tiempo sin moverse", () => {
  const m = crearModelo({ ruta: RUTA });
  const [inicio] = agente("t1", ["Inicio"], null);
  aplicar(m, inicio);
  const quieto = (n, signals) => ({ v: 1, id: `t1|${n}|step`, run_id: "t1", type: "step", step: n, ts: inicio.ts, action: "left_click", node: web("Inicio"), signals });
  aplicar(m, quieto(1, ["no_effect"]));
  assert.equal(m.nodos.get(clave(web("Inicio"))).atascos, 0);
  aplicar(m, quieto(2, ["visible_error"]));
  assert.equal(m.nodos.get(clave(web("Inicio"))).atascos, 1);

  const [otro] = agente("t2", ["Inicio"], null);
  aplicar(m, otro);
  assert.equal(revisarAtascos(m, Date.parse(otro.ts) + 1000), false);
  assert.equal(revisarAtascos(m, Date.parse(otro.ts) + 60_000), true);
  assert.equal(m.nodos.get(clave(web("Inicio"))).atascos, 2);
});

test("layout estable: una página nueva no mueve las que ya están", () => {
  const m = crearModelo({ ruta: RUTA });
  const antes = new Map();
  let i = 0;
  for (const ev of escenario()) {
    aplicar(m, ev);
    for (const [k, n] of m.nodos) {
      if (n.term) continue;
      if (antes.has(k)) assert.deepEqual([n.anillo, n.ang], antes.get(k), `${k} se movió en el evento ${i}`);
      else antes.set(k, [n.anillo, n.ang]);
    }
    i++;
  }
  // La ruta es el rayo del ángulo 0, un anillo por hito; las demás páginas no se pisan dentro de un anillo.
  RUTA.forEach((p, k) => assert.deepEqual([m.nodos.get(clave(p)).anillo, m.nodos.get(clave(p)).ang], [k, 0]));
  const porAnillo = new Map();
  for (const n of m.nodos.values()) if (!n.term) porAnillo.set(n.anillo, [...(porAnillo.get(n.anillo) ?? []), n]);
  for (const [anillo, nodos] of porAnillo) {
    for (const a of nodos) {
      assert.ok(Math.abs(a.ang) <= LIMITE);
      for (const b of nodos) if (a !== b) assert.ok(Math.abs(a.ang - b.ang) * radio(anillo) >= 103, `${a.clave} y ${b.clave} se pisan`);
    }
  }
});

test("un tramo de la ruta va en línea recta de un anillo al siguiente", () => {
  const A = { r: radio(1), a: 0, anillo: 1 };
  const B = { r: radio(2), a: 0, anillo: 2 };
  const p = puntoDeTramo(A, B, "av", 0, 0.5, {});
  assert.equal(p.x, PASO * 1.5);
  assert.equal(p.y, 0);
});

test("sin ruta, el inicio del primer agente es el centro", () => {
  const m = crearModelo();
  for (const ev of agente("s1", ["Portada", "Contacto"], "success")) aplicar(m, ev);
  assert.deepEqual(m.ruta, [clave(web("Portada"))]);
  assert.equal(m.nodos.get(clave(web("Contacto"))).anillo, 1);
  assert.equal(cifras(m).y, 1);
});

test("fuenteDeTanda: eventos v1 de cada intento, en orden y con ids únicos", async () => {
  const tanda = await leer(TANDA);
  const eventos = eventosDeTanda(tanda);
  assert.equal(new Set(eventos.map((ev) => ev.id)).size, eventos.length);
  for (let i = 1; i < eventos.length; i++) assert.ok(Date.parse(eventos[i].ts) >= Date.parse(eventos[i - 1].ts));
  for (const intento of tanda.intentos) {
    const suyos = eventos.filter((ev) => ev.run_id === `${tanda.id}|${intento.id}`);
    assert.deepEqual(suyos.map((ev) => ev.type), ["start", ...intento.pasos.map(() => "step"), "end"]);
    assert.equal(suyos[0].attempt, intento.id);
    assert.equal(suyos.at(-1).id, `${tanda.id}|${intento.id}|${intento.pasos.at(-1).numero}|end`);
  }
  const volvio = eventos.find((ev) => ev.signals.includes("went_back"));
  assert.equal(volvio.action, "go_back");
});

test("fuenteDeTanda: el estado final coincide con la tanda (finales, hitos y la ruta como rayo)", async () => {
  for (const id of [TANDA, NUEVA]) {
    const tanda = await leer(id);
    const m = crearModelo({ ruta: rutaDeTanda(tanda) });
    const vistos = [];
    fuenteDeTanda(tanda).suscribir((ev) => vistos.push(aplicar(m, ev)));
    assert.equal(vistos.length, eventosDeTanda(tanda).length, "sin reproducir, todo llega de una vez");
    assert.equal(m.ruta.length, tanda.telarana.ruta.paginas.length);
    assert.equal(enCurso(m), 0);
    const porResultado = (r) => tanda.intentos.filter((i) => i.resultado === r).length;
    assert.equal(m.fin.success, porResultado("logrado"));
    assert.equal(m.fin.failed, porResultado("fallido"));
    assert.equal(m.fin.error, porResultado("error"));
    const validos = tanda.intentos.filter((i) => i.resultado !== "error");
    const c = cifras(m);
    assert.equal(c.y, validos.length);
    // x(k): los que alcanzaron el hito según el backoffice (hitos[].alcanzado).
    tanda.telarana.ruta.paginas.forEach((pagina, k) => {
      const alcanzaron = validos.filter((i) => i.hitos.some((h) => h.pagina === pagina && h.alcanzado)).length;
      assert.equal(c.x[k], alcanzaron, `${id}, hito ${k + 1}`);
    });
  }
});

test("fuenteDeTanda: las variantes de URL de una página son el mismo nodo", async () => {
  const tanda = await leer(TANDA);
  const m = crearModelo({ ruta: rutaDeTanda(tanda) });
  fuenteDeTanda(tanda).suscribir((ev) => aplicar(m, ev));
  const titulos = [...m.nodos.values()].filter((n) => !n.term).map((n) => n.titulo).sort();
  assert.deepEqual(titulos, ["Ayuda", "Cómo dar de baja", "Inicio", "Planes"]);
});

test("fuenteDeTanda: reproduciendo, cada evento llega a su hora y la velocidad se puede cambiar", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reloj = 0;
  const tanda = await leer(TANDA);
  const total = eventosDeTanda(tanda).length;
  const llegados = [];
  const suscripcion = fuenteDeTanda(tanda, { reproducir: true, ahora: () => reloj }).suscribir((ev) => llegados.push(ev));
  const correr = (ms) => {
    for (let i = 0; i < ms / 50; i++) {
      reloj += 50;
      t.mock.timers.tick(50);
    }
  };
  const iniciales = llegados.length;
  assert.ok(iniciales > 0 && llegados.every((ev) => ev.type === "start"));
  correr(2_500);
  assert.ok(llegados.length > iniciales && llegados.length < total);
  suscripcion.velocidad(4);
  correr(3_000);
  assert.equal(llegados.length, total, "×4: los 10 s de la tanda llegan en menos de 6 s");
  suscripcion.cerrar();
});

const enMs = (...ms) => ms.map((m) => ({ ts: new Date(Date.UTC(2026, 10, 22) + m).toISOString() }));

test("horarioComprimido: la tanda dura lo previsto, en orden, con su ritmo y sin pausas largas", () => {
  const eventos = enMs(0, 0, 60_000, 61_000, 62_000, 600_000, 601_000, 700_000);
  const horas = horarioComprimido(eventos);
  assert.equal(horas.length, eventos.length);
  assert.equal(horas[0], 0);
  assert.equal(horas[1], 0, "los simultáneos siguen juntos");
  for (let i = 1; i < horas.length; i++) {
    assert.ok(horas[i] >= horas[i - 1], "el orden se conserva");
    assert.ok(horas[i] - horas[i - 1] <= HUECO_MAX_MS + 1e-6, "ninguna pausa pasa del tope");
  }
  assert.equal(horas[3] - horas[2], horas[4] - horas[3], "el ritmo relativo se conserva");
  const largo = horarioComprimido(enMs(...Array.from({ length: 200 }, (_, i) => i * 5_000)));
  assert.ok(Math.abs(largo.at(-1) - DURACION_COMPRIMIDA_MS) < 5, `dura ${largo.at(-1)} ms`);
});

test("horarioComprimido: vacía, de un evento y nunca más lenta que la real", () => {
  assert.deepEqual(horarioComprimido([]), []);
  assert.deepEqual(horarioComprimido(enMs(5_000)), [0]);
  assert.deepEqual(horarioComprimido(enMs(0, 100, 300)), [0, 100, 300]);
});

test("fuenteDeTanda comprimida: se arma en ~8 s, con pausa y velocidad, y termina igual que el estado final", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reloj = 0;
  const tanda = await leer(TANDA);
  const tandaLenta = { ...tanda, intentos: tanda.intentos.map((i) => ({ ...i, duracion: (i.duracion ?? 0) * 60, pasos: i.pasos.map((p) => ({ ...p, segundos: (p.segundos ?? 0) * 60 })) })) };
  const total = eventosDeTanda(tandaLenta).length;
  const armado = crearModelo({ ruta: rutaDeTanda(tandaLenta) });
  const final = crearModelo({ ruta: rutaDeTanda(tandaLenta) });
  fuenteDeTanda(tandaLenta).suscribir((ev) => aplicar(final, ev));
  let llegados = 0;
  const suscripcion = fuenteDeTanda(tandaLenta, { reproducir: true, comprimida: true, ahora: () => reloj }).suscribir((ev) => {
    llegados++;
    aplicar(armado, ev);
  });
  const correr = (ms) => {
    for (let i = 0; i < ms / 50; i++) {
      reloj += 50;
      t.mock.timers.tick(50);
    }
  };
  correr(2_000);
  const aMitad = llegados;
  assert.ok(aMitad > 0 && aMitad < total && !suscripcion.terminada());
  suscripcion.velocidad(0);
  correr(5_000);
  assert.equal(llegados, aMitad, "en pausa no llega nada");
  suscripcion.velocidad(4);
  correr(1_600);
  assert.equal(llegados, total, "×4: lo que faltaba llega enseguida");
  assert.ok(suscripcion.terminada());
  assert.deepEqual(cifras(armado), cifras(final));
  assert.deepEqual([...armado.nodos.keys()].sort(), [...final.nodos.keys()].sort());
  assert.deepEqual([...armado.tramos.keys()].sort(), [...final.tramos.keys()].sort());
  assert.deepEqual(armado.fin, final.fin);
  suscripcion.cerrar();
});

test("Mapa de caminos: se arma al abrir salvo con movimiento reducido o un enlace que ya elige", () => {
  assert.equal(abreArmado({}, false), false);
  assert.equal(abreArmado({ tanda: "x" }, undefined), false);
  assert.equal(abreArmado({}, true), true);
  assert.equal(abreArmado({ intento: "desktop" }, false), true);
  assert.equal(abreArmado({ pagina: "p1" }, false), true);
});

test("FINALES tiene un nodo final por resultado", () => {
  const m = crearModelo({ ruta: RUTA });
  for (const [i, final] of FINALES.entries()) for (const ev of agente(`f${i}`, ["Inicio"], final)) aplicar(m, ev);
  for (const final of FINALES) assert.equal(m.nodos.get(claveDeFinal(final)).count, 1);
});

test("una vuelta atrás se abre según los anillos de sus extremos (el nodo visual necesita anillo)", () => {
  const medio = (A, B) => Math.hypot(...Object.values(puntoDeTramo(A, B, "ret", 0, 0.5, {})));
  const vecinos = medio({ r: radio(2), a: 0, anillo: 2 }, { r: radio(1), a: 0, anillo: 1 });
  const mismo = medio({ r: radio(2), a: 0, anillo: 2 }, { r: radio(2), a: 0, anillo: 2 });
  assert.equal(Math.round(vecinos), Math.round(radio(1.5) + PASO * 0.22));
  assert.equal(Math.round(mismo), Math.round(radio(2) + PASO * 0.5));
  assert.notEqual(medio({ r: radio(2), a: 0 }, { r: radio(1), a: 0 }), vecinos, "sin anillo, toda vuelta parece del mismo anillo");
});
