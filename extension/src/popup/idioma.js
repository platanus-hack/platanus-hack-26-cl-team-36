// Selector accesible de idioma. El cambio de texto es inmediato, sin animación decorativa.
export function ponerTexto(elemento, texto) {
  if (elemento.textContent !== texto) elemento.textContent = texto;
}

export function crearSelectorIdioma({ raiz, alElegir }) {
  const boton = raiz.querySelector(".mt-idioma-boton");
  const lista = raiz.querySelector(".mt-idioma-lista");
  const opciones = [...lista.querySelectorAll('[role="option"]')];
  let actual = null;
  let activa = 0;

  const abierta = () => !lista.hidden;

  function marcarActiva(indice) {
    activa = Math.min(opciones.length - 1, Math.max(0, indice));
    opciones.forEach((opcion, i) => opcion.toggleAttribute("data-mt-activa", i === activa));
    lista.setAttribute("aria-activedescendant", opciones[activa].id);
  }

  function abrir() {
    if (abierta()) return;
    marcarActiva(Math.max(0, opciones.findIndex((opcion) => opcion.dataset.idioma === actual)));
    lista.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    lista.focus();
  }

  function cerrar({ enfocarBoton = false } = {}) {
    if (!abierta()) return;
    lista.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    if (enfocarBoton) boton.focus();
  }

  function elegir(indice) {
    const idioma = opciones[indice].dataset.idioma;
    cerrar({ enfocarBoton: true });
    if (idioma !== actual) alElegir(idioma);
  }

  boton.addEventListener("click", () => (abierta() ? cerrar() : abrir()));
  boton.addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      abrir();
    }
  });

  lista.addEventListener("keydown", (evento) => {
    const acciones = {
      ArrowDown: () => marcarActiva(activa + 1),
      ArrowUp: () => marcarActiva(activa - 1),
      Home: () => marcarActiva(0),
      End: () => marcarActiva(opciones.length - 1),
      Enter: () => elegir(activa),
      " ": () => elegir(activa),
      Escape: () => cerrar({ enfocarBoton: true }),
    };
    if (evento.key === "Tab") return cerrar();
    const accion = acciones[evento.key];
    if (!accion) return;
    evento.preventDefault();
    evento.stopPropagation(); // Escape no debe cerrar el popup entero, solo la lista
    accion();
  });

  opciones.forEach((opcion, i) => {
    opcion.addEventListener("pointermove", () => activa !== i && marcarActiva(i));
    opcion.addEventListener("click", () => elegir(i));
  });

  // Clic fuera o foco que se va a otro lado: se cierra sin robar el foco.
  document.addEventListener("pointerdown", (evento) => {
    if (abierta() && !raiz.contains(evento.target)) cerrar();
  });
  raiz.addEventListener("focusout", (evento) => {
    if (abierta() && !raiz.contains(evento.relatedTarget)) cerrar();
  });

  return {
    mostrar(idioma) {
      actual = idioma;
      for (const opcion of opciones) opcion.setAttribute("aria-selected", String(opcion.dataset.idioma === idioma));
    },
  };
}
