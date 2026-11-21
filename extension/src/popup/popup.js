// Popup del ícono de la barra: interruptor ON/OFF de Chameleon y opinión sobre la página.
//
// - Interruptor: invierte `activo` en storage.local. content/motor.js escucha ese cambio y
//   corre la metamorfosis en la pestaña; el background pinta el badge. El popup se
//   redibuja con storage.onChanged, venga de donde venga el cambio.
// - Opinión: pregunta a la pestaña activa `estado:pagina` (content/captura.js) para decidir
//   qué mostrar (ver estado.js) y guarda con `voto:guardar` en el background.
//
// - Idioma: el selector de la cabecera guarda `idioma` en storage.local. Todos los textos
//   salen del diccionario (comun/idioma.js): los fijos del HTML con data-mt-texto*, los
//   demás desde acá. Al cambiar de idioma se anima el cambio (idioma.js); al abrir, no.
//
// JS solo pone atributos, clases y textos; todo lo visual está en popup.css e idioma.css.

import "../comun/idioma.js";
import { crearCola, decidirVista, textoPendientes, validarEnvio } from "./estado.js";
import { animarCambio, crearSelectorIdioma, ponerTexto } from "./idioma.js";
import "./interruptor.js"; // animación del camaleón del interruptor (solo visual)

const { CLAVE_IDIOMA, IDIOMAS, TEXTOS, IDIOMA_POR_DEFECTO, normalizarIdioma, t } = globalThis.MiTema.idioma;

const $ = (id) => document.getElementById(id);
const el = {
  cuerpo: document.body,
  panel: document.querySelector(".mt-panel"),
  control: document.querySelector(".mt-control"),
  idioma: $("mt-idioma"),
  idiomaBoton: $("mt-idioma-boton"),
  idiomaActual: $("mt-idioma-actual"),
  chip: $("mt-chip"),
  interruptor: $("mt-interruptor"),
  estado: $("mt-estado"),
  ayuda: $("mt-estado-ayuda"),
  opinion: $("mt-opinion"),
  aviso: $("mt-aviso"),
  formulario: $("mt-formulario"),
  opciones: [...document.querySelectorAll(".mt-opcion")],
  comentario: $("mt-comentario"),
  pista: $("mt-pista"),
  enviar: $("mt-enviar"),
  mensaje: $("mt-mensaje"),
  pendientes: $("mt-pendientes"),
};

const estado = {
  idioma: null, // null mientras se lee storage
  activo: null, // null mientras se lee storage
  tabId: null,
  pagina: null, // { alcanzable, temaId } | null mientras se consulta
  opcion: null, // "mejor" | "peor" | "comentario" | null
  guardando: false,
  pendientes: null,
  mensaje: null, // { tipo: "exito" | "error", clave, parametros } | { tipo, texto } | null
};

const tx = (clave, parametros) => t(estado.idioma, clave, parametros);

// ---------- Dibujo ----------

// Textos fijos del HTML (data-mt-texto*), el selector y <html lang>.
function dibujarIdioma() {
  const idioma = normalizarIdioma(estado.idioma);
  const html = document.documentElement;
  html.lang = idioma;
  if (estado.idioma !== null) html.dataset.mtIdioma = idioma; // idioma.css muestra el panel recién ahí
  for (const nodo of document.querySelectorAll("[data-mt-texto]")) ponerTexto(nodo, tx(nodo.dataset.mtTexto));
  for (const nodo of document.querySelectorAll("[data-mt-texto-placeholder]")) {
    nodo.placeholder = tx(nodo.dataset.mtTextoPlaceholder);
  }
  for (const nodo of document.querySelectorAll("[data-mt-texto-aria-label]")) {
    nodo.setAttribute("aria-label", tx(nodo.dataset.mtTextoAriaLabel));
  }
  el.control?.setAttribute("aria-label", tx("interruptor.seccion"));
  ponerTexto(el.idiomaActual, IDIOMAS[idioma].corto);
  el.idiomaBoton.setAttribute("aria-label", tx("idioma.boton", { nombre: IDIOMAS[idioma].nombre }));
  selector.mostrar(idioma);
}

function dibujarInterruptor() {
  const { activo } = estado;
  el.cuerpo.dataset.activo = activo === null ? "cargando" : activo ? "si" : "no";
  el.interruptor.disabled = activo === null;
  el.interruptor.setAttribute("aria-pressed", String(Boolean(activo)));
  el.chip.textContent = activo === null ? "…" : activo ? "ON" : "OFF"; // igual en todos los idiomas
  ponerTexto(el.estado, tx(activo === null ? "interruptor.cargando" : activo ? "interruptor.encendido" : "interruptor.apagado"));
  ponerTexto(el.ayuda, activo === null ? "" : tx(activo ? "interruptor.ayudaEncendido" : "interruptor.ayudaApagado"));
}

