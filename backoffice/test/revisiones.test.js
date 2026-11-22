import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { avanceDeRevision, crearRevisiones, paginaDeRevision, partesDeResultado, revisionesVigentes } from "../lib/revisiones.js";
import { coincide } from "../lib/etiqueta.js";
import { esperaDe, revisionTerminada } from "../public/pantallas/revisiones.js";
import { crearServidor } from "../servidor.js";
import { clienteDynamoFalso, comandosDynamo } from "./aws-falso.js";

const TABLA = "chameleon-revisiones";
const RAIZ = fileURLToPath(new URL("./fixtures/corridas", import.meta.url));
const CATALOGO = "wom.cl/cataloger/2026-11-21T10-00-00Z";
const guia = (goal) => `wom.cl/guide/${goal}/desktop/2026-11-21T10-05-00Z`;
const visita = (goal) => `wom.cl/visitor/${goal}/2026-11-21T10-10-00Z`;
const MEJORA = "wom.cl/improver/2026-11-21T10-30-00Z";

const meta = (revision, campos) => ({
  PK: `REV#${revision}`,
  SK: "META",
  url: "https://wom.cl/planes",
  host: "wom.cl",
  created_at: "2026-11-21T10:00:00Z",
  updated_at: "2026-11-21T10:00:00Z",
  ...campos,
});
const item = (revision, SK, status, run_key, updated_at = "2026-11-21T10:20:00Z") => ({ PK: `REV#${revision}`, SK, status, run_key, updated_at });

const RECIEN = [meta("recien", { status: "queued" })];
const A_MEDIAS = [
  meta("a-medias", { status: "running", goals_total: 3 }),
  item("a-medias", "STAGE#cataloger", "succeeded", CATALOGO),
  item("a-medias", "GOAL#baja-fibra#guide", "succeeded", guia("baja-fibra")),
  item("a-medias", "GOAL#baja-fibra#visitor", "running", visita("baja-fibra")),
  item("a-medias", "GOAL#ver-planes#guide", "failed", `${guia("ver-planes")}/manifest.json`),
  item("a-medias", "GOAL#contratar#guide", "running", guia("contratar")),
];
const LISTA = [
  meta("lista", { status: "done", goals_total: 1, css_key: `${MEJORA}/tema.css`, created_at: "2026-11-21T11:00:00Z" }),
  item("lista", "STAGE#cataloger", "succeeded", CATALOGO),
  item("lista", "GOAL#baja-fibra#guide", "succeeded", guia("baja-fibra")),
  item("lista", "GOAL#baja-fibra#visitor", "succeeded", visita("baja-fibra")),
  item("lista", "STAGE#improver", "succeeded", MEJORA),
];
const FALLIDA = [
  meta("fallida", { status: "failed", goals_total: 0, created_at: "2026-11-21T09:00:00Z" }),
  item("fallida", "STAGE#cataloger", "failed", "s3://no/es/una/clave"),
];

test("recién creada: todo pendiente y sin goals conocidos", () => {
  const avance = avanceDeRevision(RECIEN);
  assert.equal(avance.revision, "recien");
  assert.equal(avance.estado, "queued");
  assert.deepEqual(avance.catalogo, { estado: "pending", runKey: null, actualizada: null, resultados: [] });
  assert.deepEqual(avance.goals, []);
  assert.equal(avance.improver.estado, "pending");
  assert.deepEqual(avance.progreso, { cerrados: 0, total: 2, goalsConocidos: false });
  assert.equal(avance.css, null);
});

test("a medias: goals en distintos estados, enlaces solo de las corridas terminadas", () => {
  const avance = avanceDeRevision(A_MEDIAS);
  assert.equal(avance.estado, "running");
  assert.deepEqual(avance.goals.map((g) => [g.goal, g.guide.estado, g.visitor.estado]), [
    ["baja-fibra", "succeeded", "running"],
    ["contratar", "running", "pending"],
    ["ver-planes", "failed", "pending"],
  ]);
  assert.deepEqual(avance.catalogo.resultados, [
    { archivo: "goals.json", clave: `${CATALOGO}/goals.json` },
    { archivo: "manifest.json", clave: `${CATALOGO}/manifest.json` },
  ]);
  const [fibra, contratar, planes] = avance.goals;
  assert.deepEqual(fibra.guide.resultados.map((r) => r.archivo), ["route.json", "manifest.json"]);
  assert.deepEqual(fibra.visitor.resultados, [], "una corrida en curso no tiene resultados");
  assert.deepEqual(contratar.guide.resultados, []);
  // Fallida: solo su manifiesto; la clave del manifiesto se acepta como clave de la corrida.
  assert.equal(planes.guide.runKey, guia("ver-planes"));
  assert.deepEqual(planes.guide.resultados, [{ archivo: "manifest.json", clave: `${guia("ver-planes")}/manifest.json` }]);
  // catálogo + guide de baja-fibra + guide fallido de ver-planes, de 2 + 2 × 3.
  assert.deepEqual(avance.progreso, { cerrados: 3, total: 8, goalsConocidos: true });
});

