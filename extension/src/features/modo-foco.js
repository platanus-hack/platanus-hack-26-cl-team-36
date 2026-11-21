// Feature "modo-foco": inserta un botón que alterna la clase `mi-tema-foco` en <html>.
// Qué se oculta en modo foco lo decide el CSS del tema (html.mi-tema.mi-tema-foco ...).
//
// Opciones (vienen del tema):
//   rutas: lista de pathnames donde mostrar el botón. Sin `rutas`, se muestra en todas.
//   ancla: selector del elemento tras el cual insertar el botón. Si no se encuentra,
//          el botón queda flotando en una esquina.

(() => {
  const ID_BOTON = "mt-foco";
  const CLASE_FOCO = "mi-tema-foco";
  const html = document.documentElement;

  function textoBoton() {
    return html.classList.contains(CLASE_FOCO) ? "🎯 Salir de modo foco" : "🎯 Modo foco";
  }

  function crearBoton() {
    const btn = document.createElement("button");
    btn.id = ID_BOTON;
    btn.type = "button";
    btn.textContent = textoBoton();
    btn.addEventListener("click", () => {
      html.classList.toggle(CLASE_FOCO);
      btn.textContent = textoBoton();
    });
    return btn;
  }

  function actualizar({ rutas, ancla } = {}) {
    const enRuta = !rutas || rutas.includes(location.pathname);
    let btn = document.getElementById(ID_BOTON);

    if (!enRuta) {
      btn?.remove();
      html.classList.remove(CLASE_FOCO);
      return;
    }

    if (!btn) btn = crearBoton();

    const elAncla = ancla ? document.querySelector(ancla) : null;
    if (elAncla) {
      if (elAncla.nextElementSibling !== btn) {
        btn.classList.remove("mt-flotante");
        elAncla.after(btn);
      }
    } else if (!btn.isConnected && document.body) {
      // Si el sitio cambió su estructura y no hay ancla, lo dejamos flotando
      // para que siga mostrando algo.
      btn.classList.add("mt-flotante");
      document.body.append(btn);
    }
  }

  MiTema.registrarFeature("modo-foco", { actualizar });
})();
