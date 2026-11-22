// Animación del camaleón del interruptor ON/OFF (solo visual; todo lo que se ve está en interruptor.css).
//
// popup.js pone `body[data-activo]` = "cargando" | "si" | "no". Este módulo:
// - Observa ese atributo y, cuando pasa de "no" a "si" o al revés, pone en `.mt-control` una clase
//   temporal (`mt-despertando` / `mt-durmiendo`) que interruptor.css anima. La primera pintura
//   ("cargando" → estado leído) no anima la transformación: solo muestra el estado. Con los efectos
//   «sutiles» (`body[data-efectos]`, lo pone popup.js) la clase es `mt-cambio-sutil`: un fundido corto.
// - Hace que el ojo siga al puntero: pasa la dirección como propiedades personalizadas
//   (`--mt-mirar-x`, `--mt-mirar-y`, entre -1 y 1) y la clase `mt-mirando` mientras se mueve.
// - Le da a cada escama y brillo su índice (`--mt-i`) para escalonar las animaciones.
// Lo único que escribe en `style` son propiedades personalizadas (excepción de extension/CLAUDE.md).

/** Cuánto dura cada transformación (ms); igual que las animaciones más largas de interruptor.css. */
export const DURACION = { despertando: 1700, durmiendo: 1400 };

/** Con los efectos «sutiles» (body[data-efectos], comun/efectos.js) el camaleón solo se funde de un estado al otro. */
export const DURACION_SUTIL = 320;

/**
 * Clase temporal que anima el cambio: la transformación (despertar o dormirse) o, con efectos sutiles, el fundido.
 * @returns {"despertando" | "durmiendo" | "cambio-sutil" | null}
 */
export function claseDeCambio(anterior, nuevo, efectos) {
  const transicion = decidirTransicion(anterior, nuevo);
  if (!transicion) return null;
  return efectos === "sutiles" ? "cambio-sutil" : transicion;
}

/** Tras cuánto rato sin mover el puntero el ojo vuelve a mirar por su cuenta (ms). */
export const PAUSA_MIRADA = 1800;

/**
 * Qué transformación toca al cambiar `data-activo`. Solo entre "no" y "si": desde "cargando" (la
 * primera pintura) o sin cambio real no se anima nada.
 * @returns {"despertando" | "durmiendo" | null}
 */
export function decidirTransicion(anterior, nuevo) {
  if (anterior === "no" && nuevo === "si") return "despertando";
  if (anterior === "si" && nuevo === "no") return "durmiendo";
  return null;
}

/**
 * Hacia dónde mira el ojo: vector de largo 0 a 1 desde el ojo hacia el puntero. Llega a 1 cuando
 * el puntero está a `alcance` px o más; más cerca mira menos de lado (no se pone bizco).
 */
export function direccionMirada(ojo, puntero, alcance = 80) {
  const dx = puntero.x - ojo.x;
  const dy = puntero.y - ojo.y;
  const distancia = Math.hypot(dx, dy);
  if (distancia < 0.5) return { x: 0, y: 0 };
  const largo = Math.min(1, distancia / alcance);
  const redondear = (n) => Math.round(n * 1000) / 1000;
  return { x: redondear((dx / distancia) * largo), y: redondear((dy / distancia) * largo) };
}

// Posición del ojo dentro del viewBox 0 0 128 128 del logo (centro del globo).
const OJO = { x: 95.63 / 128, y: 39.12 / 128 };

function iniciar() {
  const control = document.querySelector(".mt-control");
  const camaleon = document.querySelector(".mt-camaleon");
  if (!control || !camaleon) return;

  for (const selector of [".mt-escama", ".mt-brillo"]) {
    document.querySelectorAll(selector).forEach((el, i) => el.style.setProperty("--mt-i", String(i)));
  }

  // ---------- Transformaciones ----------
  let temporizador = null;
  const terminar = () => {
    control.classList.remove("mt-despertando", "mt-durmiendo", "mt-cambio-sutil");
    temporizador = null;
  };
  new MutationObserver((registros) => {
    for (const { oldValue } of registros) {
      const clase = claseDeCambio(oldValue, document.body.dataset.activo, document.body.dataset.efectos);
      if (!clase) continue;
      clearTimeout(temporizador);
      terminar();
      void control.offsetWidth; // reinicia las animaciones si llega otro cambio a mitad de una
      control.classList.add(`mt-${clase}`);
      temporizador = setTimeout(terminar, DURACION[clase] ?? DURACION_SUTIL);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["data-activo"], attributeOldValue: true });

  // ---------- El ojo sigue al puntero ----------
  const reducido = matchMedia("(prefers-reduced-motion: reduce)");
  let puntero = null;
  let cuadro = 0;
  let quieto = null;
  const dejarDeMirar = () => camaleon.classList.remove("mt-mirando");
  const mirar = () => {
    cuadro = 0;
    if (!puntero) return;
    const caja = camaleon.getBoundingClientRect();
    const ojo = { x: caja.left + caja.width * OJO.x, y: caja.top + caja.height * OJO.y };
    const { x, y } = direccionMirada(ojo, puntero);
    camaleon.style.setProperty("--mt-mirar-x", String(x));
    camaleon.style.setProperty("--mt-mirar-y", String(y));
    camaleon.classList.add("mt-mirando");
  };
  document.addEventListener("pointermove", (evento) => {
    if (reducido.matches || document.body.dataset.activo !== "si") return;
    puntero = { x: evento.clientX, y: evento.clientY };
    if (!cuadro) cuadro = requestAnimationFrame(mirar);
    clearTimeout(quieto);
    quieto = setTimeout(dejarDeMirar, PAUSA_MIRADA);
  });
  document.documentElement.addEventListener("pointerleave", () => {
    puntero = null;
    clearTimeout(quieto);
    dejarDeMirar();
  });
}

if (typeof document !== "undefined") iniciar();
