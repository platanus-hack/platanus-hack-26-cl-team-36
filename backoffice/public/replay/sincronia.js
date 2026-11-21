// Sincronía del Replay (diseño §10.6.2): tiempo ↔ paso, saltos a pasos con problemas, grupos de pasos repetidos y
// tramos de "solo pasos". Puro: no toca document ni window, así node:test lo importa.
//
// Los segundos son del intento: 0 = la pantalla inicial. En el video el mismo instante es `desfase + t`, donde
// `desfase` es `video_offset_s` del evaluador (lo que tardó en cargar la primera página antes del intento).

/** Velocidades de reproducción, de la más lenta a la más rápida. */
export const VELOCIDADES = [0.5, 1, 2, 4];

const numero = (valor) => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);

/**
 * Ventana de tiempo de cada paso: desde que el modelo empieza a decidirlo hasta que se tomó su captura.
 * Un paso sin tiempos hereda el final del anterior (ventana vacía), así el orden nunca retrocede.
 * @param {{ numero: number, segundos?: number | null, duracion?: number | null }[]} pasos
 * @returns {{ numero: number, desde: number, hasta: number }[]}
 */
export function ventanasDePasos(pasos) {
  const ventanas = [];
  let anterior = 0;
  for (const paso of pasos ?? []) {
    const segundos = numero(paso?.segundos);
    const duracion = numero(paso?.duracion) ?? 0;
    const hasta = segundos === null ? anterior : Math.max(segundos, 0);
    const desde = segundos === null ? anterior : Math.max(0, segundos - Math.max(duracion, 0));
    ventanas.push({ numero: paso?.numero ?? ventanas.length + 1, desde, hasta });
    anterior = Math.max(anterior, hasta);
  }
  return ventanas;
}

/**
 * Largo de la línea de tiempo: el mayor entre la duración del intento y el final del último paso.
 * @param {{ duracion?: number | null, pasos?: object[] }} intento
 */
export function duracionTotal(intento) {
  const ventanas = ventanasDePasos(intento?.pasos ?? []);
  const ultimo = ventanas.length ? ventanas[ventanas.length - 1].hasta : 0;
  return Math.max(numero(intento?.duracion) ?? 0, ultimo, 0);
}

/**
 * Índice del paso que se ve en el segundo `t`: la última ventana que ya empezó (desde ≤ t). Antes de la primera,
 * 0; sin ventanas, -1.
 * @param {{ desde: number }[]} ventanas
 * @param {number} t
 */
export function pasoEnSegundo(ventanas, t) {
  if (!ventanas?.length) return -1;
  let bajo = 0;
  let alto = ventanas.length - 1;
  let hallado = 0;
  while (bajo <= alto) {
    const medio = (bajo + alto) >> 1;
    if (ventanas[medio].desde <= t) {
      hallado = medio;
      bajo = medio + 1;
    } else alto = medio - 1;
  }
  return hallado;
}

/** ¿El paso tiene un problema? Una señal (sin efecto, volvió atrás, error visible…) o está fuera de la ruta. */
export function esProblema(paso) {
  return (Array.isArray(paso?.senales) && paso.senales.length > 0) || paso?.carril === "fuera-de-ruta";
}

/**
 * Siguiente (direccion 1) o anterior (-1) paso con problema, sin contar `indice`. → índice o null.
 * @param {object[]} pasos
 * @param {number} indice
 * @param {1 | -1} direccion
 */
export function siguienteConProblema(pasos, indice, direccion = 1) {
  const lista = pasos ?? [];
  const paso = direccion < 0 ? -1 : 1;
  for (let i = indice + paso; i >= 0 && i < lista.length; i += paso) {
    if (esProblema(lista[i])) return i;
  }
  return null;
}

const CLICS = new Set(["clic", "clic_coordenadas", "doble_clic", "triple_clic"]);

