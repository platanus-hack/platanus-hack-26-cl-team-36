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
const TEMA = /^[a-z0-9.:-]+\/improver\/[^/]+\/tema\.json$/;
export const MAX_BYTES_TEMA = 64 * 1024;

// Una revisión queued/running sin novedades en este rato (un runtime caído la deja así) no cuenta para el tope y
// un POST la reemplaza.
const VENTANA_EN_CURSO_MS = 60 * 60_000;
// Un done sin css_key espera este rato el evento del improver (llegan desordenados); después se da por fallida.
const VENTANA_SIN_TEMA_MS = 10 * 60_000;

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

  // El tema listo es done para el cliente aunque el conductor siga con los goals; META no cambia, así la revisión
  // sigue contando para el tope y force no la duplica.
  function estadoVisible(meta) {
    const status = meta.status ?? "queued";
    if (status === "failed") return status;
    if (CSS.test(meta.css_key ?? "")) return "done";
    if (status !== "done") return status;
    const desde = new Date(ahora().getTime() - VENTANA_SIN_TEMA_MS).toISOString();
    return (meta.updated_at ?? "") < desde ? "failed" : "running";
  }

  async function responder({ revision, meta }) {
    const datos = { success: true, revision, status: estadoVisible(meta) };
    if (datos.status === "done") {
      datos.css = await almacen.leerTexto(meta.css_key);
      if (TEMA.test(meta.tema_key ?? "")) {
        const tema = await leerTema(meta.tema_key);
        if (tema) datos.tema = tema;
      }
    }
    return { estado: 200, datos };
  }

  // El tema.json es opcional: si no se puede usar, la revisión se entrega solo con su CSS.
  async function leerTema(clave) {
    try {
      const { bytes } = await almacen.cabecera(clave);
      if (bytes > MAX_BYTES_TEMA) throw new Error(`pesa ${bytes} bytes, más de ${MAX_BYTES_TEMA}`);
      const texto = await almacen.leerTexto(clave);
      if (Buffer.byteLength(texto) > MAX_BYTES_TEMA) throw new Error(`pesa más de ${MAX_BYTES_TEMA} bytes`);
      const tema = JSON.parse(texto);
      if (!tema || typeof tema !== "object" || Array.isArray(tema)) throw new Error("no es un objeto");
      return tema;
    } catch (error) {
      console.warn(`✖ ${clave}: se omite el tema (${error.message})`);
      return null;
    }
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
    // failed (o done sin tema pasada su ventana) o en curso sin novedades en la ventana se reintenta sin force;
    // force no duplica una en curso.
    const abandonada =
      (previo && estadoVisible(previo.meta) === "failed") || (EN_CURSO.includes(status) && (previo?.meta.updated_at ?? "") < desde);
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
      // Puede haber llegado: si no, queda queued y la ventana de una hora permite reintentarla.
      if (error.incierta) {
        console.warn(`⚠ revisión ${revision}: invocación del runtime sin confirmar (${motivo})`);
        return { estado: 202, datos: { success: true, revision, status: "queued" } };
      }
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
