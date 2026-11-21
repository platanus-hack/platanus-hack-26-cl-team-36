// Section "replay" (owner: WP4). Texts of the step-by-step viewer of one attempt. Same key tree as
// i18n/es/replay.js. Run data (expectations, justifications, titles, route actions) does not go through here: it
// is shown as-is.

export default {
  titulo: "Replay of “{nombre}”",
  tituloDocumento: "Replay · {nombre}",

  cabecera: {
    intentos: "Attempts in this batch",
    intento: "{nombre}: {resultado}",
    pasos: ({ n, ruta }, { plural }) => {
      const base = `${n} ${plural(n, { one: "step", other: "steps" })}`;
      return ruta === null || ruta === undefined || ruta === "" ? base : `${base} (route ${ruta})`;
    },
    pasosAyuda: "Steps of this attempt and, in brackets, those of the recommended route",
    duracionAyuda: "How long the attempt took",
    viewport: "{ancho}×{alto}",
    viewportAyuda: "Size of the browser window",
  },

  veredicto: {
    mostrar: "Verdict and criterion",
    justificacion: "What the judge said",
    respuesta: "The user’s answer",
    sinRespuesta: "It left no answer.",
    motivo: "How it ended",
    criterio: "The judge’s criterion",
    evidencias: "Evidence the judge looks for",
    notaEvidencias: "The judge gives one verdict per attempt; it does not mark each piece of evidence.",
    sinCriterio: "This batch did not save the judge’s criterion.",
  },

  error: {
    explicacion: "This attempt does not count in the figures: the tool failed, not the user. The steps shown did happen.",
    corte: "After this step the tool failed ({titulo}) and the attempt did not go on.",
    sinPasos: "The attempt stopped before the first step.",
  },

  rail: {
    titulo: "Steps",
    etiqueta: "Steps of the attempt",
    soloSenales: "Only with signals",
    soloSenalesAyuda: "Show only the steps with a signal or off the route",
    ningunoConSenales: "No step has signals or leaves the route.",
    repetido: ({ firma, n }, { plural }) => `${firma} · ${n} ${plural(n, { one: "time", other: "times" })}`,
    opcion: "Step {n}: {firma}",
    opcionRepetida: "Steps {desde} to {hasta}: {firma}",
  },

  visor: {
    fuente: "What to show",
    capturas: "Screenshots",
    video: "Video",
    modos: "Comparison mode",
    despues: "After",
    antes: "Before",
    deslizar: "Slide",
    superponer: "Overlay",
    mantenB: "Hold B",
    mantenBAyuda: "Show “Before” while you hold it",
    verEnTelarana: "See in the route map",
    deslizarEtiqueta: "Slide between before and after",
    superponerEtiqueta: "Opacity of “After” over “Before”",
    altAntes: "Screen before step {n}",
    altDespues: "Screen after step {n}",
    altInicio: "Starting screen of the attempt",
    sinCaptura: "There is no screenshot of this step.",
    clic: "Where step {n} clicked",
    videoEtiqueta: "Video of {nombre}’s attempt",
    videoNoCarga: "The video could not be loaded; showing the screenshots.",
    aLos: "at {tiempo}",
    accionCruda: "Recorded action: {accion}",
    sinPasos: "This attempt has no steps.",
  },

  tarjeta: {
    titulo: "Step {n}",
    esperaba: "Expected",
    loQuePaso: "What happened",
    noLoDijo: "It did not say.",
    coincide: "Matches (estimated)",
    coincideAyuda: "The backoffice infers it from the signals and the page change; the judge does not assess each step.",
    ruta: "Route",
    usuario: "User",
    rutaAccion: "{accion} → “{destino}”",
    sigueEnPagina: "(stays on the page)",
    fueraDeRuta: "This page is not on the recommended route.",
    terminaRuta: "The route ends here: this is the answer.",
    tramo: "leg {k} of {total}",
    igual: "The user does the same as the route",
    difiere: "The user leaves the route",
    anterior: "Previous",
    siguiente: "Next",
    fin: "End of the attempt: {motivo}.",
  },

  linea: {
    etiqueta: "Timeline",
    reproducir: "Play",
    pausar: "Pause",
    velocidad: "Speed",
    velocidadValor: "{v}×",
    soloPasos: "Steps only",
    soloPasosAyuda: "Skip the parts of the video without actions",
    valor: "{actual} of {total}, step {n}",
    reloj: "{actual} / {total}",
    tira: "Screenshots of each step",
    carril: "Route lane",
  },
};
