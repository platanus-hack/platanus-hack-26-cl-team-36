// Gramática de las rutas (diseño §5.1). Puro: no toca document ni window, así node:test lo importa.
//
//   #/                          Corridas   ?q= &sitio= &filtro= &orden= &vista=
//   #/t/<tandaId>               → #/t/<tandaId>/telarana
//   #/t/<tandaId>/<pestaña>     telarana · replay   (#/t/<tandaId>/resumen, de cuando existía, → telarana)
//
// Todo el estado de la vista vive en el hash. `idioma=` puede venir en cualquier ruta: el enrutador lo aplica y lo
// saca del hash (extraerIdioma), así los hashes canónicos nunca lo llevan.

import { CORRIDA, partesDeTanda } from "./almacen.js";

export const PESTANAS = ["telarana", "replay"];
export const PESTANA_POR_DEFECTO = "telarana";

// Pestañas que ya no existen y adónde llevan sus enlaces viejos (sin sus parámetros).
const PESTANAS_RETIRADAS = { resumen: "telarana" };

// Claves del diccionario (no textos): t(NOMBRES_DE_PESTANA.replay) → "Replay".
export const NOMBRES_DE_PESTANA = Object.freeze({
  telarana: "comun.pestana.telarana",
  replay: "comun.pestana.replay",
});


// Orden estable de los parámetros conocidos; los demás van después, en orden alfabético.
const ORDEN_DE_PARAMETROS = {
  corridas: ["q", "sitio", "filtro", "orden", "vista"],
  telarana: ["pagina"],
  replay: ["intento", "paso"],
};

// Valores por defecto: no se escriben en el hash.
const POR_DEFECTO = {
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

  if (partes.length === 0) return { tipo: "corridas", parametros };

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

/** Hash canónico: orden estable de parámetros, sin valores vacíos ni por defecto, sin `idioma`. */
export function hashDe({ tipo, tandaId, pestana = PESTANA_POR_DEFECTO, parametros = {} }) {
  if (tipo === "tanda") {
    const id = String(tandaId).split("/").map(encodeURIComponent).join("/");
    const limpios = aplicarAlias(pestana, parametros);
    return `#/t/${id}/${pestana}${consultaCanonica(pestana, limpios)}`;
  }
  return `#/${consultaCanonica("corridas", parametros)}`;
}

export function enlaceATanda(tandaId, pestana = PESTANA_POR_DEFECTO, parametros = {}) {
  return hashDe({ tipo: "tanda", tandaId, pestana, parametros });
}

/**
 * Enlaces de la v0 (#/telarana?t=…, #/replay?t=…&perfil=…).
 * @returns {{ destino: string, aviso: string | null } | null}  aviso es una clave del diccionario.
 */
export function traducirLegado(hash) {
  const { camino, consulta } = separar(hash);
  const partes = segmentos(camino);
  if (!partes || partes.length !== 1 || !PANTALLAS_LEGADAS.has(partes[0])) return null;
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
