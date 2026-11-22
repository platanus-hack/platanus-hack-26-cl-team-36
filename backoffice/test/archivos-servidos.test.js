// /archivos/ con la lista de tandas que comparte el Overview (lib/panel.js, esTandaListada): N capturas dentro de la
// ventana cuestan una sola pasada de listado, una tanda que aparece después se sirve igual (si el id no está, se
// vuelve a listar) y la validación no cambia (NOMBRE_SEGURO, ARCHIVO_DE_PERFIL y solo ids listados). Los LIST se
// cuentan con el S3 falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { crearFuenteS3 } from "../lib/fuentes/s3.js";
import { crearPanel, memorizar } from "../lib/panel.js";
import { idsDeTandas } from "../lib/tandas.js";
import { crearServidor } from "../servidor.js";
import { clienteS3Falso, comandosS3, objetosDeCarpeta } from "./aws-falso.js";

const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const BUCKET = "chameleon-almacen-000000000000";
const ID = "demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z";
const FALLIDA = "demo.cl/visitor/tarea-demo/2026-11-21T12-00-00Z";
const EN_CURSO = "demo.cl/visitor/tarea-demo/2026-11-21T13-00-00Z";
const NUEVA = "demo.cl/visitor/tarea-demo/2026-11-21T15-00-00Z";
// Las 12 capturas de la tanda ID.
const CAPTURAS = [
  ...["00", "01", "02"].map((n) => `first_time/step_${n}.png`),
  ...["00", "01", "02", "03", "04", "05"].map((n) => `hurried/step_${n}.png`),
  ...["00", "01", "02"].map((n) => `mobile/step_${n}.png`),
];

function almacen() {
  const objetos = objetosDeCarpeta(RAIZ);
  const cliente = clienteS3Falso(BUCKET, objetos);
  return { objetos, cliente, fuente: crearFuenteS3({ bucket: BUCKET, cliente, comandos: comandosS3 }) };
}
const listados = (cliente) => cliente.contar("ListObjectsV2Command");

async function conServidor(fuente, probar) {
  const servidor = crearServidor({ fuente });
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  const pedir = async (ruta) => {
    const respuesta = await fetch(`http://127.0.0.1:${servidor.address().port}/backoffice/archivos/${ruta}`);
    await respuesta.arrayBuffer();
    return respuesta.status;
  };
  try {
    await probar(pedir);
  } finally {
    servidor.close();
  }
}

test("N capturas pedidas dentro de la ventana: una sola pasada de listado", async () => {
  // Lo que cuesta una pasada de idsDeTandas en frío, sobre el mismo almacén.
  const referencia = almacen();
  await idsDeTandas(referencia.fuente);
  const unaPasada = listados(referencia.cliente);
  assert.ok(unaPasada > 0);

  const { cliente, fuente } = almacen();
  await conServidor(fuente, async (pedir) => {
    assert.deepEqual(await Promise.all(CAPTURAS.map((captura) => pedir(`${ID}/${captura}`))), CAPTURAS.map(() => 200), "a la vez");
    for (const captura of CAPTURAS) assert.equal(await pedir(`${ID}/${captura}`), 200, `una por una: ${captura}`);
    assert.equal(listados(cliente), unaPasada, `${2 * CAPTURAS.length} capturas, una pasada`);
  });
});

test("una tanda que aparece después de la lista compartida se sirve igual: el id que falta se busca en una lista nueva", async () => {
  const { objetos, cliente, fuente } = almacen();
  await conServidor(fuente, async (pedir) => {
    assert.equal(await pedir(`${ID}/first_time/step_00.png`), 200, "la lista compartida queda sin NUEVA");
    // Termina una tanda nueva dentro de la ventana (la misma, copiada con su manifest succeeded y route_tree.json).
    for (const [clave, valor] of Object.entries(objetos)) if (clave.startsWith(`${ID}/`)) objetos[clave.replace(ID, NUEVA)] = valor;

    const antes = listados(cliente);
    assert.equal(await pedir(`${NUEVA}/first_time/step_00.png`), 200);
    assert.ok(listados(cliente) > antes, "volvió a listar");
    const despues = listados(cliente);
    assert.equal(await pedir(`${NUEVA}/mobile/step_01.png`), 200);
    assert.equal(await pedir(`${ID}/hurried/step_05.png`), 200);
    assert.equal(listados(cliente), despues, "la lista nueva quedó como la compartida");
  });
});

