// Priorizador de trazas y estado del riel (public/tanda/priorizar.js, riel-estado.js) y títulos sin sufijo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerTanda } from "../lib/tandas.js";
import { grupoDe, motivoATexto, priorizar, puntaje } from "../public/tanda/priorizar.js";
import { fechaDeCorrida, otrasDeLaTarea, seleccion, vecina } from "../public/tanda/riel-estado.js";
import { limpiarTitulos, sinSufijo, sufijoDelSitio } from "../public/tanda/titulos.js";
import comunEn from "../public/i18n/en/comun.js";
import comunEs from "../public/i18n/es/comun.js";

const RAIZ = new URL("./fixtures/recorrido-unico", import.meta.url).pathname;
const CON_RUTA = "ejemplo.test/visitor/horario/2026-11-22T10-00-00Z";

const crearT = (comun) => (clave, vars = {}) => {
  const valor = clave.replace(/^comun\./, "").split(".").reduce((nodo, parte) => nodo?.[parte], comun);
  if (typeof valor === "function") return valor(vars, { plural: (n, formas) => (n === 1 ? formas.one : formas.other) });
  return typeof valor === "string" ? valor.replace(/\{(\w+)\}/g, (entero, nombre) => vars[nombre] ?? entero) : clave;
};

const paso = (pagina, senales = []) => ({ pagina, senales });
const intento = (id, extra = {}) => ({ id, resultado: "logrado", logro: "directo", camino: ["a", "b", "c"], pasos: [paso("b"), paso("c")], demoras: [], seSepara: null, ...extra });
const RUTA = { paginas: ["a", "b", "c"], pasosIdeales: 2 };

test("los que no llegan van primero y los idénticos se agrupan", () => {
  const grupos = priorizar(
    [
      intento("desktop"),
      intento("mobile-2"),
      intento("hurried", { resultado: "abandonado", logro: null, motivoDeFin: "gave_up", camino: ["a", "b"], seSepara: { pagina: null, seDetuvo: true } }),
      intento("senior", { resultado: "fallido", logro: "declaro_sin_llegar", camino: ["a", "x"], seSepara: { pagina: "x", seDetuvo: false } }),
    ],
    RUTA,
  );
  assert.deepEqual(grupos.map((g) => g.representante), ["senior", "hurried", "desktop"]);
  const ultimo = grupos.at(-1);
  assert.equal(ultimo.n, 2);
  assert.deepEqual(ultimo.intentos.map((i) => i.id), ["desktop", "mobile-2"]);
  assert.deepEqual(ultimo.motivos.map((m) => m.clave), ["siguioRuta"]);
  assert.deepEqual(grupos[0].motivos.map((m) => m.clave), ["creyoTerminar", "desvioUnico", "caminoUnico"]);
  assert.equal(grupos[1].motivos[0].clave, "fin_gave_up");
  assert.equal(grupos[1].motivos[0].pagina, "b", "sin desvío, queda donde terminó");
});

test("el puntaje suma señales, atascos y pasos de más, con tope", () => {
  const largo = intento("largo", {
    pasos: [paso("b", ["no_effect"]), paso("b", ["no_effect"]), paso("b", ["went_back"]), paso("c", ["visible_error"]), paso("c"), paso("c")],
    demoras: [{ pagina: "b" }, { pagina: "c" }, { pagina: "a" }],
  });
  const p = puntaje(largo, { ruta: RUTA });
  assert.deepEqual(
    p.motivos.map((m) => [m.clave, m.peso]),
    [["error", 25], ["atasco", 20], ["atasco", 20], ["veces", 10], ["sinEfecto", 6], ["atras", 3]],
  );
  assert.equal(p.valor, 84);
  assert.deepEqual(puntaje(intento("x", { resultado: "error" })), { valor: 0, motivos: [{ clave: "herramienta", peso: 0 }] });
});

test("a igual puntaje desempata el resultado, luego los pasos y luego el id", () => {
  const a = intento("b-uno", { logro: null });
  const b = intento("a-dos", { logro: null, camino: ["a", "c"] });
  const c = intento("c-tres", { logro: null, camino: ["a", "b", "b", "c"], pasos: [paso("b"), paso("b"), paso("c")] });
  assert.deepEqual(priorizar([a, b, c], null).map((g) => g.representante), ["c-tres", "a-dos", "b-uno"]);
});

