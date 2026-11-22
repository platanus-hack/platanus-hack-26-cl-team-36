// Section "replay" (owner: WP4). Texts of the step-by-step viewer of one attempt: steps, capture, analysis and
// timeline. Same key tree as i18n/es/replay.js. Run data (expectations, justifications, titles) does not go through
// here: it is shown as-is.

export default {
  tituloDocumento: "Replay · {nombre}",

  pasos: {
    titulo: "Steps",
    etiqueta: "Steps of the attempt",
    intento: "Attempt",
    opcion: "Step {n}: {firma}",
  },

  captura: {
    alt: "Screen after step {n}",
    altInicio: "Starting screen of the attempt",
    sinCaptura: "There is no capture for this step.",
  },

  analisis: {
    titulo: "Analysis",
    paso: "Step {n}",
    duracion: "Step duration",
    pasoCorto: "step {n}",
    pasoEn: "step {n} · {pagina}",
    fuera: "off the route",
    rutaGuia: "Guide's route",
    rutaTelarana: "Recommended route",
    paginasAlcanzadas: "{n}/{de} pages",
    sinRuta: "No Guide route: there is nothing to compare the path against.",
    desvios: ({ n }, { plural }) => `${n} ${plural(n, { one: "detour", other: "detours" })}`,
    yMas: "+{n}",
    paginaFinal: "Final page of the route",
    sinLlegar: "(not reached)",
    esperaba: "What it expected",
    noLoDijo: "It didn't say.",
    quedo: "Where it ended up",
    seQuedo: "Stayed on «{pagina}».",
    sinPagina: "A page that could not be located.",
    corte: "After this step the tool failed ({titulo}) and the attempt stopped.",
    fin: "End of the attempt: {motivo}.",
    intento: "Attempt",
    declaroEn: "said it was done on «{pagina}»",
    sinNota: "The judge left no note.",
    sinJuez: "No judge: the result is whether it reached the final page of the Guide’s route.",
    sinMedir: "No Guide route nor judge: the result is not measured.",
    errorIntento: "This attempt doesn't count in the figures: the tool failed, not the user.",
    sinPasos: "This attempt has no steps.",
    cortadoAntes: "The attempt stopped before the first step.",
  },

  animacion: {
    volver: "Back to «{pagina}»",
  },

  linea: {
    etiqueta: "Timeline",
    reproducir: "Play",
    pausar: "Pause",
    posicion: "Step {n} of {total}",
    velocidad: "Speed",
    velocidadAyuda: "Playback speed (slower / faster)",
    velocidadValor: "{v}×",
  },
};
