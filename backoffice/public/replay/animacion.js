// Lo que la captura del Replay anima en cada paso, como datos. Puro: no toca document ni window, así node:test lo
// importa. escena.js lo dibuja (Web Animations API sobre la captura).
//
// Por qué sin three.js: todo lo que se anima es 2D sobre una captura (cursor, onda, deslizar, texto, tecla,
// fundido). CSS y la Web Animations API lo hacen en la GPU, con texto nítido del DOM y sin pesar ~650 kB más que
// todo el resto del front; un shader de transición no se distingue de un fundido con desenfoque a este tamaño.

/** Duraciones en ms. "completo" al reproducir; "corto" al elegir un paso a mano. */
export const DURACIONES = {
  completo: { viaje: 650, pulso: 420, escribirPorLetra: 45, escribirMax: 1100, tecla: 520, desplazar: 700, cambio: 650, fundido: 260 },
  corto: { viaje: 260, pulso: 300, escribirPorLetra: 18, escribirMax: 450, tecla: 300, desplazar: 380, cambio: 380, fundido: 180 },
};

const CLICS = { left_click: "clic", double_click: "doble_clic", triple_click: "doble_clic" };

/**
 * Rectángulo donde queda la imagen dentro de una caja con `object-fit: contain`.
 * @param {{ ancho: number|null, alto: number|null }} viewport  tamaño original de la captura
 * @param {{ ancho: number, alto: number }} caja                tamaño de la caja que la muestra
 * @returns {{ x: number, y: number, ancho: number, alto: number, escala: number } | null}
 */
export function rectanguloDeImagen(viewport, caja) {
  const va = Number(viewport?.ancho) || 0;
  const vh = Number(viewport?.alto) || 0;
  if (!va || !vh || !(caja?.ancho > 0) || !(caja?.alto > 0)) return null;
  const escala = Math.min(caja.ancho / va, caja.alto / vh);
  const ancho = va * escala;
  const alto = vh * escala;
  return { x: (caja.ancho - ancho) / 2, y: (caja.alto - alto) / 2, ancho, alto, escala };
}

/**
 * Un punto del viewport de la página ([x, y] en px de la captura) en % de la captura mostrada, para poner encima
 * piezas del DOM que siguen a la imagen al cambiar de tamaño. Los puntos fuera se acercan al borde.
 * @returns {{ x: number, y: number } | null}
 */
export function aPorcentaje(punto, viewport) {
  const va = Number(viewport?.ancho) || 0;
  const vh = Number(viewport?.alto) || 0;
  if (!Array.isArray(punto) || punto.length < 2 || !va || !vh) return null;
  const [x, y] = punto.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const limitar = (v) => Math.min(100, Math.max(0, v));
  return { x: limitar((x / va) * 100), y: limitar((y / vh) * 100) };
}

/** Puntos de una curva suave (bezier cuadrática que se arquea hacia arriba) de `desde` a `hasta`, para el cursor. */
export function curvaDelCursor(desde, hasta, muestras = 16) {
  const [x0, y0] = desde.map(Number);
  const [x1, y1] = hasta.map(Number);
  const distancia = Math.hypot(x1 - x0, y1 - y0);
  const control = [(x0 + x1) / 2, Math.min(y0, y1) - Math.min(120, distancia * 0.25)];
  const puntos = [];
  for (let i = 0; i <= muestras; i += 1) {
    const t = i / muestras;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    puntos.push([a * x0 + b * control[0] + c * x1, a * y0 + b * control[1] + c * y1]);
  }
  return { puntos, control };
}

