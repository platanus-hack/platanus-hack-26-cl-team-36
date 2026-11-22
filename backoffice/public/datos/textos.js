// Convierte en texto lo que la API entrega como clave + variables (diseño §5.13), en el idioma de `t`.
// Puro: no toca document ni window, y recibe `t` como parámetro para poder probarlo con node:test.
//
// Convenciones de las variables de hallazgos y titulares (§2.6): `intento`/`intentos` son ids de
// intento y se muestran con el nombre del perfil; `pagina` y las que terminan en `Pagina` son ids de
// página y se muestran con nombreDePagina(); `senal` es una señal (comun.senal.*), `motivo` un
// end_reason (datos.motivo.*) y `conteos` un { clic, desplazamiento, texto, tecla, otra }.
// Los datos de la corrida (títulos, nombres de perfil, textos de elementos) pasan tal cual.

/** @typedef {(clave: string, vars?: Record<string, unknown>) => string} Traductor */

const FLECHAS = { abajo: "↓", arriba: "↑", izquierda: "←", derecha: "→" };
const ORDEN_DE_CONTEOS = ["clic", "desplazamiento", "texto", "tecla", "otra"];

/**
 * El nombre visible de una página: "Inicio"/"Home" para la de inicio ("Inicio · m.sitio.cl" si hay varias);
 * si no, su título corto.
 * @param {{ tituloTipo?: string, tituloCorto?: string | null, titulo?: string, url?: string, id?: string } | null} pagina
 * @param {Traductor} t
 */
export function nombreDePagina(pagina, t) {
  if (!pagina) return "";
  if (pagina.tituloTipo === "error") return t("datos.pagina.error");
  if (pagina.tituloTipo === "inicio") {
    return pagina.tituloCorto ? t("datos.pagina.inicioDe", { sitio: pagina.tituloCorto }) : t("datos.pagina.inicio");
  }
  return pagina.tituloCorto || pagina.titulo || pagina.url || pagina.id || "";
}

/**
 * La acción de un paso: { tipo: "clic", objetivo: "Close" } → "clic «Close»" | "click «Close»".
 * @param {import("../../lib/derivar.js").Firma | null} firma
 * @param {Traductor} t
 */
export function textoDeFirma(firma, t) {
  if (!firma) return "";
  const vars = { ...firma, flecha: FLECHAS[firma.direccion] ?? "" };
  const texto = t(`datos.firma.${firma.tipo}`, vars);
  return texto === `datos.firma.${firma.tipo}` ? t("datos.firma.otra", vars) : texto;
}

const DIRECCION_EN_INGLES = { down: "abajo", up: "arriba", left: "izquierda", right: "derecha" };
/** La firma de una acción tal como la escribe el evaluador en route_tree.json («clic «X»», «tecla Enter»…). */
function firmaDeAccion(accion) {
  const texto = String(accion ?? "").trim();
  let m;
  if ((m = /^clic «(.*)»$/s.exec(texto))) return { tipo: "clic", objetivo: m[1] };
  if ((m = /^volver a «(.*)»$/s.exec(texto))) return { tipo: "volver", objetivo: m[1] };
  if ((m = /^escribir «(.*)»$/s.exec(texto))) return { tipo: "escribir", objetivo: m[1] };
  if ((m = /^tecla (.+)$/s.exec(texto))) return { tipo: "tecla", objetivo: m[1] };
  if (/^atr[aá]s$/i.test(texto)) return { tipo: "atras" };
  if ((m = /^scroll (down|up|left|right)(?: x(\d+))?$/i.exec(texto))) return { tipo: "desplazar", direccion: DIRECCION_EN_INGLES[m[1].toLowerCase()], cantidad: m[2] ? Number(m[2]) : null };
  return null;
}

/**
 * Una acción del evaluador («clic «X»», «volver a «X»», «tecla Enter», «escribir «X»», «atrás», «scroll down x2»)
 * en el idioma de la pantalla, con el mismo vocabulario que Replay; el objetivo (lo que dice el sitio) no se
 * traduce. Lo que no reconoce queda como está.
 * @param {string} accion  @param {Traductor} t
 */
export function textoDeAccion(accion, t) {
  const firma = firmaDeAccion(accion);
  if (!firma) return String(accion ?? "");
  const clave = `datos.firma.${firma.tipo}`;
  const texto = t(clave, { ...firma, flecha: FLECHAS[firma.direccion] ?? "" });
  return texto === clave ? String(accion ?? "") : texto;
}

/**
 * "Lo que pasó" en un paso, en un párrafo.
 * @param {{ clave: string, vars?: Record<string, unknown> }[] | null} loQuePaso
 * @param {Traductor} t
 */
