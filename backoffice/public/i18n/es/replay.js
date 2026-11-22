// Sección "replay" (dueño: WP4). Textos del visor paso a paso de un intento: pasos, captura, análisis y línea de
// tiempo. Mismo árbol de claves que i18n/en/replay.js. Los datos de la corrida (expectativas, justificaciones,
// títulos) no pasan por aquí: se muestran tal cual.

export default {
  tituloDocumento: "Replay · {nombre}",

  pasos: {
    titulo: "Pasos",
    etiqueta: "Pasos del intento",
    opcion: "Paso {n}: {firma}",
    saleDeLaRuta: "sale de la ruta",
  },

  captura: {
    alt: "Pantalla después del paso {n}",
    altInicio: "Pantalla inicial del intento",
    sinCaptura: "No hay captura de este paso.",
    etiqueta: "Captura del paso",
  },

  analisis: {
    esperaba: "Qué esperaba",
    noLoDijo: "No lo dijo.",
    quedo: "Dónde quedó",
    sinPagina: "Una página que no se pudo ubicar.",
    fin: "Fin del intento: {motivo}.",
    declaroEn: "dijo que terminó en «{pagina}»",
    sinNota: "El juez no dejó una nota.",
    sinJuez: "Sin juez: el resultado sale de si llegó a la página final de la ruta de la Guía.",
    sinMedir: "Sin ruta de la Guía ni juez: el resultado no se mide.",
    sinPasos: "Este intento no tiene pasos.",
  },

  fin: {
    titulo: "Por qué terminó así",
    enRuta: "«{pagina}»",
    fueraDeRuta: "«{pagina}», fuera de la ruta",
  },

  animacion: {
    volver: "Volver a «{pagina}»",
  },

  linea: {
    etiqueta: "Línea de tiempo",
    reproducir: "Reproducir",
    pausar: "Pausar",
    posicion: "Paso {n} de {total}",
    velocidad: "Velocidad",
    velocidadAyuda: "Velocidad de reproducción (más lenta / más rápida)",
    velocidadValor: "{v}×",
  },
};
