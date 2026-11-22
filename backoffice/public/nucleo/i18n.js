// Idiomas de la interfaz (diseño §5.13): inglés por defecto y español (el selector muestra EN | ES).
//
// Los diccionarios son módulos ES por sección y por idioma (public/i18n/<idioma>/<sección>.js), cada uno con un
// dueño, así los equipos nunca editan el mismo archivo. Un valor es un texto con {variables} o una función
// (vars, { plural, fmt }) => texto. t() busca en el idioma activo, después en inglés y si no, devuelve la clave.
//
// Importarlo no toca window ni localStorage: node:test usa `formatear` directamente.

import { crearFormatos } from "./formato.js";

export const IDIOMAS = ["en", "es"];
export const IDIOMA_POR_DEFECTO = "en";
export const EVENTO_IDIOMA = "backoffice:idioma";
// v2 desde que la interfaz es en inglés: lo que guardó el selector ES | EN de antes no deja a nadie en español sin
// haberlo pedido con ?idioma=es.
const CLAVE_ALMACEN = "backoffice:idioma:v2";

let actual = IDIOMA_POR_DEFECTO;
/** { en: { comun: {...}, datos: {...} }, es: {...} } */
const diccionarios = { en: {}, es: {} };
const secciones = new Set();
const pedidas = new Map(); // "<idioma>/<sección>" → Promise
const avisadas = new Set();
const reglasDePlural = new Map();

/** Formatos del idioma activo. Enlace vivo: se reemplaza al cambiar de idioma. */
export let fmt = crearFormatos(IDIOMA_POR_DEFECTO);

export function idioma() {
  return actual;
}

const esIdioma = (valor) => IDIOMAS.includes(valor);

function plurales(idiomaDelTexto) {
  if (!reglasDePlural.has(idiomaDelTexto)) {
    reglasDePlural.set(idiomaDelTexto, new Intl.PluralRules(idiomaDelTexto === "en" ? "en-US" : "es-CL"));
  }
  return reglasDePlural.get(idiomaDelTexto);
}

function buscar(diccionario, clave) {
  let nodo = diccionario;
  for (const parte of String(clave).split(".")) {
    if (nodo === null || typeof nodo !== "object" || !Object.hasOwn(nodo, parte)) return undefined;
    nodo = nodo[parte];
  }
  return typeof nodo === "string" || typeof nodo === "function" ? nodo : undefined;
}

function interpolar(texto, vars) {
  return texto.replace(/\{(\w+)\}/g, (entero, nombre) =>
    vars && vars[nombre] !== undefined && vars[nombre] !== null ? String(vars[nombre]) : entero,
  );
}

/**
 * Núcleo puro de t(): busca `clave` en diccionarios[idioma], luego en el idioma por defecto (diccionarios.en), y si no
 * está devuelve la clave.
 * @param {Record<string, object>} dicc   { en: { <sección>: {...} }, es: {...} }
 * @param {(clave: string, idioma: string) => void} [alFaltar]  se llama si falta en el idioma pedido
 */
export function formatear(dicc, clave, vars = {}, idiomaPedido = IDIOMA_POR_DEFECTO, alFaltar = null) {
  let idiomaDelTexto = idiomaPedido;
  let valor = buscar(dicc?.[idiomaPedido], clave);
  if (valor === undefined) {
    alFaltar?.(clave, idiomaPedido);
    if (idiomaPedido !== IDIOMA_POR_DEFECTO) {
      valor = buscar(dicc?.[IDIOMA_POR_DEFECTO], clave);
      idiomaDelTexto = IDIOMA_POR_DEFECTO;
    }
  }
  if (valor === undefined) return String(clave);
  if (typeof valor === "function") {
    const ayudas = {
      plural: (n, formas) => formas[plurales(idiomaDelTexto).select(Number(n))] ?? formas.other ?? "",
      fmt: crearFormatos(idiomaDelTexto),
    };
    try {
      return String(valor(vars ?? {}, ayudas) ?? "");
    } catch (error) {
      console.error(`i18n: la función de «${clave}» falló`, error);
      return String(clave);
    }
  }
  return interpolar(valor, vars);
}

function avisarFalta(clave, idiomaPedido) {
  const marca = `${idiomaPedido}:${clave}`;
  if (avisadas.has(marca)) return;
  avisadas.add(marca);
  console.warn(`i18n: falta la clave «${clave}» en «${idiomaPedido}»`);
}

/** "replay.pasoDeTotal" → texto en el idioma activo. Nunca lanza. */
export function t(clave, vars = {}) {
  return formatear(diccionarios, clave, vars, actual, avisarFalta);
}

async function importarSeccion(idiomaDeSeccion, seccion) {
  const llave = `${idiomaDeSeccion}/${seccion}`;
  if (!pedidas.has(llave)) {
    const promesa = import(`../i18n/${idiomaDeSeccion}/${seccion}.js`)
      .then((modulo) => modulo.default ?? {})
      .catch((error) => {
        // Una sección que todavía no existe no rompe nada: se ven las claves y t() avisa.
        console.warn(`i18n: no se pudo cargar la sección «${llave}»`, error?.message ?? error);
        return {};
      });
    pedidas.set(llave, promesa);
  }
  diccionarios[idiomaDeSeccion][seccion] = await pedidas.get(llave);
}

/** Carga una sección del idioma activo (y la del idioma por defecto, para el respaldo). Idempotente; nunca lanza. */
export async function cargarSeccion(seccion) {
  secciones.add(seccion);
  const idiomas = actual === IDIOMA_POR_DEFECTO ? [actual] : [actual, IDIOMA_POR_DEFECTO];
  await Promise.all(idiomas.map((cada) => importarSeccion(cada, seccion)));
}

function leerGuardado() {
  try {
    return globalThis.localStorage?.getItem(CLAVE_ALMACEN) ?? null;
  } catch {
    return null;
  }
}

function guardar(valor) {
  try {
    globalThis.localStorage?.setItem(CLAVE_ALMACEN, valor);
  } catch {
    // Sin almacenamiento (modo privado, sitio bloqueado): el idioma vale solo para esta visita.
  }
}

function aplicar(nuevo) {
  actual = nuevo;
  fmt = crearFormatos(nuevo);
  if (globalThis.document) document.documentElement.lang = nuevo;
}

/**
 * Elige el idioma (parámetro `idioma=` del hash → localStorage → "en") y carga "comun" y "datos".
 * @param {{ parametroDeHash?: string | null }} opciones
 */
export async function iniciarI18n({ parametroDeHash = null } = {}) {
  let elegido = IDIOMA_POR_DEFECTO;
  if (esIdioma(parametroDeHash)) {
    elegido = parametroDeHash;
    guardar(elegido);
  } else {
    const guardado = leerGuardado();
    if (esIdioma(guardado)) elegido = guardado;
  }
  aplicar(elegido);
  await Promise.all([cargarSeccion("comun"), cargarSeccion("datos")]);
  return actual;
}

/**
 * Cambia el idioma: lo guarda, recarga las secciones ya cargadas y avisa con el evento `backoffice:idioma`
 * (el enrutador remonta la vista y el armazón al oírlo).
 */
export async function cambiarIdioma(nuevo, { avisar = true } = {}) {
  if (!esIdioma(nuevo)) return actual;
  guardar(nuevo);
  if (nuevo === actual) return actual;
  aplicar(nuevo);
  await Promise.all([...secciones].map((seccion) => cargarSeccion(seccion)));
  if (avisar && globalThis.window) window.dispatchEvent(new CustomEvent(EVENTO_IDIOMA, { detail: { idioma: nuevo } }));
  return actual;
}