export function textoDeLoQuePaso(loQuePaso, t) {
  const partes = Array.isArray(loQuePaso) ? loQuePaso : [];
  if (!partes.length) return t("datos.loQuePaso.sinRegistro");
  return partes.map(({ clave, vars }) => t(`datos.loQuePaso.${clave}`, vars ?? {})).join(" ");
}

/** El motivo de fin de un intento, legible ("terminó y respondió"). */
export function textoDeMotivo(motivo, t) {
  return t(`datos.motivo.${motivo ?? "desconocido"}`);
}

/**
 * Qué hizo el usuario en una demora: "7 desplazamientos, 2 clics, 1 texto" (de más a menos; sin ceros).
 * @param {Partial<Record<"clic" | "desplazamiento" | "texto" | "tecla" | "otra", number>> | null} conteos
 * @param {Traductor} t
 */
export function textoDeConteos(conteos, t) {
  return ORDEN_DE_CONTEOS.map((tipo, orden) => ({ tipo, orden, n: Number(conteos?.[tipo] ?? 0) }))
    .filter(({ n }) => n > 0)
    .sort((a, b) => b.n - a.n || a.orden - b.orden)
    .map(({ tipo, n }) => t(`datos.conteos.${tipo}`, { n }))
    .join(", ");
}

/**
 * Un error de la herramienta, listo para mostrar: título traducido, resumen y detalle tal cual.
 * @param {import("../../lib/derivar.js").ErrorDeHerramienta | null} error
 * @param {Traductor} t
 * @returns {{ titulo: string, resumen: string, detalle: string } | null}
 */
export function textoDeError(error, t) {
  if (!error) return null;
  return { titulo: t(`datos.error.${error.tipo}`), resumen: error.resumen ?? "", detalle: error.detalle ?? "" };
}

// Nombres de los intentos y páginas de una tanda completa (Tanda) o de su resumen (ResumenDeTanda).
function contextoDe(tanda) {
  const nombres = new Map();
  if (Array.isArray(tanda?.intentos)) {
    for (const intento of tanda.intentos) {
      if (intento && typeof intento === "object") nombres.set(intento.id, intento.nombrePerfil || intento.perfil || intento.id);
    }
  }
  for (const perfil of Array.isArray(tanda?.perfiles) ? tanda.perfiles : []) {
    if (perfil?.intento && !nombres.has(perfil.intento)) nombres.set(perfil.intento, perfil.nombre || perfil.perfil || perfil.intento);
  }
  const paginas = new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  return { nombres, paginas };
}

function resolver(valor, clave, contexto, t) {
  const nombre = (id) => contexto.nombres.get(id) ?? String(id ?? "");
  // En la lista (ResumenDeTanda) la página del titular ya viene descrita (lib/derivar.js, conPaginaNombrada).
  if ((clave === "pagina" || clave?.endsWith("Pagina")) && valor && typeof valor === "object") return nombreDePagina(valor, t);
  if (clave === "intentos" && Array.isArray(valor)) return [...new Set(valor.filter((id) => id != null).map(nombre))];
  if (clave === "conteos" && valor && typeof valor === "object") return textoDeConteos(valor, t);
  if (Array.isArray(valor)) return valor.map((cada) => resolver(cada, null, contexto, t));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolver(v, k, contexto, t)]));
  }
  if (clave === "intento") return valor == null ? "" : nombre(valor);
  if (clave === "pagina" || clave?.endsWith("Pagina")) {
    if (valor == null) return "";
    return nombreDePagina(contexto.paginas.get(valor) ?? { tituloCorto: String(valor) }, t);
  }
  if (clave === "senal") return valor ? t(`comun.senal.${valor}`) : "";
  if (clave === "motivo") return textoDeMotivo(valor, t);
  return valor;
}

/** Las variables de un hallazgo o titular ya resueltas a texto (ids → nombres, etc.). */
export function resolverVars(vars, tanda, t) {
  return resolver(vars ?? {}, null, contextoDe(tanda), t);
}

/**
 * La frase de un hallazgo.
 * @param {{ clave: string, vars: Record<string, unknown> }} hallazgo
 * @param {object} tanda   la Tanda (para nombres de intentos y páginas)
 * @param {Traductor} t
 */
export function textoDeHallazgo(hallazgo, tanda, t) {
  if (!hallazgo) return "";
  return t(hallazgo.clave, resolverVars(hallazgo.vars, tanda, t));
}

/**
 * La frase de un titular (titulares.tanda / .telarana / .perfiles, o ResumenDeTanda.titular).
 * @param {{ clave: string, vars: Record<string, unknown> } | null} titular
 * @param {object} tanda   la Tanda o, en Corridas, el ResumenDeTanda
 * @param {Traductor} t
 */
export function textoDeTitular(titular, tanda, t) {
  return textoDeHallazgo(titular, tanda, t);
}
