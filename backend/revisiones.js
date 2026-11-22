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
const EN_CURSO = ["queued", "running"];
// Solo lo que escribe el improver en el almacén (ver proyectora.js).
const CSS = /^[a-z0-9.:-]+\/improver\/[^/]+\/tema\.css$/;

// Una revisión queued/running sin novedades en este rato (un runtime caído la deja así) no cuenta para el tope y
// un POST la reemplaza.
const VENTANA_EN_CURSO_MS = 60 * 60_000;

export function crearRevisiones({
  db,
  almacen,
  agentes,
  ahora = () => new Date(),
  idRevision = nuevaRevision,
  maxEnCurso = 5,
}) {
  async function registro(url) {
    const marca = await db.obtener(claveUrl(url));
    if (!marca) return null;
    return { revision: marca.revision, meta: (await db.obtener(claveRevision(marca.revision))) ?? {} };
  }

  async function responder({ revision, meta }) {
    const datos = { success: true, revision, status: meta.status ?? "queued" };
    if (datos.status === "done" && CSS.test(meta.css_key ?? "")) datos.css = await almacen.leerTexto(meta.css_key);
    return { estado: 200, datos };
  }

  async function consultar(texto) {
    const previo = await registro(normalizarUrl(texto).url);
    return previo ? responder(previo) : NO_EXISTE;
  }

  // Dos solicitudes simultáneas: solo una registra la revisión; la otra responde con ella.
  async function solicitar(texto, { force = false } = {}, intentos = 3) {
    const { url, host, pagina } = normalizarUrl(texto);
    const previo = await registro(url);
    const desde = new Date(ahora().getTime() - VENTANA_EN_CURSO_MS).toISOString();
    const status = previo?.meta.status ?? "queued";
    // failed o en curso sin novedades en la ventana se reintenta sin force; force no duplica una en curso.
    const abandonada = status === "failed" || (EN_CURSO.includes(status) && (previo?.meta.updated_at ?? "") < desde);
    if (previo && !abandonada && (!force || EN_CURSO.includes(status))) return responder(previo);

    // Aproximado: solicitudes simultáneas pueden pasar el tope (cuentan antes de que las otras registren).
    const enCurso = await db.contarEnCurso(EN_CURSO, desde);
    if (enCurso >= maxEnCurso) {
      const error = `Hay ${enCurso} revisiones en curso (tope ${maxEnCurso}); intenta en unos minutos`;
      return { estado: 429, datos: { success: false, error } };
    }

    const revision = idRevision();
    const momento = ahora().toISOString();
    const registrada = await db.registrar([
      { item: { ...claveUrl(url), revision, created_at: momento }, reemplaza: previo?.revision ?? null },
      {
        item: { ...claveRevision(revision), url: pagina, host, status: "queued", created_at: momento, updated_at: momento },
        reemplaza: null,
      },
    ]);
    if (!registrada) {
      if (intentos <= 1) throw new Error(`No se pudo registrar la revisión de ${url}`);
      return solicitar(texto, { force: false }, intentos - 1);
    }

    try {
      await agentes.invocar({ stage: "revision", revision, url: pagina });
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
