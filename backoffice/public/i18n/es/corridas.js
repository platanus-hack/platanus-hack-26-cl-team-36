// Sección "corridas" (español). Dueño: WP2. Mismo árbol de claves que i18n/en/corridas.js.

export default {
  lista: "Tandas",
  cuentaFiltrada: ({ n, total }) => `${n} de ${total}`,
  limpiarFiltros: "Limpiar filtros",
  buscar: {
    etiqueta: "Buscar tandas",
    marcador: "Buscar tarea, sitio o instrucción",
  },
  filtro: {
    etiqueta: "Filtrar tandas",
    todas: "Todas",
    problemas: "Con problemas",
    errores: "Con errores",
  },
  sitio: {
    etiqueta: "Sitio",
    todos: "Todos los sitios",
    opcion: "{host} ({n})",
  },
  orden: {
    etiqueta: "Orden",
    nuevas: "Más nuevas",
    viejas: "Más antiguas",
    exito: "Menor éxito primero",
    tarea: "Por tarea",
  },
  vista: {
    etiqueta: "Vista",
    lista: "Lista",
    grilla: "Grilla",
    listaTitulo: "Ver como lista (v)",
    grillaTitulo: "Ver como grilla (v)",
  },
  dia: {
    hoy: "Hoy",
    ayer: "Ayer",
    sinFecha: "Sin fecha",
  },
  fila: {
    arbolDanado: "route_tree.json dañado",
    arbolFalta: "Incompleta",
    intentoResultado: "{nombre}: {resultado}",
    sinValidos: "sin válidos",
    sinMedir: "sin medir",
  },
  vacio: {
    sinTandas: "Todavía no hay tandas",
    sinTandasTexto: "El backoffice lee las corridas de {carpeta}. Gatilla una desde la terminal y aparece aquí al recargar:",
    sinCoincidencias: "Ninguna tanda calza con estos filtros",
    sinCoincidenciasBusqueda: "Nada calza con «{q}» y los filtros elegidos.",
    sinCoincidenciasTexto: "Prueba con otro sitio u otro filtro.",
  },
  atajos: {
    buscar: "Buscar en Corridas",
  },
};
