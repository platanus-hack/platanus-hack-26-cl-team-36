// Motor genérico: corre en cada página donde la extensión tiene content script.
// No sabe nada de ningún sitio en particular; todo lo específico viene del tema.
//
//   1. Pide al background el tema para esta URL (el background inyecta su CSS).
//   2. Pone/quita la clase `mi-tema` en <html> según el botón de la extensión.
//   3. Ejecuta las features que pide el tema en cada navegación y cambio del DOM.

(() => {
  const html = document.documentElement;

  function aplicarActivo(activo) {
    html.classList.toggle("mi-tema", activo);
  }

  // Activo por defecto apenas carga (evita un "flash" del diseño original);
  // luego se corrige según lo guardado y según si hay tema para el sitio.
  aplicarActivo(true);

  function prepararFeatures(tema) {
    return Object.entries(tema.features).flatMap(([id, opciones]) => {
      const feature = MiTema.features.get(id);
      if (!feature) {
        console.warn(`[mi-tema] El tema "${tema.id}" pide la feature "${id}", que no existe en la extensión.`);
        return [];
      }
      return [{ id, feature, opciones }];
    });
  }

  function vigilarCambios(tema, actualizarUI) {
    // Eventos propios del sitio al navegar sin recargar (SPA), ej. yt-navigate-finish.
    for (const evento of tema.eventosNavegacion) {
      document.addEventListener(evento, actualizarUI);
    }

    // Respaldo: si el sitio re-renderiza y borra lo que insertamos, lo reponemos.
    // requestAnimationFrame agrupa muchos cambios seguidos en una sola llamada.
    let pendiente = false;
    const observador = new MutationObserver(() => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        actualizarUI();
      });
    });

    const iniciar = () => {
      observador.observe(document.body, { childList: true, subtree: true });
      actualizarUI();
    };
    if (document.body) iniciar();
    else document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  }

  async function iniciar() {
    const [{ activo = true }, tema] = await Promise.all([
      browser.storage.local.get("activo"),
      browser.runtime.sendMessage({ tipo: "tema:aplicar" }),
    ]);

    if (!tema) {
      aplicarActivo(false); // no hay tema para este sitio
      return;
    }

    aplicarActivo(activo);
    browser.storage.onChanged.addListener((cambios, area) => {
      if (area === "local" && "activo" in cambios) aplicarActivo(cambios.activo.newValue);
    });

    const features = prepararFeatures(tema);
    const actualizarUI = () => {
      for (const { id, feature, opciones } of features) {
        try {
          feature.actualizar(opciones);
        } catch (error) {
          console.error(`[mi-tema] Error en la feature "${id}":`, error);
        }
      }
    };
    vigilarCambios(tema, actualizarUI);
  }

  iniciar().catch((error) => console.error("[mi-tema] No se pudo iniciar:", error));
})();
