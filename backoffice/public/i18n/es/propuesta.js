// Sección "propuesta". Textos de la pestaña Propuesta de una tanda: el tema que propone el Diseñador, por qué y cómo
// se ven las páginas antes y después. Mismo árbol de claves que i18n/en/propuesta.js. Lo que escribió el Diseñador
// (resumen, decisiones) y los textos del sitio no pasan por aquí: se muestran tal cual.

export default {
  vistas: {
    etiqueta: "Páginas de la propuesta, de donde más visitantes se quedaron",
    titulo: "Páginas",
    orden: "donde se quedaron",
    paradas: "{n}/{de}",
    detalle: ({ n }) => (n === 1 ? "un visitante se quedó aquí sin llegar" : `${n} visitantes se quedaron aquí sin llegar`),
    fueraDeRuta: "fuera de la ruta",
    paradasAyuda: ({ n, de }, { plural }) => `${n} de ${de} ${plural(n, { one: "visitante se quedó", other: "visitantes se quedaron" })} aquí sin llegar`,
  },
  dispositivo: {
    etiqueta: "Dispositivo",
    desktop: "Escritorio",
    mobile: "Móvil",
  },
  escenario: {
    etiqueta: "Antes y después",
    antes: "Antes",
    despues: "Después",
    corte: "Antes / después",
    sinDespues: "Sin captura del después",
    sinCaptura: "No hay captura de esta página en {dispositivo}.",
    altAntes: "«{pagina}» antes del tema, en {dispositivo}",
    altDespues: "«{pagina}» con el tema, en {dispositivo}",
    marca: "Nota {n}",
  },
  disenador: {
    titulo: "Diseñador",
    disenando: "Diseñando · {tiempo}",
    fallo: "El Diseñador no pudo entregar un tema.",
    sinResumen: "El Diseñador no dejó un resumen.",
    paraTarea: "Pensada para «{tarea}»",
  },
  notas: {
    etiqueta: "Por qué este cambio",
    paradas: ({ n, de }, { plural }) => `${n}/${de} ${plural(n, { one: "se quedó", other: "se quedaron" })}`,
    clics: ({ texto, n }, { plural }) => `«${texto}» · ${n} ${plural(n, { one: "clic", other: "clics" })}`,
    texto: "Texto +{n} %",
    interlineado: "Interlineado {valor}",
    enlaces: "Enlaces subrayados",
    objetivos: "Botones de {n} px",
    muestraTexto: "Aa",
    pendiente: "El Diseñador todavía está decidiendo este cambio.",
  },
  decisiones: ({ n }) => `Decisiones del Diseñador (${n})`,
  tema: "Tema",
  paleta: {
    etiqueta: "Colores del tema: {colores}",
    fondo: "fondo {color}",
    texto: "texto {color}",
    acento: "acento {color}",
  },
  verTema: "Ver el tema (tema.css)",
  vacio: {
    titulo: "Todavía no hay propuesta para esta tanda",
    texto: "El Diseñador propone un tema cuando una revisión termina de medir con visitantes. Ninguna corrida del Diseñador leyó esta tanda.",
  },
  error: "No se pudo cargar la propuesta.",
};

export const ejemplos = {
  "notas.clics": (n) => ({ texto: "Requisitos", n }),
};