function dibujarOpinion() {
  const cargando = estado.pagina === null || estado.activo === null;
  const vista = cargando ? { modo: "cargando", aviso: null } : decidirVista(estado);
  el.opinion.dataset.modo = vista.modo;
  ponerTexto(el.aviso, vista.aviso ? tx(vista.aviso) : "");

  // Si "Mejor"/"Peor" se ocultan (p. ej. al apagar), la elección deja de valer.
  if (vista.modo !== "completa" && estado.opcion !== "comentario") estado.opcion = null;
  for (const boton of el.opciones) {
    boton.setAttribute("aria-pressed", String(boton.dataset.voto === estado.opcion));
    boton.disabled = estado.guardando;
  }

  const pideTexto = vista.modo === "solo-comentario" || estado.opcion === "comentario";
  el.comentario.placeholder = tx(pideTexto ? "opinion.comentarioObligatorio" : "opinion.comentarioOpcional");
  el.comentario.disabled = estado.guardando;

  const envio = validarEnvio({ modo: vista.modo, opcion: estado.opcion, comentario: el.comentario.value });
  el.enviar.disabled = cargando || estado.guardando || !envio.ok;
  ponerTexto(el.enviar, tx(estado.guardando ? "opinion.guardando" : "opinion.enviar"));
  el.formulario.setAttribute("aria-busy", String(estado.guardando));
  // La pista calla mientras se muestra el resultado del último envío (no compiten dos avisos).
  const callaPista = cargando || estado.guardando || envio.ok || estado.mensaje;
  ponerTexto(el.pista, callaPista ? "" : tx(envio.motivo, envio.parametros));

  // Región viva (role=status): no se anima, para que el lector de pantalla no lea basura.
  el.mensaje.textContent = textoMensaje(estado.mensaje);
  el.mensaje.dataset.tipo = estado.mensaje?.tipo ?? "";
  ponerTexto(el.pendientes, estado.pendientes === null ? "" : textoPendientes(estado.pendientes, estado.idioma));
}

function textoMensaje(mensaje) {
  if (!mensaje) return "";
  return mensaje.clave ? tx(mensaje.clave, mensaje.parametros) : mensaje.texto;
}

function dibujar() {
  dibujarIdioma();
  dibujarInterruptor();
  dibujarOpinion();
}

// ---------- Idioma ----------

const selector = crearSelectorIdioma({ raiz: el.idioma, alElegir: elegirIdioma });

// Elementos cuyo texto anima el cambio de idioma (el mensaje, región viva, no).
function elementosConTexto() {
  return [
    ...document.querySelectorAll("[data-mt-texto]"),
    el.idiomaActual,
    el.aviso,
    el.pista,
    el.enviar,
    el.pendientes,
    el.estado,
    el.ayuda,
  ];
}

function aplicarIdioma(idioma, { animar = true } = {}) {
  const nuevo = normalizarIdioma(idioma);
  if (nuevo === estado.idioma) return;
  const primeraVez = estado.idioma === null; // la primera pintura no se anima
  estado.idioma = nuevo;
  if (primeraVez || !animar) dibujar();
  else animarCambio({ elementos: elementosConTexto(), aplicar: dibujar, raiz: el.panel });
}

function elegirIdioma(idioma) {
  aplicarIdioma(idioma);
  browser.storage.local
    .set({ [CLAVE_IDIOMA]: normalizarIdioma(idioma) })
    .catch((error) => console.error("[mi-tema] No se pudo guardar el idioma:", error));
}

// Errores del background: `codigo` → clave `error.<codigo>`; si no se conoce, su texto.
function mensajeDeError(respuesta) {
  const clave = `error.${respuesta?.codigo}`;
  if (Object.hasOwn(TEXTOS[IDIOMA_POR_DEFECTO], clave)) return { tipo: "error", clave, parametros: respuesta.parametros };
  if (respuesta?.error) return { tipo: "error", texto: respuesta.error };
  return { tipo: "error", clave: "error.guardar" };
}

// ---------- Interruptor ----------

const encolar = crearCola();

async function alternar() {
  const { activo = true } = await browser.storage.local.get("activo");
  await browser.storage.local.set({ activo: !activo });
}

el.interruptor.addEventListener("click", () => {
  encolar(alternar).catch((error) => console.error("[mi-tema] No se pudo cambiar el estado:", error));
});

