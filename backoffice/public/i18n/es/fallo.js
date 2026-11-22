// Sección "fallo" (una revisión fallida en su hoja, #/f/<revision>), en español. Mismo árbol que i18n/en/fallo.js.

export default {
  titulo: "Revisión fallida",
  captura: "La página {sitio} en revisión",
  cadena: "Cadena de agentes",
  etapa: { catalog: "Catalogador", guide: "Guía", visitor: "Visitantes", improver: "Diseñador" },
  estado: { hecho: "listo", en_curso: "en curso", no_corrio: "no corrió" },
  motivo: {
    limite: "Límite de uso · AgentCore 429",
    catalogador: "No pudo mapear los objetivos del sitio",
    guia: "No encontró una ruta para los objetivos",
    disenador: "No pudo escribir el tema",
    error: "El agente se detuvo con un error",
  },
  duro: "duró {duracion}",
  manifiesto: "manifest.json",
  anteriores: ({ n }, { plural }) => `${n} ${plural(n, { one: "revisión anterior", other: "revisiones anteriores" })}`,
};
