/**
 * Panel: toda la interfaz. No habla con el puente ni toca las páginas; le pide cada cosa al
 * script de fondo.
 */

/** @typedef {import("./almacen.js").Configuracion} Configuracion */
/** @typedef {import("./almacen.js").EstadoPestana} EstadoPestana */
/** @typedef {import("./puente.js").SaludPuente} SaludPuente */

/**
 * @typedef {object} Vista
 * @property {Configuracion} configuracion
 * @property {string} url_puente
 * @property {string} url_puente_por_defecto
 * @property {import("./rutas.js").Pagina | null} pagina
 * @property {EstadoPestana | null} estado
 * @property {number} cantidad_pieles
 * @property {number} ahora_ms
 */

const INTERVALO_VISTA_MS = 1_000;
const INTERVALO_PUENTE_MS = 5_000;

/**
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
const porId = (id) => /** @type {T} */ (document.getElementById(id));

const elementos = {
  puente: porId("estado-puente"),
  sugerencia: /** @type {HTMLTextAreaElement} */ (porId("sugerencia")),
  guardar: /** @type {HTMLButtonElement} */ (porId("guardar")),
  adaptarTodos: /** @type {HTMLInputElement} */ (porId("adaptar-todos")),
  adaptarSitio: /** @type {HTMLInputElement} */ (porId("adaptar-sitio")),
  nombreSitio: porId("nombre-sitio"),
  estado: porId("estado-pagina"),
  detalle: porId("detalle-pagina"),
  pie: porId("pie-pagina"),
  alternar: /** @type {HTMLButtonElement} */ (porId("alternar")),
  regenerar: /** @type {HTMLButtonElement} */ (porId("regenerar")),
  aviso: porId("aviso"),
  borrarPieles: /** @type {HTMLButtonElement} */ (porId("borrar-pieles")),
  urlPuente: /** @type {HTMLInputElement} */ (porId("url-puente")),
  guardarUrlPuente: /** @type {HTMLButtonElement} */ (porId("guardar-url-puente")),
};

/** @type {number | null} */
let idPestana = null;
/** @type {Vista | null} */
let vista = null;
let camposCargados = false;

/**
 * Pide algo al script de fondo.
 * @param {string} tipo
 * @param {Record<string, unknown>} [datos]
 * @returns {Promise<any>}
 */
async function pedir(tipo, datos = {}) {
  const respuesta = await browser.runtime.sendMessage({ tipo, tabId: idPestana, ...datos });
  if (!respuesta?.ok) throw new Error(respuesta?.mensaje ?? "La extensión no respondió.");
  return respuesta.datos;
}

/**
 * @param {string} texto
 * @param {"bien" | "mal"} [tono]
 */
function avisar(texto, tono = "bien") {
  elementos.aviso.textContent = texto;
  elementos.aviso.dataset.tono = tono;
}

/** @param {number} milisegundos */
function enSegundos(milisegundos) {
  return `${Math.max(0, Math.round(milisegundos / 1000))} s`;
}

/** @param {SaludPuente} salud */
function pintarPuente(salud) {
  let texto = "Puente: sin conexión";
  let tono = "mal";
  if (salud.ok && salud.claude === "listo") {
    texto = `Puente: listo${salud.modelo ? ` · ${salud.modelo}` : ""}`;
    tono = "bien";
  } else if (salud.ok) {
    texto = "Puente: no encuentra a Claude";
  }
  elementos.puente.textContent = texto;
  elementos.puente.dataset.tono = tono;
  elementos.puente.title = salud.mensaje ?? "";
}

/**
 * Texto del estado de la página: título, detalle y pie.
 * @param {Vista} actual
 * @returns {{ titulo: string, detalle?: string, pie?: string }}
 */
function describirEstado(actual) {
  const { estado, pagina } = actual;
  if (pagina === null) return { titulo: "Esta página no se puede adaptar" };
  if (estado === null) return { titulo: "Sin piel" };
  const piel = estado.piel;
  switch (estado.estado) {
    case "generando":
      return { titulo: `Generando… ${enSegundos(Date.now() - (estado.inicio_ms ?? Date.now()))}` };
    case "aplicada":
      return {
        titulo: `Piel aplicada: ${piel?.nombre ?? ""}`,
        detalle: piel?.explicacion,
        pie: piel ? `Tardó ${enSegundos(piel.duracion_ms)}${piel.modelo ? ` · ${piel.modelo}` : ""}` : "",
      };
    case "original":
      return { titulo: "Viendo el original", detalle: piel ? `Piel guardada: ${piel.nombre}` : "" };
    case "error":
      return { titulo: "Error", detalle: estado.mensaje };
    default:
      return { titulo: "Sin piel", detalle: estado.motivo };
  }
}

