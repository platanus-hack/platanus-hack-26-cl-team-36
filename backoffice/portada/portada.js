// Portada de chameleonmode.app. Sin JavaScript la página se ve completa y los enlaces funcionan; esto suma el
// comparador que se arrastra, la versión de la extensión y la aparición de las secciones al bajar.

const raiz = document.documentElement;
raiz.classList.replace("sin-js", "js");
const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Comparador antes / después ----------

// El control es un <input type="range"> para el teclado y los lectores de pantalla; el mouse y el dedo arrastran sobre
// la imagen (pointer events), porque un range invisible no recibe bien el puntero.
for (const comparador of document.querySelectorAll(".comparador")) {
  const control = comparador.querySelector(".comparador-control");
  const lienzo = comparador.querySelector(".comparador-lienzo");
  if (!control || !lienzo) continue;
  const mover = (valor) => comparador.style.setProperty("--corte", `${valor}%`);
  let tocado = false;
  let arrastrando = false;
  control.addEventListener("input", () => {
    tocado = true;
    mover(control.value);
  });
  const desdePuntero = (evento) => {
    const caja = lienzo.getBoundingClientRect();
    const valor = Math.min(100, Math.max(0, ((evento.clientX - caja.left) / caja.width) * 100));
    control.value = String(Math.round(valor));
    mover(valor.toFixed(2));
  };
  lienzo.addEventListener("pointerdown", (evento) => {
    if (evento.button !== 0) return;
    tocado = true;
    arrastrando = true;
    lienzo.setPointerCapture(evento.pointerId);
    desdePuntero(evento);
  });
  lienzo.addEventListener("pointermove", (evento) => {
    if (arrastrando) desdePuntero(evento);
  });
  for (const tipo of ["pointerup", "pointercancel"]) lienzo.addEventListener(tipo, () => (arrastrando = false));

  // Una sola vez, al verlo: la línea va hacia un lado y vuelve, para que se note que se puede arrastrar.
  if (!sinMovimiento && "IntersectionObserver" in window) {
    const observador = new IntersectionObserver((entradas) => {
      if (!entradas.some((entrada) => entrada.isIntersecting)) return;
      observador.disconnect();
      const inicio = performance.now();
      const duracion = 1800;
      const paso = (ahora) => {
        if (tocado) return;
        const t = Math.min(1, (ahora - inicio) / duracion);
        const valor = 50 - 22 * Math.sin(Math.PI * t) * (1 - t * 0.35);
        mover(valor.toFixed(2));
        control.value = String(Math.round(valor));
        if (t < 1) requestAnimationFrame(paso);
        else mover(50);
      };
      setTimeout(() => requestAnimationFrame(paso), 500);
    }, { threshold: 0.6 });
    observador.observe(comparador);
  }
}

// ---------- La última versión para Firefox ----------

const fecha = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" });

async function mostrarVersion() {
  let datos;
  try {
    const respuesta = await fetch("/descargas/firefox.json", { headers: { Accept: "application/json" } });
    if (!respuesta.ok) return;
    datos = await respuesta.json();
  } catch {
    return; // sin red o sin servidor: se queda el texto de la página
  }
  const nota = document.querySelector("[data-version-firefox]");
  const insignia = document.querySelector("[data-version-insignia]");
  const detalle = document.querySelector("[data-version-detalle]");
  if (!datos?.disponible) {
    // Todavía no hay un .xpi publicado: los botones no llevan a un 404.
    for (const enlace of document.querySelectorAll("[data-descarga-firefox]")) {
      enlace.setAttribute("aria-disabled", "true");
      enlace.removeAttribute("href");
      enlace.lastChild.textContent = " Disponible pronto";
    }
    if (nota) nota.textContent = "Firefox y Chrome, próximamente";
    if (insignia) insignia.textContent = "Pronto";
    if (detalle) detalle.textContent = "Estamos publicando la primera versión.";
    return;
  }
  const publicado = datos.publicado ? fecha.format(new Date(datos.publicado)) : null;
  if (nota) nota.textContent = `Firefox · versión ${datos.version} firmada por Mozilla · Chrome, próximamente`;
  if (insignia) insignia.textContent = `v${datos.version}`;
  if (detalle) detalle.textContent = publicado ? `Versión ${datos.version}, publicada el ${publicado}. Firmada por Mozilla.` : `Versión ${datos.version}, firmada por Mozilla.`;
}
mostrarVersion();

// ---------- Aparecer al bajar ----------

const porAparecer = document.querySelectorAll(".aparece");
if (sinMovimiento || !("IntersectionObserver" in window)) {
  for (const elemento of porAparecer) elemento.classList.add("visible");
} else {
  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      entrada.target.classList.add("visible");
      observador.unobserve(entrada.target);
    }
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.15 });
  for (const elemento of porAparecer) observador.observe(elemento);
}
