/**
 * Latido: mientras dura una generación, la pestaña le escribe al script de fondo cada cierto
 * tiempo para que Firefox no lo descargue por inactividad. Esta función se inyecta con
 * `scripting.executeScript`, así que debe bastarse sola.
 *
 * @param {string} idSolicitud
 * @param {number} intervaloMs
 * @param {number} duracionMaximaMs
 */
export function iniciarLatido(idSolicitud, intervaloMs, duracionMaximaMs) {
  const estado = /** @type {{ __latidoPieles?: string }} */ (globalThis);
  if (estado.__latidoPieles === idSolicitud) return;
  estado.__latidoPieles = idSolicitud;
  const inicio = Date.now();
  let fallos = 0;

  const detener = () => {
    clearInterval(temporizador);
    if (estado.__latidoPieles === idSolicitud) delete estado.__latidoPieles;
  };

  const latir = async () => {
    if (estado.__latidoPieles !== idSolicitud || Date.now() - inicio > duracionMaximaMs) {
      detener();
      return;
    }
    try {
      const respuesta = await browser.runtime.sendMessage({ tipo: "latido", id_solicitud: idSolicitud });
      fallos = 0;
      if (!respuesta?.seguir) detener();
    } catch {
      fallos += 1;
      if (fallos >= 3) detener();
    }
  };

  const temporizador = setInterval(latir, intervaloMs);
}
