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
    senales: "Signals",
    sinSenales: "No signals: nothing unusual in this step.",
    senal: {
      no_effect: "The action changed nothing on screen.",
      went_back: "Went back to the previous page.",
      visible_error: "The page showed an error message.",
      security_block: "The site blocked the user (captcha or security check).",
      revisit: "Went back to a page it had already seen.",
    },
    fueraDeRuta: "This page is not on the recommended route.",
    esperaba: "What it expected",
    noLoDijo: "It didn't say.",
    loQuePaso: "What happened",
    pagina: "Where it ended up",
    corte: "After this step the tool failed ({titulo}) and the attempt stopped.",
    fin: "End of the attempt: {motivo}.",
    juez: "Judge's note",
    sinNota: "The judge left no note.",
    errorIntento: "This attempt doesn't count in the figures: the tool failed, not the user.",
    sinPasos: "This attempt has no steps.",
    cortadoAntes: "The attempt stopped before the first step.",
  },

  linea: {
    etiqueta: "Timeline",
    reproducir: "Play",
    pausar: "Pause",
    posicion: "Step {n} of {total}",
  },
};
