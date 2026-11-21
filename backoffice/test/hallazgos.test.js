import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { contarAcciones, demorasDelIntento } from "../lib/hallazgos.js";
import { leerTanda } from "../lib/tandas.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));

// Un intento sintético: `enPagina` pasos seguidos en una página y luego sale.
function intentoCon(pagina, enPagina, accion = "left_click") {
  const pasos = Array.from({ length: enPagina }, (_, i) => ({ numero: i + 1, accion, pagina, salePagina: false }));
  pasos.push({ numero: enPagina + 1, accion: "left_click", pagina: "otra", salePagina: true });
  return { pasos };
}

const RUTA_WOM = { paginas: ["n1", "n2", "n3", "n4"], tramos: [{ pasos: 3 }, { pasos: 1 }, { pasos: 4 }] };
const RUTA_SII = { paginas: ["n1", "n2", "n3"], tramos: [{ pasos: 1 }, { pasos: 4 }] };
const opciones = { logrado: true, paginaFinal: "n9" };

test("demoras: umbral según los pasos que da la ruta en esa página", () => {
  // wom: la ruta da 2 pasos en Inicio → umbral 5.
  assert.equal(demorasDelIntento(intentoCon("n1", 5), RUTA_WOM, opciones).length, 1, "wom mobile: 5 pasos en Inicio");
  assert.equal(demorasDelIntento(intentoCon("n1", 4), RUTA_WOM, opciones).length, 0, "wom first_time: 4 pasos en Inicio");
  // sii: la ruta da 3 pasos en «Ley reconstruccion» → umbral 6.
  const [demora] = demorasDelIntento(intentoCon("n2", 9, "scroll"), RUTA_SII, opciones);
  assert.deepEqual(
    { ...demora, conteos: undefined },
    { pagina: "n2", desdePaso: 1, hastaPaso: 9, pasos: 9, rutaPasos: 3, conteos: undefined },
  );
  assert.equal(demorasDelIntento(intentoCon("n2", 5), RUTA_SII, opciones).length, 0, "sii mobile: 5 pasos");
  // Fuera de la ruta, o sin ruta, el umbral es 4.
  assert.equal(demorasDelIntento(intentoCon("x", 4), RUTA_SII, opciones)[0].rutaPasos, null);
  assert.equal(demorasDelIntento(intentoCon("x", 4), null, opciones).length, 1);
  // La página final de un intento logrado no cuenta: ahí lee la respuesta.
  assert.equal(demorasDelIntento(intentoCon("n9", 8), RUTA_SII, opciones).length, 0);
});

test("contar acciones por tipo", () => {
  assert.deepEqual(
    contarAcciones([{ accion: "left_click" }, { accion: "scroll" }, { accion: "type" }, { accion: "key" }, { accion: "zoom" }, { accion: "double_click" }]),
    { clic: 2, desplazamiento: 1, texto: 1, tecla: 1, otra: 1 },
  );
});

test("hallazgos de la tanda nueva, en orden y solo con claves y variables", async () => {
  const tanda = await leerTanda(RAIZ, "tarea-demo/2026-11-21_11-00-00");
  assert.deepEqual(tanda.hallazgos.map((h) => h.id), [
    "resultado", "errores", "desvio:senior", "detenido:senior", "demora:hurried:2", "tropiezos", "costo",
  ]);
  const porId = Object.fromEntries(tanda.hallazgos.map((h) => [h.id, h]));
  assert.deepEqual(porId.resultado, {
    id: "resultado", nivel: "atencion", clave: "datos.hallazgo.resultado",
    vars: { total: 4, validos: 3, logrados: 2, directos: 2, siguen: 2, errores: 1, intentos: ["senior"] },
    intento: null, paso: null, pagina: null,
  });
  assert.deepEqual(porId.errores.vars, { intentos: ["mobile"] });
  assert.deepEqual(porId["desvio:senior"].vars, { intento: "senior", desdePagina: "n1", haciaPagina: "n5", paso: 1, vuelveEnPaso: null });
  assert.equal(porId["desvio:senior"].nivel, "atencion");
  assert.deepEqual(porId["detenido:senior"].vars, { intento: "senior", pagina: "n5", pasos: 3, motivo: "gave_up" });
  assert.deepEqual(porId["demora:hurried:2"].vars, {
    intento: "hurried", pagina: "n2", pasos: 6, rutaPasos: 0,
    conteos: { clic: 0, desplazamiento: 6, texto: 0, tecla: 0, otra: 0 },
  });
  assert.deepEqual([porId["demora:hurried:2"].intento, porId["demora:hurried:2"].paso], ["hurried", 2]);
  assert.deepEqual(porId.tropiezos.vars, {
    pasos: 2,
    casos: [{ intento: "hurried", paso: 4, senal: "no_effect" }, { intento: "senior", paso: 3, senal: "went_back" }],
  });
  assert.deepEqual(porId.costo.vars, { pasosMediana: 4, pasosIdeales: 2 });
  for (const hallazgo of tanda.hallazgos) assert.match(hallazgo.clave, /^datos\.hallazgo\.[a-z]+$/);
});

test("titulares de las dos tandas", async () => {
  const nueva = await leerTanda(RAIZ, "tarea-demo/2026-11-21_11-00-00");
  assert.deepEqual(nueva.titulares.tanda, { clave: nueva.hallazgos[0].clave, vars: nueva.hallazgos[0].vars });
  assert.deepEqual(nueva.titulares.telarana, {
    clave: "datos.titular.telarana", vars: { hayRuta: true, tramos: 2, pasosIdeales: 2, siguen: 2, validos: 3 },
  });
  assert.deepEqual(nueva.titulares.perfiles.vars, {
    caso: "noLlegan", intentos: ["senior"], pasos: null, pasosIdeales: 2, perfiles: 3, unoPorPerfil: true,
  });
  const vieja = await leerTanda(RAIZ, "tarea-demo/2026-11-21_10-00-00");
  assert.deepEqual(vieja.hallazgos.map((h) => h.id), ["resultado", "desvio:hurried", "desvio:mobile", "detenido:mobile", "tropiezos"]);
  assert.equal(vieja.hallazgos.find((h) => h.id === "desvio:hurried").nivel, "info", "vuelve a la ruta");
});
