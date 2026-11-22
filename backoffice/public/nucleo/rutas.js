// Gramática de las rutas (diseño §5.1). Puro: no toca document ni window, así node:test lo importa.
//
//   #/                          Overview   ?dispositivo=all|desktop|mobile &pestana=recent|live|failed &link=<texto> &pagina=<n>
//   #/corridas                  Corridas   ?q= &sitio= &filtro= &orden= &vista=
//   #/?q=…&sitio=…              (enlace viejo, de cuando Corridas era #/) → #/corridas?… con esos parámetros
//   #/t/<tandaId>               → #/t/<tandaId>/telarana
//   #/t/<tandaId>/<pestaña>     telarana · replay · propuesta   (#/t/<tandaId>/resumen, de cuando existía, → telarana)
//   #/revisiones                Revisiones (DynamoDB)   ?estado=live|done|failed|historial   (live = running + queued)
//   #/revisiones/<revision>     el avance de una revisión
//   #/revisiones/<revision>/<goal>   la telaraña en vivo de un goal (SSE)
//   #/f/<revision>              una revisión fallida, en una hoja (la cadena de etapas y dónde se detuvo)
//
// Todo el estado de la vista vive en el hash. `idioma=` puede venir en cualquier ruta: el enrutador lo aplica y lo
// saca del hash (extraerIdioma), así los hashes canónicos nunca lo llevan. En el Overview y en el filtro de
// Revisiones un valor desconocido se descarta, y los valores por defecto (all, recent, página 1) nunca se escriben.

import { CORRIDA, OBJETIVO, REVISION, partesDeTanda } from "./almacen.js";
import { LARGO_MAXIMO_DE_BUSQUEDA } from "./links.js";

export const PESTANAS = ["telarana", "replay", "propuesta"];
export const PESTANA_POR_DEFECTO = "telarana";

/** Filtro de dispositivo del Overview (el primero es el de por defecto). */
export const DISPOSITIVOS = Object.freeze(["all", "desktop", "mobile"]);
/** Pestañas de revisiones del Overview (la primera es la de por defecto). */
export const PESTANAS_DEL_OVERVIEW = Object.freeze(["recent", "live", "failed"]);
/** Filtro `estado=` de la lista de Revisiones. */
export const ESTADOS_DE_REVISIONES = Object.freeze(["live", "done", "failed", "historial"]);

/** Página de las revisiones del Overview: un entero de 1 a 9999 escrito sin ceros adelante. */
export const esPaginaDelOverview = (texto) => /^[1-9]\d{0,3}$/.test(String(texto));
/** Búsqueda por link del Overview: un texto con algo más que espacios y no más largo que el tope. */
export const esBusquedaDelOverview = (texto) => String(texto).trim() !== "" && String(texto).length <= LARGO_MAXIMO_DE_BUSQUEDA;

// Valores válidos de los parámetros con un conjunto cerrado (o una prueba); lo demás se descarta al leer y al escribir.
const VALORES = {
  overview: { dispositivo: DISPOSITIVOS, pestana: PESTANAS_DEL_OVERVIEW, link: esBusquedaDelOverview, pagina: esPaginaDelOverview },
  revisiones: { estado: ESTADOS_DE_REVISIONES },
};

// Parámetros de Corridas: si alguno viene en #/, es un enlace de cuando Corridas vivía ahí.
const PARAMETROS_DE_CORRIDAS = ["q", "sitio", "filtro", "orden", "vista"];

// Pestañas que ya no existen y adónde llevan sus enlaces viejos (sin sus parámetros).
const PESTANAS_RETIRADAS = { resumen: "telarana" };

// Claves del diccionario (no textos): t(NOMBRES_DE_PESTANA.replay) → "Replay".
export const NOMBRES_DE_PESTANA = Object.freeze({
  telarana: "comun.pestana.telarana",
  replay: "comun.pestana.replay",
  propuesta: "comun.pestana.propuesta",
});


