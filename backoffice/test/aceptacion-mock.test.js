// Aceptación del Overview (especificación §5) sobre los datos de prueba de verdad: backoffice/.mock, que genera
// mock/generar.py y no está en git. Sin esa carpeta, estas pruebas se saltan (aceptacion.test.js prueba lo mismo
// sobre un almacén en memoria).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crearFuente } from "../lib/fuente.js";
import { crearPanel } from "../lib/panel.js";
import { crearRevisiones } from "../lib/revisiones.js";
import { crearServidor } from "../servidor.js";
import { clienteDynamoFalso, comandosDynamo } from "./aws-falso.js";

const MOCK = fileURLToPath(new URL("../.mock", import.meta.url));
const HAY_MOCK = existsSync(`${MOCK}/corridas`) && existsSync(`${MOCK}/revisiones.json`);
const SALTAR = HAY_MOCK ? false : "no hay datos de prueba en backoffice/.mock (npm run mock:generar)";

const CONTRATO_RESUMEN = {
  ahora: "2026-11-22T03:36:49.000Z",
  roles: {
    cataloger: { logrado: 72, fallido: 9, en_curso: 1, en_cola: 0 },
    guide: { logrado: 191, fallido: 19, en_curso: 3, en_cola: 3 },
    visitor: {
      all: { logrado: 595, fallido: 128, abandonado: 128, sin_medir: 49, error: 22, en_curso: 0, en_cola: 6 },
      desktop: { logrado: 476, fallido: 84, abandonado: 100, sin_medir: 35, error: 13, en_curso: 0, en_cola: 6 },
      mobile: { logrado: 119, fallido: 44, abandonado: 28, sin_medir: 14, error: 9, en_curso: 0, en_cola: 6 },
    },
    improver: { logrado: 65, fallido: 3, en_curso: 1, en_cola: 3 },
  },
};
// Contrato §2 con los ajustes de §7.3: las en cola son tarjetas (Recent y Live), sin `cola`.
const LIVE = ["mwracgf6-dbc496", "mwracfin-1fb17c", "mwra90fg-e77243", "mwra38v2-ae97ba", "mwra2k9l-c6aa7d", "mwr9xaz3-e22b64", "mwr3wz54-abd5a1"];
const CONTRATO_LISTAS = {
  cuentas: { total: 90, running: 5, stalled: 1, queued: 2, live: 7, delivered: 65, failed: 18 },
  pestanas: {
    recent: { ids: LIVE.slice(0, 6), total: 90, pagina: 1, paginas: 15 },
    live: { ids: LIVE.slice(0, 6), total: 7, pagina: 1, paginas: 2 },
    delivered: { ids: ["mwqzio79-f9166d", "mwqz780m-8ef86d", "mwqygae6-78cdf0", "mwqw761q-7e7961", "mwqtq24w-dd7f1b", "mwqr64yv-16034e"], total: 65, pagina: 1, paginas: 11 },
    failed: { ids: ["mwqhgg8u-c7d205", "mwq9ud02-ba22c7", "mwq9jnpg-b1348a", "mwq89pkb-69522a", "mwpzu4cp-8db0a9", "mwpxkn6i-c6aa1f"], total: 18, pagina: 1, paginas: 3 },
  },
};

