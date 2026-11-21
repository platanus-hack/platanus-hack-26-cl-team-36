import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { leerTanda } from "../lib/tandas.js";
import { atascosPorPagina, repiteAlAnterior } from "../public/telarana/atascos.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const clic = (objetivo, extra = {}) => ({ firma: { tipo: "clic", objetivo }, paginaAntes: "n1", pagina: "n1", salePagina: false, estado: "sin_evaluar", ...extra });

test("repetir la misma acción en la misma página", () => {
  assert.equal(repiteAlAnterior(clic("Buscar"), clic("Buscar")), true);
  assert.equal(repiteAlAnterior(clic("Buscar"), clic("Ayuda")), false);
  assert.equal(repiteAlAnterior(clic("Buscar", { salePagina: true, pagina: "n2" }), clic("Buscar")), false, "la anterior dejó la página");
  const desplazar = { firma: { tipo: "desplazar", direccion: "abajo" }, paginaAntes: "n1", pagina: "n1" };
  assert.equal(repiteAlAnterior(desplazar, desplazar), false, "desplazarse varias veces es leer, no trabarse");
  const enXY = (x, y) => ({ ...clic(null), firma: { tipo: "clic_coordenadas", x, y } });
  assert.equal(repiteAlAnterior(enXY(100, 200), enXY(104, 197)), true);
  assert.equal(repiteAlAnterior(null, clic("Buscar")), false);
});

test("atascos de la tanda nueva: demora, tropiezos y sin los intentos con error", async () => {
  const tanda = await leerTanda(RAIZ, "tarea-demo/2026-11-21_11-00-00");
  const atascos = atascosPorPagina(tanda);
  // Apurado da 7 pasos seguidos en Ayuda (n2), uno sin efecto; Adulto mayor vuelve atrás desde n6.
  assert.deepEqual(atascos.get("n2"), [{ intento: "hurried", demora: 7, tropiezos: 1, repetidos: 0 }]);
  assert.deepEqual(atascos.get("n6"), [{ intento: "senior", demora: null, tropiezos: 1, repetidos: 0 }]);
  assert.ok(![...atascos.values()].flat().some((a) => a.intento === "mobile"), "el error de la herramienta no cuenta");
  // Con el filtro de perfil, solo lo de ese perfil.
  assert.deepEqual([...atascosPorPagina(tanda, "senior").keys()], ["n6"]);
  assert.equal(atascosPorPagina(tanda, "first_time").size, 0);
});
