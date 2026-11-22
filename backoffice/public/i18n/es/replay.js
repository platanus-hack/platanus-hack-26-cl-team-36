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
    duracion: "Duración del paso",
    pasoCorto: "paso {n}",
    pasoEn: "paso {n} · {pagina}",
    fuera: "fuera de la ruta",
    rutaGuia: "Ruta de la Guía",
    rutaTelarana: "Ruta recomendada",
    paginasAlcanzadas: "{n}/{de} páginas",
    sinRuta: "Sin ruta de la Guía: no hay contra qué comparar el camino.",
    desvios: ({ n }, { plural }) => `${n} ${plural(n, { one: "desvío", other: "desvíos" })}`,
    yMas: "+{n}",
    paginaFinal: "Página final de la ruta",
    sinLlegar: "(sin llegar)",
    esperaba: "Qué esperaba",
    noLoDijo: "No lo dijo.",
    quedo: "Dónde quedó",
    seQuedo: "Se quedó en «{pagina}».",
    sinPagina: "Una página que no se pudo ubicar.",
    corte: "Después de este paso falló la herramienta ({titulo}) y el intento no siguió.",
    fin: "Fin del intento: {motivo}.",
    intento: "Intento",
    declaroEn: "dijo que terminó en «{pagina}»",
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
