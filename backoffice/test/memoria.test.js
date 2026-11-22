// memorizar con rancioMs (lib/memoria.js): sirve lo vencido mientras arma lo nuevo, que recibe la pregunta siguiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memorizar } from "../lib/memoria.js";

test("memorizar con rancioMs: lo vencido se sirve sin esperar mientras se arma lo nuevo, que recibe la pregunta siguiente", async () => {
  let vez = 0;
  let soltar;
  const leer = memorizar(
    async () => {
      vez += 1;
      if (vez > 1) await new Promise((listo) => (soltar = listo));
      return vez;
    },
    10,
    { rancioMs: 10_000 },
  );
  assert.equal(await leer(), 1);
  await new Promise((listo) => setTimeout(listo, 20));
  assert.equal(await leer(), 1, "vencida: responde la anterior sin esperar");
  assert.equal(await leer(), 1, "mientras arma la nueva, la anterior sigue sirviendo");
  assert.equal(vez, 2, "una sola lectura nueva por detrás");
  soltar();
  await new Promise((listo) => setTimeout(listo, 0));
  assert.equal(await leer(), 2);

  const sinRancio = memorizar(async () => (vez += 1), 10);
  const primera = await sinRancio();
  await new Promise((listo) => setTimeout(listo, 20));
  assert.equal(await sinRancio(), primera + 1, "sin rancioMs, vencida espera la nueva");
});