test("done con css: la tanda del visitor, el tema del improver y el css de la revisión", () => {
  const avance = avanceDeRevision(LISTA);
  assert.equal(avance.estado, "done");
  assert.equal(avance.css, `${MEJORA}/tema.css`);
  assert.deepEqual(avance.goals[0].visitor.resultados, [
    { tanda: visita("baja-fibra") },
    { archivo: "manifest.json", clave: `${visita("baja-fibra")}/manifest.json` },
  ]);
  assert.deepEqual(avance.improver.resultados.map((r) => r.archivo), ["tema.css", "manifest.json"]);
  assert.deepEqual(avance.progreso, { cerrados: 4, total: 4, goalsConocidos: true });
});

test("failed: el estado de la revisión manda y una run_key que no es del almacén no se enlaza", () => {
  const avance = avanceDeRevision(FALLIDA);
  assert.equal(avance.estado, "failed");
  assert.deepEqual(avance.catalogo, { estado: "failed", runKey: null, actualizada: "2026-11-21T10:20:00Z", resultados: [] });
  assert.deepEqual(avance.progreso, { cerrados: 1, total: 2, goalsConocidos: true });
});

test("META con goals_total no numérico o css_key que no es un tema: se ignoran", () => {
  const avance = avanceDeRevision([meta("rara", { status: "running", goals_total: "muchos", css_key: `${CATALOGO}/goals.json` })]);
  assert.equal(avance.goalsTotal, null);
  assert.equal(avance.css, null);
  assert.deepEqual(avance.progreso, { cerrados: 0, total: 2, goalsConocidos: false });
});

test("sin META no hay revisión", () => {
  assert.equal(avanceDeRevision([item("x", "STAGE#cataloger", "running", CATALOGO)]), null);
  assert.equal(avanceDeRevision([]), null);
});

test("partesDeResultado: solo archivos de resultado bajo una clave de corrida", () => {
  assert.deepEqual(partesDeResultado(`${MEJORA}/tema.css`), { runKey: MEJORA, archivo: "tema.css" });
  assert.deepEqual(partesDeResultado(`${guia("x")}/route.json`), { runKey: guia("x"), archivo: "route.json" });
  for (const clave of [`${CATALOGO}/outline.json`, `${CATALOGO}/../goals.json`, "goals.json", `wom.cl/guide/x/tablet/2026-11-21T10-05-00Z/route.json`, `WOM.cl/cataloger/2026-11-21T10-00-00Z/goals.json`, null]) {
    assert.equal(partesDeResultado(clave), null, String(clave));
  }
});

const TODOS = [...RECIEN, ...A_MEDIAS, ...LISTA, ...FALLIDA];

test("crearRevisiones: lista las META de la más nueva a la más vieja y lee una revisión, paginando", async () => {
  const cliente = clienteDynamoFalso(TABLA, TODOS);
  const revisiones = crearRevisiones({ tabla: TABLA, cliente, comandos: comandosDynamo });
  const { revisiones: lista, historial } = await revisiones.listar();
  assert.deepEqual(lista.map((r) => r.revision), ["lista", "a-medias", "recien", "fallida"], "sin URL#, todas son vigentes");
  assert.deepEqual(historial, []);
  assert.deepEqual(lista[0], {
    revision: "lista",
    url: "https://wom.cl/planes",
    host: "wom.cl",
    estado: "done",
    goalsTotal: 1,
    css: `${MEJORA}/tema.css`,
    creada: "2026-11-21T11:00:00Z",
    actualizada: "2026-11-21T10:00:00Z",
    resumen: null,
    anteriores: 0,
  });
  assert.deepEqual(await revisiones.leer("a-medias"), avanceDeRevision(A_MEDIAS));
  assert.equal(await revisiones.leer("no-existe"), null);
  const antes = cliente.llamadas.length;
  assert.equal(await revisiones.leer("REV#x"), null);
  assert.equal(cliente.llamadas.length, antes, "una revisión inválida no llega a DynamoDB");
});

const puntero = (url, revision) => ({ PK: `URL#${url}`, SK: "URL", revision, created_at: "2026-11-21T11:00:00Z" });

test("revisionesVigentes: la que apunta URL#<url> de su página; sin URL# o con uno sin META, todas las de esa página", () => {
  const metas = [
    meta("vieja", { url: "https://www.wom.cl/planes/" }),
    meta("nueva", {}),
    meta("otra", { url: "https://wom.cl/otra" }),
    meta("huerfana-1", { url: "https://wom.cl/huerfana" }),
    meta("huerfana-2", { url: "https://wom.cl/huerfana" }),
  ];
  const { vigentes, anteriores } = revisionesVigentes(metas, [puntero("https://wom.cl/planes", "nueva"), puntero("https://wom.cl/huerfana", "borrada")]);
  assert.deepEqual([...vigentes].sort(), ["huerfana-1", "huerfana-2", "nueva", "otra"]);
  assert.deepEqual([...anteriores], [["nueva", 1]]);
  assert.equal(paginaDeRevision("https://WWW.Wom.cl:8443/Planes//"), "https://wom.cl:8443/Planes");
  assert.equal(paginaDeRevision("no es url"), null);
});

