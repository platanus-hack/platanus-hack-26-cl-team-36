// Sección "perfiles" (dueño: WP5, pantalla Perfiles), en inglés. Mismo árbol de claves que i18n/es/perfiles.js.

export default {
  nota: {
    unIntento: ({ sinValidos }) =>
      sinValidos
        ? "Each profile has 1 valid attempt or none: these are counts, not rates. It measures agents, not people."
        : "Each profile has 1 attempt: these are counts, not rates. It measures agents, not people.",
    sinRuta: "Nobody reached the answer, so there is no recommended route to compare with: no milestones and no Δ route.",
  },
  vacio: {
    sinIntentos: "This batch has no attempts.",
  },
  bloque: {
    resultado: {
      titulo: "Result",
      ayuda: "One mark per attempt. Attempts with a tool error are hatched and don't count.",
    },
    hitos: {
      titulo: "How far each profile gets",
      ayuda: "Milestones of the recommended route: how many attempts of each profile reached each page of the route.",
    },
    metricas: {
      titulo: "Metrics",
      ayuda: "Each column has its own scale, shared by every profile. The dotted line is the recommended route.",
    },
    intentos: {
      titulo: "Attempts",
      ayuda: "One row per attempt. Sort with the headers; each row opens its Replay.",
    },
  },
  unidades: {
    lista: "Attempts of {nombre}",
    conError: ({ n }, { plural }) => `${n} with ${plural(n, { one: "an error", other: "errors" })}`,
    marca: "{nombre}: {resultado}. Open in Replay",
    leyenda: "Legend",
    directo: "by the route",
    indirecto: "by another path",
    fallido: "failed",
    abandonado: "abandoned",
    error: "error (doesn't count)",
  },
  calor: {
    perfil: "Profile",
    hito: "Milestone {n}",
    celda: ({ nombre, pagina, n, de }, { plural }) =>
      `${nombre} at “${pagina}”: ${n} of ${de} ${plural(n, { one: "gets there", other: "get there" })}`,
    salen: ({ n }) => (n === 1 ? "leaves the route here" : `${n} leave the route here`),
    senal: "most common signal: {senal}",
    sinValidos: "Attempt with a tool error: doesn't count",
    abrir: "open Replay at step {paso}",
    leyendaTono: "Shade: how many get there (stronger, more)",
    leyendaSale: "a profile leaves the route here",
    leyendaSenal: "the most common signal on that page",
  },
  metricas: {
    pasos: "Steps",
    tiempo: "Time",
    tropiezos: "Stumbles",
    hitos: "Milestones",
    definicion: {
      pasos: "Steps of each attempt; the line, those of the recommended route.",
      tiempo: "Duration of each attempt; the line, the recommended route's.",
      tropiezos: "Steps with any signal: no effect, went back, visible error.",
      hitos: "Pages of the route it reached; the line, all of them.",
    },
    ruta: "route {valor}",
    escala: "Scale from {minimo} to {maximo}",
    valor: {
      pasos: ({ n }, { plural }) => `${n} ${plural(n, { one: "step", other: "steps" })}`,
      tropiezos: ({ n }, { plural }) => `${n} ${plural(n, { one: "stumble", other: "stumbles" })}`,
      hitos: ({ n, total }) => `${n} of ${total} milestones`,
    },
    contraRuta: "the route: {valor}",
    diferencia: ({ n }) => (n > 0 ? `${n} more than the route` : n < 0 ? `${-n} fewer than the route` : "same as the route"),
    punto: "{nombre}: {valor}",
    abrir: "Open in Replay",
    sinValidos: "No valid attempts",
    grafico: "{metrica} by profile",
  },
  tabla: {
    titulo: "Attempts by profile",
    columna: {
      perfil: "Profile",
      resultado: "Result",
      pasos: "Steps",
      delta: "Δ route",
      hitos: "Milestones",
      tropiezos: "Stumbles",
      tiempo: "Time",
      costo: "Cost",
      recorrido: "Path",
      abrir: "Open",
    },
    definicion: {
      perfil: "The simulated user's profile",
      resultado: "The judge's verdict and whether it went by the recommended route",
      pasos: "Actions the agent took",
      delta: "Steps more (+) or fewer (−) than the recommended route",
      hitos: "Pages of the recommended route it reached",
      tropiezos: "Steps with any signal (no effect, went back, visible error)",
      tiempo: "Duration of the attempt",
      costo: "Equivalent token cost",
      recorrido: "The attempt's first screenshots",
    },
    ordenarPor: "Sort by {columna}",
    ordenAscendente: "Sorted by {columna}, lowest first",
    ordenDescendente: "Sorted by {columna}, highest first",
    abrir: "Open {nombre} in Replay",
    costo: "US${valor}",
    noAplica: "Not applicable: {motivo}",
    motivo: {
      error: "attempt with a tool error",
      sinRuta: "there is no recommended route",
      sinCosto: "the evaluator didn't record the cost",
    },
  },
};
