// Section "corridas" (English). Owner: WP2. Same key tree as i18n/es/corridas.js.

export default {
  lista: "Batches",
  cuentaFiltrada: ({ n, total }) => `${n} of ${total}`,
  limpiarFiltros: "Clear filters",
  buscar: {
    etiqueta: "Search batches",
    marcador: "Search task, site or instruction",
  },
  filtro: {
    etiqueta: "Filter batches",
    todas: "All",
    problemas: "With problems",
    errores: "With errors",
  },
  sitio: {
    etiqueta: "Site",
    todos: "All sites",
    opcion: "{host} ({n})",
  },
  orden: {
    etiqueta: "Sort",
    nuevas: "Newest first",
    viejas: "Oldest first",
    exito: "Least success first",
    tarea: "By task",
  },
  vista: {
    etiqueta: "View",
    lista: "List",
    grilla: "Grid",
    listaTitulo: "Show as a list (v)",
    grillaTitulo: "Show as a grid (v)",
  },
  dia: {
    hoy: "Today",
    ayer: "Yesterday",
    sinFecha: "No date",
  },
  fila: {
    arbolDanado: "route_tree.json damaged",
    arbolFalta: "Incomplete",
    intentoResultado: "{nombre}: {resultado}",
    sinValidos: "none valid",
  },
  vacio: {
    sinTandas: "No batches yet",
    sinTandasTexto: "The backoffice reads runs from {carpeta}. Trigger one from the terminal and it shows up here on reload:",
    sinCoincidencias: "No batch matches these filters",
    sinCoincidenciasBusqueda: "Nothing matches “{q}” with the chosen filters.",
    sinCoincidenciasTexto: "Try another site or filter.",
  },
  atajos: {
    buscar: "Search Runs",
  },
};
