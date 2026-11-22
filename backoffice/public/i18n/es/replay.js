// Sección "replay" (dueño: WP4). Textos del visor paso a paso de un intento. Mismo árbol de claves que
// i18n/en/replay.js. Los datos de la corrida (expectativas, justificaciones, títulos, acciones de la ruta) no
// pasan por aquí: se muestran tal cual.

export default {
  titulo: "Replay de «{nombre}»",
  tituloDocumento: "Replay · {nombre}",

  cabecera: {
    intentos: "Intentos de esta tanda",
    intento: "{nombre}: {resultado}",
    pasos: ({ n, ruta }, { plural }) => {
      const base = `${n} ${plural(n, { one: "paso", other: "pasos" })}`;
      return ruta === null || ruta === undefined || ruta === "" ? base : `${base} (ruta ${ruta})`;
    },
    pasosAyuda: "Pasos de este intento y, entre paréntesis, los de la ruta recomendada",
    duracionAyuda: "Lo que duró el intento",
    viewport: "{ancho}×{alto}",
    viewportAyuda: "Tamaño de la ventana del navegador",
    tarea: "Tarea que leyó:",
    nivel: {
      sin_contexto: "sin contexto",
      conoce_tema: "conoce el tema",
    },
    rechazados: "Términos que no podía escribir: {terminos}",
  },

  veredicto: {
    mostrar: "Veredicto y criterio",
    justificacion: "Lo que dijo el juez",
    respuesta: "Respuesta del usuario",
    sinRespuesta: "No dejó una respuesta.",
    motivo: "Cómo terminó",
    criterio: "Criterio del juez",
    evidencias: "Evidencias que busca el juez",
    notaEvidencias: "El juez da un veredicto por intento; no marca cada evidencia.",
    sinCriterio: "Esta tanda no guardó el criterio del juez.",
  },

  error: {
    explicacion: "Este intento no cuenta en las cifras: falló la herramienta, no el usuario. Los pasos que se ven sí ocurrieron.",
    corte: "Después de este paso falló la herramienta ({titulo}) y el intento no siguió.",
    sinPasos: "El intento se cortó antes del primer paso.",
  },

  rail: {
    titulo: "Pasos",
    etiqueta: "Pasos del intento",
    soloSenales: "Solo con señales",
    soloSenalesAyuda: "Mostrar solo los pasos con una señal o fuera de la ruta",
    ningunoConSenales: "Ningún paso tiene señales ni sale de la ruta.",
    repetido: ({ firma, n }, { plural }) => `${firma} · ${n} ${plural(n, { one: "vez", other: "veces" })}`,
    opcion: "Paso {n}: {firma}",
    opcionRepetida: "Pasos {desde} a {hasta}: {firma}",
  },

  visor: {
    fuente: "Qué mostrar",
    capturas: "Capturas",
    video: "Video",
    modos: "Modo de comparación",
    despues: "Después",
    antes: "Antes",
    deslizar: "Deslizar",
    superponer: "Superponer",
    mantenB: "Mantén B",
    mantenBAyuda: "Ver «Antes» mientras lo mantienes presionado",
    verEnTelarana: "Ver en la telaraña",
    deslizarEtiqueta: "Deslizar entre antes y después",
    superponerEtiqueta: "Opacidad de «Después» sobre «Antes»",
    altAntes: "Pantalla antes del paso {n}",
    altDespues: "Pantalla después del paso {n}",
    altInicio: "Pantalla inicial del intento",
    sinCaptura: "No hay captura de este paso.",
    clic: "Dónde hizo clic en el paso {n}",
    videoEtiqueta: "Video del intento de {nombre}",
    videoNoCarga: "No se pudo cargar el video; se muestran las capturas.",
    aLos: "a los {tiempo}",
    accionCruda: "Acción registrada: {accion}",
    sinPasos: "Este intento no tiene pasos.",
  },

  tarjeta: {
    titulo: "Paso {n}",
    esperaba: "Esperaba",
    loQuePaso: "Pasó",
    noLoDijo: "No lo dijo.",
    coincide: "¿Pasó lo que esperaba? (estimado)",
    coincideAyuda: "Lo deduce el backoffice de las señales y del cambio de página; el juez no evalúa cada paso.",
    ruta: "Ruta",
    usuario: "Usuario",
    rutaAccion: "{accion} → «{destino}»",
    sigueEnPagina: "(sigue en la página)",
    fueraDeRuta: "Esta página no está en la ruta recomendada.",
    terminaRuta: "Aquí termina la ruta: esta es la respuesta.",
    tramo: "tramo {k} de {total}",
    igual: "El usuario hace lo mismo que la ruta",
    difiere: "El usuario se aparta de la ruta",
    anterior: "Anterior",
    siguiente: "Siguiente",
    fin: "Fin del intento: {motivo}.",
  },

  linea: {
    etiqueta: "Línea de tiempo",
    reproducir: "Reproducir",
    pausar: "Pausar",
    velocidad: "Velocidad",
    velocidadAyuda: "Velocidad de reproducción (más lenta / más rápida)",
    velocidadValor: "{v}×",
    soloPasos: "Solo pasos",
    soloPasosAyuda: "Saltar los tramos del video sin acciones",
    valor: "{actual} de {total}, paso {n}",
    reloj: "{actual} / {total}",
    tira: "Capturas de cada paso",
    carril: "Carril de la ruta",
  },
};
