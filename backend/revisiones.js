// POST /revisiones y GET /revisiones: marca cada página vista y dispara su revisión.
// Los clientes de AWS se inyectan (ver aws.js) para probar sin red.

import { randomBytes } from "node:crypto";
import { ORDEN_META, claveRevision, claveUrl, previos } from "./estados.js";
import { normalizarUrl } from "./urls.js";

// Corto y ordenable por fecha; cumple `[a-z0-9]+(-[a-z0-9]+)*`.
export function nuevaRevision(ahora = new Date()) {
  return `${ahora.getTime().toString(36)}-${randomBytes(3).toString("hex")}`;
}

const NO_EXISTE = { estado: 404, datos: { success: false } };

export function crearRevisiones({ db, almacen, agentes, ahora = () => new Date(), idRevision = nuevaRevision }) {
  async function vista(url) {
    const marca = await db.obtener(claveUrl(url));
    if (!marca) return null;
    const meta = await db.obtener(claveRevision(marca.revision));
    const datos = { success: true, revision: marca.revision, status: meta?.status ?? "queued" };
    if (datos.status === "done" && meta.css_key) datos.css = await almacen.leerTexto(meta.css_key);
    return { estado: 200, datos };
  }

  async function consultar(texto) {
    return (await vista(normalizarUrl(texto).url)) ?? NO_EXISTE;
  }

  async function solicitar(texto, { force = false } = {}) {
    const { url, host } = normalizarUrl(texto);
    if (!force) {
      const respuesta = await vista(url);
      if (respuesta) return respuesta;
    }

    const revision = idRevision();
    const momento = ahora().toISOString();
    const registrada = await db.registrar([
      { item: { ...claveUrl(url), revision, created_at: momento }, nueva: !force },
      {
        item: { ...claveRevision(revision), url: texto, host, status: "queued", created_at: momento, updated_at: momento },
        nueva: true,
      },
    ]);
    // Otra solicitud por la misma página ganó la carrera.
    if (!registrada) return (await vista(url)) ?? NO_EXISTE;

    try {
      await agentes.invocar({ stage: "revision", revision, url: texto });
    } catch (error) {
      const motivo = `${error.name}: ${error.message}`.slice(0, 200);
      console.error(`✖ revisión ${revision}: no se pudo invocar el runtime (${motivo})`);
      await db.actualizar(
        claveRevision(revision),
        { status: "failed", error: motivo, updated_at: ahora().toISOString() },
        { previos: previos(ORDEN_META, "failed"), existente: true },
      );
      return { estado: 202, datos: { success: true, revision, status: "failed" } };
    }
    console.log(`✔ revisión ${revision} para ${url}`);
    return { estado: 202, datos: { success: true, revision, status: "queued" } };
  }

  return { consultar, solicitar };
}
