// Portada de chameleonmode.app. Sin JavaScript la página se ve completa, en inglés, y los enlaces funcionan; esto suma
// el español (EN | ES), el comparador que se arrastra, las versiones publicadas, los videos y la aparición
// de las secciones al bajar.

const raiz = document.documentElement;
raiz.classList.replace("sin-js", "js");
const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Idioma ----------

// El inglés vive en el HTML; aquí, el español de cada clave data-i18n (texto), data-i18n-html (con marcas, solo de este
// diccionario), data-i18n-alt y data-i18n-aria-label.
const ES = {
  descripcion: "Una extensión que rediseña los sitios difíciles de usar, con agentes de IA que los recorren como personas para encontrar dónde se pierden.",
  saltar: "Saltar al contenido",
  marca: "Chameleon Mode, inicio",
  nav: "Secciones",
  "nav.como": "Cómo funciona",
  "nav.telarana": "La telaraña",
  "nav.descargar": "Descargar",
  idioma: "Idioma",
  "ir-app": "Ir a la app",
  "portada.etiqueta": "Extensión de navegador",
  "portada.titulo": "La web, <span>adaptada a ti.</span>",
  "portada.bajada":
    "Agentes de IA recorren cada sitio como lo haría una persona, encuentran dónde se pierde la gente y generan un tema que la extensión aplica encima de la página. El sitio original no cambia, y siempre puedes volver a él.",
  "portada.todas": "todas las descargas",
  "comparador.antes": "La portada de Metro de Santiago tal como es: el menú y una grilla gris con el estado de cada línea sobre un video.",
  "comparador.despues":
    "La misma portada con el tema de Chameleon: fondo oscuro, «Planifica tu viaje» y seis tareas numeradas con el color de cada línea, como el estado del servicio, el plano de la red y los horarios, y un buscador de tareas.",
  "comparador.control": "Comparar: a la izquierda la página con Chameleon, a la derecha la original",
  "comparador.pie": "Metro de Santiago con el tema que generaron los agentes y sin él: lo que la gente viene a hacer, arriba y en orden.",
  "comparador.arrastra": "Arrastra para comparar.",
  "con-chameleon": "Con Chameleon",
  original: "Original",
  "problema.frase":
    "Dar de baja un servicio, pedir un certificado, encontrar el horario de una sucursal. <span>Tareas simples que en muchos sitios se vuelven un laberinto. El dueño del sitio rara vez lo arregla, y quien lo sufre no puede hacer nada.</span>",
  "telefono.antes": "metro.cl en el teléfono tal como es: un banner y el estado de cada línea; para planificar un viaje hay que seguir bajando.",
  "telefono.despues": "metro.cl con el tema de Chameleon: «Planifica tu viaje» y una lista numerada de tareas, cada una con el color de una línea.",
  "como.etiqueta": "Cómo funciona",
  "como.titulo": "Antes de tocar un sitio, cuatro agentes lo estudian",
  "como.bajada": "Cada cambio sale de ver a alguien perderse, no de una opinión sobre cómo debería verse la página.",
  "rol.catalogador": "Catalogador",
  "rol.guia": "Guía",
  "rol.visitantes": "Visitantes",
  "rol.disenador": "Diseñador",
  "paso1.titulo": "Descubre a qué viene la gente",
  "paso1.texto": "Lee el sitio y hace un catálogo de lo que la gente viene a hacer en él: los trámites, las consultas, lo que buscan.",
  "paso2.titulo": "Encuentra el camino más corto",
  "paso2.texto": "Para cada objetivo busca y verifica la ruta de referencia: por dónde se llega, página a página.",
  "paso3.titulo": "Lo intentan como personas",
  "paso3.texto":
    "Usuarios sintéticos intentan la tarea viendo solo capturas de pantalla, en escritorio y en el teléfono: unos van directo, otros parten por el menú, el buscador o el pie.",
  "paso4.titulo": "Genera el tema",
  "paso4.texto": "Con lo que muestran los intentos, escribe un tema: más contraste, la tarea a la vista, atajos donde la gente se perdió.",
  "telarana.etiqueta": "La telaraña",
  "telarana.titulo": "Mira por dónde se pierde la gente",
  "telarana.bajada":
    "Cada intento de un visitante se dibuja mientras ocurre: la ruta recomendada como eje, un anillo por paso y, en ramas, cada desvío y cada vuelta atrás. Antes de cambiar nada, se ve dónde se trabó alguien.",
  "telarana.video":
    "Una telaraña de ejemplo: ocho visitantes sintéticos buscan el horario de las sucursales de un banco inventado; dos llegan, dos fallan y cuatro abandonan.",
  "telarana.pie": "Un ejemplo ilustrativo, acelerado: ocho visitantes buscan el horario de las sucursales de un banco inventado. Solo dos llegan.",
  "clave1.titulo": "Ruta recomendada",
  "clave1.texto": "El eje turquesa: el camino más corto que verificó la Guía, página a página.",
  "clave2.titulo": "Desvíos y vueltas atrás",
  "clave2.texto": "Cada rama es una página fuera de la ruta. El grosor dice cuántos pasaron por ahí y el color, cómo terminaron.",
  "clave3.titulo": "Dónde se trabó",
  "clave3.texto": "Una marca donde alguien no logró avanzar: ahí es donde el tema tiene que ayudar.",
  evidencia: "Lo que dejan los agentes",
  "replay.titulo": "Cada intento, paso a paso",
  "replay.texto":
    "Qué vio el visitante, dónde hizo clic, qué esperaba encontrar y dónde quedó. La misma evidencia que usa el Diseñador está a la vista de cualquiera.",
  "replay.video":
    "El Replay de un intento real en metro.cl, acelerado: el visitante recorre las páginas de transparencia, se desvía dos veces y vuelve antes de llegar a los informes financieros; al lado, la ruta de la Guía y lo que el visitante esperaba en cada paso.",
  "replay.pie": "Un intento real en metro.cl, a 2×.",
  "descargar.etiqueta": "Descargar",
  "descargar.titulo": "Instala Chameleon en tu navegador",
  "descargar.bajada":
    "Chameleon todavía no está en las tiendas de los navegadores, así que se instala desde aquí. La versión de Firefox está firmada por Mozilla; la de Chrome se carga en modo de desarrollador. Cada una toma más o menos un minuto.",
  "firefox.paso1":
    "Abre esta página en Firefox y aprieta <em>Descargar el .xpi</em>. Firefox avisa que bloqueó al sitio para instalar software: aprieta <em>Continuar con la instalación</em>.",
  "firefox.paso2": "Pide acceso a tus datos en todos los sitios: aprieta <em>Añadir</em>.",
  "firefox.paso3": "Fíjala en la barra desde el menú de extensiones (la pieza de puzzle): su ícono enciende y apaga el tema.",
  "firefox.ayuda":
    "Necesita Firefox 140 o superior. Hacer doble clic en el archivo .xpi no lo instala: si ya lo descargaste, arrástralo a una ventana de Firefox, o abre <code>about:addons</code>, aprieta el engranaje y elige <em>Instalar complemento desde archivo…</em>",
  "chrome.paso1": "Descomprime el .zip en una carpeta que no vayas a borrar.",
  "chrome.paso2": "Abre <code>chrome://extensions</code> y activa <em>Modo de desarrollador</em>.",
  "chrome.paso3": "Aprieta <em>Cargar descomprimida</em> y elige esa carpeta.",
  "chrome.paso4": "Fíjala en la barra desde el menú de extensiones (la pieza de puzzle): su ícono enciende y apaga el tema.",
  "chrome.ayuda": "Necesita Chrome 148 o superior. En la Chrome Web Store, próximamente.",
  "permisos.titulo": "Por qué pide acceso a todos los sitios",
  "permisos.texto":
    "Aplica temas en el sitio que abras, así que necesita llegar a la página. Para saber si la página tiene tema solo envía su dirección, sin parámetros, y no envía nada en ventanas privadas ni mientras está apagada.",
  "actualizar.titulo": "Cómo actualizar",
  "actualizar.texto":
    "No se actualiza sola. La versión de esta página es siempre la última: en Firefox, descárgala e instálala encima de la anterior; en Chrome, reemplaza la carpeta y aprieta el botón de recargar de la extensión en <code>chrome://extensions</code>.",
  "cierre.titulo": "Mira a los agentes trabajar",
  "cierre.texto": "Los sitios revisados, las tandas de visitantes y los temas propuestos, en vivo.",
  "pie.antes": "chameleonmode.app · Hecho en",
  "pie.despues": ", Santiago",
  huevo: "Platanus Hack 26: ¡plátanos!",
};