test("los motivos se nombran en español y en inglés, con la página entre comillas", () => {
  const nombre = (id) => ({ b: "Ayuda" })[id] ?? id;
  const es = crearT(comunEs);
  const en = crearT(comunEn);
  assert.equal(motivoATexto({ clave: "fin_gave_up", pagina: "b" }, { t: es, nombre }), "se rindió en «Ayuda»");
  assert.equal(motivoATexto({ clave: "fin_gave_up", pagina: null }, { t: en, nombre }), "gave up on the start");
  assert.equal(motivoATexto({ clave: "sinEfecto", n: 3 }, { t: es, nombre }), "3 clics sin efecto");
  assert.equal(motivoATexto({ clave: "veces", n: 2 }, { t: en, nombre }), "2× the route's steps");
  for (const clave of Object.keys(comunEs.traza.motivo)) assert.ok(comunEn.traza.motivo[clave], clave);
});

test("una tanda real: cada intento cae en un grupo y el riel la recorre", async () => {
  const tanda = await leerTanda(RAIZ, CON_RUTA);
  const grupos = priorizar(tanda.intentos, tanda.telarana.ruta);
  assert.equal(grupos.reduce((s, g) => s + g.n, 0), tanda.intentos.length);
  for (const i of tanda.intentos) assert.ok(grupoDe(grupos, i.id));
  for (let k = 1; k < grupos.length; k++) assert.ok(grupos[k - 1].valor >= grupos[k].valor);
});

test("seleccion: el intento del hash elige su fila; el Replay cae en la primera", () => {
  const grupos = priorizar([intento("desktop"), intento("mobile"), intento("lento", { resultado: "abandonado", logro: null })], RUTA);
  assert.equal(seleccion(grupos, "mobile").grupo.representante, "desktop");
  assert.equal(seleccion(grupos, "mobile").intento.id, "mobile");
  assert.equal(seleccion(grupos, null), null);
  assert.equal(seleccion(grupos, "nadie"), null);
  assert.deepEqual(
    [seleccion(grupos, null, { porDefecto: true }).intento.id, seleccion(grupos, "nadie", { porDefecto: true }).valido],
    ["lento", false],
  );
});

test("vecina: ↑ ↓ recorren las filas sin dar la vuelta", () => {
  const grupos = priorizar([intento("a"), intento("b", { resultado: "abandonado", logro: null }), intento("c", { resultado: "fallido", logro: null, camino: ["a"] })], RUTA);
  const ids = grupos.map((g) => g.representante);
  assert.equal(vecina(grupos, null, 1), ids[0]);
  assert.equal(vecina(grupos, null, -1), ids.at(-1));
  assert.equal(vecina(grupos, ids[0], 1), ids[1]);
  assert.equal(vecina(grupos, ids[0], -1), ids[0]);
  assert.equal(vecina(grupos, ids.at(-1), 1), ids.at(-1));
  assert.equal(vecina([], "a", 1), null);
});

test("otras tandas de la tarea, de la más nueva, y su fecha legible", () => {
  const otras = otrasDeLaTarea({ mismaTarea: [{ id: "v", fecha: "2026-11-01T10-00-00Z" }, { id: "n", fecha: "2026-11-20T10-00-00Z" }] });
  assert.deepEqual(otras.map((o) => o.id), ["n", "v"]);
  assert.equal(otrasDeLaTarea(null).length, 0);
  assert.equal(fechaDeCorrida("2026-11-20T00-46-11Z"), "2026-11-20T00:46:11Z");
  assert.equal(fechaDeCorrida("2026-11-20T00-46-11Z_02"), "2026-11-20T00:46:11Z");
});

test("el sufijo del sitio sale de los nombres de página", () => {
  const titulos = ["Inicio - Aerolínea Cóndor", "Ayuda - Aerolínea Cóndor", "Mascotas - Aerolínea Cóndor", "Contacto"];
  assert.equal(sufijoDelSitio(titulos), " - Aerolínea Cóndor");
  assert.equal(sufijoDelSitio(["Ayuda | Sitio", "Otra"]), "", "una sola vez no es un sufijo");
  assert.equal(sinSufijo("Preguntas - Aerolínea Cóndor · /faq", " - Aerolínea Cóndor"), "Preguntas · /faq");
  assert.equal(sinSufijo("Aerolínea Cóndor", " - Aerolínea Cóndor"), "Aerolínea Cóndor");
  const tanda = {
    telarana: {
      paginas: [
        { titulo: "Inicio - Aerolínea Cóndor", tituloCorto: null, tituloTipo: "inicio" },
        { titulo: "Ayuda - Aerolínea Cóndor", tituloCorto: "Ayuda - Aerolínea Cóndor", tituloTipo: "sitio" },
        { titulo: "Pago - Aerolínea Cóndor", tituloCorto: null, tituloTipo: "sitio" },
      ],
    },
  };
  limpiarTitulos(tanda);
  assert.deepEqual(tanda.telarana.paginas.map((p) => p.tituloCorto), [null, "Ayuda", "Pago"]);
});
