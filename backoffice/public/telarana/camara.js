// Cámara de la telaraña (diseño §10.5.2): pan con arrastre, zoom con Ctrl/⌘ + rueda (normalizando deltaMode),
// pellizco con dos punteros, botones y teclas, ajuste a la vista y vuelo a una estación. Todo por CSSOM:
// `.escena { transform: translate(tx, ty) scale(k) }` y `--k` para que las etiquetas se contraescalen.

export const ZOOM_MINIMO = 0.35;
export const ZOOM_MAXIMO = 2.5;
const AJUSTE_MAXIMO = 1.25;
const DURACION_DE_VUELO = 600;

const acotar = (valor, minimo, maximo) => Math.min(maximo, Math.max(minimo, valor));
const curva = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2); // ease-in-out (cúbica)

/** Nivel de detalle de las etiquetas según el zoom: bajo, el nombre en 2 líneas; medio, en 3; alto, con detalles. */
export const detalleDeZoom = (k) => (k < 0.8 ? "bajo" : k > 1.3 ? "alto" : "medio");
const LINEAS_DE_NOMBRE = { bajo: 2, medio: 3 };

// Medidas de telarana.css que deciden cuánto alto pide una estación en pantalla (si cambian allá, cambian acá):
// el botón sube 9 px (translate), el punto mide 18 px y se agranda a 0.8/k; la etiqueta va 6 px debajo del punto,
// con 2 px de relleno arriba y abajo, líneas de 16 px y se agranda a 0.9/k; la marca de atasco asoma 8 px sobre el
// punto (y queda a su derecha, encima del nombre de la estación de arriba si no hay lugar).
const ESTACION = {
  subida: 9,
  punto: 18,
  separacion: 6,
  relleno: 4,
  linea: 16,
  atascoSobreElPunto: 8,
  puntoMinimo: 0.8,
  etiquetaMinima: 0.9,
};

/**
 * ¿Cabe, con el zoom k, el nombre de una estación (con las líneas de su nivel de detalle) entre su punto y la marca
 * de atasco o el punto de la estación de la fila de abajo? Todo en px de pantalla; filas de `altoFila` px de escena.
 */
export function cabeLaEtiqueta(k, altoFila) {
  const detalle = detalleDeZoom(k);
  if (!(detalle in LINEAS_DE_NOMBRE)) return true; // de cerca, el detalle alto se lee estación por estación
  const { subida, punto, separacion, relleno, linea, atascoSobreElPunto, puntoMinimo, etiquetaMinima } = ESTACION;
  const arribaDeLaEtiqueta = (punto - subida + separacion) * k;
  const etiqueta = (LINEAS_DE_NOMBRE[detalle] * linea + relleno) * Math.max(k, etiquetaMinima);
  const deLaVecina = (subida + atascoSobreElPunto) * Math.max(k, puntoMinimo);
  return arribaDeLaEtiqueta + etiqueta + 1 <= altoFila * k - deLaVecina;
}

/** Alto mínimo del lienzo de la telaraña (px): por debajo, se desplaza la página en vez de achicarlo más. */
export const ALTO_MINIMO_DEL_LIENZO = 320;

/**
 * Alto del lienzo (px) para que quepa en la ventana: lo que queda bajo su borde de arriba (`arriba`, medido con la
 * página sin desplazar) menos un margen, nunca menos que ALTO_MINIMO_DEL_LIENZO.
 */
export function altoDelLienzo(ventana, arriba, margen = 16) {
  return Math.max(ALTO_MINIMO_DEL_LIENZO, Math.floor(ventana - arriba - margen));
}

/** El menor zoom (de a 0.01) desde el que los nombres caben en su fila: el ajuste a la vista no aleja más que esto. */
export function zoomLegible(altoFila) {
  for (let k = ZOOM_MINIMO; k <= ZOOM_MAXIMO; k = Math.round((k + 0.01) * 100) / 100) {
    if (cabeLaEtiqueta(k, altoFila)) return k;
  }
  return ZOOM_MAXIMO;
}

