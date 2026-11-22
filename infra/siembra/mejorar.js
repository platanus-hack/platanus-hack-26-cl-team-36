// Vuelve a correr solo la etapa improver sobre revisiones ya terminadas (`just aws improve`): catálogo, Guía y
// Visitante no se repiten, el improver lee lo que midieron en el almacén y deja una corrida nueva.
//   node mejorar.js [--todas] [--dry-run] [--concurrencia <n>] [--tope-min <minutos>] [<url>...]
// Usa la CLI de AWS con las credenciales del entorno (AWS_PROFILE). Sale con 1 si alguna no terminó succeeded.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as dormirMs } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { normalizarUrl } from "../../backend/urls.js";

const TABLA = "chameleon-revisiones";
const RUNTIME = "ChameleonAgents_default_chameleon";
// Las corridas empiezan después de invocar; el margen cubre relojes algo desfasados (como el conductor).
const DESFASE_MS = 5_000;

// Ids de corrida como los de agents/shared (store/run_ids.py): ordenan como texto.
export const idDeCorrida = (fecha) => fecha.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";

// Las revisiones vigentes a mejorar: las de `urls` o, con `todas`, las done. Una que no está done no se toca.
export function elegir(vigentes, { urls = [], todas = false }) {
  const porClave = new Map(vigentes.map((v) => [v.clave, v]));
  const claves = todas ? vigentes.map((v) => v.clave) : [...new Set(urls.map((url) => normalizarUrl(url).url))];
  const pedidas = claves.map((clave) => porClave.get(clave) ?? { clave });
  const objetivos = [];
  const saltadas = [];
  for (const v of pedidas) {
    if (!v.revision) saltadas.push({ url: v.clave, motivo: "sin revisión" });
    else if (v.status !== "done") saltadas.push({ url: v.clave, revision: v.revision, motivo: `revisión ${v.status ?? "sin META"}` });
    else objetivos.push(v);
  }
  return { objetivos, saltadas };
}

// El mismo payload con que el conductor invoca la etapa (agents/shared, stages.py), con la URL que recibió.
export const payload = ({ revision, url }) => ({ stage: "improver", revision, url });

// La corrida de la revisión que empezó desde `desde`, la más reciente: { status, runKey } o null.
export function corridaNueva(manifiestos, revision, desde) {
  const propias = manifiestos
    .filter((m) => m.revision === revision && m.run_id >= desde)
    .sort((a, b) => (a.run_id < b.run_id ? 1 : -1));
  return propias.length ? { status: propias[0].status, runKey: `${propias[0].host}/improver/${propias[0].run_id}` } : null;
}

export function tabla(resultados) {
  const filas = [
    ["URL", "revisión", "resultado", "dirección", "tema.json"],
    ...resultados.map((r) => [r.url, r.revision ?? "", r.resultado, r.direccion ?? "", r.tema === undefined ? "" : r.tema ? "sí" : "no"]),
  ];
  const anchos = filas[0].map((_, i) => Math.max(...filas.map((f) => f[i].length)));
  return filas.map((f) => f.map((celda, i) => celda.padEnd(anchos[i])).join("  ").trimEnd()).join("\n");
}

const direccionDe = (informe) =>
  informe?.direccion ? `${informe.direccion}${informe.nombre ? ` (${informe.nombre})` : ""}` : informe?.modo ? `— (${informe.modo})` : undefined;

async function enTanda(items, concurrencia, trabajo) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await trabajo(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, obrero));
  return resultados;
}

// Invoca el improver de cada revisión y lo sigue en el almacén hasta succeeded o failed. Con succeeded espera además
// a que la proyectora pase su tema al META (lo que sirve la API).
export async function mejorar(
  objetivos,
  { aws, concurrencia = 2, dormir = dormirMs, ahora = () => new Date(), intervaloMs = 15_000, topeMs = 20 * 60_000, esperaMetaMs = 2 * 60_000, log = console.log },
) {
  return enTanda(objetivos, concurrencia, async (v) => {
    const base = { url: v.clave, revision: v.revision };
    const inicio = ahora();
    const desde = idDeCorrida(new Date(inicio.getTime() - DESFASE_MS));
    const segundos = () => Math.round((ahora() - inicio) / 1000);
    try {
      await aws.invocar(payload(v));
    } catch (error) {
      log(`${v.clave}: no se pudo invocar el runtime · ${error.message}`);
      return { ...base, resultado: "no invocada" };
    }
    log(`${v.clave}: improver invocado (${v.revision})`);
    let corrida = null;
    let visto = null;
    while (ahora() - inicio < topeMs) {
      await dormir(intervaloMs);
      try {
        corrida = corridaNueva(await aws.manifiestos(v.host, desde), v.revision, desde);
      } catch (error) {
        log(`${v.clave}: ${error.message}, se reintenta`);
        continue;
      }
      if (corrida && corrida.status !== visto) log(`${v.clave}: ${(visto = corrida.status)} · ${segundos()} s`);
      if (corrida && corrida.status !== "running") break;
    }
    if (!corrida || corrida.status === "running") return { ...base, resultado: "tope de tiempo" };
    if (corrida.status !== "succeeded") return { ...base, resultado: corrida.status };
    const css = `${corrida.runKey}/tema.css`;
    const limite = ahora().getTime() + esperaMetaMs;
    let proyectada = false;
    for (;;) {
      proyectada = (await aws.meta(v.revision).catch(() => null))?.css_key === css;
      if (proyectada || ahora().getTime() >= limite) break;
      await dormir(Math.min(intervaloMs, 5_000));
    }
    const informe = await aws.leerJson(`${corrida.runKey}/informe.json`).catch(() => null);
    const tema = await aws.existe(`${corrida.runKey}/tema.json`).catch(() => false);
    return { ...base, resultado: proyectada ? "succeeded" : "succeeded, META sin el tema", direccion: direccionDe(informe), tema };
  });
}

