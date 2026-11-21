/**
 * Script de fondo: es el único que habla con el puente local, guarda las pieles y las inyecta.
 *
 * Firefox lo descarga tras unos 30 s sin eventos, así que nada esencial vive solo en memoria:
 * la configuración y las pieles están en `storage.local`; el estado de cada pestaña y las
 * generaciones en curso, en `storage.session`.
 */

import {
  URL_PUENTE_POR_DEFECTO,
  borrarEstadoPestana,
  borrarGeneracion,
  borrarPieles,
  contarPieles,
  guardarConfiguracion,
  guardarEstadoPestana,
  guardarGeneracion,
  guardarPiel,
  guardarUrlPuente,
  leerConfiguracion,
  leerEstadoPestana,
  leerPiel,
  leerUrlPuente,
  listarEstadosPestanas,
  listarGeneraciones,
} from "./almacen.js";
import { iniciarLatido } from "./latido.js";
import { armarMapaPagina } from "./mapa_pagina.js";
import { consultarSalud, esperarGeneracion, pedirGeneracion } from "./puente.js";
import { clavePiel, describirPagina } from "./rutas.js";
import { sanearCss } from "./saneador.js";

/** @typedef {import("./almacen.js").Configuracion} Configuracion */
/** @typedef {import("./almacen.js").EstadoPestana} EstadoPestana */
/** @typedef {import("./almacen.js").Piel} Piel */
/** @typedef {import("./almacen.js").RegistroGeneracion} RegistroGeneracion */
/** @typedef {import("./rutas.js").Pagina} Pagina */
/** @typedef {import("./puente.js").RespuestaGeneracion} RespuestaGeneracion */

const GENERACIONES_SIMULTANEAS = 2;
const INTERVALO_LATIDO_MS = 20_000;
const DURACION_MAXIMA_LATIDO_MS = 10 * 60_000;
const INSIGNIAS = { generando: "…", aplicada: "✓", error: "!" };
const COLOR_INSIGNIA = { generando: "#5b6470", aplicada: "#1a7f37", error: "#c62828" };

const MOTIVOS = {
  sin_sugerencia: "Todavía no has dicho cómo quieres ver las páginas.",
  todos_apagado: "«Adaptar todos los sitios» está apagado.",
  sitio_apagado: "Este sitio está apagado.",
  pieles_borradas: "Se borraron las pieles guardadas.",
};

/**
 * Generaciones que atiende esta carga del script de fondo, por clave (sitio, patrón de ruta y
 * sugerencia). Solo evita duplicados: el registro que sobrevive a una descarga está en
 * `storage.session`.
 * @type {Map<string, RegistroGeneracion>}
 */
const enCurso = new Map();

let turnosOcupados = 0;
/** @type {Array<() => void>} */
const colaTurnos = [];

/** @type {Map<number, Promise<void>>} */
const colasPestanas = new Map();

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

/**
 * Ejecuta las tareas de una misma pestaña una detrás de otra, para que dos eventos seguidos no
 * se pisen.
 * @param {number} tabId
 * @param {() => Promise<void>} tarea
 * @returns {Promise<void>}
 */
function enSerie(tabId, tarea) {
  const anterior = colasPestanas.get(tabId) ?? Promise.resolve();
  const siguiente = anterior.then(tarea).catch((error) => console.error("Pieles: falló una tarea de la pestaña", tabId, error));
  colasPestanas.set(tabId, siguiente);
  return siguiente;
}

/** @returns {Promise<void>} Se resuelve cuando hay un turno libre para generar. */
function tomarTurno() {
  if (turnosOcupados < GENERACIONES_SIMULTANEAS) {
    turnosOcupados += 1;
    return Promise.resolve();
  }
  return new Promise((resolver) => colaTurnos.push(resolver));
}

function soltarTurno() {
  const siguiente = colaTurnos.shift();
  if (siguiente) siguiente();
  else turnosOcupados -= 1;
}