// Lo que escribe este script (descargas y versiones), en los dos idiomas.
const DINAMICOS = {
  en: {
    fecha: "en-US",
    descargarPara: (navegador) => `Download for ${navegador}`,
    paraAmbos: "For Firefox and Chrome",
    muyPronto: "For Firefox and Chrome, very soon",
    disponible: "Available",
    pronto: "Soon",
    disponiblePronto: "Available soon",
    boton: { firefox: "Download the .xpi", chrome: "Download the .zip" },
    sinVersion: { firefox: "The latest version, signed by Mozilla.", chrome: "The latest version, to load in developer mode." },
    detalle: { firefox: "Signed by Mozilla.", chrome: "To load in developer mode." },
    version: (version, publicado) => `Version ${version}${publicado ? `, published ${publicado}` : ""}.`,
    publicando: "We're publishing the first version.",
  },
  es: {
    fecha: "es-CL",
    descargarPara: (navegador) => `Descargar para ${navegador}`,
    paraAmbos: "Para Firefox y Chrome",
    muyPronto: "Para Firefox y Chrome, muy pronto",
    disponible: "Disponible",
    pronto: "Pronto",
    disponiblePronto: "Disponible pronto",
    boton: { firefox: "Descargar el .xpi", chrome: "Descargar el .zip" },
    sinVersion: { firefox: "La última versión, firmada por Mozilla.", chrome: "La última versión, para cargarla en modo de desarrollador." },
    detalle: { firefox: "Firmada por Mozilla.", chrome: "Para cargarla en modo de desarrollador." },
    version: (version, publicado) => `Versión ${version}${publicado ? `, publicada el ${publicado}` : ""}.`,
    publicando: "Estamos publicando la primera versión.",
  },
};