browser.storage.onChanged.addListener((cambios, area) => {
  if (area !== "local") return;
  if (CLAVE_IDIOMA in cambios) aplicarIdioma(cambios[CLAVE_IDIOMA].newValue);
  if (!("activo" in cambios)) return;
  estado.activo = cambios.activo.newValue ?? true;
  estado.mensaje = null; // el aviso de la opinión anterior ya no corresponde a lo que se ve
  dibujar();
});

// ---------- Opinión ----------

for (const boton of el.opciones) {
  boton.addEventListener("click", () => {
    estado.opcion = estado.opcion === boton.dataset.voto ? null : boton.dataset.voto;
    estado.mensaje = null;
    dibujar();
    if (estado.opcion === "comentario") el.comentario.focus();
  });
}

el.comentario.addEventListener("input", () => {
  if (estado.mensaje?.tipo === "exito") estado.mensaje = null;
  dibujar();
});

el.formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const modo = el.opinion.dataset.modo;
  const envio = validarEnvio({ modo, opcion: estado.opcion, comentario: el.comentario.value });
  if (!envio.ok || estado.guardando) return;

  estado.guardando = true;
  estado.mensaje = null;
  dibujar();
  let respuesta;
  try {
    respuesta = await browser.runtime.sendMessage({
      tipo: "voto:guardar",
      tabId: estado.tabId,
      voto: envio.voto,
      comentario: envio.comentario,
    });
  } catch (error) {
    console.error("[mi-tema] No se pudo enviar el voto al background:", error);
    respuesta = { ok: false, codigo: "guardar" };
  }
  estado.guardando = false;
  if (respuesta?.ok) {
    estado.mensaje = { tipo: "exito", clave: "opinion.gracias" };
    estado.pendientes = respuesta.pendientes;
    estado.opcion = null;
    el.comentario.value = "";
  } else {
    estado.mensaje = mensajeDeError(respuesta);
  }
  dibujar();
});

// ---------- Carga ----------

// Solo para verificar el popup abierto como pestaña (ahí la pestaña activa es el propio
// popup): `popup.html?pestana=<id>` apunta a otra pestaña. Únicamente con la extensión
// cargada como temporal (installType "development"); instalada, se ignora.
async function pestanaDePrueba() {
  const id = Number(new URLSearchParams(location.search).get("pestana"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const extension = await browser.management.getSelf();
  return extension.installType === "development" ? id : null;
}

async function pestanaObjetivo() {
  const deprueba = await pestanaDePrueba();
  if (deprueba !== null) return deprueba;
  const [pestana] = await browser.tabs.query({ active: true, currentWindow: true });
  return pestana?.id ?? null;
}

// Pestañas sin content script (about:, addons.mozilla.org, abiertas antes de instalar)
// hacen fallar sendMessage: se tratan como no alcanzables.
async function consultarPagina(tabId) {
  if (!Number.isInteger(tabId)) return { alcanzable: false, temaId: null };
  try {
    const respuesta = await browser.tabs.sendMessage(tabId, { tipo: "estado:pagina" }, { frameId: 0 });
    return { alcanzable: Boolean(respuesta), temaId: respuesta?.temaId ?? null };
  } catch {
    return { alcanzable: false, temaId: null };
  }
}

async function leerIdioma() {
  try {
    return (await browser.storage.local.get(CLAVE_IDIOMA))[CLAVE_IDIOMA];
  } catch (error) {
    console.error("[mi-tema] No se pudo leer el idioma:", error);
    return IDIOMA_POR_DEFECTO;
  }
}

async function iniciar() {
  // El idioma primero: el panel no se muestra hasta tenerlo (idioma.css), así no parpadea en español.
  aplicarIdioma(await leerIdioma(), { animar: false });
  const [almacenado, votos] = await Promise.all([
    browser.storage.local.get("activo"),
    browser.runtime.sendMessage({ tipo: "votos:estado" }).catch(() => ({ pendientes: null })),
  ]);
  estado.activo ??= almacenado.activo ?? true; // si el interruptor ya cambió, manda ese valor
  estado.pendientes = votos?.pendientes ?? null;
  dibujar();

  estado.tabId = await pestanaObjetivo();
  estado.pagina = await consultarPagina(estado.tabId);
  dibujar();
}

iniciar().catch((error) => {
  console.error("[mi-tema] No se pudo iniciar el popup:", error);
  estado.idioma ??= IDIOMA_POR_DEFECTO;
  estado.activo ??= true;
  estado.pagina ??= { alcanzable: false, temaId: null };
  dibujar();
});
