// Una tanda terminada como fuente de eventos v1 para la telaraña viva: cada intento es un agente que parte en su
// página de inicio, da sus pasos y termina con su resultado. Sin reproducir, entrega todo de una vez (el estado
// final); reproduciendo, cada evento a su hora real desde el inicio de la tanda. Puro salvo los temporizadores.

const FINAL_DEL_RESULTADO = { logrado: "success", fallido: "failed", abandonado: "abandoned", sin_medir: "unmeasured", error: "error" };

const pagina = (url, titulo) => ({ url: String(url ?? ""), title: String(titulo ?? "") });

/** La ruta recomendada de la tanda como páginas { url, title } (vacía si no tiene). */
export function rutaDeTanda(tanda) {
  const paginas = new Map((tanda?.telarana?.paginas ?? []).map((p) => [p.id, p]));
  return (tanda?.telarana?.ruta?.paginas ?? []).map((id) => paginas.get(id)).filter(Boolean).map((p) => pagina(p.url, p.titulo));
}

/** Los eventos v1 de una tanda, en orden de ts. Los intentos corren a la vez: todos parten al inicio de la tanda. */
export function eventosDeTanda(tanda) {
  const base = Date.parse(tanda?.fechaIso ?? "") || 0;
  const comun = { v: 1, revision: null, host: tanda?.host ?? null, goal: tanda?.tarea ?? null, agent: "visitor" };
  const eventos = [];
  for (const intento of tanda?.intentos ?? []) {
    const primero = intento.pasos?.[0];
    const inicio = intento.inicio ? pagina(intento.inicio.url, intento.inicio.titulo) : primero ? pagina(primero.urlAntes, primero.tituloAntes) : null;
    if (!inicio?.url) continue;
    const run = `${tanda.id}|${intento.id}`;
    const propio = { ...comun, run_id: run, attempt: intento.id };
    let ms = base;
    const a = (segundos) => (ms = Math.max(ms, base + (Number.isFinite(segundos) ? segundos : (ms - base) / 1000) * 1000));
    const evento = (type, step, extra) => ({ id: `${run}|${step}|${type}`, ...propio, ts: new Date(ms).toISOString(), type, step, signals: [], ...extra });
    eventos.push(evento("start", 0, { node: inicio }));
    let ultima = inicio;
    let numero = 0;
    for (const paso of intento.pasos ?? []) {
      numero = Number.isInteger(paso.numero) ? paso.numero : numero + 1;
      a(paso.segundos);
      const atras = (paso.senales ?? []).includes("went_back");
      ultima = pagina(paso.url, paso.titulo);
      eventos.push(
        evento("step", numero, {
          action: atras ? "go_back" : paso.accion,
          from: pagina(paso.urlAntes, paso.tituloAntes),
          node: ultima,
          signals: [...(paso.senales ?? [])],
        }),
      );
    }
    a(intento.duracion);
    eventos.push(evento("end", numero, { node: ultima, outcome: FINAL_DEL_RESULTADO[intento.resultado] ?? "failed", end_reason: intento.motivoDeFin ?? "" }));
  }
  // sort es estable: a igual ts, el orden de cada intento se conserva.
  return eventos.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
}

/**
 * @param {object} tanda   la tanda de GET /api/tandas/<id>
 * @param {{ reproducir?: boolean, ahora?: () => number }} opciones
 * @returns {{ suscribir(cb: (evento: object) => void): { cerrar(): void, velocidad?(v: number): void } }}
 */
export function fuenteDeTanda(tanda, { reproducir = false, ahora = () => performance.now() } = {}) {
  const eventos = eventosDeTanda(tanda);
  return {
    suscribir(cb) {
      if (!reproducir) {
        for (const evento of eventos) cb(evento);
        return { cerrar() {} };
      }
      const cero = eventos.length ? Date.parse(eventos[0].ts) : 0;
      let i = 0;
      let reloj = 0;
      let vel = 1;
      let previo = ahora();
      let temporizador = null;
      const avanzar = () => {
        const t = ahora();
        reloj += (t - previo) * vel;
        previo = t;
      };
      const tic = () => {
        temporizador = null;
        avanzar();
        while (i < eventos.length && Date.parse(eventos[i].ts) - cero <= reloj) cb(eventos[i++]);
        if (i < eventos.length) temporizador = setTimeout(tic, 50);
      };
      tic();
      return {
        cerrar() {
          clearTimeout(temporizador);
          i = eventos.length;
        },
        velocidad(v) {
          avanzar();
          vel = v;
        },
      };
    },
  };
}
