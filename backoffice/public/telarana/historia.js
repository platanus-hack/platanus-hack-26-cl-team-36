// Modo historia (diseño §10.5.3): un cometa recorre el camino de un intento, paso a paso. En los pasos que no
// cambian de página la estación late; al cambiar de página el cometa viaja por el tramo (getPointAtLength + rAF)
// y la cámara lo sigue solo si la próxima estación queda fuera de la vista. Con movimiento reducido, salta.

import { duracionDePaso } from "./cuentas.js";

/**
 * @param {{ recorrido: { pasos: { numero, pagina, paginaAntes, tramo }[] }, pasosDelIntento: object[],
 *   dibujo: { cometa: HTMLElement, estaciones: Map, tramos: Map }, posiciones: Map<string, {x, y}>,
 *   camara, reducido: () => boolean, alCambiar: (paso: number, { reproduciendo: boolean }) => void }} opciones
 */
export function crearHistoria({ recorrido, pasosDelIntento, dibujo, posiciones, camara, reducido, alCambiar }) {
  const pasos = recorrido.pasos;
  const total = pasos.length;
  let actual = total ? 1 : 0;
  let reloj = 0;
  let viaje = 0;
  let reproduciendo = false;
  let vivo = true;

  const paginaDe = (numero) => pasos[numero - 1]?.pagina ?? null;

  function ponerCometa(x, y) {
    dibujo.cometa.style.setProperty("--x", `${Math.round(x * 10) / 10}px`);
    dibujo.cometa.style.setProperty("--y", `${Math.round(y * 10) / 10}px`);
  }

  function seguir(pagina) {
    const p = posiciones.get(pagina);
    if (p && !camara.esVisible(p.x, p.y, 64)) camara.volarA(p.x, p.y);
  }

  function latir(pagina) {
    if (reducido()) return;
    dibujo.estaciones
      .get(pagina)
      ?.querySelector(".estacion-punto")
      ?.animate([{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out", pseudoElement: "::before" });
  }

  function cancelarViaje() {
    if (viaje) cancelAnimationFrame(viaje);
    viaje = 0;
  }

  /** Coloca el cometa en el paso `numero`; si `desde` es el paso anterior y cambia de página, viaja por el tramo. */
  function colocar(numero, { desde = null, conCamara = true } = {}) {
    cancelarViaje();
    const pagina = paginaDe(numero);
    const destino = posiciones.get(pagina);
    if (!destino) return;
    dibujo.cometa.classList.add("visible");
    const paso = pasos[numero - 1];
    const camino = desde === numero - 1 && paso.tramo ? dibujo.tramos.get(paso.tramo)?.querySelector(".tramo-trazo") : null;
    if (!camino || reducido()) {
      ponerCometa(destino.x, destino.y);
      if (desde !== null && !paso.tramo) latir(pagina);
      if (conCamara) seguir(pagina);
      return;
    }
    let largo = 0;
    try {
      largo = camino.getTotalLength();
    } catch {
      largo = 0;
    }
    if (!largo) {
      ponerCometa(destino.x, destino.y);
      seguir(pagina);
      return;
    }
    seguir(pagina);
    const duracion = Math.min(900, Math.max(300, duracionDePaso(pasosDelIntento[numero - 1]) * 0.6));
    const inicio = performance.now();
    const cuadro = (ahora) => {
      const avance = Math.min(1, (ahora - inicio) / duracion);
      const suave = 1 - (1 - avance) ** 3;
      const punto = camino.getPointAtLength(largo * suave);
      ponerCometa(punto.x, punto.y);
      viaje = avance < 1 && vivo ? requestAnimationFrame(cuadro) : 0;
    };
    viaje = requestAnimationFrame(cuadro);
  }

  function programar() {
    clearTimeout(reloj);
    if (!reproduciendo) return;
    if (actual >= total) {
      pausar();
      return;
    }
    reloj = setTimeout(() => {
      if (!vivo || !reproduciendo) return;
      const anterior = actual;
      actual += 1;
      colocar(actual, { desde: anterior });
      alCambiar(actual, { reproduciendo: actual < total });
      if (actual >= total) pausar();
      else programar();
    }, duracionDePaso(pasosDelIntento[actual - 1]));
  }

  function irA(numero, { animar = false, conCamara = true } = {}) {
    if (!total) return;
    const destino = Math.min(total, Math.max(1, Math.round(numero)));
    const anterior = actual;
    actual = destino;
    colocar(actual, { desde: animar ? anterior : null, conCamara });
    if (reproduciendo) programar();
  }

  function reproducir() {
    if (!total) return;
    if (actual >= total) {
      actual = 1;
      colocar(actual);
      alCambiar(actual, { reproduciendo: true });
    }
    reproduciendo = true;
    programar();
  }

  function pausar() {
    const estaba = reproduciendo;
    reproduciendo = false;
    clearTimeout(reloj);
    if (estaba) alCambiar(actual, { reproduciendo: false });
  }

  return {
    get paso() {
      return actual;
    },
    get total() {
      return total;
    },
    get reproduciendo() {
      return reproduciendo;
    },
    irA,
    reproducir,
    pausar,
    alternar: () => (reproduciendo ? pausar() : reproducir()),
    /** Paso siguiente/anterior a mano: pausa y avisa. */
    mover(dir) {
      if (!total) return;
      reproduciendo = false;
      clearTimeout(reloj);
      const anterior = actual;
      irA(actual + dir, { animar: dir === 1 });
      if (actual !== anterior) alCambiar(actual, { reproduciendo: false });
    },
    extremo(ultimo) {
      reproduciendo = false;
      clearTimeout(reloj);
      irA(ultimo ? total : 1);
      alCambiar(actual, { reproduciendo: false });
    },
    /** Vuelve a ubicar el cometa (después de redibujar la escena). */
    reubicar(nuevoDibujo, nuevasPosiciones) {
      cancelarViaje();
      dibujo = nuevoDibujo;
      posiciones = nuevasPosiciones;
      colocar(actual, { conCamara: false });
    },
    destruir() {
      vivo = false;
      reproduciendo = false;
      clearTimeout(reloj);
      cancelarViaje();
      dibujo.cometa.classList.remove("visible");
    },
  };
}
