// Sección "resumen" (español). Dueño: WP2. Mismo árbol de claves que i18n/en/resumen.js.
// Los nombres de perfiles y páginas y las acciones del evaluador llegan como datos de la corrida (sin traducir).

const pasos = (n, plural) => `${n} ${plural(n, { one: "paso", other: "pasos" })}`;

export default {
  archivos: {
    arbolDanado: "route_tree.json está dañado: faltan la ruta, el mapa de caminos y lo que sale de ellos.",
    arbolFalta: "Tanda incompleta: todavía no tiene route_tree.json (el evaluador lo escribe al final, o se cortó).",
  },
  cifra: {
    llegan: "Llegan",
    pasos: "Pasos (mediana)",
    errores: "Errores de la herramienta",
    rutaPasos: "la ruta, {n}",
    erroresContexto: "no cuentan en las cifras",
    sinValidos: "No aplica: ningún intento válido",
  },
  hallazgo: {
    titulo: "Hallazgos",
    ninguno: "Sin otros hallazgos: nadie se demora ni tropieza.",
    verPaso: "Ver paso {paso}",
    verPasoEtiqueta: "{nombre}, paso {paso}: abrir en Replay",
    enTelaranaEtiqueta: "{nombre}, paso {paso}: ver en el mapa de caminos",
    verIntento: ({ n }, { plural }) => `Ver sus ${pasos(n, plural)}`,
    verIntentoEtiqueta: ({ nombre, n }, { plural }) => `${nombre}: ver sus ${pasos(n, plural)} en Replay`,
    verPagina: "Ver en el mapa de caminos",
    verPaginaEtiqueta: "Ver «{pagina}» en el mapa de caminos",
  },
  ruta: {
    titulo: "Ruta recomendada",
    hitos: "Páginas de la ruta recomendada",
    hito: "Hito {n}:",
    verEnTelarana: "Ver en el mapa de caminos",
    sinRuta: "Nadie llegó a la respuesta: no hay ruta recomendada.",
    lleganTitulo: "Llegan a esta página: {nombres}",
    nadieLlega: "Ningún intento válido llega a esta página",
    respuesta: "Aquí está la respuesta",
    // n = intentos válidos que hicieron esa acción en el tramo (los con error de la herramienta no cuentan).
    accionVeces: ({ accion, n }, { plural }) => `${accion} (${n} ${plural(n, { one: "intento", other: "intentos" })})`,
    accionVecesTitulo: "Cuántos intentos válidos hicieron esta acción en este tramo",
    masAcciones: "+{n}",
    tramoPasos: ({ n }, { plural }) => pasos(n, plural),
  },
  niveles: {
    titulo: "Por nivel de conocimiento",
    columna: {
      nivel: "Nivel",
      logrados: "Llegan",
      pasos: "Pasos (mediana)",
      tiempo: "Tiempo (mediana)",
    },
    nivel: { sin_contexto: "Sin contexto", conoce_tema: "Conoce el tema" },
  },
};
