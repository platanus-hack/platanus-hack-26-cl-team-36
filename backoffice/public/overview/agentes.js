// Bloque de agentes del Overview (spec §3.3, §3.4). Puro: no toca document ni window, así node:test lo importa.
// Trabaja sobre la respuesta de /api/resumen (contrato §1): cuántas corridas hay por rol y por estado. Un cuadrito
// es una corrida de un agente (un visitante = un intento); las en cola se dibujan como contorno y no se cuentan.

/** Estados de un agente, en el orden en que se dibujan sus cuadritos (y sus tramos). */
export const ESTADOS = Object.freeze(["logrado", "fallido", "abandonado", "sin_medir", "error", "detenido", "en_curso", "en_cola"]);
/** Roles en el orden del pipeline: Cataloger → Guide → Visitors → Designer. */
export const ROLES = Object.freeze(["cataloger", "guide", "visitor", "improver"]);
export const DISPOSITIVOS = Object.freeze(["all", "desktop", "mobile"]);
/** Sobre esta cantidad de cuadritos en la fila más grande, cada cuadrito vale k corridas (el DOM no explota). */
export const MAX_CUADRITOS_POR_FILA = 2000;
/** Con este número de casos medidos o menos, la tasa va como conteo (x/y) y no como % (README, "n chico"). */
export const N_CHICO = 5;
/** La leyenda siempre muestra estos; "detenido" y "en_cola" solo si hay cuadritos así. */
export const LEYENDA_FIJA = Object.freeze(["logrado", "fallido", "abandonado", "sin_medir", "error", "en_curso"]);

export const leerDispositivo = (valor) => (DISPOSITIVOS.includes(valor) ? valor : "all");

const entero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Posición de un estado en el orden de dibujo; uno desconocido va al final. */
export const posicionDeEstado = (estado) => {
  const i = ESTADOS.indexOf(estado);
  return i === -1 ? ESTADOS.length : i;
};

/** Copia ordenada (orden de dibujo) de una lista de estados. */
export const ordenarEstados = (estados) => [...(estados ?? [])].sort((a, b) => posicionDeEstado(a) - posicionDeEstado(b));

/**
 * Conteos de un rol con todos los estados (0 si faltan). Los visitantes vienen por dispositivo
 * (`roles.visitor.{all,desktop,mobile}`); los otros roles sirven a los dos dispositivos y no cambian con el filtro.
 */
export function conteosDeRol(resumen, rol, dispositivo = "all") {
  let fuente = resumen?.roles?.[rol] ?? null;
  if (rol === "visitor" && fuente) {
    const porDispositivo = fuente.all !== null && typeof fuente.all === "object";
    fuente = porDispositivo ? fuente[leerDispositivo(dispositivo)] : leerDispositivo(dispositivo) === "all" ? fuente : null;
  }
  return Object.fromEntries(ESTADOS.map((estado) => [estado, entero(fuente?.[estado])]));
}

/** La cifra de una fila: todas sus corridas menos las en cola (todavía no parten). */
export const cifraVisible = (conteos) => ESTADOS.reduce((suma, estado) => (estado === "en_cola" ? suma : suma + (conteos?.[estado] ?? 0)), 0);

/** Cuadritos que dibuja una fila (con los en cola). */
export const totalDeCuadritos = (conteos) => ESTADOS.reduce((suma, estado) => suma + (conteos?.[estado] ?? 0), 0);

export const tonoDePorcentaje = (pct) =>
  pct === null || pct === undefined || !Number.isFinite(pct) ? "neutro" : pct >= 70 ? "logrado" : pct >= 60 ? "aviso" : "fallido";

/**
 * Tasa de éxito: { logrados, medidos, pct (entero redondeado o null), chico (≤ N_CHICO medidos: va x/y), tono }.
 * El tono sale del % redondeado (70 % es verde, como en la maqueta). Sin medidos: pct null, tono neutro ("—").
 */
export function exito(logrados, medidos) {
  const ok = entero(logrados);
  const de = entero(medidos);
  if (!de) return { logrados: ok, medidos: 0, pct: null, chico: false, tono: "neutro" };
  const pct = Math.round((100 * ok) / de);
  return { logrados: ok, medidos: de, pct, chico: de <= N_CHICO, tono: tonoDePorcentaje(pct) };
}

/** Visitantes: logrados / (logrados + fallidos + abandonó). Los demás roles: logrados / (logrados + fallidos). */
export function exitoDeRol(conteos, rol) {
  const logrados = conteos?.logrado ?? 0;
  const medidos = logrados + (conteos?.fallido ?? 0) + (rol === "visitor" ? (conteos?.abandonado ?? 0) : 0);
  return exito(logrados, medidos);
}

/** k = cuántas corridas vale un cuadrito: 1, o ceil(máx / 2000) si la fila más grande pasa de 2.000. Uno para todo el bloque. */
export function escalaDelBloque(listaDeConteos) {
  const maximo = Math.max(0, ...(listaDeConteos ?? []).map(totalDeCuadritos));
  return maximo > MAX_CUADRITOS_POR_FILA ? Math.ceil(maximo / MAX_CUADRITOS_POR_FILA) : 1;
}

/** Grupos de cuadritos de una fila en el orden de dibujo: [{ estado, n }], n = ceil(cantidad / k) (ningún estado desaparece). */
export function cuadritosDeFila(conteos, k = 1) {
  const escala = Math.max(1, Math.floor(k) || 1);
  return ESTADOS.filter((estado) => (conteos?.[estado] ?? 0) > 0).map((estado) => ({ estado, n: Math.ceil(conteos[estado] / escala) }));
}

/** Estados de la leyenda: los fijos y, si aparecen en alguna fila, detenido y en cola; en el orden de dibujo. */
export function estadosDeLeyenda(listaDeConteos) {
  const presentes = new Set(LEYENDA_FIJA);
  for (const conteos of listaDeConteos ?? []) {
    for (const estado of ["detenido", "en_cola"]) if ((conteos?.[estado] ?? 0) > 0) presentes.add(estado);
  }
  return ESTADOS.filter((estado) => presentes.has(estado));
}

/**
 * Todo lo que dibuja el bloque de agentes para un filtro de dispositivo:
 * { dispositivo, total, k, filas: [{ rol, conteos, n, exito, cuadritos }], leyenda, dispositivos: [{ id, n, seleccionado }] }.
 * El total es la suma de las filas visibles: con Mobile cambia solo la fila Visitors.
 */
export function modeloDeAgentes(resumen, dispositivo = "all") {
  const elegido = leerDispositivo(dispositivo);
  const filas = ROLES.map((rol) => {
    const conteos = conteosDeRol(resumen, rol, elegido);
    return { rol, conteos, n: cifraVisible(conteos), exito: exitoDeRol(conteos, rol) };
  });
  const conteos = filas.map((fila) => fila.conteos);
  const k = escalaDelBloque(conteos);
  for (const fila of filas) fila.cuadritos = cuadritosDeFila(fila.conteos, k);
  return {
    dispositivo: elegido,
    total: filas.reduce((suma, fila) => suma + fila.n, 0),
    k,
    filas,
    leyenda: estadosDeLeyenda(conteos),
    dispositivos: DISPOSITIVOS.map((id) => ({ id, n: cifraVisible(conteosDeRol(resumen, "visitor", id)), seleccionado: id === elegido })),
  };
}
