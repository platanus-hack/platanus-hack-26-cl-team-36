// Sección `datos` (inglés): los textos de lo que la API entrega como clave + variables. Dueño: WP0.
// Mismo árbol de claves que i18n/es/datos.js; glosario en §5.13 del diseño.

const LISTA = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });
const unir = (nombres) => LISTA.format((Array.isArray(nombres) ? nombres : []).map(String));
const n = (valor) => Number(valor ?? 0) || 0;
const segun = (cuenta, uno, varios) => (cuenta === 1 ? uno : varios);
const pasos = (cuenta) => `${cuenta} ${segun(cuenta, "step", "steps")}`;
const conNota = (frase, nota) => (nota ? frase.replace(/\.$/, ` ${nota}.`) : frase);

export default {
  pagina: {
    inicio: "Home",
    error: "Browser error page",
    // Cuando la tanda tiene más de una página de inicio (sitio.cl y m.sitio.cl).
    inicioDe: "Home · {sitio}",
  },

  error: {
    internal_error: "The evaluator's browser failed",
    api_error: "The model API failed",
    no_response: "The model did not respond",
    refusal: "The model refused to continue",
    juez: "The judge could not give a verdict",
    sin_inicio: "The page could not be opened",
    archivo_danado: "The attempt's file is damaged",
  },

  motivo: {
    done: "finished and answered",
    blocked: "declared itself blocked",
    gave_up: "gave up",
    step_limit: "ran out of actions",
    time_limit: "ran out of time",
    refusal: "the model refused",
    api_error: "API error",
    no_response: "the model did not respond",
    internal_error: "internal error",
    desconocido: "no reason recorded",
  },

  firma: {
    clic: "click «{objetivo}»",
    clic_coordenadas: "click at ({x}, {y})",
    doble_clic: ({ objetivo, x, y }) => (objetivo ? `double click «${objetivo}»` : `double click at (${x ?? "?"}, ${y ?? "?"})`),
    triple_clic: ({ objetivo, x, y }) => (objetivo ? `triple click «${objetivo}»` : `triple click at (${x ?? "?"}, ${y ?? "?"})`),
    desplazar: ({ flecha, cantidad }) => ["scroll", flecha, cantidad ? `×${cantidad}` : ""].filter(Boolean).join(" "),
    escribir: "type «{objetivo}»",
    atras: "go back",
    volver: ({ objetivo }) => (objetivo ? `jump back to «${objetivo}»` : "jump back to a page already seen"),
    tecla: "key {objetivo}",
    otra: ({ original }) => String(original ?? "") || "other action",
  },

  loQuePaso: {
    volvio: "Went back to the previous page.",
    cambioUrl: "Went from {de} to {a}.",
    cambioTitulo: "The page is called «{titulo}».",
    sinCambio: "The screen did not change.",
    cambioParcial: "{porcentaje}% of the screen changed, on the same page.",
    errorVisible: "An error appeared on screen.",
    bloqueoSeguridad: "The evaluator blocked a form submission.",
    detalle: "Detail: {texto}",
    sinRegistro: "No changes recorded.",
  },

  conteos: {
    clic: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "click", "clicks")}`,
    desplazamiento: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "scroll", "scrolls")}`,
    texto: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "text entry", "text entries")}`,
    tecla: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "key press", "key presses")}`,
    otra: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "other action", "other actions")}`,
  },

  hallazgo: {
    resultado: ({ total, validos, logrados, directos, errores, intentos }) => {
      const [t, v, l, d, e] = [n(total), n(validos), n(logrados), n(directos), n(errores)];
      if (t === 0) return "This batch has no recorded attempts.";
      if (v === 0) {
        return `No valid attempts: ${t === 1 ? "the only attempt" : `all ${t} attempts`} failed because of a tool error.`;
      }
      if (l === v) {
        const sujeto = v === 1
          ? (e > 0 ? "The only valid attempt reaches" : "The only attempt reaches")
          : (e > 0 ? `The ${v} valid attempts reach` : `All ${v} reach`);
        let como = " by the recommended route.";
        if (directos === null || directos === undefined) como = "."; // no recommended route
        else if (d === 0) como = v === 1 ? ", but not by the recommended route." : ", none by the recommended route.";
        else if (d < l) como = `; ${l - d} by another way.`;
        return `${sujeto} the answer${como}`;
      }
      if (l === 0) {
        return v === 1 ? "The only valid attempt does not reach the answer." : `None of the ${v} reach the answer.`;
      }
      const faltan = Array.isArray(intentos) ? intentos : [];
      return `${l} of ${v} ${segun(l, "reaches", "reach")} the answer. Did not reach it: ${unir(faltan)}.`;
    },
    errores: ({ intentos }) => {
      const nombres = Array.isArray(intentos) ? intentos : [];
      const sujeto = nombres.length === 1 ? "One attempt does not count" : `${nombres.length} attempts do not count`;
      return `${sujeto}: tool error (${unir(nombres)}).`;
    },
    sinMedir: ({ todos, cuantos, intentos }) => {
      const c = n(cuantos);
      if (todos) return `${c === 1 ? "The only attempt was not measured" : `None of the ${c} attempts was measured`}: there is no Guide route nor judge.`;
      return `${c === 1 ? "One attempt was not measured" : `${c} attempts were not measured`} (no Guide route nor judge): ${unir(intentos)}.`;
    },
    desvio: ({ intento, desdePagina, haciaPagina, paso, vuelveEnPaso }) =>
      `${intento ?? ""} leaves the route at «${desdePagina ?? ""}» towards «${haciaPagina ?? ""}» (step ${n(paso)}) and ` +
      `${vuelveEnPaso === null || vuelveEnPaso === undefined ? "does not come back" : `comes back at step ${vuelveEnPaso}`}.`,
    detenido: ({ intento, pagina, pasos: cuenta, motivo }) =>
      `${intento ?? ""} ends at «${pagina ?? ""}» after ${pasos(n(cuenta))}: ${motivo ?? ""}.`,
    declaro: ({ intento, pagina, pasos: cuenta }) =>
      `${intento ?? ""} said it was done without reaching the route's final page: it stopped at «${pagina ?? ""}» after ${pasos(n(cuenta))}.`,
    demora: ({ intento, pasos: cuenta, pagina, rutaPasos, conteos }) =>
      `${intento ?? ""} takes ${n(cuenta)} steps in a row on «${pagina ?? ""}»` +
      `${rutaPasos === null || rutaPasos === undefined ? "" : ` (the route: ${rutaPasos})`}: ${conteos ?? ""}.`,
    tropiezos: ({ pasos: cuenta, casos }) => {
      const lista = Array.isArray(casos) ? casos : [];
      const detalle = lista.map((caso) => `${caso.intento}, step ${caso.paso} (${String(caso.senal ?? "").toLocaleLowerCase("en")})`);
      const resto = n(cuenta) - lista.length;
      if (resto > 0) detalle.push(`${resto} more`);
      return `${pasos(n(cuenta))} with stumbles${detalle.length ? `: ${detalle.join("; ")}` : ""}.`;
    },
    costo: ({ pasosMediana, pasosIdeales }) =>
      `The median is ${pasos(n(pasosMediana))}; the recommended route takes ${n(pasosIdeales)}.`,
  },

  titular: {
    // Everyone gets there, but someone struggled: the tanda header and Corridas headline does not hide it.
    tanda: ({ validos, errores, caso, intento, pagina, pasos: cuenta, pasosIdeales }) => {
      const [v, e] = [n(validos), n(errores)];
      const sujeto = v === 1
        ? (e > 0 ? "The only valid attempt reaches" : "The only attempt reaches")
        : (e > 0 ? `The ${v} valid attempts reach` : `All ${v} reach`);
      if (caso === "masPasos") {
        return `${sujeto} the answer, but ${intento ?? ""} takes ${pasos(n(cuenta))} (the route: ${n(pasosIdeales)}).`;
      }
      if (caso === "demora") return `${sujeto} the answer, but ${intento ?? ""} takes ${n(cuenta)} steps in a row on «${pagina ?? ""}».`;
      return `${sujeto} the answer, but ${pasos(n(cuenta))} ${segun(n(cuenta), "has", "have")} stumbles.`;
    },
    telarana: ({ hayRuta, enInicio, probabilidad, tramos, pasosIdeales, siguen, validos, medidos, logrados }) => {
      if (!hayRuta && enInicio) return `The task is solved on the start page${probabilidad == null ? "" : ` (the evaluator estimates ${Math.round(probabilidad * 100)}%)`}: the axis is the busiest path.`;
      if (!hayRuta && n(validos) > 0 && medidos !== undefined && n(medidos) === 0) {
        return "Nobody's arrival was measured (no Guide route nor judge): the axis is the busiest path.";
      }
      if (!hayRuta && n(logrados) > 0) return "There is no recommended route to follow: the axis is the busiest path.";
      if (!hayRuta) return "Nobody reached the answer: the axis is the busiest path.";
      const [s, v] = [n(siguen), n(validos)];
      let quienes;
      if (s === v) quienes = v === 1 ? "the only attempt follows it" : `all ${v} follow it`;
      else quienes = `${s} of ${v} ${segun(s, "follows", "follow")} it`;
      return `The recommended route has ${n(tramos)} ${segun(n(tramos), "leg", "legs")} and ${pasos(n(pasosIdeales))}; ${quienes}.`;
    },
    perfiles: ({ caso, intentos, pasos: cuenta, pasosIdeales, perfiles, unoPorPerfil }) => {
      const nombres = Array.isArray(intentos) ? intentos : [];
      const nota = unoPorPerfil ? "(1 attempt per profile)" : "";
      if (caso === "sinValidos") return "No profile has valid attempts.";
      if (caso === "sinMedir") return "It was not measured whether the profiles reach the answer: there is no Guide route nor judge.";
      if (caso === "noLlegan") {
        return conNota(`${unir(nombres)} ${segun(nombres.length, "does", "do")} not reach the answer.`, nota);
      }
      if (caso === "masPasos") {
        return conNota(`${nombres[0] ?? ""} needs ${pasos(n(cuenta))}; the route, ${n(pasosIdeales)}.`, nota);
      }
      const total = n(perfiles);
      const sujeto = total === 1 ? "The only profile reaches" : `All ${total} profiles reach`;
      if (caso === "llegan") return conNota(`${sujeto} the answer.`, nota);
      return conNota(`${sujeto} the answer at a cost similar to the route's.`, nota);
    },
  },
};
