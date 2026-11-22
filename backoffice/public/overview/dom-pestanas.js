// Fila de pestañas accesible (spec §3.8): role="tablist" con botones role="tab", aria-selected y tabindex
// itinerante (solo la elegida entra en el orden de Tab); ← → mueven y eligen, Inicio y Fin van a la primera y la
// última. Elegir no remonta nada: escribe el hash y la pantalla se redibuja con los mismos botones, así el foco se
// queda donde está. Se usa para las fichas de dispositivo y para las pestañas de revisiones.

const TECLAS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/** Conecta teclado y clic de `lista` (el elemento role="tablist"). `alElegir(valor)` con el data-valor del botón. */
export function activarPestanas(lista, { alElegir, senal }) {
  lista.addEventListener(
    "keydown",
    (evento) => {
      if (!TECLAS.has(evento.key) || evento.altKey || evento.ctrlKey || evento.metaKey) return;
      const botones = [...lista.querySelectorAll('[role="tab"]')];
      const actual = botones.indexOf(evento.target instanceof Element ? evento.target.closest('[role="tab"]') : null);
      if (actual === -1) return;
      const destino =
        evento.key === "Home"
          ? 0
          : evento.key === "End"
            ? botones.length - 1
            : (actual + (evento.key === "ArrowRight" ? 1 : -1) + botones.length) % botones.length;
      evento.preventDefault();
      botones[destino].focus();
      if (botones[destino].getAttribute("aria-selected") !== "true") alElegir(botones[destino].dataset.valor);
    },
    { signal: senal },
  );
  lista.addEventListener(
    "click",
    (evento) => {
      const boton = evento.target instanceof Element ? evento.target.closest('[role="tab"]') : null;
      if (boton && lista.contains(boton) && boton.getAttribute("aria-selected") !== "true") alElegir(boton.dataset.valor);
    },
    { signal: senal },
  );
}

/** Marca la pestaña `valor` como elegida (aria-selected, tabindex 0) y las demás no (tabindex -1). */
export function marcarPestana(lista, valor) {
  for (const boton of lista.querySelectorAll('[role="tab"]')) {
    const elegida = boton.dataset.valor === valor;
    if (boton.getAttribute("aria-selected") !== String(elegida)) boton.setAttribute("aria-selected", String(elegida));
    boton.tabIndex = elegida ? 0 : -1;
  }
}
