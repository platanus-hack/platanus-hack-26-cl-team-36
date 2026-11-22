// GET /api/vivo/<revision>/<goal> por SSE: eventos de lib/eventos.js, `event: ruta`, `event: listo` (lo conocido al
// conectar ya salió), `event: fin` (y cierre), `: ping`.

import { crearSeguimiento, eventosDelGoal, goalTerminado, rutaDeLaGuia } from "./eventos.js";

const mensaje = ({ id, evento, datos }) => `${id ? `id: ${id}\n` : ""}${evento ? `event: ${evento}\n` : ""}data: ${JSON.stringify(datos)}\n\n`;

/**
 * Un sondeador por revisión y goal, compartido por sus conexiones: lee el almacén una vez por tic y deja de sondear
 * cuando no queda nadie. `tope`: conexiones abiertas a la vez.
 * @param {{ revisiones: { leerGoal: Function } | null, cabeceras?: object, intervaloMs?: number, latidoMs?: number, tope?: number }} opciones
 */
export function crearTransmisor({ revisiones, cabeceras = {}, intervaloMs = 2000, latidoMs = 15000, tope = 20 }) {
  let abiertas = 0;
  const sondeadores = new Map();

  function sondeadorDe(revision, goal, lectura) {
    const clave = `${revision}\n${goal}`;
    if (sondeadores.has(clave)) return sondeadores.get(clave);
    const sondeador = { ultima: lectura, suscriptores: new Set(), enVuelo: false };
    sondeador.intervalo = setInterval(async () => {
      // Un sondeo lento (S3) no se pisa con el siguiente.
      if (sondeador.enVuelo) return;
      sondeador.enVuelo = true;
      try {
        const nueva = await revisiones.leerGoal(revision, goal);
        if (nueva) sondeador.ultima = nueva;
        for (const suscriptor of [...sondeador.suscriptores]) suscriptor(nueva);
      } catch (error) {
        console.error(`vivo: no se pudo leer «${revision}/${goal}».`, error);
      } finally {
        sondeador.enVuelo = false;
      }
    }, intervaloMs);
    sondeador.soltar = (suscriptor) => {
      sondeador.suscriptores.delete(suscriptor);
      if (sondeador.suscriptores.size || sondeadores.get(clave) !== sondeador) return;
      clearInterval(sondeador.intervalo);
      sondeadores.delete(clave);
    };
    sondeadores.set(clave, sondeador);
    return sondeador;
  }

  return async function transmitir(req, res, revision, goal, responderJson) {
    if (abiertas >= tope) return responderJson(res, 503, { error: "Demasiadas conexiones en vivo" });
    abiertas += 1;
    let leido;
    try {
      leido = sondeadores.get(`${revision}\n${goal}`)?.ultima ?? (revisiones ? await revisiones.leerGoal(revision, goal) : null);
    } catch (error) {
      abiertas -= 1;
      throw error;
    }
    // El cliente pudo cortar mientras se leía: su `close` ya pasó.
    if (req.destroyed || res.destroyed) {
      abiertas -= 1;
      return;
    }
    if (!leido) {
      abiertas -= 1;
      return responderJson(res, 404, { error: "No existe ese goal en esa revisión" });
    }
    const ultimoId = req.headers["last-event-id"] ?? null;
    // Reconexión a un goal terminado sin nada pendiente: 204 para que EventSource no reintente (el cliente cierra al recibir `fin`).
    const nadaPendiente = ultimoId && goalTerminado(leido) && !crearSeguimiento(ultimoId)(eventosDelGoal(leido)).length;
    if (req.method === "HEAD" || nadaPendiente) {
      abiertas -= 1;
      res.writeHead(req.method === "HEAD" ? 200 : 204, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", ...cabeceras });
      return res.end();
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // Sin esto, un proxy (nginx, el balanceador) junta los mensajes y llegan de a montones.
      "X-Accel-Buffering": "no",
      ...cabeceras,
    });
    res.flushHeaders();

    const nuevos = crearSeguimiento(ultimoId);
    let ruta = null;
    let cerrada = false;
    let sondeador = null;
    const latido = setInterval(() => res.write(": ping\n\n"), latidoMs);

    const cerrar = () => {
      if (cerrada) return;
      cerrada = true;
      clearInterval(latido);
      sondeador?.soltar(enviar);
      abiertas -= 1;
      res.end();
    };

    function enviar(lectura, inicial = false) {
      if (cerrada) return;
      if (!lectura) return cerrar();
      for (const evento of nuevos(eventosDelGoal(lectura))) res.write(mensaje({ id: evento.id, datos: evento }));
      const rutaNueva = rutaDeLaGuia(lectura.goal.guide);
      if (rutaNueva && JSON.stringify(rutaNueva) !== ruta) {
        ruta = JSON.stringify(rutaNueva);
        res.write(mensaje({ evento: "ruta", datos: rutaNueva }));
      }
      // El cliente dibuja de una vez lo que llegó antes de `listo` y anima lo que llega después.
      if (inicial) res.write(mensaje({ evento: "listo", datos: { revision, goal } }));
      if (goalTerminado(lectura)) {
        res.write(mensaje({ evento: "fin", datos: { revision, goal, estado: lectura.goal.visitor.estado } }));
        cerrar();
      }
    }

    req.on("close", cerrar);
    res.on("close", cerrar);
    enviar(leido, true);
    if (cerrada) return;
    sondeador = sondeadorDe(revision, goal, leido);
    sondeador.suscriptores.add(enviar);
  };
}