const IDIOMAS = ["en", "es"];
const CLAVE_IDIOMA = "chameleon-idioma";
let idioma = "en";
const originales = new Map(); // elemento → el inglés del HTML, para volver a él
const descripcion = document.querySelector('meta[name="description"]');
const descripcionEnIngles = descripcion?.content ?? "";

function traducir(nuevo) {
  idioma = nuevo;
  const es = nuevo === "es";
  raiz.lang = nuevo;
  if (descripcion) descripcion.content = es ? ES.descripcion : descripcionEnIngles;
  for (const el of document.querySelectorAll("[data-i18n], [data-i18n-html], [data-i18n-alt], [data-i18n-aria-label]")) {
    if (!originales.has(el)) {
      originales.set(el, { texto: el.textContent, html: el.innerHTML, alt: el.getAttribute("alt"), aria: el.getAttribute("aria-label") });
    }
    const o = originales.get(el);
    const { i18n, i18nHtml, i18nAlt, i18nAriaLabel } = el.dataset;
    if (i18n) el.textContent = es ? (ES[i18n] ?? o.texto) : o.texto;
    if (i18nHtml) el.innerHTML = es ? (ES[i18nHtml] ?? o.html) : o.html;
    if (i18nAlt) el.setAttribute("alt", es ? (ES[i18nAlt] ?? o.alt) : o.alt);
    if (i18nAriaLabel) el.setAttribute("aria-label", es ? (ES[i18nAriaLabel] ?? o.aria) : o.aria);
  }
  for (const boton of document.querySelectorAll("[data-idioma]")) boton.setAttribute("aria-pressed", String(boton.dataset.idioma === nuevo));
  pintarDescargas();
}

function idiomaInicial() {
  const pedido = new URLSearchParams(location.search).get("lang");
  if (IDIOMAS.includes(pedido)) return pedido;
  try {
    const guardado = localStorage.getItem(CLAVE_IDIOMA);
    if (IDIOMAS.includes(guardado)) return guardado;
  } catch {
    // sin almacenamiento (ventana privada, bloqueado): inglés
  }
  return "en";
}

for (const boton of document.querySelectorAll("[data-idioma]")) {
  boton.addEventListener("click", () => {
    const nuevo = boton.dataset.idioma;
    if (nuevo === idioma) return;
    try {
      localStorage.setItem(CLAVE_IDIOMA, nuevo);
    } catch {
      // se cambia igual, solo no se recuerda
    }
    traducir(nuevo);
  });
}

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

const NOMBRE = { firefox: "Firefox", chrome: "Chrome" };
const versiones = { firefox: undefined, chrome: undefined }; // undefined: todavía no se sabe; null: no respondió

