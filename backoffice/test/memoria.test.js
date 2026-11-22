// memorizar con rancioMs (lib/memoria.js): sirve lo vencido mientras arma lo nuevo, que recibe la pregunta siguiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memorizar } from "../lib/memoria.js";

test("memorizar con rancioMs: sirve lo vencido sin esperar mientras arma lo nuevo", async () => {
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

test("memorizar: una lectura vieja que termina tarde no pisa a una más nueva", async () => {
  const soltar = [];
  const leer = memorizar(
    () => {
      const vez = soltar.length + 1;
      return new Promise((listo) => soltar.push(() => listo(vez)));
    },
    10,
    { rancioMs: 10_000 },
  );
  const tick = () => new Promise((listo) => setTimeout(listo, 0));
  const primera = leer();
  await tick();
  const segunda = leer({ desde: performance.now() + 1 });
  await tick();
  soltar[1]();
  assert.equal(await segunda, 2);
  soltar[0]();
  await primera;
  await new Promise((listo) => setTimeout(listo, 20));
  assert.equal(await leer(), 2, "vencida: responde la guardada y arma otra por detrás");
  assert.equal(await leer(), 2, "mientras arma, sirve la más nueva, no la que terminó tarde");
  await tick();
  soltar[2]();
});

test("memorizar: un error del recálculo por detrás se avisa y la pregunta siguiente reintenta", async (t) => {
  const avisos = t.mock.method(console, "warn", () => {});
  let vez = 0;
  const leer = memorizar(
    async () => {
      vez += 1;
      if (vez === 2) throw new Error("se cayó S3");
      return vez;
    },
    10,
    { rancioMs: 10_000 },
  );
  assert.equal(await leer(), 1);
  await new Promise((listo) => setTimeout(listo, 20));
  assert.equal(await leer(), 1, "responde la anterior");
  await new Promise((listo) => setTimeout(listo, 0));
  assert.equal(avisos.mock.callCount(), 1);
  assert.match(String(avisos.mock.calls[0].arguments[1]?.message), /se cayó S3/);
  assert.equal(await leer(), 3);
});
