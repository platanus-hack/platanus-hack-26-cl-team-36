// Sección "vivo" (la telaraña en vivo de un goal, #/revisiones/<revision>/<goal>). Mismo árbol de claves que
// i18n/en/vivo.js.

export default {
  titulo: "{goal} en vivo",
  subtitulo: "Los agentes de este goal aparecen en el mapa a medida que avanzan.",
  estado: {
    conectando: "Conectando…",
    enVivo: "En vivo",
    reconectando: "Reconectando…",
    terminado: "Terminado",
    error: "Sin conexión",
  },
  terminado: {
    conTanda: "El Visitante terminó. Su tanda tiene el mapa de caminos completo y el replay de cada intento.",
    esperandoTanda: "El Visitante terminó; su tanda aparece en unos segundos.",
    sinTanda: "El goal terminó sin tanda del Visitante.",
    verTanda: "Ver la tanda",
  },
  riel: {
    titulo: "Goals",
    fase: { ruta: "Ruta", visita: "En vivo", tanda: "Listo", fallido: "Falló", espera: "En cola" },
  },
  sinConexion: "Se cortó la transmisión en vivo.",
  noExiste: "No existe el goal «{goal}» en la revisión «{revision}».",
  volver: "Volver a la revisión",
};
