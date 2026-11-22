// Sección "vivo" (a goal's live web, #/revisiones/<revision>/<goal>), in English. Same key tree as i18n/es/vivo.js.

export default {
  titulo: "{goal} live",
  subtitulo: "This goal's agents show up on the map as they move.",
  estado: {
    conectando: "Connecting…",
    enVivo: "Live",
    reconectando: "Reconnecting…",
    terminado: "Finished",
    error: "Disconnected",
  },
  terminado: {
    conTanda: "The Visitor finished. Its batch has the full path map and the replay of every attempt.",
    esperandoTanda: "The Visitor finished; its batch shows up in a few seconds.",
    sinTanda: "The goal finished without a Visitor batch.",
    verTanda: "Open the batch",
  },
  riel: {
    titulo: "Goals",
    fase: { ruta: "Route", visita: "Live", tanda: "Done", fallido: "Failed", espera: "Queued" },
  },
  sinConexion: "The live stream was cut.",
  noExiste: "Goal «{goal}» doesn't exist in review «{revision}».",
  volver: "Back to the review",
};