/** @param {unknown} error */
function mensajeDe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {number} tabId
 * @param {EstadoPestana["estado"] | null} estado
 */
function pintarInsignia(tabId, estado) {
  const texto = (estado && INSIGNIAS[estado]) || "";
  browser.action.setBadgeText({ tabId, text: texto }).catch(() => {});
  if (texto !== "") {
    browser.action.setBadgeBackgroundColor({ tabId, color: COLOR_INSIGNIA[estado] }).catch(() => {});
  }
}

/**
 * @param {number} tabId
 * @param {EstadoPestana} estado
 */
async function fijarEstado(tabId, estado) {
  await guardarEstadoPestana(tabId, estado);
  pintarInsignia(tabId, estado.estado);
}

/**
 * @param {number} tabId
 * @param {string} css
 */
async function inyectarCss(tabId, css) {
  await browser.scripting.insertCSS({ target: { tabId }, css, origin: "USER" });
}

/**
 * @param {number} tabId
 * @param {string} css
 */
async function quitarCss(tabId, css) {
  try {
    await browser.scripting.removeCSS({ target: { tabId }, css, origin: "USER" });
  } catch {
    // La pestaña ya no existe o cambió de documento: no queda nada que quitar.
  }
}

/**
 * @param {Configuracion} configuracion
 * @param {string} sitio
 * @returns {keyof typeof MOTIVOS | null} Por qué no se adapta el sitio, o `null` si se adapta.
 */