test("crearRevisiones: listar() deja la vigente de cada página y manda las reemplazadas (también fallidas) al historial", async () => {
  const revisiones = crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, [...TODOS, puntero("https://wom.cl/planes", "a-medias")]), comandos: comandosDynamo });
  const { revisiones: lista, historial } = await revisiones.listar();
  assert.deepEqual(lista.map((r) => [r.revision, r.estado, r.anteriores]), [["a-medias", "running", 3]]);
  assert.deepEqual(historial.map((r) => [r.revision, r.estado]), [["lista", "done"], ["recien", "queued"], ["fallida", "failed"]]);
});

let servidor;
let base;
let sinTabla;
before(async () => {
  const revisiones = crearRevisiones({ tabla: TABLA, cliente: clienteDynamoFalso(TABLA, TODOS), comandos: comandosDynamo });
  servidor = crearServidor({ raizCorridas: RAIZ, revisiones });
  sinTabla = crearServidor({ raizCorridas: RAIZ });
  await Promise.all([servidor, sinTabla].map((s) => new Promise((listo) => s.listen(0, "127.0.0.1", listo))));
  base = (s) => `http://127.0.0.1:${s.address().port}/backoffice`;
});
after(() => {
  servidor.close();
  sinTabla.close();
});

test("/api/revisiones: lista y avance; sin tabla dice que no está disponible", async () => {
  const lista = await (await fetch(`${base(servidor)}/api/revisiones`)).json();
  assert.equal(lista.disponible, true);
  assert.equal(lista.revisiones.length, 4);
  assert.deepEqual(lista.historial, []);
  const avance = await (await fetch(`${base(servidor)}/api/revisiones/lista`)).json();
  assert.equal(avance.improver.estado, "succeeded");
  assert.equal((await fetch(`${base(servidor)}/api/revisiones/no-existe`)).status, 404);
  assert.equal((await fetch(`${base(servidor)}/api/revisiones/a/b`)).status, 404);

  assert.deepEqual(await (await fetch(`${base(sinTabla)}/api/revisiones`)).json(), { disponible: false, revisiones: [], historial: [] });
  assert.equal((await fetch(`${base(sinTabla)}/api/revisiones/lista`)).status, 404);
});

test("/api/revisiones con ETag: el mismo cuerpo con If-None-Match da 304 sin cuerpo", async () => {
  for (const ruta of ["api/revisiones", "api/revisiones/lista"]) {
    const primera = await fetch(`${base(servidor)}/${ruta}`);
    const etiqueta = primera.headers.get("etag");
    assert.match(etiqueta, /^"[\w-]+"$/, ruta);
    await primera.json();
    const igual = await fetch(`${base(servidor)}/${ruta}`, { headers: { "If-None-Match": etiqueta } });
    assert.equal(igual.status, 304, ruta);
    assert.equal(await igual.text(), "");
    assert.equal(igual.headers.get("etag"), etiqueta);
    const otra = await fetch(`${base(servidor)}/${ruta}`, { headers: { "If-None-Match": '"otra"' } });
    assert.equal(otra.status, 200, ruta);
    assert.equal(otra.headers.get("etag"), etiqueta, "el mismo cuerpo, la misma etiqueta");
  }
  assert.equal(coincide(`"a", W/"b"`, '"b"'), true);
  assert.equal(coincide(null, '"b"'), false);
});

test("sondeo: el detalle para con META cerrada y nada corriendo; la lista mira solo las vigentes", () => {
  const lista = avanceDeRevision(LISTA);
  assert.equal(revisionTerminada(lista), true);
  assert.equal(esperaDe({ revision: "lista", datos: lista }), null);
  const atrasada = { ...lista, goals: lista.goals.map((g) => ({ ...g, visitor: { ...g.visitor, estado: "running" } })) };
  assert.equal(revisionTerminada(atrasada), false, "META done antes que la última etapa");
  assert.equal(esperaDe({ revision: "lista", datos: atrasada }), 2500);
  assert.equal(esperaDe({ revision: "lista", datos: lista, error: true }), 2500);
  const enCurso = { revisiones: [{ estado: "running" }], historial: [] };
  const quieta = { revisiones: [{ estado: "done" }], historial: [{ estado: "running" }] };
  assert.equal(esperaDe({ revision: null, datos: enCurso }), 10000);
  assert.equal(esperaDe({ revision: null, datos: quieta }), 60000, "una vieja del historial que quedó running no cuenta");
});

test("/resultados funciona también con la fuente local", async () => {
  const respuesta = await fetch(`${base(sinTabla)}/resultados/demo.cl/visitor/tarea-demo/2026-11-21T10-00-00Z/manifest.json`);
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).status, "succeeded");
});