/** @param {Vista} actual */
function pintarVista(actual) {
  const { configuracion, pagina, estado } = actual;
  if (!camposCargados) {
    elementos.sugerencia.value = configuracion.sugerencia;
    elementos.urlPuente.value = actual.url_puente;
    elementos.urlPuente.placeholder = actual.url_puente_por_defecto;
    camposCargados = true;
  }
  const hayPagina = pagina !== null;
  const haySugerencia = configuracion.sugerencia !== "";
  const tipoEstado = hayPagina ? (estado?.estado ?? "inactiva") : "inactiva";

  elementos.adaptarTodos.checked = configuracion.adaptar_todos;
  elementos.adaptarTodos.disabled = !haySugerencia;
  elementos.adaptarSitio.checked = hayPagina && !configuracion.sitios_apagados.includes(pagina.sitio);
  elementos.adaptarSitio.disabled = !hayPagina;
  elementos.nombreSitio.textContent = hayPagina ? `(${pagina.sitio})` : "";

  const textos = describirEstado(actual);
  elementos.estado.textContent = textos.titulo;
  elementos.estado.dataset.estado = tipoEstado;
  elementos.detalle.textContent = textos.detalle ?? "";
  elementos.pie.textContent = textos.pie ?? "";

  const alternable = tipoEstado === "aplicada" || tipoEstado === "original";
  elementos.alternar.hidden = !alternable;
  elementos.alternar.textContent = tipoEstado === "original" ? "Volver a aplicar" : "Ver original";
  elementos.regenerar.disabled = !hayPagina || !haySugerencia || tipoEstado === "generando";
  elementos.borrarPieles.textContent = `Borrar pieles guardadas (${actual.cantidad_pieles})`;
  elementos.borrarPieles.disabled = actual.cantidad_pieles === 0;
}

async function refrescarVista() {
  if (idPestana === null) return;
  try {
    vista = await pedir("obtener_estado");
    pintarVista(/** @type {Vista} */ (vista));
  } catch (error) {
    avisar(error instanceof Error ? error.message : String(error), "mal");
  }
}

async function refrescarPuente() {
  try {
    pintarPuente(await pedir("consultar_puente"));
  } catch {
    pintarPuente({ ok: false });
  }
}

/**
 * Ejecuta una acción del panel y refresca la vista; los errores se muestran en el aviso.
 * @param {() => Promise<string | void>} accion Devuelve el aviso que mostrar, si hay.
 */
async function ejecutar(accion) {
  try {
    avisar((await accion()) ?? "");
  } catch (error) {
    avisar(error instanceof Error ? error.message : String(error), "mal");
  }
  await refrescarVista();
}

function conectarAcciones() {
  elementos.guardar.addEventListener("click", () =>
    ejecutar(async () => {
      await pedir("guardar_sugerencia", { sugerencia: elementos.sugerencia.value });
      return "Guardado.";
    }),
  );
  elementos.adaptarTodos.addEventListener("change", () =>
    ejecutar(() => pedir("cambiar_adaptar_todos", { valor: elementos.adaptarTodos.checked })),
  );
  elementos.adaptarSitio.addEventListener("change", () =>
    ejecutar(async () => {
      if (!vista?.pagina) return;
      await pedir("cambiar_adaptar_sitio", { sitio: vista.pagina.sitio, valor: elementos.adaptarSitio.checked });
    }),
  );
  elementos.alternar.addEventListener("click", () =>
    ejecutar(() => pedir(vista?.estado?.estado === "original" ? "volver_a_aplicar" : "ver_original")),
  );
  elementos.regenerar.addEventListener("click", () => ejecutar(() => pedir("regenerar")));
  elementos.borrarPieles.addEventListener("click", () =>
    ejecutar(async () => {
      await pedir("borrar_pieles");
      return "Pieles borradas.";
    }),
  );
  elementos.guardarUrlPuente.addEventListener("click", () =>
    ejecutar(async () => {
      await pedir("guardar_url_puente", { url: elementos.urlPuente.value });
      await refrescarPuente();
      return "URL del puente guardada.";
    }),
  );
}

/**
 * Pestaña indicada en la URL (`panel.html?pestana=<id>`): sirve para abrir el panel como una
 * pestaña normal, al depurar o en las pruebas, y que actúe sobre otra pestaña.
 * @returns {number | null}
 */
function pestanaIndicada() {
  const indicada = Number(new URLSearchParams(location.search).get("pestana"));
  return Number.isInteger(indicada) && indicada > 0 ? indicada : null;
}

/** @returns {Promise<number | null>} */
async function pestanaActiva() {
  const [pestana] = await browser.tabs.query({ active: true, currentWindow: true });
  return pestana?.id ?? null;
}

async function iniciar() {
  idPestana = pestanaIndicada() ?? (await pestanaActiva());
  conectarAcciones();
  await refrescarVista();
  void refrescarPuente();
  setInterval(refrescarVista, INTERVALO_VISTA_MS);
  setInterval(refrescarPuente, INTERVALO_PUENTE_MS);
}

void iniciar();
