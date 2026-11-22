// Tiempos de una tarjeta del Overview (spec §3.5). Puro. Todo se mide contra `ahora` de la API (contrato §2.2),
// nunca contra el reloj del navegador: con los datos de prueba estáticos, el reloj real haría crecer los tiempos
// sin parar.

export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

/** Milisegundos de una fecha ISO (o Date); null si no se puede leer. */
export function aMs(fecha) {
  if (fecha instanceof Date) return Number.isNaN(fecha.getTime()) ? null : fecha.getTime();
  if (typeof fecha !== "string" || !fecha) return null;
  const ms = Date.parse(fecha);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Tiempo transcurrido desde `desde` hasta `ahora`, en minutos enteros con piso: { minutos, horas, resto }.
 * resto = minutos que sobran de la última hora ("3 h 04 min"). Nunca negativo. null si falta una fecha.
 */
export function transcurrido(desde, ahora) {
  const inicio = aMs(desde);
  const fin = aMs(ahora);
  if (inicio === null || fin === null) return null;
  const minutos = Math.max(0, Math.floor((fin - inicio) / MINUTO));
  return { minutos, horas: Math.floor(minutos / 60), resto: minutos % 60 };
}

/**
 * Una duración redondeada a su unidad más natural: { unidad: "min" | "h" | "d", n }.
 * Minutos bajo 60, horas bajo 24 y si no, días ("No progress for 3 h"). Redondeado: 2 h 59 min 55 s → 3 h.
 */
export function duracionRedondeada(milisegundos) {
  const ms = Math.max(0, Number(milisegundos) || 0);
  const minutos = Math.round(ms / MINUTO);
  if (minutos < 60) return { unidad: "min", n: minutos };
  const horas = Math.round(ms / HORA);
  if (horas < 24) return { unidad: "h", n: horas };
  return { unidad: "d", n: Math.round(ms / DIA) };
}

const CORREN = new Set(["running", "stalled", "queued"]);

/**
 * Qué tiempo va al pie de una tarjeta:
 *  - corriendo, detenida o en cola: el transcurrido desde `creada` → { tipo: "transcurrido", minutos, horas, resto };
 *  - entregada o fallida: relativo a `actualizada` → { tipo: "relativo", fecha, ahora } (lo formatea fmt.tiempoRelativo).
 * null si faltan fechas.
 */
export function tiempoDeTarjeta(tarjeta, ahora) {
  if (CORREN.has(tarjeta?.estado)) {
    const valor = transcurrido(tarjeta.creada, ahora);
    return valor ? { tipo: "transcurrido", ...valor } : null;
  }
  const fecha = tarjeta?.actualizada ?? tarjeta?.creada ?? null;
  const ms = aMs(ahora);
  if (aMs(fecha) === null || ms === null) return null;
  return { tipo: "relativo", fecha, ahora: ms };
}

/** Cuánto lleva sin avanzar una tarjeta detenida (ahora − actualizada), redondeado. null si falta una fecha. */
export function sinAvance(tarjeta, ahora) {
  const desde = aMs(tarjeta?.actualizada);
  const hasta = aMs(ahora);
  if (desde === null || hasta === null) return null;
  return duracionRedondeada(hasta - desde);
}