// Orden estable de los parámetros conocidos; los demás van después, en orden alfabético.
const ORDEN_DE_PARAMETROS = {
  overview: ["dispositivo", "pestana", "link", "pagina"],
  corridas: PARAMETROS_DE_CORRIDAS,
  revisiones: ["estado"],
  telarana: ["intento", "pagina"],
  replay: ["intento", "paso"],
  propuesta: ["vista", "dispositivo"],
};

// Valores por defecto: no se escriben en el hash.
const POR_DEFECTO = {
  overview: { dispositivo: DISPOSITIVOS[0], pestana: PESTANAS_DEL_OVERVIEW[0], pagina: "1" },
  corridas: { vista: "lista", orden: "nuevas" },
};

// Sinónimos aceptados dentro de una tanda (se reescriben al nombre canónico).
const ALIAS = {
  replay: { perfil: "intento" },
  telarana: { nodo: "pagina" },
};

const PANTALLAS_LEGADAS = new Set(["telarana", "replay"]);

export const AVISO_ENLACE_SIN_TANDA = "comun.aviso.enlaceSinTanda";

function separar(hash) {
  const sinAlmohadilla = String(hash ?? "").replace(/^#/, "");
  const indice = sinAlmohadilla.indexOf("?");
  const camino = indice === -1 ? sinAlmohadilla : sinAlmohadilla.slice(0, indice);
  const consulta = indice === -1 ? "" : sinAlmohadilla.slice(indice + 1);
  return { camino, consulta };
}

function leerParametros(consulta) {
  const parametros = {};
  for (const [clave, valor] of new URLSearchParams(consulta)) {
    if (valor !== "" && !(clave in parametros)) parametros[clave] = valor;
  }
  return parametros;
}

/**
 * Para las vistas con parámetros cerrados (overview, revisiones): solo las claves conocidas con un valor válido y
 * distinto del de por defecto. El resto se descarta, así el hash canónico nunca lleva un valor que la vista no entiende.
 */
function soloValidos(vista, parametros) {
  const validos = VALORES[vista];
  const defecto = POR_DEFECTO[vista] ?? {};
  const resultado = {};
  for (const [clave, permitidos] of Object.entries(validos)) {
    const valor = parametros?.[clave];
    if (valor === null || valor === undefined) continue;
    const texto = String(valor);
    const vale = typeof permitidos === "function" ? permitidos(texto) : permitidos.includes(texto);
    if (vale && defecto[clave] !== texto) resultado[clave] = texto;
  }
  return resultado;
}

/** Los parámetros de Corridas que trae un hash de #/, o null si no trae ninguno (entonces es el Overview). */
function parametrosDeCorridasEn(parametros) {
  const presentes = PARAMETROS_DE_CORRIDAS.filter((clave) => clave in parametros);
  return presentes.length ? Object.fromEntries(presentes.map((clave) => [clave, parametros[clave]])) : null;
}

function aplicarAlias(pestana, parametros) {
  const alias = ALIAS[pestana];
  if (!alias) return parametros;
  const resultado = { ...parametros };
  for (const [viejo, nuevo] of Object.entries(alias)) {
    if (viejo in resultado) {
      if (!(nuevo in resultado)) resultado[nuevo] = resultado[viejo];
      delete resultado[viejo];
    }
  }
  return resultado;
}

function segmentos(camino) {
  try {
    return camino.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** @returns {import("./rutas.js").Ruta} */
export function parsearHash(hash) {
  const { camino, consulta } = separar(hash);
  const partes = segmentos(camino);
  const original = `#${String(hash ?? "").replace(/^#/, "")}`;
  if (!partes) return { tipo: "desconocida", hash: original };
  const parametros = leerParametros(consulta);

  if (partes.length === 0) {
    const legado = traducirLegado(hash);
    if (legado) return { tipo: "legado", ...legado };
    return { tipo: "overview", parametros: soloValidos("overview", parametros) };
  }

  if (partes[0] === "corridas" && partes.length === 1) return { tipo: "corridas", parametros };

  if (partes[0] === "revisiones" && partes.length <= 3) {
    const [, revision = null, goal = null] = partes;
    if (revision !== null && !REVISION.test(revision)) return { tipo: "desconocida", hash: original };
    if (goal === null) return { tipo: "revisiones", revision, parametros: revision === null ? soloValidos("revisiones", parametros) : {} };
    if (!OBJETIVO.test(goal)) return { tipo: "desconocida", hash: original };
    return { tipo: "vivo", revision, goal, parametros: {} };
  }

  if (partes[0] === "f" && partes.length === 2) {
    if (!REVISION.test(partes[1])) return { tipo: "desconocida", hash: original };
    return { tipo: "fallo", revision: partes[1], parametros: {} };
  }

  if (partes[0] === "t") {
    const resto = partes.slice(1);
    // Un id que no sigue el layout no es una tanda: así nunca arma otra ruta al pedirlo ("..%2F..%2Fx" → "../../x").
    const fin = resto.findIndex((parte) => CORRIDA.test(parte));
    if (fin !== 3 || !partesDeTanda(resto.slice(0, 4).join("/"))) return { tipo: "desconocida", hash: original };
    const tandaId = resto.slice(0, fin + 1).join("/");
    const despues = resto.slice(fin + 1);
    if (despues.length > 1) return { tipo: "desconocida", hash: original };
    const retirada = PESTANAS_RETIRADAS[despues[0]];
    if (retirada) return { tipo: "tanda", tandaId, pestana: retirada, parametros: {} };
    const pestana = despues[0] ?? PESTANA_POR_DEFECTO;
    if (!PESTANAS.includes(pestana)) return { tipo: "desconocida", hash: original };
    return { tipo: "tanda", tandaId, pestana, parametros: aplicarAlias(pestana, parametros) };
  }

  if (partes.length === 1 && PANTALLAS_LEGADAS.has(partes[0])) {
    const legado = traducirLegado(hash);
    if (legado) return { tipo: "legado", ...legado };
  }
  return { tipo: "desconocida", hash: original };
}

function consultaCanonica(clave, parametros) {
  const orden = ORDEN_DE_PARAMETROS[clave] ?? [];
  const defecto = POR_DEFECTO[clave] ?? {};
  const pares = Object.entries(parametros ?? {})
    .filter(([nombre, valor]) => nombre !== "idioma" && valor !== null && valor !== undefined && valor !== "")
    .map(([nombre, valor]) => [nombre, String(valor)])
    .filter(([nombre, valor]) => defecto[nombre] !== valor);
  pares.sort(([a], [b]) => {
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const texto = new URLSearchParams(pares).toString();
  return texto ? `?${texto}` : "";
}

/**
 * Hash canónico: orden estable de parámetros, sin valores vacíos ni por defecto, sin `idioma`. Sin `tipo` (o con uno
 * que no es una vista) es el Overview.
 */
export function hashDe({ tipo, tandaId, revision = null, goal = null, pestana = PESTANA_POR_DEFECTO, parametros = {} }) {
  if (tipo === "revisiones") {
    if (revision) return enlaceARevision(revision);
    return `#/revisiones${consultaCanonica("revisiones", soloValidos("revisiones", parametros))}`;
  }
  if (tipo === "vivo") return enlaceAVivo(revision, goal);
  if (tipo === "fallo") return enlaceAFallo(revision);
  if (tipo === "tanda") {
    const id = String(tandaId).split("/").map(encodeURIComponent).join("/");
    const limpios = aplicarAlias(pestana, parametros);
    return `#/t/${id}/${pestana}${consultaCanonica(pestana, limpios)}`;
  }
  if (tipo === "corridas") return `#/corridas${consultaCanonica("corridas", parametros)}`;
  return `#/${consultaCanonica("overview", soloValidos("overview", parametros))}`;
}

export function enlaceATanda(tandaId, pestana = PESTANA_POR_DEFECTO, parametros = {}) {
  return hashDe({ tipo: "tanda", tandaId, pestana, parametros });
}

/** Los parámetros de una pestaña de la tanda que siguen al cambiar a otra: la traza elegida (?intento=). */
export function parametrosQueSiguen(parametros) {
  return parametros?.intento ? { intento: parametros.intento } : {};
}

const ORIGENES = new Set(["overview", "revisiones", "corridas", "vivo"]);

/**
 * Adónde vuelve la hoja de una tanda: la vista que quedó debajo (`anterior`, con el hash que mostraba) o, si se
 * entró por un enlace directo o desde otra tanda, el Overview. → { clave, hash, conFondo }.
 */
export function origenDeHoja(anterior, hash = null) {
  if (anterior && ORIGENES.has(anterior.tipo) && hash) return { clave: anterior.tipo, hash, conFondo: true };
  return { clave: "overview", hash: hashDe({ tipo: "overview" }), conFondo: false };
}

/** "#/f/<revision>": la hoja de una revisión fallida. */
export function enlaceAFallo(revision) {
  return `#/f/${encodeURIComponent(revision)}`;
}

/** "#/revisiones" o "#/revisiones/<revision>". */
export function enlaceARevision(revision = null) {
  return revision ? `#/revisiones/${encodeURIComponent(revision)}` : "#/revisiones";
}

/** La lista de Revisiones, filtrada: "#/revisiones" o "#/revisiones?estado=failed" (live = running + queued). */
export function enlaceARevisiones(estado = null) {
  return hashDe({ tipo: "revisiones", parametros: { estado } });
}

/** "#/revisiones/<revision>/<goal>": la telaraña en vivo del goal. */
export function enlaceAVivo(revision, goal) {
  return `${enlaceARevision(revision)}/${encodeURIComponent(goal)}`;
}

/**
 * Enlaces viejos y adónde llevan:
 *   - los de la v0 (#/telarana?t=…, #/replay?t=…&perfil=…) → la tanda; sin t= → Corridas, con aviso;
 *   - los de Corridas de cuando vivía en #/ (#/?q=…&sitio=…&filtro=…&orden=…&vista=…) → #/corridas?…, solo con esos
 *     parámetros (#/ es ahora el Overview).
 * @returns {{ destino: string, aviso: string | null } | null}  aviso es una clave del diccionario.
 */
export function traducirLegado(hash) {
  const { camino, consulta } = separar(hash);
  const partes = segmentos(camino);
  if (!partes) return null;
  if (partes.length === 0) {
    const deCorridas = parametrosDeCorridasEn(leerParametros(consulta));
    return deCorridas ? { destino: hashDe({ tipo: "corridas", parametros: deCorridas }), aviso: null } : null;
  }
  if (partes.length !== 1 || !PANTALLAS_LEGADAS.has(partes[0])) return null;
  const pestana = partes[0];
  const { t: tandaId, ...resto } = leerParametros(consulta);
  if (!tandaId) return { destino: hashDe({ tipo: "corridas" }), aviso: AVISO_ENLACE_SIN_TANDA };
  return { destino: enlaceATanda(tandaId, pestana, resto), aviso: null };
}

/** Separa `idioma=` del hash: → { idioma: string | null, hash: string sin ese parámetro }. */
export function extraerIdioma(hash) {
  const { camino, consulta } = separar(hash);
  const parametros = new URLSearchParams(consulta);
  if (!parametros.has("idioma")) return { idioma: null, hash: `#${camino}${consulta ? `?${consulta}` : ""}` };
  const idioma = parametros.get("idioma");
  parametros.delete("idioma");
  const resto = parametros.toString();
  return { idioma, hash: `#${camino || "/"}${resto ? `?${resto}` : ""}` };
}

/**
 * Lee el parámetro `paso` (1-based) contra un intento de `total` pasos (diseño §5.9).
 * → { paso: number, aviso: { clave, vars } | null }. Sin valor → paso 1 y sin aviso.
 */
export function normalizarPaso(valor, total) {
  const ultimo = Math.max(1, Number(total) || 0);
  if (valor === null || valor === undefined || valor === "") return { paso: 1, aviso: null };
  const texto = String(valor);
  if (!/^\d+$/.test(texto) || Number(texto) < 1) {
    return { paso: 1, aviso: { clave: "comun.estado.pasoInvalido", vars: { paso: texto } } };
  }
  const numero = Number(texto);
  if (numero > ultimo) return { paso: ultimo, aviso: { clave: "comun.estado.pasoFueraDeRango", vars: { total: ultimo } } };
  return { paso: numero, aviso: null };
}
