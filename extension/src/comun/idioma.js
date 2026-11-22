// Textos de la interfaz en cada idioma: todo texto que ve el usuario pasa por acá.
//
// Se carga en tres lugares, por eso es un script clásico (sin import/export) que se
// expone en `globalThis.MiTema.idioma`:
//   - popup y background (módulos ES): `import "../comun/idioma.js"` y luego
//     `const { t } = globalThis.MiTema.idioma`.
//   - content scripts: listado en content_scripts del manifest justo después de
//     content/registro.js (que crea MiTema; si este fuera antes, registro no lo crearía).
//   - tests de Node: `await import("../src/comun/idioma.js")`.
//
// Agregar un texto: la misma clave en `es` y en `en` (test/idioma.test.js lo verifica) y
// usarla con `t(idioma, "clave", { parametro })`. En el HTML del popup, los textos fijos
// van con `data-mt-texto="clave"` (o `data-mt-texto-placeholder` / `data-mt-texto-aria-label`).
//
// Valores: texto con `{parametro}` para interpolar, o, para plurales, un objeto
// { cero?, uno, otros } que se elige con `params.n`. Los números se formatean según el idioma.
// El idioma elegido se guarda en storage.local con la clave `idioma` ("es" | "en").

(() => {
  const IDIOMA_POR_DEFECTO = "es";
  const CLAVE_IDIOMA = "idioma";

  // Cada idioma se nombra en su propio idioma (así lo encuentra quien no entiende el actual).
  const IDIOMAS = {
    es: { nombre: "Español", locale: "es-CL" },
    en: { nombre: "English", locale: "en-US" },
  };

  const TEXTOS = {
    es: {
      // Ajustes del popup (hoja que sube desde abajo)
      "ajustes.titulo": "Ajustes",
      "ajustes.cerrar": "Cerrar ajustes",
      "ajustes.idioma": "Idioma",
      "efectos.etiqueta": "Efectos llamativos",
      "efectos.ayuda": "Si lo apagas, solo un fundido.",

      // Vista de opinión
      "opinion.abrir": "Dar opinión",
      "opinion.volver": "Volver",
      "opinion.titulo": "Tu opinión",
      "opinion.pregunta": "¿Esta página es mejor para ti que la original?",
      "opinion.mejor": "Mejor",
      "opinion.peor": "Peor",
      "opinion.soloComentar": "Solo quiero comentar",
      "opinion.comentario": "Comentario",
      "opinion.comentarioOpcional": "Cuéntanos qué cambiarías (opcional)",
      "opinion.comentarioObligatorio": "Escribe tu comentario",
      "opinion.enviar": "Enviar",
      "opinion.guardando": "Guardando…",
      "opinion.gracias": "¡Gracias por tu opinión!",
      "opinion.pendientes": {
        cero: "Aún no hay opiniones guardadas en tu equipo.",
        uno: "{n} opinión guardada en tu equipo.",
        otros: "{n} opiniones guardadas en tu equipo.",
      },
      "opinion.privacidad": "Al enviar se guarda una copia de esta página (antes y después del tema) solo en tu equipo.",
      "opinion.privacidadSinCopia": "Al enviar se guarda solo tu comentario, sin copiar la página, y solo en tu equipo.",

      // Avisos según la pestaña (estado.js → decidirVista)
      "aviso.noDisponible":
        "Chameleon no puede leer esta pestaña. Las páginas internas del navegador no lo permiten; si es un sitio web, recárgalo.",
      "aviso.privada": "En las ventanas privadas Chameleon no guarda opiniones. El interruptor funciona igual.",
      "aviso.sinTema": "Esta página todavía no tiene un tema de Chameleon. Cuéntanos qué te gustaría cambiar.",
      "aviso.apagado": "Chameleon está apagado. Enciéndelo para comparar con la página original, o déjanos un comentario.",

      // Por qué todavía no se puede enviar (estado.js → validarEnvio)
      "motivo.noDisponible": "No se puede opinar sobre esta pestaña.",
      "motivo.elegir": "Elige una opción para enviar.",
      "motivo.escribir": "Escribe tu comentario para enviar.",
      "motivo.largo": "El comentario es muy largo (máximo {max} caracteres).",

      // Errores de `voto:guardar` / `votos:estado` (background: `error.<codigo>`)
      "error.voto-invalido": "Elige si la página quedó mejor, peor o si solo quieres comentar.",
      "error.comentario-no-texto": "El comentario debe ser texto.",
      "error.comentario-vacio": "Escribe tu comentario antes de enviarlo.",
      "error.comentario-largo": "El comentario es muy largo (máximo {max} caracteres).",
      "error.sin-pestana": "No se sabe de qué pestaña es tu opinión.",
      "error.sin-captura": "No se pudo leer esta página. Recárgala e inténtalo de nuevo.",
      "error.sin-tema": "Esta página no tiene un tema de Chameleon: no hay con qué comparar.",
      "error.privada": "En las ventanas privadas no se guardan opiniones.",
      "error.guardar": "No se pudo guardar tu opinión. Inténtalo de nuevo.",
      "error.contar": "No se pudieron leer las opiniones guardadas.",

      // Interruptor ON/OFF
      "interruptor.seccion": "Encender o apagar Chameleon",
      "interruptor.cargando": "Cargando…",
      "interruptor.encendido": "Encendido",
      "interruptor.apagado": "Apagado",
      "interruptor.ayudaEncendido": "Haz clic para volver a la página original",
      "interruptor.ayudaApagado": "Haz clic para aplicar el diseño de Chameleon",
      "interruptor.ayudaEncendidoSinTema": "Haz clic para apagar Chameleon",
      "interruptor.ayudaApagadoSinTema": "Haz clic para encender Chameleon",

      // Content scripts: feature modo-foco
      "foco.entrar": "🎯 Modo foco",
      "foco.salir": "🎯 Salir de modo foco",

      // Content scripts: componente cartelera (el tema puede reemplazarlos, ver cartelera.js)
      "cartelera.titulo": "Para ti",
      "cartelera.destacado": "Destacado",
      "cartelera.boton": "Reproducir",
      "cartelera.fila": "Sigue explorando",
      "cartelera.lista": "Más",
      "cartelera.original": "Ver original",
      "cartelera.volver": "Volver a la vista nueva",

      // Content scripts: componentes lanzador, atajo y buscador (el tema puede reemplazarlos)
      "lanzador.titulo": "Lo más buscado",
      "lanzador.subtitulo": "Ve directo a lo que viniste a hacer.",
      "atajo.titulo": "Ir directo",
      "atajo.subtitulo": "Elige y te llevamos al resultado.",
      "atajo.boton": "Ver resultado",
      "atajo.invertir": "Intercambiar",
      "atajo.elegir": "Elige una opción",
      "buscador.boton": "Buscar una tarea…",
      "buscador.titulo": "Buscar una tarea",
      "buscador.campo": "¿Qué quieres hacer?",
      "buscador.sugerencias": "Sugerencias",
      "buscador.sin-resultados": "Nada para «{consulta}»",
      "buscador.sin-resultados-ayuda": "Prueba con otra palabra o con menos letras.",
      "buscador.resultados": { cero: "Sin resultados.", uno: "{n} resultado.", otros: "{n} resultados." },
      "buscador.cerrar": "Cerrar",
      "buscador.mover": "moverte",
      "buscador.abrir": "abrir",
      "buscador.atajo": "Ctrl K",
      "buscador.atajo-mac": "⌘K",
    },

    en: {
      "ajustes.titulo": "Settings",
      "ajustes.cerrar": "Close settings",
      "ajustes.idioma": "Language",
      "efectos.etiqueta": "Bold effects",
      "efectos.ayuda": "Turn off for a simple fade.",

      "opinion.abrir": "Give feedback",
      "opinion.volver": "Back",
      "opinion.titulo": "Your feedback",
      "opinion.pregunta": "Is this page better for you than the original?",
      "opinion.mejor": "Better",
      "opinion.peor": "Worse",
      "opinion.soloComentar": "Just a comment",
      "opinion.comentario": "Comment",
      "opinion.comentarioOpcional": "Tell us what you'd change (optional)",
      "opinion.comentarioObligatorio": "Write your comment",
      "opinion.enviar": "Send",
      "opinion.guardando": "Saving…",
      "opinion.gracias": "Thanks for your feedback!",
      "opinion.pendientes": {
        cero: "No feedback saved on this device yet.",
        uno: "{n} response saved on this device.",
        otros: "{n} responses saved on this device.",
      },
      "opinion.privacidad": "Sending saves a copy of this page (before and after the theme) only on this device.",
      "opinion.privacidadSinCopia": "Sending saves only your comment, without copying the page, and only on this device.",

      "aviso.noDisponible": "Chameleon can't read this tab. The browser's internal pages don't allow it; if it's a website, reload it.",
      "aviso.privada": "Chameleon doesn't save feedback in private windows. The switch still works.",
      "aviso.sinTema": "This page doesn't have a Chameleon theme yet. Tell us what you'd like to change.",
      "aviso.apagado": "Chameleon is off. Turn it on to compare with the original page, or leave us a comment.",

      "motivo.noDisponible": "You can't give feedback on this tab.",
      "motivo.elegir": "Pick an option to send.",
      "motivo.escribir": "Write your comment to send.",
      "motivo.largo": "Your comment is too long ({max} characters max).",

      "error.voto-invalido": "Choose whether the page got better, worse, or you just want to comment.",
      "error.comentario-no-texto": "The comment must be text.",
      "error.comentario-vacio": "Write your comment before sending it.",
      "error.comentario-largo": "Your comment is too long ({max} characters max).",
      "error.sin-pestana": "We couldn't tell which tab your feedback is about.",
      "error.sin-captura": "Couldn't read this page. Reload it and try again.",
      "error.sin-tema": "This page has no Chameleon theme, so there's nothing to compare.",
      "error.privada": "Feedback isn't saved in private windows.",
      "error.guardar": "Couldn't save your feedback. Please try again.",
      "error.contar": "Couldn't read your saved feedback.",

      "interruptor.seccion": "Turn Chameleon on or off",
      "interruptor.cargando": "Loading…",
      "interruptor.encendido": "On",
      "interruptor.apagado": "Off",
      "interruptor.ayudaEncendido": "Click to go back to the original page",
      "interruptor.ayudaApagado": "Click to apply Chameleon's design",
      "interruptor.ayudaEncendidoSinTema": "Click to turn Chameleon off",
      "interruptor.ayudaApagadoSinTema": "Click to turn Chameleon on",

      "foco.entrar": "🎯 Focus mode",
      "foco.salir": "🎯 Exit focus mode",

      "cartelera.titulo": "For you",
      "cartelera.destacado": "Featured",
      "cartelera.boton": "Play",
      "cartelera.fila": "Keep exploring",
      "cartelera.lista": "More",
      "cartelera.original": "View original",
      "cartelera.volver": "Back to the new view",

      "lanzador.titulo": "Most wanted",
      "lanzador.subtitulo": "Go straight to what you came to do.",
      "atajo.titulo": "Go direct",
      "atajo.subtitulo": "Choose and we take you to the result.",
      "atajo.boton": "See result",
      "atajo.invertir": "Swap",
      "atajo.elegir": "Choose an option",
      "buscador.boton": "Search for a task…",
      "buscador.titulo": "Search for a task",
      "buscador.campo": "What do you want to do?",
      "buscador.sugerencias": "Suggestions",
      "buscador.sin-resultados": "Nothing for “{consulta}”",
      "buscador.sin-resultados-ayuda": "Try another word or fewer letters.",
      "buscador.resultados": { cero: "No results.", uno: "{n} result.", otros: "{n} results." },
      "buscador.cerrar": "Close",
      "buscador.mover": "move",
      "buscador.abrir": "open",
      "buscador.atajo": "Ctrl K",
      "buscador.atajo-mac": "⌘K",
    },
  };

  function normalizarIdioma(valor) {
    return Object.hasOwn(TEXTOS, valor) ? valor : IDIOMA_POR_DEFECTO;
  }

  function formatear(valor, idioma) {
    return typeof valor === "number" ? valor.toLocaleString(IDIOMAS[idioma].locale) : String(valor);
  }

  // Plurales: "cero" si existe y n es 0; si no, la regla del idioma ("one" → "uno").
  function elegirForma(formas, idioma, n) {
    if (n === 0 && formas.cero !== undefined) return formas.cero;
    const regla = Number.isFinite(n) ? new Intl.PluralRules(IDIOMAS[idioma].locale).select(n) : "other";
    return regla === "one" ? formas.uno : formas.otros;
  }

  // t("en", "opinion.pendientes", { n: 3 }) → "3 responses saved on this device."
  // Una clave que falta en el idioma cae al español; una que no existe se devuelve tal cual
  // (se nota en pantalla, pero no rompe nada).
  function t(idioma, clave, params = {}) {
    const elegido = normalizarIdioma(idioma);
    let valor = TEXTOS[elegido][clave] ?? TEXTOS[IDIOMA_POR_DEFECTO][clave];
    if (valor === undefined) return clave;
    if (typeof valor === "object") valor = elegirForma(valor, elegido, params.n);
    return valor.replace(/\{(\w+)\}/g, (marca, nombre) =>
      Object.hasOwn(params, nombre) ? formatear(params[nombre], elegido) : marca,
    );
  }

  // Idioma actual de quien no lo pasa en cada llamada (los content scripts: content/motor.js
  // lo lee de storage y lo cambia con `fijar` cuando cambia).
  let actual = IDIOMA_POR_DEFECTO;

  (globalThis.MiTema ??= {}).idioma = {
    IDIOMA_POR_DEFECTO,
    CLAVE_IDIOMA,
    IDIOMAS,
    TEXTOS,
    normalizarIdioma,
    t,
    actual: () => actual,
    fijar: (idioma) => (actual = normalizarIdioma(idioma)),
    texto: (clave, params) => t(actual, clave, params),
  };
})();
