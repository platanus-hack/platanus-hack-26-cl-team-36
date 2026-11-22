// Sección "perfiles" (dueño: WP5, pantalla Perfiles). Claves relativas: t("perfiles.bloque.resultado.titulo").

export default {
  nota: {
    unIntento: ({ sinValidos }) =>
      sinValidos
        ? "Cada perfil tiene 1 intento válido o ninguno: son conteos, no tasas. Mide agentes, no personas."
        : "Cada perfil tiene 1 intento: son conteos, no tasas. Mide agentes, no personas.",
    sinRuta: "Nadie llegó a la respuesta, así que no hay ruta recomendada con la que comparar: sin hitos ni Δ ruta.",
  },
  vacio: {
    sinIntentos: "Esta tanda no tiene intentos.",
  },
  bloque: {
    resultado: {
      titulo: "Resultado",
      ayuda: "Un punto por intento. Los intentos con error de la herramienta van rayados y no cuentan.",
    },
    hitos: {
      titulo: "Dónde avanza cada perfil",
      ayuda: "Hitos de la ruta recomendada: cuántos intentos de cada perfil llegaron a cada página de la ruta.",
    },
    metricas: {
      titulo: "Métricas",
      ayuda: "Cada columna con su escala, la misma para todos los perfiles. La línea punteada es la ruta recomendada.",
    },
    intentos: {
      titulo: "Intentos",
      ayuda: "Una fila por intento. Ordena con los encabezados; cada fila abre su Replay.",
    },
  },
  unidades: {
    lista: "Intentos de {nombre}",
    conError: ({ n }, { plural }) => `${n} con error`,
    marca: "{nombre}: {resultado}. Abrir en Replay",
    leyenda: "Leyenda",
    directo: "por la ruta",
    indirecto: "por otro camino",
    fallido: "fallido",
    abandonado: "abandonado",
    sin_medir: "sin medir",
    error: "error (no cuenta)",
  },
  calor: {
    perfil: "Perfil",
    hito: "Hito {n}",
    celda: ({ nombre, pagina, n, de }, { plural }) =>
      `${nombre} en «${pagina}»: ${n} de ${de} ${plural(n, { one: "llega", other: "llegan" })}`,
    salen: ({ n }, { plural }) => (n === 1 ? "deja la ruta aquí" : `${n} dejan la ruta aquí`),
    senal: "señal más común: {senal}",
    sinValidos: "Intento con error de la herramienta: no cuenta",
    abrir: "abrir Replay en el paso {paso}",
    leyendaTono: "Tono: cuántos llegan (más intenso, más llegan)",
    leyendaSale: "un perfil deja la ruta aquí",
    leyendaSenal: "la señal más común en esa página",
  },
  metricas: {
    pasos: "Pasos",
    tiempo: "Tiempo",
    tropiezos: "Tropiezos",
    hitos: "Hitos",
    definicion: {
      pasos: "Pasos de cada intento; la línea, los de la ruta recomendada.",
      tiempo: "Duración de cada intento; la línea, la de la ruta recomendada.",
      tropiezos: "Pasos con alguna señal: sin efecto, volvió atrás, error visible.",
      hitos: "Páginas de la ruta a las que llegó; la línea, todas.",
    },
    ruta: "ruta {valor}",
    escala: "Escala de {minimo} a {maximo}",
    valor: {
      pasos: ({ n }, { plural }) => `${n} ${plural(n, { one: "paso", other: "pasos" })}`,
      tropiezos: ({ n }, { plural }) => `${n} ${plural(n, { one: "tropiezo", other: "tropiezos" })}`,
      hitos: ({ n, total }) => `${n} de ${total} hitos`,
    },
    contraRuta: "la ruta: {valor}",
    diferencia: ({ n }) => (n > 0 ? `${n} más que la ruta` : n < 0 ? `${-n} menos que la ruta` : "igual que la ruta"),
    punto: "{nombre}: {valor}",
    abrir: "Abrir en Replay",
    sinValidos: "Sin intentos válidos",
    grafico: "{metrica} por perfil",
  },
  tabla: {
    titulo: "Intentos por perfil",
    columna: {
      perfil: "Perfil",
      resultado: "Resultado",
      pasos: "Pasos",
      delta: "Δ ruta",
      hitos: "Hitos",
      tropiezos: "Tropiezos",
      tiempo: "Tiempo",
      costo: "Costo",
      recorrido: "Recorrido",
      abrir: "Abrir",
    },
    definicion: {
      perfil: "El perfil del usuario simulado",
      resultado: "Resultado (según la ruta de la Guía o el juez) y si llegó por la ruta recomendada",
      pasos: "Acciones que hizo el agente",
      delta: "Pasos de más (+) o de menos (−) que la ruta recomendada",
      hitos: "Páginas de la ruta recomendada a las que llegó",
      tropiezos: "Pasos con alguna señal (sin efecto, volvió atrás, error visible)",
      tiempo: "Duración del intento",
      costo: "Costo equivalente en tokens",
      recorrido: "Las primeras capturas del intento",
    },
    ordenarPor: "Ordenar por {columna}",
    ordenAscendente: "Ordenado por {columna}, de menor a mayor",
    ordenDescendente: "Ordenado por {columna}, de mayor a menor",
    abrir: "Abrir {nombre} en Replay",
    costo: "US$ {valor}",
    noAplica: "No aplica: {motivo}",
    motivo: {
      error: "intento con error de la herramienta",
      sinRuta: "no hay ruta recomendada",
      sinCosto: "el evaluador no registró el costo",
    },
  },
};