async function leerVersion(navegador) {
  try {
    const respuesta = await fetch(`/descargas/${navegador}.json`, { headers: { Accept: "application/json" } });
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null; // sin red o sin servidor: se queda el texto de la página
  }
}

function ponerBoton(enlace, texto, href) {
  if (href) {
    enlace.href = href;
    enlace.removeAttribute("aria-disabled");
  } else {
    enlace.removeAttribute("href");
    enlace.setAttribute("aria-disabled", "true");
  }
  enlace.querySelector("span").textContent = texto;
}

function pintarTarjeta(navegador, t) {
  const tarjeta = document.querySelector(`[data-navegador="${navegador}"]`);
  if (!tarjeta) return;
  const datos = versiones[navegador];
  const insignia = tarjeta.querySelector("[data-version-insignia]");
  const detalle = tarjeta.querySelector("[data-version-detalle]");
  const enlace = tarjeta.querySelector("[data-descarga]");
  const pronto = datos?.disponible === false; // no hay nada publicado: el botón no lleva a un 404
  tarjeta.classList.toggle("descarga-pronto", pronto);
  insignia.classList.toggle("insignia-lista", !pronto);
  if (pronto) {
    insignia.textContent = t.pronto;
    detalle.textContent = t.publicando;
    ponerBoton(enlace, t.disponiblePronto, null);
    return;
  }
  ponerBoton(enlace, t.boton[navegador], `/descargas/${navegador}`);
  if (!datos?.disponible) {
    insignia.textContent = t.disponible;
    detalle.textContent = t.sinVersion[navegador];
    return;
  }
  const publicado = datos.publicado ? new Intl.DateTimeFormat(t.fecha, { day: "numeric", month: "long", year: "numeric" }).format(new Date(datos.publicado)) : null;
  insignia.textContent = `v${datos.version}`;
  detalle.textContent = `${t.version(datos.version, publicado)} ${t.detalle[navegador]}`;
}

// El botón de la portada ofrece el navegador de quien visita: Chrome (o Edge, Brave… cualquier Chromium) si hay .zip,
// si no Firefox. Safari y los demás ven Firefox.
const esChromium = navigator.userAgentData?.brands?.some(({ brand }) => brand === "Chromium") ??
  (/Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent));

function pintarPrincipal(t) {
  const principal = document.querySelector("[data-descarga-principal]");
  const nota = document.querySelector("[data-nota-versiones]");
  if (!principal) return;
  const disponibles = Object.keys(versiones).filter((navegador) => versiones[navegador]?.disponible);
  const ninguno = versiones.firefox?.disponible === false && versiones.chrome?.disponible === false;
  if (ninguno) {
    principal.removeAttribute("href");
    principal.setAttribute("aria-disabled", "true");
    principal.querySelector("[data-texto-descarga]").textContent = t.disponiblePronto;
    if (nota) nota.textContent = t.muyPronto;
    return;
  }
  const elegido = esChromium && disponibles.includes("chrome") ? "chrome" : disponibles.includes("firefox") ? "firefox" : (disponibles[0] ?? "firefox");
  principal.href = `/descargas/${elegido}`;
  principal.removeAttribute("aria-disabled");
  principal.querySelector("[data-texto-descarga]").textContent = t.descargarPara(NOMBRE[elegido]);
  if (nota) {
    nota.textContent = disponibles.length
      ? disponibles.map((navegador) => `${NOMBRE[navegador]} v${versiones[navegador].version}`).join(" · ")
      : t.paraAmbos;
  }
}

function pintarDescargas() {
  const t = DINAMICOS[idioma];
  pintarTarjeta("firefox", t);
  pintarTarjeta("chrome", t);
  pintarPrincipal(t);
}

traducir(idiomaInicial());

Promise.all([leerVersion("firefox"), leerVersion("chrome")]).then(([firefox, chrome]) => {
  versiones.firefox = firefox;
  versiones.chrome = chrome;
  pintarDescargas();
});

// ---------- Los videos (la telaraña y el Replay) ----------

// Sin JavaScript o con movimiento reducido el video queda quieto, con sus controles. Si no, corre en bucle solo
// mientras se ve (no baja nada hasta entonces: preload="none") y sin controles encima.
for (const video of document.querySelectorAll(".video-auto")) {
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