function motivoInactiva(configuracion, sitio) {
  if (configuracion.sugerencia === "") return "sin_sugerencia";
  if (!configuracion.adaptar_todos) return "todos_apagado";
  if (configuracion.sitios_apagados.includes(sitio)) return "sitio_apagado";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Aplicar pieles
// ---------------------------------------------------------------------------------------------

/**
 * Decide qué hacer con una pestaña: nada, inyectar la piel guardada o generar una.
 * @param {number} tabId
 * @param {string} url
 * @param {{ documentoNuevo?: boolean, ignorarCache?: boolean }} [opciones]
 */
async function adaptarPestana(tabId, url, { documentoNuevo = false, ignorarCache = false } = {}) {
  const [configuracion, urlPuente, previo] = await Promise.all([
    leerConfiguracion(),
    leerUrlPuente(),
    leerEstadoPestana(tabId),
  ]);
  if (!documentoNuevo && previo?.estado === "aplicada" && previo.css) await quitarCss(tabId, previo.css);

  const pagina = describirPagina(url, urlPuente);
  if (pagina === null) {
    await borrarEstadoPestana(tabId);
    pintarInsignia(tabId, null);
    return;
  }
  const motivo = motivoInactiva(configuracion, pagina.sitio);
  if (motivo !== null) {
    await fijarEstado(tabId, { ...pagina, estado: "inactiva", motivo: MOTIVOS[motivo] });
    return;
  }
  const piel = ignorarCache ? null : await leerPiel(pagina.sitio, pagina.patron_ruta);
  if (piel !== null && piel.sugerencia === configuracion.sugerencia) {
    await aplicarPiel(tabId, pagina, piel);
    return;
  }
  await iniciarGeneracion(tabId, pagina, configuracion.sugerencia);
}

/**
 * Sanea e inyecta una piel en una pestaña.
 * @param {number} tabId
 * @param {Pagina} pagina
 * @param {Piel} piel
 */
async function aplicarPiel(tabId, pagina, piel) {
  const saneado = sanearCss(piel.css);
  if (saneado.rechazada) {
    await fijarEstado(tabId, { ...pagina, estado: "error", mensaje: saneado.motivo ?? "La piel fue rechazada." });
    return;
  }
  try {
    // Por si el documento vuelve de la caché de navegación con la piel ya puesta.
    await quitarCss(tabId, saneado.css);
    await inyectarCss(tabId, saneado.css);
  } catch (error) {
    await fijarEstado(tabId, {
      ...pagina,
      estado: "error",
      mensaje: `No se pudo inyectar la piel en esta página: ${mensajeDe(error)}`,
    });
    return;
  }
  await fijarEstado(tabId, {
    ...pagina,
    estado: "aplicada",
    css: saneado.css,
    piel: {
      nombre: piel.nombre,
      explicacion: piel.explicacion,
      duracion_ms: piel.duracion_ms,
      modelo: piel.modelo,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Generar pieles
// ---------------------------------------------------------------------------------------------

/**
 * Deja la pestaña esperando una generación: una nueva, o la que ya está en curso para el mismo
 * sitio, patrón de ruta y sugerencia.
 * @param {number} tabId
 * @param {Pagina} pagina
 * @param {string} sugerencia
 */
async function iniciarGeneracion(tabId, pagina, sugerencia) {
  await recuperarGeneraciones();
  const clave = `${clavePiel(pagina.sitio, pagina.patron_ruta)}|${sugerencia}`;
  let registro = enCurso.get(clave);
  const esNueva = registro === undefined;
  if (registro === undefined) {
    registro = { id_solicitud: crypto.randomUUID(), clave, ...pagina, sugerencia, inicio_ms: Date.now() };
    enCurso.set(clave, registro);
    await guardarGeneracion(registro);
  }
  await fijarEstado(tabId, {
    ...pagina,
    estado: "generando",
    id_solicitud: registro.id_solicitud,
    inicio_ms: registro.inicio_ms,
  });
  inyectarLatido(tabId, registro.id_solicitud);

  if (esNueva) {
    void ejecutarGeneracion(tabId, registro);
  } else if (enCurso.get(clave) !== registro) {
    // La generación terminó mientras esta pestaña se sumaba: la piel ya está guardada.
    const piel = await leerPiel(pagina.sitio, pagina.patron_ruta);
    if (piel !== null) await aplicarPiel(tabId, pagina, piel);
  }
}

/**
 * @param {number} tabId
 * @param {string} idSolicitud
 */
function inyectarLatido(tabId, idSolicitud) {
  browser.scripting
    .executeScript({
      target: { tabId },
      func: iniciarLatido,
      args: [idSolicitud, INTERVALO_LATIDO_MS, DURACION_MAXIMA_LATIDO_MS],
      injectImmediately: true,
    })
    .catch((error) => console.warn("Pieles: no se pudo iniciar el latido", error));
}

/**
 * Arma el mapa de página en la pestaña. Por defecto `executeScript` espera a que el documento
 * esté listo (`document_idle`).
 * @param {number} tabId
 * @param {Pagina} pagina
 * @returns {Promise<string>}
 */
async function obtenerMapaPagina(tabId, pagina) {
  const [resultado] = await browser.scripting.executeScript({
    target: { tabId },
    func: armarMapaPagina,
    args: [pagina.sitio, pagina.patron_ruta],
  });
  if (typeof resultado?.result !== "string" || resultado.result === "") {
    throw new Error("No se pudo leer la estructura de la página.");
  }
  return resultado.result;
}

/**
 * Pide la piel al puente y la reparte entre las pestañas que la esperan.
 * @param {number} tabId Pestaña de la que se saca el mapa de página.
 * @param {RegistroGeneracion} registro
 */
async function ejecutarGeneracion(tabId, registro) {
  try {
    await tomarTurno();
    let respuesta;
    try {
      const mapaPagina = await obtenerMapaPagina(tabId, registro);
      respuesta = await pedirGeneracion({
        id_solicitud: registro.id_solicitud,
        sitio: registro.sitio,
        patron_ruta: registro.patron_ruta,
        mapa_pagina: mapaPagina,
        sugerencia: registro.sugerencia,
        preferencias: [],
        piel_actual: null,
      });
    } finally {
      soltarTurno();
    }
    await concluirGeneracion(registro, respuesta);
  } catch (error) {
    await fallarGeneracion(registro, error);
  } finally {
    await cerrarGeneracion(registro);
  }
}

/**
 * Retoma una generación que quedó huérfana al descargarse el script de fondo: el puente guarda
 * el resultado por `id_solicitud`.
 * @param {RegistroGeneracion} registro
 */
async function reanudarGeneracion(registro) {
  try {
    await concluirGeneracion(registro, await esperarGeneracion(registro.id_solicitud));
  } catch (error) {
    await fallarGeneracion(registro, error);
  } finally {
    await cerrarGeneracion(registro);
  }
}

/** Retoma las generaciones registradas en la sesión que nadie está atendiendo. */
async function recuperarGeneraciones() {
  for (const registro of await listarGeneraciones()) {
    if (enCurso.has(registro.clave)) continue;
    enCurso.set(registro.clave, registro);
    void reanudarGeneracion(registro);
  }
}

/** @param {RegistroGeneracion} registro */
async function cerrarGeneracion(registro) {
  if (enCurso.get(registro.clave) === registro) enCurso.delete(registro.clave);
  await borrarGeneracion(registro.id_solicitud);
}

/**
 * Guarda la piel recién generada y la aplica en las pestañas que la esperaban.
 * @param {RegistroGeneracion} registro
 * @param {RespuestaGeneracion} respuesta
 */
async function concluirGeneracion(registro, respuesta) {
  /** @type {Piel} */
  const piel = {
    version_esquema: 1,
    id: crypto.randomUUID(),
    sitio: registro.sitio,
    patron_ruta: registro.patron_ruta,
    nombre: String(respuesta.nombre ?? "Piel sin nombre"),
    descripcion: String(respuesta.descripcion ?? ""),
    css: respuesta.css,
    padre_id: null,
    explicacion: String(respuesta.explicacion ?? ""),
    sugerencia: registro.sugerencia,
    duracion_ms: Number(respuesta.duracion_ms) || Date.now() - registro.inicio_ms,
    modelo: String(respuesta.modelo ?? ""),
  };
  const saneado = sanearCss(piel.css);
  if (saneado.rechazada) throw new Error(saneado.motivo ?? "La piel fue rechazada.");
  await guardarPiel(piel);
  const pagina = { sitio: registro.sitio, patron_ruta: registro.patron_ruta };
  await resolverPestanas(registro.id_solicitud, (tabId) => aplicarPiel(tabId, pagina, piel));
}

/**
 * @param {RegistroGeneracion} registro
 * @param {unknown} error
 */
async function fallarGeneracion(registro, error) {
  console.warn("Pieles: falló la generación", registro.id_solicitud, error);
  const pagina = { sitio: registro.sitio, patron_ruta: registro.patron_ruta };
  await resolverPestanas(registro.id_solicitud, (tabId) =>
    fijarEstado(tabId, { ...pagina, estado: "error", mensaje: mensajeDe(error) }),
  );
}

/**
 * Ejecuta una acción en cada pestaña que sigue esperando una generación.
 * @param {string} idSolicitud
 * @param {(tabId: number) => Promise<void>} accion
 */
async function resolverPestanas(idSolicitud, accion) {
  /** @param {EstadoPestana | null} estado */
  const espera = (estado) => estado?.estado === "generando" && estado.id_solicitud === idSolicitud;
  const pestanas = (await listarEstadosPestanas()).filter(({ estado }) => espera(estado));
  await Promise.all(
    pestanas.map(({ tabId }) =>
      enSerie(tabId, async () => {
        if (espera(await leerEstadoPestana(tabId))) await accion(tabId);
      }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------------------------

browser.webNavigation.onCommitted.addListener((detalle) => {
  if (detalle.frameId !== 0) return;
  void enSerie(detalle.tabId, () => adaptarPestana(detalle.tabId, detalle.url, { documentoNuevo: true }));
});

// Aplicaciones de una sola página: la ruta cambia sin recargar el documento.
browser.webNavigation.onHistoryStateUpdated.addListener((detalle) => {
  if (detalle.frameId !== 0) return;
  void enSerie(detalle.tabId, async () => {
    const [previo, urlPuente] = await Promise.all([leerEstadoPestana(detalle.tabId), leerUrlPuente()]);
    const pagina = describirPagina(detalle.url, urlPuente);
    const mismoPatron =
      previo !== null && pagina !== null && previo.sitio === pagina.sitio && previo.patron_ruta === pagina.patron_ruta;
    if (!mismoPatron) await adaptarPestana(detalle.tabId, detalle.url);
  });
});

browser.tabs.onRemoved.addListener((tabId) => {
  colasPestanas.delete(tabId);
  void borrarEstadoPestana(tabId);
});

// Firefox borra la insignia de la pestaña al navegar: se vuelve a pintar cuando termina de cargar.
browser.tabs.onUpdated.addListener(
  (tabId, cambio) => {
    if (cambio.status !== "complete") return;
    void leerEstadoPestana(tabId).then((estado) => pintarInsignia(tabId, estado?.estado ?? null));
  },
  { properties: ["status"] },
);

// ---------------------------------------------------------------------------------------------
// Mensajes del panel y del latido
// ---------------------------------------------------------------------------------------------

/**
 * Vuelve a decidir qué hacer con una pestaña ya cargada.
 * @param {number} tabId
 * @param {{ ignorarCache?: boolean }} [opciones]
 */
async function readaptarPestana(tabId, opciones = {}) {
  const pestana = await browser.tabs.get(tabId);
  await enSerie(tabId, () => adaptarPestana(tabId, pestana.url ?? "", opciones));
}

/**
 * @param {number} tabId
 * @param {(estado: EstadoPestana) => Promise<void>} cambio
 */
async function conEstado(tabId, cambio) {
  await enSerie(tabId, async () => {
    const estado = await leerEstadoPestana(tabId);
    if (estado !== null) await cambio(estado);
  });
}

/** Acciones que puede pedir el panel. Cada una recibe el mensaje completo. */
const ACCIONES_PANEL = {
  /** @param {{ tabId: number }} mensaje */
  async obtener_estado({ tabId }) {
    const pestana = await browser.tabs.get(tabId);
    const [configuracion, urlPuente, estado, cantidadPieles] = await Promise.all([
      leerConfiguracion(),
      leerUrlPuente(),
      leerEstadoPestana(tabId),
      contarPieles(),
    ]);
    return {
      configuracion,
      url_puente: urlPuente,
      url_puente_por_defecto: URL_PUENTE_POR_DEFECTO,
      pagina: describirPagina(pestana.url ?? "", urlPuente),
      estado,
      cantidad_pieles: cantidadPieles,
      ahora_ms: Date.now(),
    };
  },

  consultar_puente: () => consultarSalud(),

  /** @param {{ tabId: number, sugerencia: string }} mensaje */
  async guardar_sugerencia({ tabId, sugerencia }) {
    const configuracion = await leerConfiguracion();
    const texto = String(sugerencia).trim();
    const primeraVez = configuracion.sugerencia === "";
    await guardarConfiguracion({
      ...configuracion,
      sugerencia: texto,
      adaptar_todos: primeraVez ? texto !== "" : configuracion.adaptar_todos,
    });
    await readaptarPestana(tabId);
  },

  /** @param {{ tabId: number, valor: boolean }} mensaje */
  async cambiar_adaptar_todos({ tabId, valor }) {
    await guardarConfiguracion({ ...(await leerConfiguracion()), adaptar_todos: Boolean(valor) });
    await readaptarPestana(tabId);
  },

  /** @param {{ tabId: number, sitio: string, valor: boolean }} mensaje */
  async cambiar_adaptar_sitio({ tabId, sitio, valor }) {
    const configuracion = await leerConfiguracion();
    const apagados = new Set(configuracion.sitios_apagados);
    if (valor) apagados.delete(sitio);
    else apagados.add(sitio);
    await guardarConfiguracion({ ...configuracion, sitios_apagados: [...apagados] });
    await readaptarPestana(tabId);
  },

  /** @param {{ tabId: number }} mensaje */
  ver_original: ({ tabId }) =>
    conEstado(tabId, async (estado) => {
      if (estado.estado !== "aplicada" || !estado.css) return;
      await quitarCss(tabId, estado.css);
      await fijarEstado(tabId, { ...estado, estado: "original" });
    }),

  /** @param {{ tabId: number }} mensaje */
  volver_a_aplicar: ({ tabId }) =>
    conEstado(tabId, async (estado) => {
      if (estado.estado !== "original" || !estado.css) return;
      await inyectarCss(tabId, estado.css);
      await fijarEstado(tabId, { ...estado, estado: "aplicada" });
    }),

  /** @param {{ tabId: number }} mensaje */
  regenerar: ({ tabId }) => readaptarPestana(tabId, { ignorarCache: true }),

  /** @param {{ tabId: number }} mensaje */
  async borrar_pieles({ tabId }) {
    await borrarPieles();
    await conEstado(tabId, async (estado) => {
      if (estado.estado === "aplicada" && estado.css) await quitarCss(tabId, estado.css);
      if (estado.estado === "generando") return;
      const { sitio, patron_ruta } = estado;
      await fijarEstado(tabId, { sitio, patron_ruta, estado: "inactiva", motivo: MOTIVOS.pieles_borradas });
    });
  },

  /** @param {{ url: string }} mensaje */
  guardar_url_puente: ({ url }) => guardarUrlPuente(String(url)),
};

/**
 * El latido llega desde la pestaña cada 20 s mientras espera una generación. Recibirlo ya
 * mantiene vivo el script de fondo; si este se había descargado, aquí se retoma la generación.
 * @param {{ id_solicitud: string }} mensaje
 * @param {browser.runtime.MessageSender} remitente
 * @returns {Promise<{ seguir: boolean }>}
 */
async function atenderLatido(mensaje, remitente) {
  await recuperarGeneraciones();
  const seguir = (await listarGeneraciones()).some((registro) => registro.id_solicitud === mensaje.id_solicitud);
  const tabId = remitente.tab?.id;
  if (!seguir && tabId !== undefined) {
    await conEstado(tabId, async (estado) => {
      if (estado.estado !== "generando" || estado.id_solicitud !== mensaje.id_solicitud) return;
      await fijarEstado(tabId, { ...estado, estado: "error", mensaje: "Se perdió la generación. Pulsa «Regenerar»." });
    });
  }
  return { seguir };
}

/** @param {browser.runtime.MessageSender} remitente */
function vieneDeLaExtension(remitente) {
  return remitente.id === browser.runtime.id && (remitente.url ?? "").startsWith(browser.runtime.getURL(""));
}

browser.runtime.onMessage.addListener((mensaje, remitente) => {
  if (remitente.id !== browser.runtime.id) return undefined;
  if (mensaje?.tipo === "latido") return atenderLatido(mensaje, remitente);
  const accion = Object.hasOwn(ACCIONES_PANEL, mensaje?.tipo) ? ACCIONES_PANEL[mensaje.tipo] : undefined;
  if (accion === undefined || !vieneDeLaExtension(remitente)) return undefined;
  return Promise.resolve()
    .then(() => accion(mensaje))
    .then(
      (datos) => ({ ok: true, datos: datos ?? null }),
      (error) => ({ ok: false, mensaje: mensajeDe(error) }),
    );
});

// Al cargarse (por ejemplo tras una descarga por inactividad), retoma lo que quedó a medias.
void recuperarGeneraciones();
