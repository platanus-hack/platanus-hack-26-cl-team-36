// Sección "replay" (dueño: WP4). Textos del visor paso a paso de un intento: pasos, captura, análisis y línea de
// tiempo. Mismo árbol de claves que i18n/en/replay.js. Los datos de la corrida (expectativas, justificaciones,
// títulos) no pasan por aquí: se muestran tal cual.

export default {
  tituloDocumento: "Replay · {nombre}",

  pasos: {
    titulo: "Pasos",
    etiqueta: "Pasos del intento",
    intento: "Intento",
    opcion: "Paso {n}: {firma}",
  },

  captura: {
    alt: "Pantalla después del paso {n}",
    altInicio: "Pantalla inicial del intento",
    sinCaptura: "No hay captura de este paso.",
  },

  analisis: {
    titulo: "Análisis",
    paso: "Paso {n}",
    senales: "Señales",
    sinSenales: "Sin señales: nada raro en este paso.",
    senal: {
      no_effect: "La acción no cambió nada en la pantalla.",
      went_back: "Volvió a la página anterior.",
      visible_error: "La página mostró un mensaje de error.",
      security_block: "El sitio bloqueó al usuario (captcha o control de seguridad).",
      revisit: "Volvió a una página que ya había visto.",
    },
    fueraDeRuta: "Esta página no está en la ruta recomendada.",
    esperaba: "Qué esperaba",
    noLoDijo: "No lo dijo.",
    loQuePaso: "Qué pasó",
    pagina: "Dónde quedó",
    corte: "Después de este paso falló la herramienta ({titulo}) y el intento no siguió.",
    fin: "Fin del intento: {motivo}.",
    juez: "Nota del juez",
    juezRuta: "Medido contra la ruta de la Guía",
    juezSinMedir: "Por qué no se midió",
    sinNota: "El juez no dejó una nota.",
    sinJuez: "Sin juez: el resultado sale de si llegó a la página final de la ruta de la Guía.",
    sinMedir: "Sin ruta de la Guía ni juez: el resultado no se mide.",
    errorIntento: "Este intento no cuenta en las cifras: falló la herramienta, no el usuario.",
    sinPasos: "Este intento no tiene pasos.",
    cortadoAntes: "El intento se cortó antes del primer paso.",
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