// --- La CLI de AWS ---

const execFileP = promisify(execFile);

async function cli(args) {
  const { stdout } = await execFileP("aws", [...args, "--output", "json"], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

const desdeDynamo = (item) => Object.fromEntries(Object.entries(item ?? {}).map(([k, v]) => [k, v.S ?? v.N ?? (v.NULL ? null : v)]));

export function clienteAws({ bucket, runtimeArn }) {
  const obtener = async (PK, SK) =>
    desdeDynamo((await cli(["dynamodb", "get-item", "--table-name", TABLA, "--consistent-read", "--key", JSON.stringify({ PK: { S: PK }, SK: { S: SK } })]))?.Item);
  const leerJson = async (clave) => {
    const { stdout } = await execFileP("aws", ["s3", "cp", `s3://${bucket}/${clave}`, "-"], { maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  return {
    meta: (revision) => obtener(`REV#${revision}`, "META"),
    async vigentes() {
      // La CLI pagina sola el scan.
      const { Items } = await cli([
        "dynamodb", "scan", "--table-name", TABLA, "--filter-expression", "SK = :u",
        "--expression-attribute-values", JSON.stringify({ ":u": { S: "URL" } }),
      ]);
      return Promise.all(
        Items.map(desdeDynamo).map(async ({ PK, revision }) => {
          const meta = await obtener(`REV#${revision}`, "META");
          return { clave: PK.replace(/^URL#/, ""), revision, status: meta.status, url: meta.url, host: meta.host };
        }),
      );
    },
    async manifiestos(host, desde) {
      const lista = await cli(["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", `${host}/improver/`, "--delimiter", "/", "--start-after", `${host}/improver/${desde}`]);
      const corridas = (lista?.CommonPrefixes ?? []).map((p) => p.Prefix.slice(0, -1));
      const leidos = await Promise.all(corridas.map((c) => leerJson(`${c}/manifest.json`).catch(() => null)));
      return leidos.filter(Boolean);
    },
    leerJson,
    existe: async (clave) => Boolean(await cli(["s3api", "head-object", "--bucket", bucket, "--key", clave]).catch(() => null)),
    async invocar(cuerpo) {
      const carpeta = await mkdtemp(join(tmpdir(), "mejorar-"));
      try {
        await execFileP("aws", [
          "bedrock-agentcore", "invoke-agent-runtime", "--agent-runtime-arn", runtimeArn,
          // El id de sesión pide 33 caracteres o más; una sesión nueva por invocación, como el conductor.
          "--runtime-session-id", `${cuerpo.revision}-improver-${randomUUID().replace(/-/g, "")}`,
          "--payload", JSON.stringify(cuerpo), "--cli-binary-format", "raw-in-base64-out",
          "--content-type", "application/json", "--accept", "application/json", join(carpeta, "respuesta.json"),
        ]);
        return JSON.parse(await readFile(join(carpeta, "respuesta.json"), "utf8"));
      } finally {
        await rm(carpeta, { recursive: true, force: true });
      }
    },
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      todas: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      concurrencia: { type: "string", default: "2" },
      "tope-min": { type: "string", default: "20" },
    },
  });
  const concurrencia = Number(values.concurrencia);
  const topeMin = Number(values["tope-min"]);
  if (!(Number.isInteger(concurrencia) && concurrencia >= 1 && concurrencia <= 3)) throw new Error(`--concurrencia va de 1 a 3: ${values.concurrencia}`);
  if (!(topeMin > 0)) throw new Error(`--tope-min debe ser un número de minutos: ${values["tope-min"]}`);
  if (!values.todas === !positionals.length) throw new Error("usa: just aws improve <url>... | --todas [--dry-run]");

  const { Account } = await cli(["sts", "get-caller-identity"]);
  const runtimeArn = values["dry-run"]
    ? null
    : (await cli(["bedrock-agentcore-control", "list-agent-runtimes", "--query", `agentRuntimes[?agentRuntimeName=='${RUNTIME}'].agentRuntimeArn | [0]`]));
  if (!values["dry-run"] && !runtimeArn?.startsWith("arn:")) throw new Error(`${RUNTIME} no está desplegado en esta cuenta`);
  const aws = clienteAws({ bucket: `chameleon-almacen-${Account}`, runtimeArn });

  const { objetivos, saltadas } = elegir(await aws.vigentes(), { urls: positionals, todas: values.todas });
  for (const s of saltadas) console.log(`${s.url}: se salta, ${s.motivo}${s.revision ? ` (${s.revision})` : ""}`);
  if (values["dry-run"]) {
    console.log(`\nSe volvería a correr el improver de ${objetivos.length} revisiones (dry-run, no se invoca nada):\n`);
    console.log(tabla(objetivos.map((v) => ({ url: v.clave, revision: v.revision, resultado: "por invocar" }))));
    for (const v of objetivos) console.log(`  payload ${JSON.stringify(payload(v))}`);
    return;
  }
  console.log(`Improver de ${objetivos.length} revisiones, de a ${concurrencia}`);
  const resultados = await mejorar(objetivos, { aws, concurrencia, topeMs: topeMin * 60_000 });
  console.log(`\n${tabla(resultados)}`);
  // Con --todas, las que no están done no se pidieron.
  process.exitCode = resultados.every((r) => r.resultado === "succeeded") && (values.todas || !saltadas.length) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