/** Clave de una firma para comparar pasos repetidos (la misma acción sobre lo mismo, en la misma página). */
function claveDeFirma(paso) {
  const firma = paso?.firma ?? {};
  const porCoordenadas = firma.tipo === "clic_coordenadas";
  return JSON.stringify([
    firma.tipo ?? paso?.accion ?? null,
    firma.objetivo ?? null,
    firma.direccion ?? null,
    firma.cantidad ?? null,
    porCoordenadas ? firma.x ?? null : null,
    porCoordenadas ? firma.y ?? null : null,
    firma.tipo === "otra" ? firma.original ?? null : null,
    paso?.pagina ?? null,
  ]);
}

/**
 * Pasos seguidos con la misma firma (p. ej. «desplazar ↓ ×10» cuatro veces en la misma página).
 * → [{ desde, hasta, firma }] con índices inclusivos; un paso suelto es un grupo de uno.
 * @param {object[]} pasos
 */
export function agruparRepetidos(pasos) {
  const grupos = [];
  (pasos ?? []).forEach((paso, indice) => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && claveDeFirma(pasos[ultimo.hasta]) === claveDeFirma(paso)) ultimo.hasta = indice;
    else grupos.push({ desde: indice, hasta: indice, firma: paso?.firma ?? null });
  });
  return grupos;
}

/**
 * Tramos de "solo pasos": cada ventana ampliada `antes` segundos hacia atrás y `despues` hacia adelante, con los
 * tramos que se tocan unidos. → [[inicio, fin], …] en orden.
 * @param {{ desde: number, hasta: number }[]} ventanas
 */
export function segmentosSoloPasos(ventanas, antes = 0.5, despues = 1.5) {
  const tramos = (ventanas ?? [])
    .map(({ desde, hasta }) => [Math.max(0, desde - antes), Math.max(desde, hasta) + despues])
    .sort((a, b) => a[0] - b[0]);
  const unidos = [];
  for (const [inicio, fin] of tramos) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && inicio <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fin);
    else unidos.push([inicio, fin]);
  }
  return unidos;
}

/**
 * Con "solo pasos": dónde debe estar la reproducción en el segundo `t`. Dentro de un tramo, `t`; en un hueco, el
 * comienzo del tramo siguiente; después del último, null (se detiene).
 * @param {[number, number][]} segmentos
 * @param {number} t
 */
export function saltoSoloPasos(segmentos, t) {
  for (const [inicio, fin] of segmentos ?? []) {
    if (t < inicio) return inicio;
    if (t <= fin) return t;
  }
  return null;
}

/** Velocidad siguiente (direccion 1) o anterior (-1) en VELOCIDADES; se queda en los extremos. */
export function cambiarVelocidad(actual, direccion) {
  const indice = VELOCIDADES.indexOf(actual);
  const desde = indice === -1 ? VELOCIDADES.indexOf(1) : indice;
  const nuevo = Math.min(VELOCIDADES.length - 1, Math.max(0, desde + (direccion < 0 ? -1 : 1)));
  return VELOCIDADES[nuevo];
}

/** "0:13", "1:05", "12:00" (minutos:segundos, sin depender del idioma). */
export function formatoReloj(segundos) {
  const total = Math.max(0, Math.floor(numero(segundos) ?? 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Dónde dibujar el anillo del clic, en % de la captura (la captura mide lo mismo que el viewport).
 * → { x, y } o null si el paso no es un clic o no tiene coordenadas.
 * @param {{ firma?: { tipo?: string }, accion?: string, coordenadas?: [number, number] | null }} paso
 * @param {{ ancho: number, alto: number } | null} viewport
 */
export function posicionDelClic(paso, viewport) {
  const tipo = paso?.firma?.tipo;
  const esClic = CLICS.has(tipo) || (!tipo && /click/.test(String(paso?.accion ?? "")));
  const [x, y] = Array.isArray(paso?.coordenadas) ? paso.coordenadas : [];
  const ancho = numero(viewport?.ancho);
  const alto = numero(viewport?.alto);
  if (!esClic || numero(x) === null || numero(y) === null || !ancho || !alto) return null;
  const acotar = (valor) => Math.min(100, Math.max(0, Math.round(valor * 1000) / 10));
  return { x: acotar(x / ancho), y: acotar(y / alto) };
}
