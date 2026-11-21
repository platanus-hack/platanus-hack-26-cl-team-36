// Registro de features y componentes. Se carga primero (ver content_scripts en manifest.json).
//
// Una feature es un comportamiento JS empaquetado en la extensión. Un componente es
// una pieza de interfaz del catálogo (src/componentes/) que una vista dibuja con datos
// de la página. Los temas (locales o de la API) solo pueden *activarlos* y pasarles
// opciones: el código nunca viene de afuera, porque MV3 prohíbe ejecutar código remoto.
//
// Los content scripts comparten el mismo global, por eso usamos globalThis.MiTema
// en vez de declarar variables globales sueltas.

globalThis.MiTema ??= {
  features: new Map(),
  componentes: new Map(),

  // feature = { actualizar(opciones) }
  // `actualizar` se llama en cada navegación y cambio del DOM: debe ser idempotente.
  registrarFeature(id, feature) {
    this.features.set(id, feature);
  },

  // componente = { dibujar(items, opciones, contexto) → Element }
  // Ver features/vista.js para qué trae `contexto`.
  registrarComponente(id, componente) {
    this.componentes.set(id, componente);
  },
};
