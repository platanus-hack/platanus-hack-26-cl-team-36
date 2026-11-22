// Section "replay" (owner: WP4). Texts of the step-by-step viewer of one attempt: steps, capture, analysis and
// timeline. Same key tree as i18n/es/replay.js. Run data (expectations, justifications, titles) does not go through
// here: it is shown as-is.

export default {
  tituloDocumento: "Replay · {nombre}",

  pasos: {
    titulo: "Steps",
    etiqueta: "Steps of the attempt",
    opcion: "Step {n}: {firma}",
    saleDeLaRuta: "leaves the route",
  },

  captura: {
    alt: "Screen after step {n}",
    altInicio: "Starting screen of the attempt",
    sinCaptura: "There is no capture for this step.",
    etiqueta: "Step screenshot",
  },

  analisis: {
    esperaba: "What it expected",
    noLoDijo: "It didn't say.",
    quedo: "Where it ended up",
    sinPagina: "A page that could not be located.",
    fin: "End of the attempt: {motivo}.",
    declaroEn: "said it was done on «{pagina}»",
    sinNota: "The judge left no note.",
    sinJuez: "No judge: the result is whether it reached the final page of the Guide’s route.",
    sinMedir: "No Guide route nor judge: the result is not measured.",
    sinPasos: "This attempt has no steps.",
  },

  fin: {
    titulo: "Why it ended this way",
    enRuta: "“{pagina}”",
    fueraDeRuta: "“{pagina}”, off the route",
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