let servidor;
let base;
let panel;
let overview;
before(async () => {
  if (!HAY_MOCK) return;
  const { items, generado } = JSON.parse(readFileSync(`${MOCK}/revisiones.json`, "utf8"));
  const tabla = "chameleon-revisiones (mock)";
  const opciones = () => ({
    fuente: crearFuente({ tipo: "archivos", raiz: `${MOCK}/corridas` }),
    revisiones: crearRevisiones({ tabla, cliente: clienteDynamoFalso(tabla, items, { porPagina: 100 }), comandos: comandosDynamo }),
    reloj: () => new Date(generado),
  });
  servidor = crearServidor(opciones());
  panel = crearPanel(opciones());
  await new Promise((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${servidor.address().port}/backoffice`;
  // Live entera, en sus dos páginas (las 7: también Banco Andino /personas, detenida, que queda en la página 2).
  const [primeraDeLive, segundaDeLive] = await Promise.all(
    ["", "?pestana=live&pagina=2"].map(async (consulta) => (await fetch(`${base}/api/overview${consulta}`)).json()),
  );
  overview = {
    ...segundaDeLive,
    pestanas: { ...segundaDeLive.pestanas, live: { ...segundaDeLive.pestanas.live, ids: [...primeraDeLive.pestanas.live.ids, ...segundaDeLive.pestanas.live.ids] } },
    tarjetas: { ...primeraDeLive.tarjetas, ...segundaDeLive.tarjetas },
  };
});
after(() => servidor?.close());

const minutos = (desde, hasta) => Math.floor((Date.parse(hasta) - Date.parse(desde)) / 60_000);
const etapas = (tarjeta) => Object.values(tarjeta.etapas).join("·");

test("mock: /api/resumen es exactamente el del contrato", { skip: SALTAR }, async () => {
  assert.deepEqual(await (await fetch(`${base}/api/resumen`)).json(), CONTRATO_RESUMEN);
});

test("mock: /api/overview con 90 revisiones (65 entregadas, 18 fallidas, 5 corriendo, 2 en cola); Recent empieza por las en cola", { skip: SALTAR }, async () => {
  const porDefecto = await (await fetch(`${base}/api/overview`)).json();
  assert.deepEqual(Object.keys(porDefecto), ["ahora", "disponible", "umbralDetenidaMin", "busqueda", "cuentas", "pestanas", "tarjetas"], "sin cola");
  assert.equal(porDefecto.ahora, "2026-11-22T03:36:49.000Z");
  assert.equal(porDefecto.disponible, true);
  assert.equal(porDefecto.umbralDetenidaMin, 30);
  assert.deepEqual(porDefecto.cuentas, CONTRATO_LISTAS.cuentas);
  assert.deepEqual(porDefecto.pestanas, CONTRATO_LISTAS.pestanas);
  const conTarjeta = new Set(Object.values(porDefecto.pestanas).flatMap((p) => p.ids));
  assert.deepEqual(Object.keys(porDefecto.tarjetas).sort(), [...conTarjeta].sort());
  assert.deepEqual(["mwracgf6-dbc496", "mwracfin-1fb17c"].map((id) => porDefecto.tarjetas[id].estado), ["queued", "queued"]);
});

test("mock: las dos páginas de Live traen las 7 (corriendo, detenida y en cola), más nuevas primero", { skip: SALTAR }, () => {
  assert.deepEqual(overview.pestanas.live, { ids: LIVE, total: 7, pagina: 2, paginas: 2 });
  assert.equal(overview.cuentas.live, overview.pestanas.live.total);
  assert.deepEqual(LIVE.map((id) => overview.tarjetas[id].estado), ["queued", "queued", "running", "running", "running", "running", "stalled"]);
  for (const otra of ["recent", "delivered", "failed"]) assert.deepEqual(overview.pestanas[otra], CONTRATO_LISTAS.pestanas[otra], otra);
});

test("mock: ?pestana=delivered&pagina=3 trae esa página de 6 con sus tarjetas; la última trae las 5 que quedan", { skip: SALTAR }, async () => {
  const tercera = await (await fetch(`${base}/api/overview?pestana=delivered&pagina=3`)).json();
  const { delivered } = tercera.pestanas;
  assert.deepEqual([delivered.ids.length, delivered.total, delivered.pagina, delivered.paginas], [6, 65, 3, 11]);
  assert.ok(delivered.ids.every((id) => !CONTRATO_LISTAS.pestanas.delivered.ids.includes(id)), "otra página, otras revisiones");
  assert.equal(delivered.ids.filter((id) => tercera.tarjetas[id]?.estado === "delivered").length, 6);
  for (const otra of ["recent", "live", "failed"]) assert.deepEqual(tercera.pestanas[otra], CONTRATO_LISTAS.pestanas[otra], otra);
  assert.equal(Object.keys(tercera.tarjetas).length, new Set(Object.values(tercera.pestanas).flatMap((p) => p.ids)).size);
  const ultima = (await (await fetch(`${base}/api/overview?pestana=delivered&pagina=11`)).json()).pestanas.delivered;
  assert.deepEqual([ultima.ids.length, ultima.pagina], [5, 11]);
});

test("mock: /api/tarjetas/<revision> da la tarjeta de una fallida (la hoja #/f/); una que no existe, 404", { skip: SALTAR }, async () => {
  const respuesta = await (await fetch(`${base}/api/tarjetas/mwqhgg8u-c7d205`)).json();
  assert.equal(respuesta.tarjeta.estado, "failed");
  assert.equal(respuesta.tarjeta.etapas.catalog, "fallido");
  assert.equal(typeof respuesta.ahora, "string");
  assert.equal((await fetch(`${base}/api/tarjetas/zzzzzzzz-000000`)).status, 404);
});

test("mock: Banco Andino /personas está detenida hace 3 h; las otras 4 que corren llevan de 2 a 11 min", { skip: SALTAR }, () => {
  const banco = overview.tarjetas["mwr3wz54-abd5a1"];
  assert.deepEqual([banco.sitio, banco.ruta, banco.estado, banco.motivo], ["Banco Andino", "/personas", "stalled", { tipo: "sin_avance", detalle: null }]);
  assert.equal(minutos(banco.actualizada, overview.ahora), 179, "2 h 59 min: «3 h» en la página");
  assert.equal(etapas(banco), "detenido·pendiente·pendiente·pendiente");
  assert.deepEqual(banco.agentes, [{ rol: "cataloger", estado: "detenido", dispositivo: null }]);

  const corriendo = Object.values(overview.tarjetas).filter((tarjeta) => tarjeta.estado === "running");
  assert.deepEqual(
    corriendo.map((t) => [t.sitio, t.ruta, minutos(t.creada, overview.ahora)]).sort((a, b) => a[2] - b[2]),
    [
      ["Móvil Sur", "/", 2],
      ["Municipalidad de Valle Verde", "/", 7],
      ["Tienda Volcán", "/ofertas", 7],
      ["Móvil Sur", "/", 11],
    ],
  );
});

test("mock: etapas, capturas, nombre y acento de las tarjetas del contrato", { skip: SALTAR }, async () => {
  const movilsur = overview.tarjetas["mwr9xaz3-e22b64"];
  assert.equal(etapas(movilsur), "hecho·hecho·hecho·en_curso");
  assert.deepEqual(movilsur.capturas, {
    desktop: { tanda: "movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z", carpeta: "desktop", archivo: "step_00.png" },
    mobile: { tanda: "movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z", carpeta: "mobile", archivo: "step_00.png" },
  });
  assert.equal(etapas(overview.tarjetas["mwra2k9l-c6aa7d"]), "hecho·en_curso·en_curso·pendiente");
  assert.equal(etapas(overview.tarjetas["mwq9jnpg-b1348a"]), "fallido·pendiente·pendiente·pendiente");
  assert.equal(etapas(overview.tarjetas["mwqhgg8u-c7d205"]), "fallido·pendiente·pendiente·pendiente");
  assert.deepEqual(overview.tarjetas["mwq9jnpg-b1348a"].agentes, [], "fallida por 429, sin ítems");

  // Toda captura apunta a una tanda que /archivos/ sirve; los acentos son hex.
  for (const tarjeta of Object.values(overview.tarjetas)) {
    for (const captura of Object.values(tarjeta.capturas).filter(Boolean)) {
      const url = `${base}/archivos/${captura.tanda}/${captura.carpeta}/${captura.archivo}`;
      const respuesta = await fetch(url, { method: "HEAD" });
      assert.equal(respuesta.status, 200, url);
      assert.equal(respuesta.headers.get("content-type"), "image/png");
    }
    if (tarjeta.estado === "delivered") assert.match(tarjeta.acento, /^#[0-9a-f]{6}$/, tarjeta.revision);
  }
  const entregada = overview.tarjetas["mwqzio79-f9166d"];
  assert.deepEqual([entregada.sitio, entregada.ruta, entregada.acento], ["Clínica Austral", "/nosotros", "#007e86"]);
});

test("mock: cada goal trae la tanda de su Visitante en esta revisión, solo si se lista (§6.5)", { skip: SALTAR }, async () => {
  const tandas = (id) => overview.tarjetas[id].goals.map((g) => [g.goal, g.tanda]);
  // Clínica Austral /nosotros, entregada: la de cada goal, en el orden de la tarjeta.
  assert.deepEqual(tandas("mwqzio79-f9166d"), [
    ["resultados-examenes", "clinicaaustral.test/visitor/resultados-examenes/2026-11-21T22-39-52Z"],
    ["convenio-isapre", "clinicaaustral.test/visitor/convenio-isapre/2026-11-21T22-37-12Z"],
    ["urgencia-pediatrica", "clinicaaustral.test/visitor/urgencia-pediatrica/2026-11-21T22-43-42Z"],
  ]);
  assert.equal(overview.tarjetas["mwr9xaz3-e22b64"].goals.find((g) => g.goal === "cobertura-5g").tanda, "movilsur.test/visitor/cobertura-5g/2026-11-22T03-28-29Z");
  // Tienda Volcán /ofertas corre: el Visitante de devolver-producto todavía no parte.
  assert.deepEqual(tandas("mwra2k9l-c6aa7d").at(-1), ["devolver-producto", null]);
  // Muni Los Pinos: el Visitante de retiro-voluminosos falló sin intentos; su tanda no se lista.
  assert.deepEqual(tandas("mwqz780m-8ef86d").at(-1), ["retiro-voluminosos", null]);
  assert.deepEqual(tandas("mwr3wz54-abd5a1"), [], "detenida antes de catalogar: sin goals");

  // Cada tanda es de su goal en esa revisión y abre en la telaraña (/api/tandas/<tanda>).
  for (const tarjeta of Object.values(overview.tarjetas)) {
    for (const { goal, tanda } of tarjeta.goals.filter((g) => g.tanda)) {
      assert.equal(tanda.split("/").slice(0, 3).join("/"), `${tarjeta.host}/visitor/${goal}`, `${tarjeta.revision} ${goal}`);
      assert.equal((await fetch(`${base}/api/tandas/${tanda}`)).status, 200, tanda);
    }
  }
});

test("mock: motivos de las fallidas (catalogador, límite de AgentCore, diseñador)", { skip: SALTAR }, async () => {
  const motivo = (id) => [overview.tarjetas[id].host, overview.tarjetas[id].motivo.tipo];
  assert.deepEqual(motivo("mwqhgg8u-c7d205"), ["aerolineacondor.test", "catalogador"]);
  assert.deepEqual(motivo("mwq9ud02-ba22c7"), ["aerolineacondor.test", "catalogador"]);
  assert.deepEqual(motivo("mwq89pkb-69522a"), ["munilospinos.test", "catalogador"]);
  for (const [id, host] of [["mwq9jnpg-b1348a", "unilitoral.test"], ["mwpzu4cp-8db0a9", "bancoandino.test"], ["mwpxkn6i-c6aa1f", "munivalleverde.test"]]) {
    assert.deepEqual(overview.tarjetas[id].motivo, { tipo: "limite", detalle: "AgentCore429: ThrottlingException: Rate exceeded" }, host);
    assert.equal(overview.tarjetas[id].host, host);
  }
  // Muni Valle Verde del 2026-11-20 no está entre las 6 de Failed: se pide su tarjeta directo.
  const valleVerde = await panel.tarjeta("mwoy9nur-668d43");
  assert.deepEqual([valleVerde.host, valleVerde.creada.slice(0, 10), valleVerde.estado, valleVerde.motivo.tipo], ["munivalleverde.test", "2026-11-20", "failed", "disenador"]);
  assert.equal(etapas(valleVerde), "hecho·hecho·hecho·fallido");
});
