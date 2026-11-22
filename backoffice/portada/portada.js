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
        const valor = 50 + 24 * Math.sin(Math.PI * t) * (1 - t * 0.35); // hacia la derecha: más de la página con tema
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

// ---------- Las descargas: la última versión de cada navegador ----------

const fecha = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" });
const DETALLE = { firefox: "Firmada por Mozilla.", chrome: "Para cargarla en modo de desarrollador." };
const NOMBRE = { firefox: "Firefox", chrome: "Chrome" };

async function leerVersion(navegador) {
  try {
    const respuesta = await fetch(`/descargas/${navegador}.json`, { headers: { Accept: "application/json" } });
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null; // sin red o sin servidor: se queda el texto de la página
  }
}

function deshabilitar(enlace, texto) {
  enlace.setAttribute("aria-disabled", "true");
  enlace.removeAttribute("href");
  enlace.querySelector("span").textContent = texto;
}

function pintarTarjeta(navegador, datos) {
  const tarjeta = document.querySelector(`[data-navegador="${navegador}"]`);
  if (!tarjeta || !datos) return;
  const insignia = tarjeta.querySelector("[data-version-insignia]");
  const detalle = tarjeta.querySelector("[data-version-detalle]");
  if (!datos.disponible) {
    // Todavía no hay un archivo publicado: el botón no lleva a un 404.
    deshabilitar(tarjeta.querySelector("[data-descarga]"), "Disponible pronto");
    tarjeta.classList.add("descarga-pronto");
    insignia.textContent = "Pronto";
    insignia.classList.remove("insignia-lista");
    detalle.textContent = "Estamos publicando la primera versión.";
    return;
  }
  const publicado = datos.publicado ? ` publicada el ${fecha.format(new Date(datos.publicado))}` : "";
  insignia.textContent = `v${datos.version}`;
  detalle.textContent = `Versión ${datos.version}${publicado}. ${DETALLE[navegador]}`;
}

// El botón de la portada ofrece el navegador de quien visita: Chrome (o Edge, Brave… cualquier Chromium) si hay .zip,
// si no Firefox. Safari y los demás ven Firefox.
const esChromium = navigator.userAgentData?.brands?.some(({ brand }) => brand === "Chromium") ??
  (/Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent));

function pintarPrincipal(versiones) {
  const principal = document.querySelector("[data-descarga-principal]");
  const nota = document.querySelector("[data-nota-versiones]");
  if (!principal) return;
  const disponibles = Object.keys(versiones).filter((navegador) => versiones[navegador]?.disponible);
  if (versiones.firefox && versiones.chrome && !disponibles.length) {
    deshabilitar(principal, "Disponible pronto");
    if (nota) nota.textContent = "Para Firefox y Chrome, muy pronto";
    return;
  }
  const elegido = esChromium && disponibles.includes("chrome") ? "chrome" : disponibles.includes("firefox") ? "firefox" : disponibles[0];
  if (elegido) {
    principal.href = `/descargas/${elegido}`;
    principal.querySelector("[data-texto-descarga]").textContent = `Descargar para ${NOMBRE[elegido]}`;
  }
  if (nota && disponibles.length) nota.textContent = disponibles.map((navegador) => `${NOMBRE[navegador]} v${versiones[navegador].version}`).join(" · ");
}

Promise.all([leerVersion("firefox"), leerVersion("chrome")]).then(([firefox, chrome]) => {
  pintarTarjeta("firefox", firefox);
  pintarTarjeta("chrome", chrome);
  pintarPrincipal({ firefox, chrome });
});

// ---------- El video de la telaraña ----------

// Sin JavaScript o con movimiento reducido el video queda quieto, con sus controles. Si no, corre en bucle solo
// mientras se ve (no baja nada hasta entonces: preload="none") y sin controles encima.
for (const video of document.querySelectorAll(".telarana-video")) {
  if (sinMovimiento || !("IntersectionObserver" in window)) continue;
  video.controls = false;
  const observador = new IntersectionObserver(([entrada]) => {
    if (entrada.isIntersecting) {
      video.play().catch(() => {
        video.controls = true; // el navegador no deja reproducir solo: que lo haga la persona
      });
    } else {
      video.pause();
    }
  }, { threshold: 0.35 });
  observador.observe(video);
}

// ---------- Aparecer al bajar ----------

const porAparecer = document.querySelectorAll(".aparece, [data-aparece]");
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
