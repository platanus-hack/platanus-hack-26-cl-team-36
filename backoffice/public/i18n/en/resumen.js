// Section "resumen" (English). Owner: WP2. Same key tree as i18n/es/resumen.js.
// Profile and page names and the evaluator's actions are run data (not translated).

const steps = (n, plural) => `${n} ${plural(n, { one: "step", other: "steps" })}`;

export default {
  archivos: {
    arbolDanado: "route_tree.json is damaged: the route, the path map and what comes from them are missing.",
    arbolFalta: "Incomplete batch: it has no route_tree.json yet (the evaluator writes it at the end, or it stopped).",
  },
  cifra: {
    llegan: "Reach the answer",
    pasos: "Steps (median)",
    errores: "Tool errors",
    rutaPasos: "route, {n}",
    erroresContexto: "not counted in the figures",
    sinValidos: "Not applicable: no valid attempts",
  },
  hallazgo: {
    titulo: "Findings",
    ninguno: "No other findings: nobody slows down or stumbles.",
    verPaso: "See step {paso}",
    verPasoEtiqueta: "{nombre}, step {paso}: open in Replay",
    enTelaranaEtiqueta: "{nombre}, step {paso}: see on the path map",
    verIntento: ({ n }, { plural }) => `See its ${steps(n, plural)}`,
    verIntentoEtiqueta: ({ nombre, n }, { plural }) => `${nombre}: see its ${steps(n, plural)} in Replay`,
    verPagina: "See on the path map",
    verPaginaEtiqueta: "See “{pagina}” on the path map",
  },
  ruta: {
    titulo: "Recommended route",
    hitos: "Pages of the recommended route",
    hito: "Milestone {n}:",
    verEnTelarana: "See on the path map",
    sinRuta: "Nobody reached the answer: there is no recommended route.",
    lleganTitulo: "Reach this page: {nombres}",
    nadieLlega: "No valid attempt reaches this page",
    respuesta: "The answer is here",
    // n = valid attempts that took this action on this leg (tool errors do not count).
    accionVeces: ({ accion, n }, { plural }) => `${accion} (${n} ${plural(n, { one: "attempt", other: "attempts" })})`,
    accionVecesTitulo: "How many valid attempts took this action on this leg",
    masAcciones: "+{n}",
    tramoPasos: ({ n }, { plural }) => steps(n, plural),
  },
  niveles: {
    titulo: "By knowledge level",
    columna: {
      nivel: "Level",
      logrados: "Reach it",
      pasos: "Steps (median)",
      tiempo: "Time (median)",
    },
    nivel: { sin_contexto: "No context", conoce_tema: "Knows the topic" },
  },
};
