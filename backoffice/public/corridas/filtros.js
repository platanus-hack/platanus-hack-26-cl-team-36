// Filtros, orden y grupos por día de la lista de Corridas (diseño §10.2). Puro: no toca document ni window, así
// node:test lo importa. Trabaja sobre ResumenDeTanda (§3.1) y sobre los parámetros del hash (?q= &sitio= &filtro=
// &orden= &vista=).

import { normalizar } from "../nucleo/buscar.js";

export const FILTROS = ["problemas", "errores"];
export const ORDENES = ["nuevas", "viejas", "exito", "tarea"];
export const VISTAS = ["lista", "grilla"];

/** Parámetros del hash ya validados: un valor desconocido vuelve al valor por defecto. */
export function leerParametros(parametros = {}) {
  const q = String(parametros.q ?? "").trim();
  const sitio = String(parametros.sitio ?? "").trim();
  return {
    q,
    sitio: sitio || null,
    filtro: FILTROS.includes(parametros.filtro) ? parametros.filtro : null,
    orden: ORDENES.includes(parametros.orden) ? parametros.orden : "nuevas",
    vista: VISTAS.includes(parametros.vista) ? parametros.vista : "lista",
  };
}

/** Cifras de una tanda con respaldo para campos ausentes. */
export function cifrasDeTanda(resumen) {
  const intentos = typeof resumen?.intentos === "number" ? resumen.intentos : 0;
  const errores = Number(resumen?.errores ?? 0) || 0;
  const validos = typeof resumen?.validos === "number" ? resumen.validos : Math.max(0, intentos - errores);
  const logrados = Number(resumen?.logrados ?? 0) || 0;
  return { intentos, errores, validos, logrados };
}

/** "Con problemas": algún intento válido no llega a la respuesta. */
export const tieneProblemas = (resumen) => {
  const { validos, logrados } = cifrasDeTanda(resumen);
  return validos > logrados;
};

/** "Con errores": algún intento no cuenta por un error de la herramienta. */
export const tieneErrores = (resumen) => cifrasDeTanda(resumen).errores > 0;

function textoDeBusqueda(resumen) {
  return normalizar([resumen?.tarea, resumen?.host, resumen?.instruccion, resumen?.id, resumen?.url].filter(Boolean).join(" "));
}

/** ¿La tanda calza con la búsqueda? Cada palabra de `q` debe aparecer (sin tildes ni mayúsculas). */
export function calzaBusqueda(resumen, q) {
  const terminos = normalizar(q).split(/\s+/).filter(Boolean);
  if (!terminos.length) return true;
  const texto = textoDeBusqueda(resumen);
  return terminos.every((termino) => texto.includes(termino));
}

/** Aplica búsqueda y sitio (no el filtro de los chips). */
export function filtrarBase(tandas, { q = "", sitio = null } = {}) {
  return (tandas ?? []).filter((resumen) => (!sitio || resumen.host === sitio) && calzaBusqueda(resumen, q));
}

/** Aplica búsqueda, sitio y filtro. */
export function filtrarTandas(tandas, { q = "", sitio = null, filtro = null } = {}) {
  const base = filtrarBase(tandas, { q, sitio });
  if (filtro === "problemas") return base.filter(tieneProblemas);
  if (filtro === "errores") return base.filter(tieneErrores);
  return base;
}

/** Cuántas tandas muestra cada chip, después de la búsqueda y el sitio: { todas, problemas, errores }. */
export function contarFiltros(tandas, { q = "", sitio = null } = {}) {
  const base = filtrarBase(tandas, { q, sitio });
  return {
    todas: base.length,
    problemas: base.filter(tieneProblemas).length,
    errores: base.filter(tieneErrores).length,
  };
}

/** Sitios presentes, de más a menos tandas y luego por nombre: [{ host, n }]. */
export function sitiosDe(tandas) {
  const cuentas = new Map();
  for (const resumen of tandas ?? []) {
    if (!resumen?.host) continue;
    cuentas.set(resumen.host, (cuentas.get(resumen.host) ?? 0) + 1);
  }
  return [...cuentas].map(([host, n]) => ({ host, n })).sort((a, b) => b.n - a.n || comparar(a.host, b.host));
}

const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const claveDeFecha = (resumen) => String(resumen?.fechaIso ?? resumen?.fecha ?? "");

