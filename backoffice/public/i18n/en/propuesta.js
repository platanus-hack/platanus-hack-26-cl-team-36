// Section "propuesta". Copy for a batch's Proposal tab: the theme the Designer proposes, why, and how the pages look
// before and after. Same key tree as i18n/es/propuesta.js. What the Designer wrote (summary, decisions) and the site's
// own text don't go through here: they are shown as they are.

export default {
  vistas: {
    etiqueta: "Proposal pages",
    titulo: "Views · {n}",
    paradas: "{n}/{de}",
    paradasAyuda: ({ n, de }, { plural }) => `${n} of ${de} ${plural(n, { one: "visitor stopped", other: "visitors stopped" })} here without getting there`,
  },
  dispositivo: {
    etiqueta: "Device",
    desktop: "Desktop",
    mobile: "Mobile",
  },
  escenario: {
    etiqueta: "Before and after",
    antes: "Before",
    despues: "After",
    corte: "Before / after",
    sinDespues: "No after capture",
    sinCaptura: "There is no capture of this page on {dispositivo}.",
    altAntes: "«{pagina}» before the theme, on {dispositivo}",
    altDespues: "«{pagina}» with the theme, on {dispositivo}",
    marca: "Note {n}",
  },
  disenador: {
    titulo: "Designer",
    disenando: "Designing · {tiempo}",
    fallo: "The Designer could not deliver a theme.",
    sinResumen: "The Designer left no summary.",
    paraTarea: "Designed for «{tarea}»",
  },
  notas: {
    etiqueta: "Why this change",
    paradas: ({ n, de }) => `${n}/${de} stopped`,
    clics: ({ texto, n }, { plural }) => `«${texto}» · ${n} ${plural(n, { one: "click", other: "clicks" })}`,
    texto: "Text +{n} %",
    interlineado: "Line height {valor}",
    enlaces: "Underlined links",
    objetivos: "{n} px targets",
    muestraTexto: "Aa",
    pendiente: "The Designer is still deciding this change.",
  },
  decisiones: ({ n }) => `Designer's decisions (${n})`,
  paleta: {
    etiqueta: "Theme colors: {colores}",
    fondo: "background {color}",
    texto: "text {color}",
    acento: "accent {color}",
  },
  verTema: "View the theme (tema.css)",
  vacio: {
    titulo: "No proposal for this batch yet",
    texto: "The Designer proposes a theme once a review finishes measuring with visitors. No Designer run read this batch.",
  },
  error: "The proposal could not be loaded.",
};

export const ejemplos = {
  "notas.clics": (n) => ({ texto: "Requirements", n }),
};
