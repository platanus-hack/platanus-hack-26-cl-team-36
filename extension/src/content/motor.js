// Motor genérico: corre en todas las páginas http(s). No sabe nada de ningún
// sitio en particular; todo lo específico viene del tema.
//
//   1. Pide al background el tema para esta URL (el background le pregunta a la
//      API e inyecta el CSS). Si no hay tema, no toca la página (salvo la animación
//      del botón, que corre en todos los sitios).
//   2. Marca <html> con la clase `mi-tema` (según el botón de la extensión) y el
//      atributo `data-mt-tema`, y los repone si el sitio los borra.
//   3. Ejecuta las features que pide el tema en cada navegación y cambio del DOM.
//   4. Cuando el usuario aprieta el botón, anima el cambio (content/transicion.js), en
//      cualquier sitio, tenga tema o no. Solo ahí: al cargar y al navegar la clase se
//      pone sin animación.
//
// Ojo: algunos sitios reemplazan el <html> completo al cargar (Gmail usa
// document.open/write) o pisan sus clases. Por eso nunca guardamos una referencia
// fija a document.documentElement y observamos `document`, que sí sobrevive.

(() => {
  let tema = null;
  let activo = true;

  // Repone la clase al instante si el sitio la pisa (ej. html.className = "...").
  let htmlObservado = null;
  const observadorHtml = new MutationObserver(() => marcarHtml());

  // Idempotente: solo escribe si algo cambió, así no entra en bucle con observadorHtml.
  function marcarHtml() {
    const html = document.documentElement;
    if (!tema || !html) return;

    if (html !== htmlObservado) {
      observadorHtml.disconnect();
      observadorHtml.observe(html, { attributes: true, attributeFilter: ["class"] });
      htmlObservado = html;
    }
    if (html.dataset.mtTema !== tema.id) html.dataset.mtTema = tema.id; // lo usa el refresco en modo desarrollo
    html.classList.toggle("mi-tema", activo); // toggle con segundo argumento no escribe si no cambia
  }

  function prepararFeatures() {
    return Object.entries(tema.features).flatMap(([id, opciones]) => {
      const feature = MiTema.features.get(id);
      if (!feature) {
        console.warn(`[mi-tema] El tema "${tema.id}" pide la feature "${id}", que no existe en la extensión.`);
        return [];
      }
      return [{ id, feature, opciones }];
    });
  }

  function vigilarCambios(actualizarUI) {
    // Eventos propios del sitio al navegar sin recargar (SPA), ej. yt-navigate-finish.
    for (const evento of tema.eventosNavegacion) {
      document.addEventListener(evento, actualizarUI);
    }

    // Si el sitio re-renderiza (o reemplaza el <html>) y borra lo que pusimos, lo reponemos.
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
    observador.observe(document, { childList: true, subtree: true });
    actualizarUI();
  }

  // `activo` (lo que se ve) cambia recién dentro de la transición: si el sitio mueve el
  // DOM antes, marcarHtml() no adelanta la clase y la captura de "antes" sale bien.
  // El botón anima en cualquier sitio, tenga tema o no: sin tema la transición corre
  // igual y simplemente no cambia nada debajo.
  let botonTocado = false; // si el botón cambió el estado antes de leerlo, manda el botón
  function escucharBoton() {
    browser.storage.onChanged.addListener((cambios, area) => {
      if (area !== "local" || !("activo" in cambios)) return;
      const pedido = cambios.activo.newValue ?? true;
      botonTocado = true;
      MiTema.transicion.animar(pedido, () => {
        activo = pedido;
        marcarHtml();
      });
    });
  }

  async function iniciar() {
    escucharBoton();
    const [estado, respuesta] = await Promise.all([
      browser.storage.local.get("activo"),
      browser.runtime.sendMessage({ tipo: "tema:aplicar" }),
    ]);
    if (!botonTocado) activo = estado.activo ?? true;
    if (!respuesta) return; // sin tema para este sitio (o la API no respondió)

    tema = respuesta;
    console.info(`[mi-tema] Tema "${tema.id}" aplicado${activo ? "" : " (desactivado con el botón)"}.`);

    const features = prepararFeatures();
    vigilarCambios(() => {
      marcarHtml();
      for (const { id, feature, opciones } of features) {
        try {
          feature.actualizar(opciones);
        } catch (error) {
          console.error(`[mi-tema] Error en la feature "${id}":`, error);
        }
      }
    });
  }

  iniciar().catch((error) => console.error("[mi-tema] No se pudo iniciar:", error));
})();