/** Tasa de éxito; sin intentos válidos cuenta como la peor (-1) para que quede arriba en "exito". */
function tasa(resumen) {
  const { validos, logrados } = cifrasDeTanda(resumen);
  return validos ? logrados / validos : -1;
}

/**
 * Orden estable de la lista.
 * nuevas: más nuevas primero · viejas: más antiguas primero · exito: menor éxito primero (lo que hay que mirar),
 * luego más errores, luego más nuevas · tarea: por tarea (A→Z), luego más nuevas.
 */
export function ordenarTandas(tandas, orden = "nuevas") {
  const lista = [...(tandas ?? [])];
  const porFechaDesc = (a, b) => comparar(claveDeFecha(b), claveDeFecha(a)) || comparar(a.id ?? "", b.id ?? "");
  const criterios = {
    nuevas: porFechaDesc,
    viejas: (a, b) => comparar(claveDeFecha(a), claveDeFecha(b)) || comparar(a.id ?? "", b.id ?? ""),
    exito: (a, b) =>
      tasa(a) - tasa(b) || cifrasDeTanda(b).errores - cifrasDeTanda(a).errores || porFechaDesc(a, b),
    tarea: (a, b) => comparar(a.tarea ?? a.host ?? "", b.tarea ?? b.host ?? "") || porFechaDesc(a, b),
  };
  return lista.sort(criterios[orden] ?? criterios.nuevas);
}

/** "2026-11-21" del día local de una fecha ISO sin zona (o del nombre de carpeta 2026-11-21_07-28-42). */
export function diaDe(fechaIso) {
  const texto = String(fechaIso ?? "");
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(texto);
  return m ? m[1] : null;
}

function diaLocal(ahora) {
  const fecha = new Date(Number(ahora));
  const dos = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function restarUnDia(dia) {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(a, m - 1, d - 1);
  const dos = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/**
 * Agrupa por día local, conservando el orden recibido (solo tiene sentido con orden nuevas/viejas).
 * → [{ dia: "2026-11-21" | null, tipo: "hoy" | "ayer" | "fecha" | "sinFecha", tandas }]
 * @param {number} ahora  milisegundos (Date.now()), para decidir "hoy" y "ayer"
 */
export function agruparPorDia(tandas, ahora = Date.now()) {
  const hoy = diaLocal(ahora);
  const ayer = restarUnDia(hoy);
  const grupos = [];
  for (const resumen of tandas ?? []) {
    const dia = diaDe(resumen?.fechaIso ?? resumen?.fecha);
    let grupo = grupos.at(-1);
    if (!grupo || grupo.dia !== dia) {
      grupo = { dia, tipo: dia === null ? "sinFecha" : dia === hoy ? "hoy" : dia === ayer ? "ayer" : "fecha", tandas: [] };
      grupos.push(grupo);
    }
    grupo.tandas.push(resumen);
  }
  return grupos;
}

/** ¿Se agrupa por día con este orden? */
export const agrupaPorDia = (orden) => orden === "nuevas" || orden === "viejas";

/** Orden de los resultados en el medidor: logrados, fallidos, abandonados, errores. */
const ORDEN_DE_RESULTADO = { logrado: 0, fallido: 1, abandonado: 2, error: 3 };

/** Los resultados de los intentos para el medidor, de mejor a peor (estable). */
export function resultadosParaMedidor(perfiles) {
  return (perfiles ?? [])
    .map((perfil, indice) => ({ ...perfil, indice }))
    .sort((a, b) => (ORDEN_DE_RESULTADO[a.resultado] ?? 9) - (ORDEN_DE_RESULTADO[b.resultado] ?? 9) || a.indice - b.indice);
}

/** Lo que hay que mostrar después de filtrar y ordenar: { visibles, grupos, cuentas, total }. */
export function prepararLista(tandas, parametros, ahora = Date.now()) {
  const p = leerParametros(parametros);
  const visibles = ordenarTandas(filtrarTandas(tandas, p), p.orden);
  const grupos = agrupaPorDia(p.orden) ? agruparPorDia(visibles, ahora) : [{ dia: null, tipo: "todas", tandas: visibles }];
  return { parametros: p, visibles, grupos, cuentas: contarFiltros(tandas, p), total: (tandas ?? []).length };
}
