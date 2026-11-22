// Sección "fallo" (a failed review in its sheet, #/f/<revision>), in English. Same key tree as i18n/es/fallo.js.

export default {
  titulo: "Failed review",
  captura: "The page {sitio} under review",
  cadena: "Agent chain",
  etapa: { catalog: "Cataloger", guide: "Guide", visitor: "Visitors", improver: "Designer" },
  estado: { hecho: "done", en_curso: "running", no_corrio: "not run" },
  motivo: {
    limite: "Rate limited · AgentCore 429",
    catalogador: "Couldn't map the site's goals",
    guia: "Couldn't find a route for the goals",
    disenador: "Couldn't write the theme",
    error: "The agent stopped with an error",
  },
  duro: "took {duracion}",
  manifiesto: "manifest.json",
  anteriores: ({ n }, { plural }) => `${n} earlier ${plural(n, { one: "review", other: "reviews" })}`,
};
