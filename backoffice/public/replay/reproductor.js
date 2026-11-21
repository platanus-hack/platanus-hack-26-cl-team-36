// Reproducción del Replay (diseño §10.6.2). Dos implementaciones con la misma forma:
//   - crearRelojVirtual: sin video, un reloj (un tic cada 50 ms × velocidad) recorre los segundos del intento;
//     la pantalla muestra la captura del paso que corresponde a cada segundo.
//   - crearReproductorDeVideo: con video.webm, el <video> manda; sus segundos se traducen a segundos del intento
//     restando el desfase (lo que tardó la carga inicial antes del intento).
// Ambos avisan con alAvanzar(t) (t en segundos del intento) y alCambiarEstado(reproduciendo).
//
// Forma común: { reproducir(), pausar(), alternar(), ir(t), tiempo(), reproduciendo(), ponerVelocidad(v),
//               ponerSoloPasos(segmentos | null), destruir() }

import { saltoSoloPasos } from "./sincronia.js";

// Tic de 50 ms con setTimeout y no requestAnimationFrame: rAF se detiene cuando el navegador no pinta la página
// (panel oculto, pestaña de fondo) y la reproducción quedaría congelada; el tiempo se mide con performance.now(),
// así un tic atrasado no desfasa el reloj. Solo se actualizan textos y atributos, no hay animación que suavizar.
const TIC = 50;
const programar = (funcion) => setTimeout(() => funcion(performance.now()), TIC);
const cancelar = (id) => clearTimeout(id);

/**
 * @param {{ fin: number, alAvanzar: (t: number) => void, alCambiarEstado: (reproduciendo: boolean) => void }} opciones
 */
export function crearRelojVirtual({ fin, alAvanzar, alCambiarEstado }) {
  let t = 0;
  let velocidad = 1;
  let activo = false;
  let cuadro = 0;
  let ultimo = 0;

  function paso(ahora) {
    const delta = Math.max(0, (ahora - ultimo) / 1000);
    ultimo = ahora;
    t = Math.min(fin, t + delta * velocidad);
    alAvanzar(t);
    if (t >= fin) {
      detener();
      return;
    }
    cuadro = programar(paso);
  }

  function detener() {
    cancelar(cuadro);
    if (!activo) return;
    activo = false;
    alCambiarEstado(false);
  }

  const reloj = {
    reproducir() {
      if (activo || fin <= 0) return;
      if (t >= fin - 0.05) {
        t = 0;
        alAvanzar(t);
      }
      activo = true;
      alCambiarEstado(true);
      ultimo = performance.now();
      cuadro = programar(paso);
    },
    pausar: detener,
    alternar() {
      if (activo) reloj.pausar();
      else reloj.reproducir();
    },
    /** Lleva el reloj a `nuevo` sin avisar (quien llama ya sabe dónde está). */
    ir(nuevo) {
      t = Math.min(fin, Math.max(0, Number(nuevo) || 0));
      ultimo = performance.now();
    },
    tiempo: () => t,
    reproduciendo: () => activo,
    ponerVelocidad(v) {
      velocidad = v;
    },
    ponerSoloPasos() {},
    destruir() {
      cancelar(cuadro);
      activo = false;
    },
  };
  return reloj;
}

/**
 * @param {HTMLVideoElement} video
 * @param {{ desfase?: number, alAvanzar: (t: number) => void, alCambiarEstado: (reproduciendo: boolean) => void,
 *           senal: AbortSignal }} opciones
 */
export function crearReproductorDeVideo(video, { desfase = 0, alAvanzar, alCambiarEstado, senal }) {
  let segmentos = null;
  let cuadro = 0;
  let velocidad = 1;
  // Oyentes propios: se quitan al destruir este reproductor aunque el <video> siga en la página.
  const controlador = new AbortController();
  senal?.addEventListener("abort", () => controlador.abort(), { once: true });
  const opciones = { signal: controlador.signal };
  const tiempo = () => Math.max(0, (video.currentTime || 0) - desfase);

  function revisarSoloPasos() {
    if (!segmentos || video.paused) return;
    const destino = saltoSoloPasos(segmentos, tiempo());
    if (destino === null) video.pause();
    else if (destino - tiempo() > 0.05) video.currentTime = destino + desfase;
  }

  function seguir() {
    revisarSoloPasos();
    alAvanzar(tiempo());
    if (!video.paused) cuadro = programar(seguir);
  }

  video.addEventListener("play", () => {
    alCambiarEstado(true);
    cancelar(cuadro);
    cuadro = programar(seguir);
  }, opciones);
  video.addEventListener("pause", () => {
    cancelar(cuadro);
    alCambiarEstado(false);
  }, opciones);
  // Cargar un src nuevo vuelve playbackRate a defaultPlaybackRate: se ponen los dos y se repite al tener metadatos.
  const aplicarVelocidad = () => {
    video.defaultPlaybackRate = velocidad;
    video.playbackRate = velocidad;
  };
  video.addEventListener("loadedmetadata", aplicarVelocidad, opciones);
  // Con el video detenido (al saltar con la línea de tiempo), timeupdate mantiene todo al día.
  video.addEventListener("timeupdate", () => video.paused && alAvanzar(tiempo()), opciones);

  const reproductor = {
    reproducir() {
      if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.05)) video.currentTime = 0;
      video.play().catch(() => alCambiarEstado(false));
    },
    pausar: () => video.pause(),
    alternar() {
      if (video.paused) reproductor.reproducir();
      else reproductor.pausar();
    },
    ir(nuevo) {
      const destino = Math.max(0, (Number(nuevo) || 0) + desfase);
      if (Math.abs(video.currentTime - destino) > 0.05) video.currentTime = destino;
    },
    tiempo,
    reproduciendo: () => !video.paused,
    ponerVelocidad(v) {
      velocidad = v;
      aplicarVelocidad();
    },
    ponerSoloPasos(nuevos) {
      segmentos = nuevos;
    },
    destruir() {
      controlador.abort();
      cancelar(cuadro);
      video.pause();
    },
  };
  return reproductor;
}
