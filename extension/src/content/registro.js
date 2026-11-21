// Registro de features. Se carga primero (ver content_scripts en manifest.json).
//
// Una feature es un comportamiento JS empaquetado en la extensión. Los temas
// (locales o de la API) solo pueden *activarlas* y pasarles opciones: el código
// nunca viene de afuera, porque MV3 prohíbe ejecutar código remoto.
//
// Los content scripts comparten el mismo global, por eso usamos globalThis.MiTema
// en vez de declarar variables globales sueltas.

globalThis.MiTema ??= {
  features: new Map(),

  // feature = { actualizar(opciones) }
  // `actualizar` se llama en cada navegación y cambio del DOM: debe ser idempotente.
  registrarFeature(id, feature) {
    this.features.set(id, feature);
  },
};
