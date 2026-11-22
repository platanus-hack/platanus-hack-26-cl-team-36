import { test } from "node:test";
import assert from "node:assert/strict";
import { corridaNueva, elegir, idDeCorrida, mejorar, payload, tabla } from "../mejorar.js";

const vigente = (clave, status, revision = `rev-${status}`) => ({
  clave,
  revision,
  status,
  url: `${clave.replace("://", "://www.")}/`,
  host: new URL(clave).host,
});
const VIGENTES = [vigente("https://a.cl", "done", "r1"), vigente("https://b.cl", "failed"), vigente("https://c.cl", "running")];

test("elegir: con --todas, solo las done; las demás se saltan con su estado", () => {
  const { objetivos, saltadas } = elegir(VIGENTES, { todas: true });
  assert.deepEqual(objetivos.map((v) => v.clave), ["https://a.cl"]);
  assert.deepEqual(saltadas, [
    { url: "https://b.cl", revision: "rev-failed", motivo: "revisión failed" },
    { url: "https://c.cl", revision: "rev-running", motivo: "revisión running" },
  ]);
});

test("elegir: las URLs pedidas se normalizan como la API; sin revisión o sin done se saltan", () => {
  const { objetivos, saltadas } = elegir(VIGENTES, { urls: ["https://www.a.cl/", "https://a.cl", "https://b.cl/", "https://z.cl"] });
  assert.deepEqual(objetivos.map((v) => v.revision), ["r1"]);
  assert.deepEqual(saltadas.map((s) => [s.url, s.motivo]), [
    ["https://b.cl", "revisión failed"],
    ["https://z.cl", "sin revisión"],
  ]);
});

test("payload: el de la etapa improver, con la URL que recibió la revisión", () => {
  assert.deepEqual(payload(VIGENTES[0]), { stage: "improver", revision: "r1", url: "https://www.a.cl/" });
});

test("idDeCorrida ordena como los ids de agents/shared", () => {
  assert.equal(idDeCorrida(new Date("2026-11-22T05:40:02.123Z")), "2026-11-22T05-40-02Z");
});

test("corridaNueva: la más reciente de la revisión desde el inicio; otras revisiones y las viejas no cuentan", () => {
  const m = (run_id, revision, status) => ({ host: "a.cl", run_id, revision, status });
  const desde = "2026-11-22T10-00-00Z";
  assert.equal(corridaNueva([m("2026-11-22T09-00-00Z", "r1", "succeeded"), m("2026-11-22T10-01-00Z", "r2", "running")], "r1", desde), null);
  assert.deepEqual(
    corridaNueva([m("2026-11-22T10-01-00Z", "r1", "failed"), m("2026-11-22T10-01-00Z_01", "r1", "running")], "r1", desde),
    { status: "running", runKey: "a.cl/improver/2026-11-22T10-01-00Z_01" },
  );
});

function reloj() {
  let t = Date.parse("2026-11-22T10:00:00Z");
  return { ahora: () => new Date(t), dormir: async (ms) => void (t += ms) };
}

// `estados`: por revisión, el status de su corrida en cada consulta (el último se repite); null, sin corrida aún.
function awsFalso({ estados, informe, tema = true, proyecta = true, falla }) {
  const invocados = [];
  const corridas = {};
  return {
    invocados,
    async invocar(cuerpo) {
      if (falla) throw new Error(falla);
      invocados.push(cuerpo);
    },
    async manifiestos(host, desde) {
      return Object.entries(estados).flatMap(([revision, lista]) => {
        const status = lista.length > 1 ? lista.shift() : lista[0];
        corridas[revision] = `${host}/improver/${desde}`;
        return status ? [{ host, run_id: desde, revision, status }] : [];
      });
    },
    meta: async (revision) => ({ status: "done", css_key: proyecta ? `${corridas[revision]}/tema.css` : "viejo/tema.css" }),
    leerJson: async () => informe ?? Promise.reject(new Error("NoSuchKey")),
    existe: async () => tema,
  };
}

test("mejorar: invoca, sigue la corrida hasta succeeded y entrega dirección y tema.json", async () => {
  const aws = awsFalso({ estados: { r1: [null, "running", "succeeded"] }, informe: { modo: "motor", direccion: "editorial", nombre: "Editorial" } });
  const log = [];
  const [r] = await mejorar([VIGENTES[0]], { aws, ...reloj(), log: (l) => log.push(l) });
  assert.deepEqual(aws.invocados, [{ stage: "improver", revision: "r1", url: "https://www.a.cl/" }]);
  assert.deepEqual(r, { url: "https://a.cl", revision: "r1", resultado: "succeeded", direccion: "editorial (Editorial)", tema: true });
  assert.ok(log.some((l) => l.includes("running")));
});

test("mejorar: failed, tope de tiempo, sin invocar y META que no recibe el tema", async () => {
  const una = (aws, extra = {}) => mejorar([VIGENTES[0]], { aws, ...reloj(), log: () => {}, ...extra }).then(([r]) => r.resultado);
  assert.equal(await una(awsFalso({ estados: { r1: ["running", "failed"] } })), "failed");
  assert.equal(await una(awsFalso({ estados: { r1: ["running"] } }), { topeMs: 60_000 }), "tope de tiempo");
  assert.equal(await una(awsFalso({ estados: {}, falla: "AccessDenied" })), "no invocada");
  assert.equal(await una(awsFalso({ estados: { r1: ["succeeded"] }, proyecta: false })), "succeeded, META sin el tema");
});

test("mejorar: no corre más de `concurrencia` a la vez", async () => {
  let enCurso = 0;
  let maximo = 0;
  const objetivos = ["r1", "r2", "r3", "r4"].map((r, i) => vigente(`https://s${i}.cl`, "done", r));
  const aws = {
    async invocar() {
      maximo = Math.max(maximo, ++enCurso);
    },
    async manifiestos(host, desde) {
      enCurso--;
      return objetivos.map((v) => ({ host, run_id: desde, revision: v.revision, status: "failed" }));
    },
  };
  const resultados = await mejorar(objetivos, { aws, concurrencia: 2, dormir: async () => {}, log: () => {} });
  assert.equal(maximo, 2);
  assert.deepEqual(resultados.map((r) => r.resultado), ["failed", "failed", "failed", "failed"]);
});

test("tabla: una fila por página, con dirección y tema.json si los hay", () => {
  const texto = tabla([
    { url: "https://a.cl", revision: "r1", resultado: "succeeded", direccion: "editorial", tema: true },
    { url: "https://b.cl", revision: "r2", resultado: "failed" },
  ]);
  const [encabezado, a, b] = texto.split("\n");
  assert.match(encabezado, /^URL\s+revisión\s+resultado\s+dirección\s+tema\.json$/);
  assert.match(a, /https:\/\/a\.cl\s+r1\s+succeeded\s+editorial\s+sí/);
  assert.match(b, /https:\/\/b\.cl\s+r2\s+failed$/);
});
