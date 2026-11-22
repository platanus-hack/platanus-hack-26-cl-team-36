// Fuente en vivo de la telaraña: GET api/vivo/<revision>/<goal> (SSE, lib/transmision.js) con la interfaz de fuente de
// montarTelaranaViva. Abre la conexión al crearse y guarda lo recibido: suscribir() entrega de una vez lo guardado
// (el componente lo dibuja sin animar) y después reenvía lo nuevo. `listo` se cumple con el `event: listo` del
// servidor, que cierra lo conocido al conectar: montar después de esperarlo dibuja el histórico como estado inicial.
//
// estado: "conectando" → "en-vivo" ⇄ "reconectando" → "terminado" (llegó `fin`) | "error" (el servidor no la acepta).

const segmento = (valor) => encodeURIComponent(String(valor));

/**
 * @param {string} revision
 * @param {string} goal
 * @param {{ alRuta?: (ruta: { url: string, title: string }[]) => void, alEstado?: (estado: string) => void,
 *           EventSource?: typeof EventSource, base?: string }} [opciones]
 */
export function fuenteSSE(revision, goal, { alRuta = () => {}, alEstado = () => {}, EventSource: Fuente = globalThis.EventSource, base = "api/vivo" } = {}) {
  const recibidos = [];
  const vistos = new Set();
  let oyente = null;
  let ruta = null;
  let estado = null;
  let avisarListo;
  const listo = new Promise((resolver) => (avisarListo = resolver));

  const conexion = new Fuente(`${base}/${segmento(revision)}/${segmento(goal)}`);

  function cambiar(nuevo) {
    if (estado === nuevo || estado === "terminado" || (estado === "error" && nuevo !== "terminado")) return;
    estado = nuevo;
    alEstado(nuevo);
  }

  function cerrarConexion(final) {
    conexion.close();
    cambiar(final);
    avisarListo();
  }

  cambiar("conectando");
  conexion.addEventListener("open", () => cambiar("en-vivo"));
  conexion.addEventListener("message", (mensaje) => {
    let evento;
    try {
      evento = JSON.parse(mensaje.data);
    } catch {
      return;
    }
    const id = evento?.id ?? mensaje.lastEventId;
    if (!id || vistos.has(id)) return;
    vistos.add(id);
    recibidos.push(evento);
    oyente?.(evento);
  });
  conexion.addEventListener("ruta", (mensaje) => {
    try {
      ruta = JSON.parse(mensaje.data);
    } catch {
      return;
    }
    alRuta(ruta);
  });
  conexion.addEventListener("listo", () => avisarListo());
  // Sin cerrar, EventSource volvería a conectarse cuando el servidor corta tras `fin`.
  conexion.addEventListener("fin", () => cerrarConexion("terminado"));
  conexion.addEventListener("error", () => {
    // CONNECTING: corte de red, EventSource reintenta solo (con Last-Event-ID). CLOSED: 404, 503 o 204, no reintenta.
    if (conexion.readyState === Fuente.CLOSED) cerrarConexion("error");
    else cambiar("reconectando");
  });

  function cerrar() {
    oyente = null;
    conexion.close();
    avisarListo();
  }

  return {
    listo,
    get ruta() {
      return ruta;
    },
    get estado() {
      return estado;
    },
    suscribir(cb) {
      for (const evento of recibidos) cb(evento);
      oyente = cb;
      return { cerrar };
    },
    cerrar,
  };
}
