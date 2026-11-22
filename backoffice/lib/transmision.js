// GET /api/vivo/<revision>/<goal>: los eventos de lib/eventos.js por Server-Sent Events. Al conectar manda todo lo
// conocido; después sondea el almacén (revisiones.leerGoal) y manda solo lo nuevo. Además:
//   event: ruta → [{ url, title }]  la ruta verificada de la Guía, cuando se conoce o cambia
//   event: fin  → { revision, goal, estado }  el Visitante del goal cerró (o la revisión terminó); luego se cierra
//   : ping      cada `latidoMs`, para que un proxy no corte la conexión callada

import { crearSeguimiento, eventosDelGoal, goalTerminado, rutaDeLaGuia } from "./eventos.js";

const mensaje = ({ id, evento, datos }) => `${id ? `id: ${id}\n` : ""}${evento ? `event: ${evento}\n` : ""}data: ${JSON.stringify(datos)}\n\n`;

/**
 * @param {{ revisiones: { leerGoal: Function } | null, cabeceras?: object, intervaloMs?: number, latidoMs?: number,
 *           tope?: number }} opciones
 *        `tope`: conexiones abiertas a la vez; cada una lee la tabla y las trazas del goal una vez por intervalo.
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, revision: string,
 *            goal: string, responderJson: Function) => Promise<void>}
 */
export function crearTransmisor({ revisiones, cabeceras = {}, intervaloMs = 1000, latidoMs = 15000, tope = 20 }) {
  let abiertas = 0;

  return async function transmitir(req, res, revision, goal, responderJson) {
    if (abiertas >= tope) return responderJson(res, 503, { error: "Demasiadas conexiones en vivo" });
    abiertas += 1;
    let leido;
    try {
      leido = revisiones ? await revisiones.leerGoal(revision, goal) : null;
    } catch (error) {
      abiertas -= 1;
      throw error;
    }
    if (!leido) {
      abiertas -= 1;
      return responderJson(res, 404, { error: "No existe ese goal en esa revisión" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Sin esto, un proxy (nginx, el balanceador) junta los mensajes y llegan de a montones.
      "X-Accel-Buffering": "no",
      ...cabeceras,
    });
    if (req.method === "HEAD") {
      abiertas -= 1;
      return res.end();
    }
    res.flushHeaders();

    const nuevos = crearSeguimiento(req.headers["last-event-id"] ?? null);
    let ruta = null;
    let cerrada = false;
    let enVuelo = false;
    let sondeo;
    let latido;

    const cerrar = () => {
      if (cerrada) return;
      cerrada = true;
      clearInterval(sondeo);
      clearInterval(latido);
      abiertas -= 1;
      res.end();
    };

    const enviar = (lectura) => {
      for (const evento of nuevos(eventosDelGoal(lectura))) res.write(mensaje({ id: evento.id, datos: evento }));
      const rutaNueva = rutaDeLaGuia(lectura.goal.guide);
      if (rutaNueva && JSON.stringify(rutaNueva) !== ruta) {
        ruta = JSON.stringify(rutaNueva);
        res.write(mensaje({ evento: "ruta", datos: rutaNueva }));
      }
      if (goalTerminado(lectura)) {
        res.write(mensaje({ evento: "fin", datos: { revision, goal, estado: lectura.goal.visitor.estado } }));
        cerrar();
      }
    };

    // Un sondeo lento (S3) no se pisa con el siguiente: si sigue en vuelo, ese turno se salta.
    const sondear = async () => {
      if (enVuelo || cerrada) return;
      enVuelo = true;
      try {
        const lectura = await revisiones.leerGoal(revision, goal);
        if (lectura && !cerrada) enviar(lectura);
      } catch (error) {
        console.error(`vivo: no se pudo leer «${revision}/${goal}».`, error);
      } finally {
        enVuelo = false;
      }
    };

    req.on("close", cerrar);
    enviar(leido);
    if (cerrada) return;
    sondeo = setInterval(sondear, intervaloMs);
    latido = setInterval(() => res.write(": ping\n\n"), latidoMs);
  };
}
