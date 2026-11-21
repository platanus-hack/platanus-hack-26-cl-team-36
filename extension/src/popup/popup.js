// Popup del ícono de la barra: interruptor ON/OFF de Chameleon y opinión sobre la página.
//
// - Interruptor: invierte `activo` en storage.local. content/motor.js escucha ese cambio y
//   corre la metamorfosis en la pestaña; el background pinta el badge. El popup se
//   redibuja con storage.onChanged, venga de donde venga el cambio.
// - Opinión: pregunta a la pestaña activa `estado:pagina` (content/captura.js) para decidir
//   qué mostrar (ver estado.js) y guarda con `voto:guardar` en el background.
//
// JS solo pone atributos, clases y textos; todo lo visual está en popup.css.

import { crearCola, decidirVista, textoPendientes, validarEnvio } from "./estado.js";

const $ = (id) => document.getElementById(id);
const el = {
  cuerpo: document.body,
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
  activo: null, // null mientras se lee storage
  tabId: null,
  pagina: null, // { alcanzable, temaId } | null mientras se consulta
  opcion: null, // "mejor" | "peor" | "comentario" | null
  guardando: false,
  pendientes: null,
  mensaje: null, // { tipo: "exito" | "error", texto } | null
};

// ---------- Dibujo ----------

function dibujarInterruptor() {
  const { activo } = estado;
  el.cuerpo.dataset.activo = activo === null ? "cargando" : activo ? "si" : "no";
  el.interruptor.disabled = activo === null;
  el.interruptor.setAttribute("aria-pressed", String(Boolean(activo)));
  el.chip.textContent = activo === null ? "…" : activo ? "ON" : "OFF";
  el.estado.textContent = activo === null ? "Cargando…" : activo ? "Encendido" : "Apagado";
  el.ayuda.textContent =
    activo === null ? "" : activo ? "Toca para volver a la página original" : "Toca para aplicar el diseño de Chameleon";
}

function dibujarOpinion() {
  const cargando = estado.pagina === null || estado.activo === null;
  const vista = cargando ? { modo: "cargando", aviso: null } : decidirVista(estado);
  el.opinion.dataset.modo = vista.modo;
  el.aviso.textContent = vista.aviso ?? "";

  // Si "Mejor"/"Peor" se ocultan (p. ej. al apagar), la elección deja de valer.
  if (vista.modo !== "completa" && estado.opcion !== "comentario") estado.opcion = null;
  for (const boton of el.opciones) {
    boton.setAttribute("aria-pressed", String(boton.dataset.voto === estado.opcion));
    boton.disabled = estado.guardando;
  }

  const pideTexto = vista.modo === "solo-comentario" || estado.opcion === "comentario";
  el.comentario.placeholder = pideTexto ? "Escribe tu comentario" : "Cuéntanos qué cambiarías (opcional)";
  el.comentario.disabled = estado.guardando;

  const envio = validarEnvio({ modo: vista.modo, opcion: estado.opcion, comentario: el.comentario.value });
  el.enviar.disabled = cargando || estado.guardando || !envio.ok;
  el.enviar.textContent = estado.guardando ? "Guardando…" : "Enviar";
  el.formulario.setAttribute("aria-busy", String(estado.guardando));
  // La pista calla mientras se muestra el resultado del último envío (no compiten dos avisos).
  el.pista.textContent = cargando || estado.guardando || envio.ok || estado.mensaje ? "" : envio.motivo;

  el.mensaje.textContent = estado.mensaje?.texto ?? "";
  el.mensaje.dataset.tipo = estado.mensaje?.tipo ?? "";
  el.pendientes.textContent = estado.pendientes === null ? "" : textoPendientes(estado.pendientes);
}

function dibujar() {
  dibujarInterruptor();
  dibujarOpinion();
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
  if (area !== "local" || !("activo" in cambios)) return;
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
    respuesta = { ok: false, error: "No se pudo guardar tu opinión. Inténtalo de nuevo." };
  }
  estado.guardando = false;
  if (respuesta?.ok) {
    estado.mensaje = { tipo: "exito", texto: "¡Gracias! Tu opinión quedó guardada en tu equipo." };
    estado.pendientes = respuesta.pendientes;
    estado.opcion = null;
    el.comentario.value = "";
  } else {
    estado.mensaje = { tipo: "error", texto: respuesta?.error ?? "No se pudo guardar tu opinión. Inténtalo de nuevo." };
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

async function iniciar() {
  dibujar();
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
  estado.activo ??= true;
  estado.pagina ??= { alcanzable: false, temaId: null };
  dibujar();
});
