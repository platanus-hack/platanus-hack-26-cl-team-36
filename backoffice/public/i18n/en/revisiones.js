// Sección "revisiones" (Reviews screen), in English. Same key tree as i18n/es/revisiones.js.

export default {
  cuenta: ({ n }, { plural }) => `${n} ${plural(n, { one: "review", other: "reviews" })}`,
  cuentaFiltrada: ({ n, total }) => `${n} of ${total}`,
  // Filter of the list (?estado=), the same cut as the Overview tabs: Live = running and queued.
  // History: the reviews a newer one of the same page replaced.
  filtro: {
    live: "Live",
    done: "Delivered",
    failed: "Failed",
    historial: "History",
    quitar: "Show all reviews",
    vacio: "No reviews with this status.",
  },
  enVivo: "Refreshes every few seconds.",
  errorAlRefrescar: "Couldn't refresh; it will retry on its own.",
  noDisponible: {
    titulo: "Reviews live in AWS",
    texto: "Start the backoffice with the S3 source to see the reviews table:",
  },
  vacio: "No reviews yet.",
  noExiste: "Review «{revision}» doesn't exist.",
  estado: {
    queued: "Queued",
    running: "Running",
    done: "Delivered",
    failed: "Failed",
    pending: "Pending",
    succeeded: "Finished",
  },
  goals: ({ n }, { plural }) => `${n} ${plural(n, { one: "goal", other: "goals" })}`,
  sinGoals: "goals not known yet",
  progreso: ({ cerrados, total }) => `${cerrados} of ${total} stages`,
  progresoParcial: ({ cerrados, total }) => `${cerrados} of at least ${total} stages`,
  creada: "created {cuando}",
  actualizada: "updated {cuando}",
  verTema: "View tema.css",
  abrirTanda: "Open batch",
  verEnVivo: "Watch live",
  verEnVivoDe: "Watch «{goal}» live",
  etapa: {
    catalogo: "Catalog",
    goals: "Goals",
    improver: "Theme",
  },
  columna: {
    goal: "Goal",
    guide: "Route (guide)",
    visitor: "Visit (visitor)",
  },
};
