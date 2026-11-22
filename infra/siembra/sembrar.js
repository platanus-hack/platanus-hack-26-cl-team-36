// Siembra revisiones en la API desplegada y las sigue hasta done o failed (`just aws seed`).
//   node sembrar.js [--force] [--api <url>] [--tope-min <minutos>] [<url>...]
// Sin URLs, las páginas de demo de agents/tasks/demo.json. Sale con 1 si alguna no terminó en done.

import { readFile } from "node:fs/promises";
import { setTimeout as dormirMs } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const FIN = ["done", "failed"];

async function pedir(fetch, url, opciones) {
  const respuesta = await fetch(url, { ...opciones, signal: AbortSignal.timeout(30_000) });
  const datos = await respuesta.json().catch(() => ({}));
  return { estado: respuesta.status, datos };
}

// Pide cada revisión y consulta las pedidas en cada vuelta. Un 429 (tope de revisiones en curso) se vuelve a pedir
// en la vuelta siguiente, así se pueden sembrar más páginas que el tope.
export async function sembrar(
  urls,
  { api, force = false, fetch = globalThis.fetch, dormir = dormirMs, ahora = Date.now, intervaloMs = 15_000, topeMs = 45 * 60_000, log = console.log },
) {
  const inicio = ahora();
  const paginas = urls.map((url) => ({ url, status: null, revision: null, error: null }));
  const cambiar = (pagina, status, extra = {}) => {
    if (status === pagina.status && !extra.error) return;
    Object.assign(pagina, { status, ...extra });
    const segundos = Math.round((ahora() - inicio) / 1000);
    log(`${pagina.url}: ${status}${pagina.revision ? ` (${pagina.revision})` : ""}${extra.error ? ` · ${extra.error}` : ""} · ${segundos} s`);
  };

  async function avanzar(pagina) {
    try {
      if (!pagina.revision) {
        const { estado, datos } = await pedir(fetch, `${api}/revisiones`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: pagina.url, ...(force && { force: true }) }),
        });
        if (estado === 429) return cambiar(pagina, "esperando cupo");
        if (!datos.success) return cambiar(pagina, "failed", { error: `POST ${estado} ${datos.error ?? ""}`.trim() });
        pagina.revision = datos.revision;
        return cambiar(pagina, datos.status);
      }
      const { estado, datos } = await pedir(fetch, `${api}/revisiones?url=${encodeURIComponent(pagina.url)}`);
      if (estado === 200 && datos.success) cambiar(pagina, datos.status);
      else log(`${pagina.url}: GET ${estado}, se reintenta`);
    } catch (error) {
      log(`${pagina.url}: ${error.message}, se reintenta`);
    }
  }

  for (;;) {
    const pendientes = paginas.filter((p) => !FIN.includes(p.status));
    if (!pendientes.length) break;
    if (ahora() - inicio >= topeMs) {
      for (const pagina of pendientes) cambiar(pagina, pagina.status ?? "sin pedir", { error: "tope de tiempo" });
      break;
    }
    await Promise.all(pendientes.map(avanzar));
    if (paginas.some((p) => !FIN.includes(p.status))) await dormir(intervaloMs);
  }

  log("\nResumen:");
  for (const { url, status, revision, error } of paginas) {
    log(`  ${status === "done" ? "✔" : "✖"} ${status.padEnd(8)} ${url}${revision ? ` (${revision})` : ""}${error ? ` · ${error}` : ""}`);
  }
  return { ok: paginas.every((p) => p.status === "done"), paginas };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { force: { type: "boolean", default: false }, api: { type: "string" }, "tope-min": { type: "string", default: "45" } },
  });
  const raiz = new URL("../../", import.meta.url);
  const urls = positionals.length ? positionals : JSON.parse(await readFile(new URL("agents/tasks/demo.json", raiz), "utf8"));
  const api = (values.api ?? (await import(new URL("extension/src/background/config.js", raiz))).API_URL_AWS).replace(/\/$/, "");
  console.log(`Sembrando ${urls.length} páginas en ${api}${values.force ? " (force)" : ""}`);
  const { ok } = await sembrar(urls, { api, force: values.force, topeMs: Number(values["tope-min"]) * 60_000 });
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
