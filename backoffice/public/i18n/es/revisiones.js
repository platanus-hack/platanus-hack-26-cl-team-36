// Sección "revisiones" (pantalla Revisiones). Mismo árbol de claves que i18n/en/revisiones.js.

export default {
  cuenta: ({ n }, { plural }) => `${n} ${plural(n, { one: "revisión", other: "revisiones" })}`,
  cuentaFiltrada: ({ n, total }) => `${n} de ${total}`,
  // Filtro de la lista (?estado=), el mismo corte que las pestañas del Overview: En vivo = en curso y en cola.
  // Historial: las revisiones que otra más nueva de la misma página reemplazó.
  filtro: {
    live: "En vivo",
    done: "Entregadas",
    failed: "Fallidas",
    historial: "Historial",
    quitar: "Ver todas las revisiones",
    vacio: "No hay revisiones con este estado.",
  },
  enVivo: "Se actualiza cada pocos segundos.",
  errorAlRefrescar: "No se pudo actualizar; se vuelve a intentar sola.",
  noDisponible: {
    titulo: "Las revisiones están en AWS",
    texto: "Arranca el backoffice con la fuente S3 para ver la tabla de revisiones:",
  },
  vacio: "Todavía no hay revisiones.",
  noExiste: "No existe la revisión «{revision}».",
  estado: {
    queued: "En cola",
    running: "En curso",
    done: "Entregada",
    failed: "Fallida",
    pending: "Pendiente",
    succeeded: "Terminó",
  },
  goals: ({ n }, { plural }) => `${n} ${plural(n, { one: "goal", other: "goals" })}`,
  sinGoals: "goals por definir",
  progreso: ({ cerrados, total }) => `${cerrados} de ${total} etapas`,
  progresoParcial: ({ cerrados, total }) => `${cerrados} de al menos ${total} etapas`,
  creada: "creada {cuando}",
  actualizada: "actualizada {cuando}",
  verTema: "Ver tema.css",
  abrirTanda: "Abrir tanda",
  etapa: {
    catalogo: "Catálogo",
    goals: "Goals",
    improver: "Tema",
  },
  columna: {
    goal: "Goal",
    guide: "Ruta (guide)",
    visitor: "Visita (visitor)",
  },
};