/**
 * El alto de fila (px de escena, de a 4, al menos `minimo`) con el que los nombres caben en su fila viendo el mapa con
 * el zoom k: un mapa ancho, que se ve de lejos para que quepan el inicio y la meta, se estira hacia abajo en vez de
 * montar los nombres.
 */
export function altoDeFilaPara(k, minimo) {
  const zoom = acotar(k, ZOOM_MINIMO, ZOOM_MAXIMO);
  let alto = Math.ceil(minimo / 4) * 4;
  while (!cabeLaEtiqueta(zoom, alto) && alto < 1000) alto += 4;
  return alto;
}

/**
 * @param {HTMLElement} lienzo  el recuadro visible (overflow hidden)
 * @param {HTMLElement} escena  lo que se transforma
 * @param {{ senal: AbortSignal, reducido: () => boolean, alCambiar?: (estado) => void,
 *           puedeArrastrar?: (evento: PointerEvent) => boolean, alTocarFondo?: (evento: PointerEvent) => void }} opciones
 */
export function crearCamara(lienzo, escena, { senal, reducido, alCambiar = () => {}, puedeArrastrar = () => true, alTocarFondo = () => {} }) {
  const estado = { tx: 0, ty: 0, k: 1 };
  // Vista 3D (§10.5.4): el plano se inclina (rotateX) y arrastrar lo gira (rotateZ, ±25°).
  const plano = { inclinado: false, giro: 0, pivote: { x: 0, y: 0 } };
  const INCLINACION = 52;
  const GIRO_MAXIMO = 25;
  let vuelo = 0;

  function aplicar() {
    // El giro es alrededor del centro del mapa (pivote), no del origen de la escena.
    const { x: px, y: py } = plano.pivote;
    const inclinacion = plano.inclinado
      ? ` rotateX(${INCLINACION}deg) translate(${px}px, ${py}px) rotateZ(${Math.round(plano.giro * 10) / 10}deg) translate(${-px}px, ${-py}px)`
      : "";
    escena.style.transform = `translate(${estado.tx}px, ${estado.ty}px) scale(${estado.k})${inclinacion}`;
    escena.style.setProperty("--k", String(Math.round(estado.k * 1000) / 1000));
    // La grilla de puntos del fondo acompaña al mapa.
    const paso = 16 * estado.k;
    lienzo.style.setProperty("background-size", `${paso}px ${paso}px`);
    lienzo.style.setProperty("background-position", `${estado.tx}px ${estado.ty}px`);
    const detalle = detalleDeZoom(estado.k);
    if (lienzo.dataset.detalle !== detalle) lienzo.dataset.detalle = detalle;
    alCambiar({ ...estado });
  }

  function cancelarVuelo() {
    if (vuelo) cancelAnimationFrame(vuelo);
    vuelo = 0;
  }

  function poner({ tx = estado.tx, ty = estado.ty, k = estado.k }) {
    cancelarVuelo();
    estado.tx = tx;
    estado.ty = ty;
    estado.k = acotar(k, ZOOM_MINIMO, ZOOM_MAXIMO);
    aplicar();
  }

  /** Zoom multiplicando k por `factor` alrededor de (px, py) en coordenadas del lienzo. */
  function zoomEn(factor, px = lienzo.clientWidth / 2, py = lienzo.clientHeight / 2) {
    const k = acotar(estado.k * factor, ZOOM_MINIMO, ZOOM_MAXIMO);
    const real = k / estado.k;
    poner({ tx: px - (px - estado.tx) * real, ty: py - (py - estado.ty) * real, k });
  }

  /**
   * Encuadre que deja `caja` (coordenadas de la escena) entera y centrada; con `minimo`, nunca más lejos que eso
   * (entonces la caja puede no caber entera).
   */
  function encuadre(caja, { ancho = lienzo.clientWidth, alto = lienzo.clientHeight, maximo = AJUSTE_MAXIMO, minimo = ZOOM_MINIMO } = {}) {
    if (!caja || !caja.ancho || !caja.alto || !ancho || !alto) return { tx: 0, ty: 0, k: 1 };
    const k = acotar(Math.min(ancho / caja.ancho, alto / caja.alto), Math.max(ZOOM_MINIMO, minimo), Math.max(maximo, minimo));
    return { k, tx: (ancho - caja.ancho * k) / 2 - caja.x * k, ty: (alto - caja.alto * k) / 2 - caja.y * k };
  }

  function ajustar(caja, opciones) {
    poner(encuadre(caja, opciones));
  }

  /** ¿Está el punto (x, y) de la escena dentro de lo visible, con un margen en px? */
  function esVisible(x, y, margen = 48) {
    const sx = x * estado.k + estado.tx;
    const sy = y * estado.k + estado.ty;
    return sx >= margen && sy >= margen && sx <= lienzo.clientWidth - margen && sy <= lienzo.clientHeight - margen;
  }

  /** Lleva el punto (x, y) al centro; animado (interpolando k en escala logarítmica) salvo movimiento reducido. */
  function volarA(x, y, { k = estado.k, animar = true } = {}) {
    const destinoK = acotar(k, ZOOM_MINIMO, ZOOM_MAXIMO);
    const destino = { k: destinoK, tx: lienzo.clientWidth / 2 - x * destinoK, ty: lienzo.clientHeight / 2 - y * destinoK };
    if (!animar || reducido()) return poner(destino);
    cancelarVuelo();
    const desde = { ...estado };
    const inicio = performance.now();
    const cuadro = (ahora) => {
      const avance = Math.min(1, (ahora - inicio) / DURACION_DE_VUELO);
      const e = curva(avance);
      estado.k = Math.exp(Math.log(desde.k) + (Math.log(destino.k) - Math.log(desde.k)) * e);
      estado.tx = desde.tx + (destino.tx - desde.tx) * e;
      estado.ty = desde.ty + (destino.ty - desde.ty) * e;
      aplicar();
      vuelo = avance < 1 ? requestAnimationFrame(cuadro) : 0;
    };
    vuelo = requestAnimationFrame(cuadro);
  }

  function mover(dx, dy) {
    poner({ tx: estado.tx + dx, ty: estado.ty + dy });
  }

  // ── Punteros: arrastre (uno) y pellizco (dos) ─────────────────────────
  const punteros = new Map();
  let arrastre = null;
  let pellizco = null;
  const local = (evento) => {
    const caja = lienzo.getBoundingClientRect();
    return { x: evento.clientX - caja.left, y: evento.clientY - caja.top };
  };
  const distancia = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);
  const medio = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  lienzo.addEventListener(
    "pointerdown",
    (evento) => {
      if (evento.button !== 0 || !puedeArrastrar(evento)) return;
      punteros.set(evento.pointerId, local(evento));
      if (punteros.size === 1) {
        arrastre = { id: evento.pointerId, ...local(evento), tx: estado.tx, ty: estado.ty, giro: plano.giro, movio: false, sobreFondo: evento.target === lienzo || !evento.target.closest?.("button, a, .terminal") };
      } else if (punteros.size === 2) {
        arrastre = null;
        const dos = [...punteros.values()];
        pellizco = { d: distancia(dos), k: estado.k };
      }
    },
    { signal: senal },
  );
  lienzo.addEventListener(
    "pointermove",
    (evento) => {
      if (!punteros.has(evento.pointerId)) return;
      punteros.set(evento.pointerId, local(evento));
      if (pellizco && punteros.size === 2) {
        const dos = [...punteros.values()];
        const centro = medio(dos);
        zoomEn((pellizco.k * distancia(dos)) / pellizco.d / estado.k, centro.x, centro.y);
        return;
      }
      if (!arrastre || arrastre.id !== evento.pointerId) return;
      const p = local(evento);
      const dx = p.x - arrastre.x;
      const dy = p.y - arrastre.y;
      if (!arrastre.movio && Math.hypot(dx, dy) < 4) return;
      if (!arrastre.movio) {
        arrastre.movio = true;
        try {
          lienzo.setPointerCapture(evento.pointerId);
        } catch {
          // el puntero ya no existe
        }
        lienzo.classList.add("arrastrando");
      }
      if (plano.inclinado) {
        plano.giro = acotar(arrastre.giro + dx * 0.15, -GIRO_MAXIMO, GIRO_MAXIMO);
        aplicar();
      } else poner({ tx: arrastre.tx + dx, ty: arrastre.ty + dy });
    },
    { signal: senal },
  );
  const soltar = (evento) => {
    if (!punteros.has(evento.pointerId)) return;
    punteros.delete(evento.pointerId);
    if (punteros.size < 2) pellizco = null;
    if (arrastre?.id === evento.pointerId) {
      if (!arrastre.movio && arrastre.sobreFondo && evento.type === "pointerup") alTocarFondo(evento);
      arrastre = null;
      lienzo.classList.remove("arrastrando");
    }
  };
  lienzo.addEventListener("pointerup", soltar, { signal: senal });
  lienzo.addEventListener("pointercancel", soltar, { signal: senal });
  // Un clic que terminó un arrastre no elige la estación sobre la que se soltó.
  lienzo.addEventListener(
    "click",
    (evento) => {
      if (lienzo.classList.contains("arrastrando")) evento.preventDefault();
    },
    { capture: true, signal: senal },
  );

  // ── Rueda: Ctrl/⌘ + rueda (y el pellizco del trackpad) acercan; el desplazamiento lateral mueve ─────
  lienzo.addEventListener(
    "wheel",
    (evento) => {
      const escala = evento.deltaMode === 1 ? 16 : evento.deltaMode === 2 ? lienzo.clientHeight : 1;
      if (evento.ctrlKey || evento.metaKey) {
        evento.preventDefault();
        const p = local(evento);
        zoomEn(Math.exp(-evento.deltaY * escala * 0.0025), p.x, p.y);
      } else if (Math.abs(evento.deltaX) > Math.abs(evento.deltaY)) {
        evento.preventDefault();
        mover(-evento.deltaX * escala, 0);
      }
    },
    { passive: false, signal: senal },
  );

  senal.addEventListener("abort", cancelarVuelo, { once: true });

  return {
    estado: () => ({ ...estado }),
    poner,
    zoomEn,
    acercar: () => zoomEn(1.25),
    alejar: () => zoomEn(0.8),
    mover,
    ajustar,
    encuadre,
    esVisible,
    volarA,
    /** Inclina o aplana el plano (la transición la pone el CSS con .cambiando-vista). */
    inclinar(activo, pivote = plano.pivote) {
      plano.inclinado = !!activo;
      plano.pivote = pivote;
      if (!activo) plano.giro = 0;
      aplicar();
    },
    get inclinado() {
      return plano.inclinado;
    },
  };
}

/**
 * Cuando el mapa no cabe de alto: el desplazamiento vertical (ty, en px de escena, antes de multiplicar por el zoom)
 * de la franja de `alto` px que deja dentro el mayor peso de puntos ({ y, peso }), con `margen` px libres arriba
 * (para el punto) y abajo (para la etiqueta). A igual peso, la franja más cerca del tronco (y = 0). Sin puntos: null.
 */
export function franjaConMasEstaciones(puntos, alto, margen = 0) {
  if (!puntos.length) return null;
  const util = Math.max(0, alto - 2 * margen);
  let mejor = null;
  for (const { y: desde } of puntos) {
    const peso = puntos.reduce((suma, p) => suma + (p.y >= desde && p.y <= desde + util ? p.peso : 0), 0);
    const centro = Math.abs(desde + util / 2);
    if (!mejor || peso > mejor.peso || (peso === mejor.peso && centro < mejor.centro)) mejor = { peso, centro, desde };
  }
  return -(mejor.desde - margen);
}