/** La URL como se lee en el rótulo de cambio de página: host y ruta, sin protocolo ni «www.» («metro.cl/tarifas»). */
export function rutaCorta(url, largo = 60) {
  let texto = String(url ?? "").trim();
  try {
    const u = new URL(texto);
    texto = `${u.host.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    // no es una URL absoluta: se muestra tal cual
  }
  return texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto || null;
}

/** URL sin `#…` ni barra final, para saber si un paso cambió de página. */
export function mismaPagina(a, b) {
  const limpia = (url) => String(url ?? "").split("#")[0].replace(/\/+$/, "");
  return limpia(a) === limpia(b);
}

const puntoValido = (p) => Array.isArray(p) && p.length >= 2 && p.every((v) => Number.isFinite(Number(v)));

/** Último punto conocido antes del paso `indice` (de dónde parte el cursor). */
function puntoAnterior(pasos, indice) {
  for (let i = indice - 1; i >= 0; i -= 1) if (puntoValido(pasos[i]?.coordenadas)) return pasos[i].coordenadas;
  return null;
}

/** El campo donde se escribe: el último clic antes del paso, en la misma página. */
function campoDeEscritura(pasos, indice) {
  for (let i = indice - 1; i >= 0; i -= 1) {
    const paso = pasos[i];
    if (!mismaPagina(paso?.url, pasos[indice]?.urlAntes)) return null;
    if (CLICS[paso?.accion] && puntoValido(paso.coordenadas)) return paso.coordenadas;
  }
  return null;
}

/**
 * Plan de animación del paso `indice` de un intento.
 * tipo: "clic" | "doble_clic" | "desplazar" | "escribir" | "tecla" | "volver" | "ninguna".
 * cambio: cómo pasa de la captura de antes a la de después: "fundido" (misma página), "pagina" (otra URL) o
 * "volver" (salto atrás del explorador o tecla atrás), y null si no hay captura de antes.
 * @param {object[]} pasos   pasos del intento (como los entrega la API)
 * @param {number} indice
 * @param {{ viewport?: { ancho: number|null, alto: number|null } }} [opciones]
 */
export function planDelPaso(pasos, indice, { viewport } = {}) {
  const paso = pasos?.[indice];
  if (!paso) return null;
  const centro = [(viewport?.ancho || 1024) / 2, (viewport?.alto || 768) / 2];
  const firma = paso.firma ?? {};
  const salto = firma.tipo === "volver" || firma.tipo === "atras" || paso.accion === "volver_a_nodo";
  const otraPagina = !mismaPagina(paso.urlAntes, paso.url);
  const plan = {
    tipo: "ninguna",
    desde: null,
    hasta: null,
    direccion: null,
    texto: null,
    tecla: null,
    destino: null,
    cambio: paso.capturaAntes ? (salto ? "volver" : otraPagina ? "pagina" : "fundido") : null,
  };

  if (salto) return { ...plan, tipo: "volver", destino: firma.objetivo || paso.titulo || null };
  if (plan.cambio === "pagina") plan.destino = rutaCorta(paso.url);

  const clic = CLICS[paso.accion];
  if (clic && puntoValido(paso.coordenadas)) {
    return { ...plan, tipo: clic, desde: puntoAnterior(pasos, indice) ?? centro, hasta: paso.coordenadas };
  }
  if (paso.accion === "scroll") {
    return { ...plan, tipo: "desplazar", direccion: firma.direccion ?? "abajo", hasta: puntoValido(paso.coordenadas) ? paso.coordenadas : centro };
  }
  if (paso.accion === "type") {
    return { ...plan, tipo: "escribir", texto: String(firma.objetivo ?? ""), hasta: campoDeEscritura(pasos, indice) };
  }
  if (paso.accion === "key") return { ...plan, tipo: "tecla", tecla: String(firma.objetivo || paso.descripcion || "").trim() || "?" };
  return plan;
}

const SIMBOLOS_DE_TECLA = { enter: "⏎", return: "⏎", tab: "⇥", escape: "Esc", backspace: "⌫", home: "Inicio", end: "Fin", pagedown: "AvPág", pageup: "RePág" };

/** Texto de la tecla para el distintivo: «Enter» → «⏎ Enter», «ctrl+l» → «Ctrl + L». */
export function textoDeTecla(tecla) {
  return String(tecla ?? "")
    .split("+")
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const simbolo = SIMBOLOS_DE_TECLA[parte.toLowerCase()];
      if (simbolo === "⏎" || simbolo === "⇥" || simbolo === "⌫") return `${simbolo} ${parte[0].toUpperCase()}${parte.slice(1)}`;
      return simbolo ?? (parte.length === 1 ? parte.toUpperCase() : parte[0].toUpperCase() + parte.slice(1));
    })
    .join(" + ");
}

/** Desplazamiento (en fracciones de la caja) de la captura de antes al deslizar: el contenido va contra el scroll. */
export function vectorDeDesplazamiento(direccion) {
  return { abajo: [0, -1], arriba: [0, 1], derecha: [-1, 0], izquierda: [1, 0] }[direccion] ?? [0, -1];
}