test("la validación no cambia: un id no listado, un perfil o un archivo inválido siguen en 404", async () => {
  const { objetos, cliente, fuente } = almacen();
  // Capturas que existen en tandas que no se listan: en curso, fallida, y una corrida de otro agente.
  const png = objetos[`${ID}/first_time/step_00.png`];
  for (const id of [EN_CURSO, FALLIDA, "demo.cl/cataloger/2026-11-21T09-00-00Z"]) objetos[`${id}/first_time/step_00.png`] = png;

  await conServidor(fuente, async (pedir) => {
    assert.equal(await pedir(`${ID}/first_time/step_00.png`), 200);
    const antes = listados(cliente);
    for (const ruta of [
      `${ID}/first_time/run.json`,
      `${ID}/first_time/step_1.png`,
      `${ID}/first_time/captura.png`,
      `${ID}/.oculto/step_00.png`,
      `${ID}/first_time/video.mp4`,
    ]) {
      assert.equal(await pedir(ruta), 404, ruta);
    }
    assert.equal(listados(cliente), antes, "un perfil o un archivo inválido se rechaza sin listar");

    for (const id of [EN_CURSO, FALLIDA, "demo.cl/cataloger/2026-11-21T09-00-00Z", "demo.cl/visitor/tarea-demo/2099-01-01T00-00-00Z"]) {
      assert.equal(await pedir(`${id}/first_time/step_00.png`), 404, id);
    }
    assert.ok(listados(cliente) > antes, "un id que no está en la lista compartida se busca en una nueva antes del 404");
  });
});

test("una tanda ya vista en la lista no se vuelve a listar, aunque la lista compartida haya vencido", async () => {
  const { cliente, fuente } = almacen();
  // memoriaMs 0: la lista compartida vence apenas se lee, como entre dos pasos del Replay.
  const panel = crearPanel({ fuente, memoriaMs: 0 });
  assert.equal(await panel.esTandaListada(ID), true);
  const antes = listados(cliente);
  for (let vez = 0; vez < 3; vez += 1) assert.equal(await panel.esTandaListada(ID), true);
  assert.equal(listados(cliente), antes, "confirmada: sin listar");

  // Lo que no está se sigue buscando en una lista nueva cada vez (no se recuerda un "no").
  assert.equal(await panel.esTandaListada(EN_CURSO), false);
  const despues = listados(cliente);
  assert.equal(await panel.esTandaListada(EN_CURSO), false);
  assert.ok(listados(cliente) > despues, "no listada: vuelve a listar");
});

test("memorizar con { desde }: sirve la lectura guardada solo si empezó después; si no, empieza otra y la comparte", async () => {
  let lecturas = 0;
  const leer = memorizar(async () => {
    lecturas += 1;
    return lecturas;
  }, 60_000);
  assert.equal(await leer(), 1);
  const pregunta = performance.now();
  assert.equal(await leer(), 1, "dentro de la ventana: la guardada");
  const [a, b] = await Promise.all([leer({ desde: pregunta }), leer({ desde: pregunta })]);
  assert.deepEqual([a, b], [2, 2], "más vieja que la pregunta: una nueva, compartida");
  assert.equal(await leer(), 2, "la nueva quedó como la guardada");
  assert.equal(await leer({ desde: pregunta }), 2, "ya empezó después de la pregunta");
});
