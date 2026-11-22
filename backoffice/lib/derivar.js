// Lo que el backoffice calcula a partir de una tanda del evaluador: lógica pura, sin archivos,
// para poder probarla con datos fijos. Entra lo que hay en la fuente (route_tree.json, criteria.json si corrió el juez
// y el run.json de cada intento) y sale lo que dibujan las pantallas (forma exacta: §3 del diseño).
//
// No arma frases para la pantalla: lo que es texto de la interfaz sale como clave + variables
// ({ clave, vars }) o como campos estructurados, y public/datos/textos.js lo traduce.

import { demorasDelIntento, hallazgos as calcularHallazgos, recortarHallazgos, titulares as calcularTitulares } from "./hallazgos.js";
import { quitarSufijo, sufijoComun, titularPaginas, tituloDesdeRuta, unirNodos } from "./paginas.js";
import { caminoDe, claveDeNodo, consultaDe, hostDe, normalizarUrl, rutaLegible, rutaSinConsulta } from "./url.js";

/**
 * @typedef {import("./hallazgos.js").Hallazgo} Hallazgo
 * @typedef {import("./hallazgos.js").Texto} Texto
 * @typedef {import("./hallazgos.js").Demora} Demora
 * @typedef {{ n: number, de: number }} Conteo
 * @typedef {"logrado" | "fallido" | "abandonado" | "sin_medir" | "error"} Resultado
 *
 * @typedef {Object} ErrorDeHerramienta
 * @property {"internal_error" | "api_error" | "no_response" | "refusal" | "juez" | "sin_inicio" | "archivo_danado"} tipo
 * @property {string} resumen      primera línea del mensaje, sin "Error: ", hasta 140 caracteres
 * @property {string} detalle      el mensaje completo, tal cual
 *
 * @typedef {Object} Firma         Qué hizo un paso, para mostrarlo con textoDeFirma()
 * @property {"clic" | "clic_coordenadas" | "doble_clic" | "triple_clic" | "desplazar" | "escribir" | "atras" | "tecla" | "otra"} tipo
 * @property {string | null} objetivo     texto del elemento, href, texto escrito o tecla (dato de la corrida)
 * @property {"abajo" | "arriba" | "izquierda" | "derecha" | null} direccion
 * @property {number | null} cantidad
 * @property {number | null} x
 * @property {number | null} y
 * @property {string} original            la descripción del evaluador, tal cual
 *
 * @typedef {Object} RutaAqui
 * @property {boolean} enRuta
 * @property {number} [hito]
 * @property {number} [total]
 * @property {boolean} [termina]
 * @property {string} [accion]
 * @property {string} [destino]
 * @property {boolean | null} [coincideConUsuario]
 *
 * @typedef {Object} Paso
 * @property {number} numero
 * @property {string} accion
 * @property {string} descripcion
 * @property {Firma} firma
 * @property {string | null} elemento
 * @property {number[] | null} coordenadas
 * @property {string} expectativa
 * @property {string} urlAntes
 * @property {string} url
 * @property {string} tituloAntes
 * @property {string} titulo
 * @property {string | null} capturaAntes
 * @property {string | null} captura
 * @property {number | null} segundos
 * @property {number | null} duracion
 * @property {number | null} inicioSegundos
 * @property {number | null} cambio
 * @property {string[]} senales
 * @property {"no_cumplida" | "sin_efecto" | "sin_evaluar"} estado
 * @property {"si" | "no" | "incierto"} coincide          estimado: el juez no evalúa cada paso
 * @property {Texto[]} loQuePaso
 * @property {string | null} paginaAntes
 * @property {string | null} pagina
 * @property {boolean} salePagina
 * @property {"en-ruta" | "fuera-de-ruta" | "sin-ruta"} carril
 * @property {RutaAqui | null} rutaAqui
 *
 * @typedef {Object} Intento
 * @property {string} id               la carpeta del intento: el perfil o, con repeticiones, «<perfil>-<n>»
 * @property {string} perfil           el perfil del Visitante (`desktop` para `desktop` y `desktop-2`)
 * @property {string} carpeta
 * @property {number} repeticion       n.º de intento del perfil en la tanda (1 en las corridas viejas)
 * @property {string} nombrePerfil     nombre del intento: el del perfil y, desde la 2.ª repetición, «#n»
 * @property {string} nombreDelPerfil
 * @property {{ ancho: number | null, alto: number | null }} viewport
 * @property {string | null} modelo
 * @property {string | null} motor
 * @property {Resultado} resultado
 * @property {"success" | "failed" | "abandoned" | "unmeasured" | "interrupted"} resultadoJuez   el `outcome` del run.json
 * @property {"ruta" | "juez" | null} fuente   de dónde sale el resultado: la ruta de la Guía o el juez
 * @property {boolean | null} declaroTerminar   el usuario dijo que terminó (null en corridas viejas)
 * @property {"directo" | "indirecto" | "declaro_sin_llegar" | null} logro   matiz del resultado: un logrado por la ruta
 *   recomendada o por otro camino; un fallido que declaró que terminó sin llegar a la página final de la ruta
 * @property {string} justificacion
 * @property {ErrorDeHerramienta | null} error
 * @property {string | null} motivoDeFin
 * @property {string} respuesta
 * @property {number | null} duracion
 * @property {number | null} costoUsd
 * @property {{ url: string, titulo: string, captura: string | null } | null} inicio
 * @property {string | null} capturaFinal
 * @property {boolean} video
 * @property {number} videoDesfase     segundos del video antes del inicio del intento (video_offset_s; 0 si no hay)
 * @property {Paso[]} pasos
 * @property {string[]} camino
 * @property {{ pagina: string, alcanzado: boolean, paso: number | null }[]} hitos
 * @property {number} hitosAlcanzados
 * @property {boolean} sigueLaRuta
 * @property {{ tramo: number, paso: number, pagina: string | null, seDetuvo: boolean } | null} seSepara
 * @property {boolean} vuelveALaRuta
 * @property {number | null} vuelveEnPaso
 * @property {Demora[]} demoras
 * @property {"sin_contexto" | "conoce_tema" | null} conocimiento   nivel de conocimiento del explorador (null: perfil común)
 * @property {string | null} instruccion    la tarea tal como la leyó este intento (sin contexto: la versión coloquial)
 * @property {string[]} terminosRechazados  términos oficiales que el harness no le dejó escribir
 *
 * @typedef {{ logrado: number, fallido: number, abandonado: number, sin_medir: number, error: number }} Finales
 *
 * @typedef {Object} Pagina
 * @property {string} id
 * @property {string} titulo
 * @property {string | null} tituloCorto
 * @property {"sitio" | "inicio" | "url" | "error"} tituloTipo
 * @property {string} url
 * @property {{ nodo: string, url: string, consulta: string, visitas: number, perfiles: string[] }[]} variantes
 * @property {number} visitas
 * @property {string[]} perfiles
 * @property {boolean} esInicio
 * @property {Finales} finales
 * @property {boolean} enRuta
 * @property {number | null} hito
 * @property {number} distancia
 * @property {{ perfil: string, archivo: string } | null} captura
 *
 * @typedef {Object} Rama
 * @property {string} id
 * @property {string} origen
 * @property {string} destino
 * @property {{ accion: string, intentos: number, pasadas: number, perfiles: string[], salto: boolean }[]} acciones  salto: un
 *   «volver a …» del explorador (no lo hace un humano)
 * @property {string} accion
 * @property {number} exitos
 * @property {number} fallos
 * @property {number} errores
 * @property {number} intentos  intentos distintos que tomaron el tramo
 * @property {number} pasadas  veces que se pasó por el tramo (exitos + fallos + errores)
 * @property {string[]} perfiles     perfiles del Visitante que pasaron por ella
 * @property {string[]} intentosIds  ids de los intentos que pasaron por ella
 * @property {number | null} medianaSegundos
 * @property {number} pasosMinimos
 * @property {"exito" | "mixto" | "fallo" | "abandono" | "sin_medir" | "error"} resultado
 * @property {boolean} enRuta
 *
 * @typedef {Object} Ruta
 * @property {string[]} paginas
 * @property {{ origen: string, destino: string, accion: string, pasos: number, segundos: number | null }[]} tramos
 * @property {number} pasosIdeales
 * @property {number | null} probabilidad
 * @property {number | null} segundos
 *
 * @typedef {Object} Perfil
 * @property {string} perfil
 * @property {string} nombre
 * @property {string[]} intentos
 * @property {number} validos
 * @property {number} medidos      válidos con resultado (sin los «sin medir»): el total contra el que se cuentan los logrados
 * @property {number} errores
 * @property {number} logrados
 * @property {number} directos
 * @property {Object} metricas
 * @property {{ pagina: string, alcanzados: number, de: number, pasos: { intento: string, paso: number }[],
 *              salen: { intento: string, paso: number }[], senalDominante: string | null }[]} hitos
 * @property {{ intento: string, tramo: number, paso: number, pagina: string | null, seDetuvo: boolean } | null} seSepara
 *
 * @typedef {Object} Tanda    GET /api/tandas/<id> (vecinas las agrega lib/tandas.js)
 * @property {string} id
 * @property {string | null} tarea
 * @property {string} instruccion
 * @property {string} url
 * @property {string} host
 * @property {string} fecha
 * @property {string} fechaIso
 * @property {string | null} motor
 * @property {{ texto: string, evidencias: string[] } | null} criterio
 * @property {Intento[]} intentos
 * @property {{ paginas: Pagina[], ramas: Rama[], ruta: Ruta | null, alias: Record<string, string> }} telarana
 * @property {Object} kpis
 * @property {Perfil[]} perfiles
 * @property {Hallazgo[]} hallazgos
 * @property {{ tanda: Texto, telarana: Texto, perfiles: Texto }} titulares
 * @property {ReturnType<typeof porConocimiento>} porConocimiento
 * @property {"ok" | "falta" | "danado"} arbol  estado del route_tree.json de la tanda
 * @property {RutaDeLaGuia | null} rutaGuia   la ruta de la Guía (solo en GET /api/tandas/<id>: lib/tandas.js la lee)
 */

// Motivos de fin que son fallas de la herramienta, no del usuario: los _INTERRUPTED_REASONS de
// agents/app/visitor/visitor/batch.py. El orden es el de la tabla del diseño (§2.1).
const MOTIVOS_DE_ERROR = ["internal_error", "api_error", "no_response", "refusal", "site_blocked"];
/** Motivo de fin del intento armado para un run.json que no se pudo leer (lib/tandas.js). */
export const ARCHIVO_DANADO = "archivo_danado";
const SIN_VEREDICTO = "No se pudo obtener el veredicto";
const LARGO_DEL_RESUMEN = 140;
const CAMBIO_QUE_CUENTA = 0.05;
const CAMBIO_DE_LA_CAPTURA = 0.2;
const ANCHO_DE_ESCRITORIO = 1000;
const ORDEN_DE_SENALES = ["visible_error", "went_back", "no_effect", "security_block"];
const RESULTADO_DEL_VEREDICTO = { success: "logrado", failed: "fallido", abandoned: "abandonado", unmeasured: "sin_medir" };
const FUENTE_DEL_VEREDICTO = { route: "ruta", judge: "juez" };
// Error técnico en el Visitante nuevo: el intento no entra en route_tree.json.
const INTERRUMPIDO = "interrupted";
const fueraDelArbol = (run) => run.verdict?.outcome === INTERRUMPIDO;
const ACCIONES_DE_CLIC = new Set(["left_click", "double_click", "triple_click"]);

/** Acción con que un explorador vuelve a una página ya vista para abrir otra rama (no la hace un humano). */
export const SALTO_DEL_EXPLORADOR = "volver_a_nodo";
export const esSaltoDelExplorador = (accion) => accion === SALTO_DEL_EXPLORADOR;

// Estado de un paso. El evaluador guarda la expectativa pero no la compara con el resultado,
// así que solo se distingue lo que delatan las señales.
export function estadoDelPaso(senales = []) {
  if (senales.includes("went_back") || senales.includes("visible_error")) return "no_cumplida";
  if (senales.includes("no_effect")) return "sin_efecto";
  return "sin_evaluar";
}

const redondear = (numero, decimales = 2) =>
  typeof numero === "number" && Number.isFinite(numero) ? Number(numero.toFixed(decimales)) : null;

export function mediana(numeros) {
  const validos = numeros.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!validos.length) return null;
  const orden = [...validos].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : redondear((orden[medio - 1] + orden[medio]) / 2);
}

const conteo = (n, de) => (de > 0 ? { n, de } : null);

/** Primera línea no vacía de un mensaje de error, sin "Error: ", cortada a 140 caracteres. */
export function resumenDeError(texto) {
  const linea = String(texto ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const limpia = linea.replace(/^Error:\s*/, "");
  return limpia.length > LARGO_DEL_RESUMEN ? `${limpia.slice(0, LARGO_DEL_RESUMEN - 1)}…` : limpia;
}

/**
 * Si el intento falló por la herramienta (no por el usuario), qué pasó; si no, null.
 * @returns {ErrorDeHerramienta | null}
 */
export function errorDelIntento(run) {
  const justificacion = String(run.verdict?.justification ?? "");
  let tipo = null;
  let texto = "";
  if (run.end_reason === ARCHIVO_DANADO) {
    tipo = ARCHIVO_DANADO;
    texto = run.final_message;
  } else if (MOTIVOS_DE_ERROR.includes(run.end_reason)) {
    tipo = run.end_reason;
    texto = run.final_message;
  } else if (justificacion.startsWith(SIN_VEREDICTO)) {
    tipo = "juez";
    texto = justificacion;
  } else if (!run.start?.url) {
    tipo = "sin_inicio";
    texto = run.final_message;
  }
  return tipo ? { tipo, resumen: resumenDeError(texto), detalle: String(texto ?? "") } : null;
}

/**
 * Cómo terminó un intento según su run.json: "error" si falló la herramienta (errorDelIntento); si no, el veredicto
 * (success → logrado, failed → fallido, abandoned → abandonado, unmeasured → sin_medir; otro o ninguno → abandonado).
 * La usan la tanda (armarIntento) y el resumen del Overview (lib/clasificar.js), así cuentan igual.
 * @param {object} run
 * @param {ErrorDeHerramienta | null} [error]  el de errorDelIntento(run), si ya se calculó
 * @returns {"logrado" | "fallido" | "abandonado" | "sin_medir" | "error"}
 */
export function resultadoDelRun(run, error = errorDelIntento(run)) {
  if (error) return "error";
  return RESULTADO_DEL_VEREDICTO[run.verdict?.outcome ?? "abandoned"] ?? "abandonado";
}

const DIRECCIONES = { down: "abajo", up: "arriba", left: "izquierda", right: "derecha" };
// El evaluador corta el texto de un elemento a 80 caracteres (recording.py), a veces a mitad de palabra.
const LARGO_DEL_TEXTO_DE_ELEMENTO = 80;

/** El texto de un elemento que el evaluador cortó termina en "…" y en una palabra entera ("… de 65 años o…"). */
export function textoDeElemento(texto) {
  const limpio = String(texto ?? "").trim();
  if (limpio.length < LARGO_DEL_TEXTO_DE_ELEMENTO) return limpio;
  const espacio = limpio.lastIndexOf(" ");
  const corte = espacio >= LARGO_DEL_TEXTO_DE_ELEMENTO - 20 ? limpio.slice(0, espacio) : limpio;
  return `${corte.replace(/[\s,.;:–—-]+$/, "")}…`;
}

/**
 * La acción de un paso, estructurada (como action_signature del evaluador, pero sin frase).
 * @returns {Firma}
 */
export function firmaDelPaso(paso) {
  const descripcion = String(paso.description ?? "");
  const [x = null, y = null] = Array.isArray(paso.coordinates) ? paso.coordinates : [];
  const base = { tipo: "otra", objetivo: null, direccion: null, cantidad: null, x, y, original: descripcion };
  const elemento = paso.element ?? {};
  const etiqueta = textoDeElemento(elemento.text) || elemento.href || null;
  const entrada = paso.action_input ?? {};
  switch (paso.action) {
    case "left_click":
      return etiqueta ? { ...base, tipo: "clic", objetivo: etiqueta } : { ...base, tipo: "clic_coordenadas" };
    case "double_click":
      return { ...base, tipo: "doble_clic", objetivo: etiqueta };
    case "triple_click":
      return { ...base, tipo: "triple_clic", objetivo: etiqueta };
    case "scroll": {
      const descrito = /^scroll (\w+) x(\d+)/.exec(descripcion);
      const direccion = entrada.scroll_direction ?? descrito?.[1];
      const cantidad = Number(entrada.scroll_amount ?? descrito?.[2]);
      return {
        ...base,
        tipo: "desplazar",
        direccion: DIRECCIONES[direccion] ?? null,
        cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : null,
      };
    }
    case "type":
      return { ...base, tipo: "escribir", objetivo: entrada.text ?? /^escribir «(.*)»$/s.exec(descripcion)?.[1] ?? "" };
    case SALTO_DEL_EXPLORADOR:
      return { ...base, tipo: "volver", objetivo: entrada.titulo ?? /^volver a «(.*)»$/s.exec(descripcion)?.[1] ?? null };
    case "key":
      if (descripcion === "atrás" || (paso.signals ?? []).includes("went_back")) return { ...base, tipo: "atras" };
      return { ...base, tipo: "tecla", objetivo: entrada.text ?? descripcion.replace(/^tecla\s*/, "") };
    default:
      return base;
  }
}

/**
 * "Lo que pasó" en un paso: una lista ordenada de claves de datos.loQuePaso.* con sus variables.
 * Lista vacía = nada registrado (textoDeLoQuePaso() dice "Sin cambios registrados").
 * @returns {Texto[]}
 */
export function loQuePaso(paso) {
  const partes = [];
  const senales = paso.signals ?? [];
  const cambioDeUrl = normalizarUrl(paso.url_before) !== normalizarUrl(paso.url);
  const cambioDeTitulo = String(paso.title_before ?? "").trim() !== String(paso.title ?? "").trim();
  const parte = (clave, vars = {}) => partes.push({ clave, vars });

  if (senales.includes("went_back")) parte("volvio");
  if (cambioDeUrl) parte("cambioUrl", { de: rutaLegible(paso.url_before), a: rutaLegible(paso.url) });
  if (cambioDeTitulo && String(paso.title ?? "").trim()) parte("cambioTitulo", { titulo: paso.title.trim() });
  if (!cambioDeUrl && !cambioDeTitulo) {
    if (senales.includes("no_effect")) parte("sinCambio");
    else if (typeof paso.screen_change === "number") {
      parte("cambioParcial", { porcentaje: Math.round(paso.screen_change * 100) });
    }
  }
  if (senales.includes("visible_error")) parte("errorVisible");
  if (senales.includes("security_block")) parte("bloqueoSeguridad");
  if (paso.error_detail) parte("detalle", { texto: String(paso.error_detail) });
  return partes;
}

/** Si lo que hizo el paso coincide con lo que esperaba el usuario (estimado, sin juez por paso). */
export function coincidenciaDelPaso({ senales, paginaAntes, pagina, cambio }) {
  if (senales.some((senal) => senal === "no_effect" || senal === "went_back" || senal === "visible_error")) return "no";
  if (paginaAntes !== pagina || (typeof cambio === "number" && cambio >= CAMBIO_QUE_CUENTA)) return "si";
  return "incierto";
}

// Cuánto de la ruta recomendada sigue un camino desde el inicio, sin salirse: el largo del prefijo común.
function prefijoComun(camino, paginasDeRuta) {
  let i = 0;
  while (i < camino.length && i < paginasDeRuta.length && camino[i] === paginasDeRuta[i]) i += 1;
  return i;
}

/**
 * ¿Recorrió el camino cada tramo de la ruta, en orden? Cada tramo (origen → destino) tiene que aparecer seguido en
 * el camino, después del anterior; antes, entre medio y después puede haber otras páginas (un explorador abre otras
 * ramas antes de tomar la ruta).
 */
export function recorreLaRuta(camino, paginasDeRuta) {
  if (paginasDeRuta.length < 2) return false;
  let desde = 0;
  for (let k = 0; k + 1 < paginasDeRuta.length; k += 1) {
    let encontrado = -1;
    for (let i = desde; i + 1 < camino.length; i += 1) {
      if (camino[i] === paginasDeRuta[k] && camino[i + 1] === paginasDeRuta[k + 1]) {
        encontrado = i;
        break;
      }
    }
    if (encontrado < 0) return false;
    desde = encontrado + 1;
  }
  return true;
}

// Recorre un intento como build_route_tree: cada paso cae en un nodo crudo (clave URL + título, o
// solo la URL si el título no calza) y de ahí en su página.
function ubicarIntento(run, buscarNodo, paginaDeNodo) {
  const paginaDe = (url, titulo) => {
    const nodo = buscarNodo(url, titulo);
    return nodo ? paginaDeNodo.get(nodo) : null;
  };
  const nodoInicial = run.start?.url ? buscarNodo(run.start.url, run.start.title) : null;
  let nodoFinal = nodoInicial;
  const paginaInicial = nodoInicial ? paginaDeNodo.get(nodoInicial) : null;
  const camino = paginaInicial ? [paginaInicial] : [];
  const llegadas = paginaInicial ? [0] : [];
  const paginas = [];
  for (const paso of run.steps ?? []) {
    const nodo = buscarNodo(paso.url, paso.title);
    if (nodo) nodoFinal = nodo;
    const pagina = nodo ? paginaDeNodo.get(nodo) : null;
    paginas.push(pagina);
    if (pagina && pagina !== camino.at(-1)) {
      camino.push(pagina);
      llegadas.push(paso.number);
    }
  }
  return { camino, llegadas, paginas, paginaInicial, nodoFinal, paginaDe };
}

// Une las ramas crudas según las páginas: suma lo que coincide, descarta los lazos que deja la unión
// y separa los tramos de intentos con error de la herramienta (que el evaluador contó como fallos).
// `intentosDelTramo(perfil, origen, destino)`: los ids de intento detrás de un perfil del árbol.
export function unirRamas(ramasCrudas, paginaDeNodo, intentosDelTramo, intentosConError) {
  const porPar = new Map();
  for (const cruda of ramasCrudas) {
    const origen = paginaDeNodo.get(cruda.source);
    const destino = paginaDeNodo.get(cruda.target);
    if (!origen || !destino || origen === destino) continue;
    const id = `${origen}>${destino}`;
    let rama = porPar.get(id);
    if (!rama) {
      rama = { id, origen, destino, acciones: [], exitos: 0, fallos: 0, errores: 0, perfiles: [], intentosIds: [], tiempos: [], pasos: [] };
      porPar.set(id, rama);
    }
    // Un intento con error nunca es success, así que cada tramo suyo quedó como fallo en el árbol.
    const perfiles = cruda.profiles ?? [];
    const conError = perfiles.filter((perfil) => {
      const ids = intentosDelTramo(perfil, origen, destino);
      return ids.length > 0 && ids.every((id) => intentosConError.has(id));
    }).length;
    rama.exitos += cruda.successes ?? 0;
    rama.fallos += Math.max(0, (cruda.failures ?? 0) - conError);
    rama.errores += conError;
    for (const perfil of perfiles) if (!rama.perfiles.includes(perfil)) rama.perfiles.push(perfil);
    for (const perfil of new Set(perfiles)) {
      for (const intento of intentosDelTramo(perfil, origen, destino)) if (!rama.intentosIds.includes(intento)) rama.intentosIds.push(intento);
    }
    rama.tiempos.push(...(cruda.times_s ?? []));
    rama.pasos.push(...(cruda.steps ?? []));
    const texto = String(cruda.action ?? "");
    const accion = rama.acciones.find((otra) => otra.accion.toLocaleLowerCase() === texto.toLocaleLowerCase());
    if (accion) {
      accion.pasadas += perfiles.length;
      for (const perfil of perfiles) if (!accion.perfiles.includes(perfil)) accion.perfiles.push(perfil);
    } else {
      rama.acciones.push({ accion: texto, pasadas: perfiles.length, perfiles: [...new Set(perfiles)], salto: esVolver(texto) });
    }
  }
  return [...porPar.values()].map(({ tiempos, pasos, ...rama }) => {
    // intentos = cuántos intentos distintos tomaron el tramo o hicieron la acción (lo que dice «Grosor = intentos»);
    // pasadas = cuántas veces se pasó por ahí (un explorador que vuelve pasa varias veces).
    const acciones = rama.acciones
      .map((accion) => ({ ...accion, intentos: accion.perfiles.length }))
      .sort((a, b) => b.intentos - a.intentos || b.pasadas - a.pasadas || (a.accion < b.accion ? -1 : 1));
    return {
      ...rama,
      acciones,
      accion: acciones[0]?.accion ?? "",
      // Con repeticiones, un perfil del árbol son varios intentos: se cuentan los intentos, no los perfiles.
      intentos: rama.intentosIds.length || rama.perfiles.length,
      pasadas: rama.exitos + rama.fallos + rama.errores,
      medianaSegundos: mediana(tiempos),
      pasosMinimos: pasos.length ? Math.min(...pasos) : 1,
    };
  });
}

/**
 * Cómo terminó lo que pasó por una rama, para su color: la marca del evaluador (exitos/fallos), salvo que todos los
 * intentos válidos que pasaron por ella estén sin medir (sin ruta de la Guía ni juez): entonces "sin_medir", porque
 * esos fallos del árbol no dicen nada.
 * @param {{ exitos: number, fallos: number, errores: number, intentosIds?: string[] }} rama
 * @param {Finales} [finalesDelDestino]
 * @param {Map<string, Resultado>} [resultadoDe]  resultado de cada intento por id
 */
export function resultadoDeRama(rama, finalesDelDestino, resultadoDe = new Map()) {
  if (rama.exitos === 0 && rama.fallos === 0 && rama.errores > 0) return "error";
  if (rama.exitos > 0 && rama.fallos === 0) return "exito";
  if (rama.exitos > 0) return "mixto";
  const validos = (rama.intentosIds ?? []).map((id) => resultadoDe.get(id)).filter((resultado) => resultado && resultado !== "error");
  if (validos.length && validos.every((resultado) => resultado === "sin_medir")) return "sin_medir";
  const finales = finalesDelDestino ?? {};
  return (finales.abandonado ?? 0) > 0 && !(finales.fallido ?? 0) ? "abandono" : "fallo";
}

/** Distancia en ramas desde el inicio; lo inalcanzable queda un paso más allá del máximo. */
export function distancias(paginas, ramas) {
  const salida = new Map();
  for (const rama of ramas) {
    if (!salida.has(rama.origen)) salida.set(rama.origen, []);
    salida.get(rama.origen).push(rama.destino);
  }
  const distancia = new Map();
  const cola = paginas.filter((pagina) => pagina.esInicio).map((pagina) => pagina.id);
  for (const id of cola) distancia.set(id, 0);
  while (cola.length) {
    const actual = cola.shift();
    for (const destino of salida.get(actual) ?? []) {
      if (!distancia.has(destino)) {
        distancia.set(destino, distancia.get(actual) + 1);
        cola.push(destino);
      }
    }
  }
  const maximo = Math.max(0, ...distancia.values());
  return new Map(paginas.map((pagina) => [pagina.id, distancia.get(pagina.id) ?? maximo + 1]));
}

const esVolver = (accion) => /^volver a\b/i.test(String(accion ?? "").trim());

/**
 * @typedef {Object} PaginaDeLaGuia
 * @property {string | null} id      la página de la telaraña, o null si ningún intento llegó a ella
 * @property {string} url
 * @property {string} titulo
 * @property {string | null} tituloCorto
 * @property {"sitio" | "inicio" | "url"} tituloTipo   como en Pagina: para nombrarla si no está en la telaraña
 * @property {string | null} accion  lo que hizo la Guía para llegar a ella (null en la página inicial)
 *
 * @typedef {{ paginas: PaginaDeLaGuia[], verificada: boolean }} RutaDeLaGuia
 */

/**
 * La ruta de la Guía (su route.json) pasada a las páginas de la tanda: la página inicial y cada página a la que lleva
 * un paso, sin repetidos seguidos. Es la ruta contra la que se mide el resultado de cada intento; la de la telaraña
 * (`telarana.ruta`) sale de los intentos que llegaron y no existe si ninguno llegó.
 * @param {object | null} guia  route.json (pasos con url_after/title_after; los viejos, con url/title)
 * @param {(url: string, titulo: string) => string | null} paginaDe   URL + título → id de página de la tanda
 * @param {{ titulo: string }[]} paginasDeLaTanda   para quitar el sufijo común de los títulos
 * @returns {RutaDeLaGuia | null}  null sin route.json o si la ruta no sale de la página inicial
 */
export function rutaDeLaGuia(guia, paginaDe, paginasDeLaTanda = []) {
  if (!guia || typeof guia !== "object") return null;
  const texto = (valor) => (typeof valor === "string" ? valor : "");
  const pasos = (Array.isArray(guia.steps) ? guia.steps : []).filter((paso) => paso && typeof paso === "object");
  const inicio = texto(guia.start?.url)
    ? { url: texto(guia.start.url), titulo: texto(guia.start.title) }
    : texto(pasos[0]?.url_before)
      ? { url: texto(pasos[0].url_before), titulo: texto(pasos[0].title_before) }
      : null;
  if (!inicio) return null;
  const lugares = [{ ...inicio, accion: null }];
  for (const paso of pasos) {
    const url = texto(paso.url_after) || texto(paso.url);
    if (url) lugares.push({ url, titulo: texto(paso.title_after) || texto(paso.title), accion: texto(paso.label) || texto(paso.action) || null });
  }
  // Títulos distintos: uno repetido (el inicio, en la tanda y en la ruta) haría de sufijo común a sí mismo.
  const sufijo = sufijoComun([...new Set([...paginasDeLaTanda.map((pagina) => pagina.titulo), ...lugares.map((lugar) => lugar.titulo)])]);
  const paginas = [];
  for (const lugar of lugares) {
    const id = paginaDe(lugar.url, lugar.titulo) ?? null;
    const clave = id ?? `url:${rutaSinConsulta(lugar.url)}`;
    if (paginas.at(-1)?.clave === clave) continue;
    const inicioDelSitio = caminoDe(lugar.url) === "/";
    const corto = lugar.titulo.trim() ? quitarSufijo(lugar.titulo, sufijo) : null;
    paginas.push({
      clave,
      id,
      url: lugar.url,
      titulo: lugar.titulo,
      tituloCorto: inicioDelSitio ? null : (corto ?? tituloDesdeRuta(lugar.url) ?? lugar.url),
      tituloTipo: inicioDelSitio ? "inicio" : corto ? "sitio" : "url",
      accion: lugar.accion,
    });
  }
  if (paginas.length < 2) return null;
  return { paginas: paginas.map(({ clave, ...pagina }) => pagina), verificada: guia.status === "verified" || guia.verified === true };
}

/**
 * La ruta recomendada del evaluador, pasada a páginas: los nodos de una misma página se juntan y cada tramo va de un
 * hito al siguiente. Las acciones y los pasos son los de la ruta del evaluador (como en su report.md), no los de la
 * rama unida entre esas páginas: la acción del tramo es la del paso que cambia de página (nunca un «volver a…», que
 * un usuario que no vio la página no puede hacer) y sus pasos son ese clic más cada acción previa que lista
 * (`preceding_actions`; «scroll down x10» cuenta 1), sumados si el tramo junta varios pasos. Los segundos, la mediana
 * de cada paso (`median_time_s`); si falta, la de la rama.
 * @returns {Ruta | null}
 */
export function rutaEnPaginas(rutaCruda, paginaDeNodo, ramaPorId) {
  if (!rutaCruda) return null;
  const paginas = [];
  const grupos = []; // por tramo, los pasos de la ruta que lo forman
  let pendientes = [];
  const inicio = paginaDeNodo.get(rutaCruda.start_node);
  if (inicio) paginas.push(inicio);
  for (const paso of rutaCruda.steps ?? []) {
    const destino = paginaDeNodo.get(paso.target);
    pendientes.push(paso);
    if (!destino || destino === paginas.at(-1)) continue; // sigue en la misma página
    if (paginas.length) grupos.push({ origen: paginas.at(-1), destino, pasos: pendientes });
    paginas.push(destino);
    pendientes = [];
  }
  // Una ruta sin tramos (la respuesta en la página inicial, o un sitio que no cargó) no es una ruta que seguir.
  if (paginas.length < 2) return null;
  const tramos = grupos.map(({ origen, destino, pasos }) => {
    const rama = ramaPorId.get(`${origen}>${destino}`);
    const ultima = String(pasos.at(-1)?.action ?? "");
    const deLaRama = rama?.acciones?.find((accion) => !esVolver(accion.accion))?.accion ?? "";
    const tiempos = pasos.map((paso) => paso.median_time_s);
    return {
      origen,
      destino,
      accion: ultima && !esVolver(ultima) ? ultima : deLaRama || ultima,
      pasos: pasos.reduce((total, paso) => total + 1 + (paso.preceding_actions?.length ?? 0), 0),
      segundos: tiempos.every(Number.isFinite) ? redondear(tiempos.reduce((a, b) => a + b, 0), 1) : (rama?.medianaSegundos ?? null),
    };
  });
  const segundos = tramos.every((tramo) => tramo.segundos !== null)
    ? redondear(tramos.reduce((total, tramo) => total + tramo.segundos, 0), 1)
    : null;
  return {
    paginas,
    tramos,
    pasosIdeales: tramos.reduce((total, tramo) => total + tramo.pasos, 0),
    probabilidad: rutaCruda.estimated_probability ?? null,
    segundos,
  };
}

/**
 * Una ruta del evaluador sin tramos que termina donde empieza: la tarea se resuelve en la página de inicio.
 * → { pagina, probabilidad } o null (no hay ruta, o sí tiene tramos).
 */
export function rutaEnLaPaginaDeInicio(rutaCruda, paginaDeNodo) {
  const inicio = rutaCruda ? paginaDeNodo.get(rutaCruda.start_node) : null;
  if (!inicio) return null;
  const fin = paginaDeNodo.get(rutaCruda.end_node ?? rutaCruda.start_node) ?? inicio;
  const sale = (rutaCruda.steps ?? []).some((paso) => (paginaDeNodo.get(paso.target) ?? inicio) !== inicio);
  return fin === inicio && !sale ? { pagina: inicio, probabilidad: rutaCruda.estimated_probability ?? null } : null;
}

/**
 * Cómo ve la ruta las páginas de un intento. Un intento que parte en otra página de inicio (m.sitio.cl en vez
 * de sitio.cl, porque el sitio redirige al celular) no eligió dónde partir: esa página hace de inicio de la
 * ruta. Devuelve la función página → página de la ruta y el camino visto así (sin repetidos seguidos).
 * @param {string[]} camino
 * @param {number[]} llegadas
 * @param {Ruta | null} ruta
 * @param {Set<string>} inicios   páginas donde parte algún intento (is_start)
 */
export function caminoSegunRuta(camino, llegadas, ruta, inicios) {
  const inicioDeRuta = ruta?.paginas[0] ?? null;
  const [primera] = camino;
  const alterno =
    inicioDeRuta && primera && primera !== inicioDeRuta && inicios.has(primera) && inicios.has(inicioDeRuta) &&
    !ruta.paginas.includes(primera)
      ? primera
      : null;
  const comoRuta = (pagina) => (alterno && pagina === alterno ? inicioDeRuta : pagina);
  if (!alterno) return { comoRuta, camino, llegadas };
  const visto = [];
  const llegadasVistas = [];
  camino.forEach((pagina, i) => {
    const comoLaVe = comoRuta(pagina);
    if (comoLaVe === visto.at(-1)) return;
    visto.push(comoLaVe);
    llegadasVistas.push(llegadas[i]);
  });
  return { comoRuta, camino: visto, llegadas: llegadasVistas };
}

// Hitos alcanzados, aunque el intento se haya salido de la ruta y vuelto: cada hito se busca en el
// camino desde donde se alcanzó el anterior.
function hitosDelCamino(camino, llegadas, ruta) {
  if (!ruta) return [];
  let desde = 0;
  return ruta.paginas.map((pagina) => {
    const indice = camino.indexOf(pagina, desde);
    if (indice < 0) return { pagina, alcanzado: false, paso: null };
    desde = indice;
    return { pagina, alcanzado: true, paso: llegadas[indice] };
  });
}

function separacion(camino, llegadas, ruta, ultimoPaso) {
  if (!ruta || !camino.length) return { sigueLaRuta: false, seSepara: null, vuelveALaRuta: false, vuelveEnPaso: null };
  const comun = prefijoComun(camino, ruta.paginas);
  if (comun === ruta.paginas.length) {
    return { sigueLaRuta: true, seSepara: null, vuelveALaRuta: false, vuelveEnPaso: null };
  }
  // Se salió de la ruta (o empezó por otra rama) y aun así puede haber recorrido todos sus tramos después.
  const sigueLaRuta = recorreLaRuta(camino, ruta.paginas);
  const seDetuvo = comun === camino.length;
  const seSepara = {
    tramo: comun,
    paso: seDetuvo ? ultimoPaso : llegadas[comun],
    pagina: seDetuvo ? null : camino[comun],
    seDetuvo,
  };
  let vuelveEnPaso = null;
  if (!seDetuvo) {
    for (let i = comun; i < camino.length; i += 1) {
      if (ruta.paginas.indexOf(camino[i]) >= comun) {
        vuelveEnPaso = llegadas[i];
        break;
      }
    }
  }
  return { sigueLaRuta, seSepara, vuelveALaRuta: vuelveEnPaso !== null, vuelveEnPaso };
}

function rutaDesde(paginaAntes, pagina, salePagina, ruta) {
  if (!ruta) return null;
  const hito = paginaAntes ? ruta.paginas.indexOf(paginaAntes) : -1;
  if (hito < 0) return { enRuta: false };
  const total = ruta.tramos.length;
  if (hito >= total) return { enRuta: true, hito, total, termina: true };
  const tramo = ruta.tramos[hito];
  return {
    enRuta: true,
    hito,
    total,
    termina: false,
    accion: tramo.accion,
    destino: tramo.destino,
    coincideConUsuario: salePagina ? pagina === tramo.destino : null,
  };
}

function armarPasos(run, ubicacion, ruta, comoRuta) {
  const enRuta = new Set(ruta?.paginas ?? []);
  return (run.steps ?? []).map((crudo, i) => {
    const pagina = ubicacion.paginas[i];
    // La página de antes es la del paso anterior; si no se ubicó, la de url_before.
    const previa = i === 0 ? ubicacion.paginaInicial : ubicacion.paginas[i - 1];
    const paginaAntes = previa ?? ubicacion.paginaDe(crudo.url_before, crudo.title_before);
    // Volver a una página ya vista con volver_a_nodo es la herramienta del explorador para abrir otra rama, no un
    // tropiezo: el «went_back» que el evaluador le pone no cuenta (ni en los tropiezos ni en las marcas de atasco).
    const senales = (crudo.signals ?? []).filter((senal) => !(senal === "went_back" && esSaltoDelExplorador(crudo.action)));
    const cambio = typeof crudo.screen_change === "number" ? crudo.screen_change : null;
    const segundos = typeof crudo.seconds_since_start === "number" ? crudo.seconds_since_start : null;
    const duracion = typeof crudo.duration_s === "number" ? crudo.duration_s : null;
    const salePagina = paginaAntes !== pagina;
    return {
      numero: crudo.number,
      accion: crudo.action,
      descripcion: crudo.description ?? "",
      firma: firmaDelPaso(crudo),
      elemento: String(crudo.element?.text ?? "").trim() || crudo.element?.href || null,
      coordenadas: crudo.coordinates ?? null,
      expectativa: crudo.expectation ?? "",
      urlAntes: crudo.url_before ?? "",
      url: crudo.url ?? "",
      tituloAntes: crudo.title_before ?? "",
      titulo: crudo.title ?? "",
      capturaAntes: crudo.screenshot_before ?? null,
      captura: crudo.screenshot ?? null,
      segundos,
      duracion,
      inicioSegundos: segundos !== null && duracion !== null ? redondear(Math.max(0, segundos - duracion)) : segundos,
      cambio,
      senales,
      estado: estadoDelPaso(senales),
      coincide: coincidenciaDelPaso({ senales, paginaAntes, pagina, cambio }),
      loQuePaso: loQuePaso(crudo),
      paginaAntes: paginaAntes ?? null,
      pagina: pagina ?? null,
      salePagina,
      carril: !ruta ? "sin-ruta" : enRuta.has(comoRuta(pagina)) ? "en-ruta" : "fuera-de-ruta",
      rutaAqui: rutaDesde(comoRuta(paginaAntes), comoRuta(pagina), salePagina, ruta),
    };
  });
}

const textoNoVacio = (valor) => typeof valor === "string" && valor !== "";

/** El perfil de un run.json (`desktop` en la carpeta `desktop-2`); si no trae uno, la carpeta. */
export const perfilDelRun = (run, carpeta) => (textoNoVacio(run.profile) ? run.profile : carpeta);

/** El intento 2 en adelante de un perfil lleva «#n» en el nombre (no se traduce: es un número). */
const nombreDeRepeticion = (nombre, repeticion) => (repeticion > 1 ? `${nombre} #${repeticion}` : nombre);

// Sin `source` el run.json es anterior a la ruta de la Guía: el veredicto era del juez.
const fuenteDelVeredicto = (verdict) =>
  verdict && "source" in verdict ? (FUENTE_DEL_VEREDICTO[verdict.source] ?? null) : verdict?.outcome ? "juez" : null;

function armarIntento({ perfil: carpeta, run, video }, ubicacion, ruta, inicios) {
  const error = errorDelIntento(run);
  const resultadoJuez = run.verdict?.outcome ?? "abandoned";
  const resultado = resultadoDelRun(run, error);
  const fuente = fuenteDelVeredicto(run.verdict);
  const declaroTerminar = typeof run.verdict?.claimed_done === "boolean" ? run.verdict.claimed_done : null;
  const repeticion = Number.isInteger(run.attempt) && run.attempt > 0 ? run.attempt : 1;
  const perfil = perfilDelRun(run, carpeta);
  const nombreDelPerfil = textoNoVacio(run.profile_name) ? run.profile_name : perfil;
  const { camino, llegadas } = ubicacion;
  // Contra la ruta se compara el camino visto desde ella (otra página de inicio cuenta como la de la ruta);
  // `camino` queda con las páginas reales.
  const segunRuta = caminoSegunRuta(camino, llegadas, ruta, inicios);
  const pasos = armarPasos(run, ubicacion, ruta, segunRuta.comoRuta);
  const hitos = hitosDelCamino(segunRuta.camino, segunRuta.llegadas, ruta);
  const ultimoPaso = pasos.at(-1)?.numero ?? 0;
  const { sigueLaRuta, seSepara, vuelveALaRuta, vuelveEnPaso } = separacion(segunRuta.camino, segunRuta.llegadas, ruta, ultimoPaso);
  const [ancho, alto] = String(run.viewport ?? "").split("x").map(Number);
  const duracionDelRun = typeof run.duration_s === "number" && run.duration_s > 0 ? run.duration_s : null;
  const costo = run.token_usage?.equivalent_cost_usd;
  let logro = null;
  // Sin ruta recomendada no hay "directo" ni "indirecto".
  if (resultado === "logrado" && ruta) logro = sigueLaRuta ? "directo" : "indirecto";
  else if (resultado === "fallido" && fuente === "ruta" && declaroTerminar) logro = "declaro_sin_llegar";
  const intento = {
    id: carpeta,
    perfil,
    carpeta,
    repeticion,
    nombrePerfil: nombreDeRepeticion(nombreDelPerfil, repeticion),
    nombreDelPerfil,
    viewport: { ancho: ancho || null, alto: alto || null },
    modelo: run.model ?? null,
    motor: run.engine ?? null,
    resultado,
    resultadoJuez,
    fuente,
    declaroTerminar,
    logro,
    justificacion: run.verdict?.justification ?? "",
    error,
    motivoDeFin: run.end_reason ?? null,
    // La traza de un error nunca se muestra como si fuera la respuesta del usuario.
    respuesta: error ? "" : (run.final_message ?? ""),
    duracion: duracionDelRun ?? pasos.at(-1)?.segundos ?? null,
    costoUsd: typeof costo === "number" ? costo : null,
    inicio: run.start?.url ? { url: run.start.url, titulo: run.start.title ?? "", captura: run.start.screenshot ?? null } : null,
    capturaFinal: run.final_screenshot || null,
    video: Boolean(video),
    // El video empieza a grabar antes de que cargue la página: los segundos de cada paso van corridos por esto.
    videoDesfase: typeof run.video_offset_s === "number" && Number.isFinite(run.video_offset_s) ? run.video_offset_s : 0,
    pasos,
    camino,
    hitos,
    hitosAlcanzados: hitos.filter((hito) => hito.alcanzado).length,
    sigueLaRuta,
    seSepara,
    vuelveALaRuta,
    vuelveEnPaso,
    demoras: [],
    conocimiento: run.conocimiento === "sin_contexto" || run.conocimiento === "conoce_tema" ? run.conocimiento : null,
    instruccion: typeof run.instruction === "string" && run.instruction.trim() ? run.instruction.trim() : null,
    terminosRechazados: Array.isArray(run.terminos_rechazados) ? [...new Set(run.terminos_rechazados.map(String))] : [],
  };
  intento.demoras = error
    ? []
    : demorasDelIntento(intento, ruta, {
        logrado: resultado === "logrado",
        paginaFinal: camino.at(-1) ?? null,
        comoRuta: segunRuta.comoRuta,
      });
  return intento;
}

// Captura de cada página: la primera que aparece, prefiriendo intentos válidos de escritorio.
function capturasDePaginas(intentos) {
  const orden = [...intentos].sort((a, b) => puntajeDeCaptura(a) - puntajeDeCaptura(b));
  const capturas = new Map();
  for (const intento of orden) {
    const inicial = intento.camino[0];
    if (inicial && intento.inicio?.captura && !capturas.has(inicial)) {
      capturas.set(inicial, { perfil: intento.id, archivo: intento.inicio.captura });
    }
    for (const paso of intento.pasos) {
      if (paso.pagina && paso.captura && !capturas.has(paso.pagina)) {
        capturas.set(paso.pagina, { perfil: intento.id, archivo: paso.captura });
      }
    }
  }
  return capturas;
}

const esEscritorio = (intento) => (intento.viewport.ancho ?? 0) >= ANCHO_DE_ESCRITORIO;
const puntajeDeCaptura = (intento) => (intento.resultado === "error" ? 2 : 0) + (esEscritorio(intento) ? 0 : 1);

function finalesCorregidos(nodosCrudos, intentos, nodoFinalDe) {
  const finales = new Map(
    nodosCrudos.map((nodo) => [
      nodo.id,
      {
        logrado: nodo.endings?.success ?? 0,
        fallido: nodo.endings?.failed ?? 0,
        abandonado: nodo.endings?.abandoned ?? 0,
        sin_medir: nodo.endings?.unmeasured ?? 0,
        error: 0,
      },
    ]),
  );
  // El evaluador contó el final de un intento con error como abandono (o fallo): pasa a "error". Un interrumpido
  // no está en el árbol: no hay qué descontar.
  for (const intento of intentos) {
    if (intento.resultado !== "error") continue;
    const suyos = finales.get(nodoFinalDe.get(intento.id));
    if (!suyos) continue;
    if (intento.resultadoJuez !== INTERRUMPIDO) {
      const campo = RESULTADO_DEL_VEREDICTO[intento.resultadoJuez] ?? "abandonado";
      suyos[campo] = Math.max(0, suyos[campo] - 1);
    }
    suyos.error += 1;
  }
  return finales;
}

function armarPaginas(grupos, finalesPorNodo, ruta, ramas, capturas) {
  const enRuta = ruta?.paginas ?? [];
  const base = grupos.map(({ id, nodos }) => {
    const [primero] = nodos;
    const finales = { logrado: 0, fallido: 0, abandonado: 0, sin_medir: 0, error: 0 };
    for (const nodo of nodos) {
      for (const [clave, valor] of Object.entries(finalesPorNodo.get(nodo.id))) finales[clave] += valor;
    }
    const perfiles = [];
    for (const nodo of nodos) for (const perfil of nodo.profiles ?? []) if (!perfiles.includes(perfil)) perfiles.push(perfil);
    return {
      id,
      titulo: String(primero.title ?? "").trim(),
      url: nodos.length > 1 ? rutaSinConsulta(primero.url) : primero.url,
      variantes: nodos.map((nodo) => ({
        nodo: nodo.id,
        url: nodo.url,
        consulta: consultaDe(nodo.url),
        visitas: nodo.visits ?? 0,
        perfiles: [...(nodo.profiles ?? [])],
      })),
      visitas: nodos.reduce((total, nodo) => total + (nodo.visits ?? 0), 0),
      perfiles,
      esInicio: nodos.some((nodo) => nodo.is_start),
      finales,
      enRuta: enRuta.includes(id),
      hito: enRuta.includes(id) ? enRuta.indexOf(id) : null,
    };
  });
  const distancia = distancias(base, ramas);
  return titularPaginas(base).map((pagina) => {
    const { id, titulo, tituloCorto, tituloTipo, url, variantes, visitas, perfiles, esInicio, finales, enRuta: estaEnRuta, hito } = pagina;
    return {
      id, titulo, tituloCorto, tituloTipo, url, variantes, visitas, perfiles, esInicio, finales,
      enRuta: estaEnRuta, hito, distancia: distancia.get(id), captura: capturas.get(id) ?? null,
    };
  });
}

function senalDominante(pasos) {
  const cuentas = new Map();
  for (const paso of pasos) for (const senal of paso.senales) cuentas.set(senal, (cuentas.get(senal) ?? 0) + 1);
  let mejor = null;
  for (const senal of ORDEN_DE_SENALES) {
    if ((cuentas.get(senal) ?? 0) > (cuentas.get(mejor) ?? 0)) mejor = senal;
  }
  return mejor;
}

function armarPerfiles(intentos, ruta) {
  const nombres = [...new Set(intentos.map((intento) => intento.perfil))];
  return nombres.map((perfil) => {
    const suyos = intentos.filter((intento) => intento.perfil === perfil);
    const validos = suyos.filter((intento) => intento.resultado !== "error");
    const medidos = validos.filter((intento) => intento.resultado !== "sin_medir");
    const logrados = validos.filter((intento) => intento.resultado === "logrado");
    const desviados = validos.filter((intento) => intento.seSepara && !intento.seSepara.seDetuvo);
    const eficiencias = ruta
      ? logrados.map((intento) => Math.min(1, ruta.pasosIdeales / Math.max(1, intento.pasos.length)))
      : [];
    const primeraSeparacion = validos
      .filter((intento) => intento.seSepara)
      .map((intento) => ({ intento: intento.id, ...intento.seSepara }))
      .sort((a, b) => a.tramo - b.tramo || a.paso - b.paso)[0] ?? null;
    return {
      perfil,
      nombre: suyos[0].nombreDelPerfil,
      intentos: suyos.map((intento) => intento.id),
      validos: validos.length,
      medidos: medidos.length,
      errores: suyos.length - validos.length,
      logrados: logrados.length,
      directos: ruta ? logrados.filter((intento) => intento.logro === "directo").length : null,
      metricas: {
        exito: conteo(logrados.length, medidos.length),
        adherencia: ruta ? conteo(validos.filter((intento) => intento.sigueLaRuta).length, validos.length) : null,
        recuperacion: conteo(desviados.filter((intento) => intento.vuelveALaRuta).length, desviados.length),
        pasos: { valores: validos.map((intento) => intento.pasos.length), ruta: ruta?.pasosIdeales ?? null },
        segundos: { valores: validos.map((intento) => intento.duracion), ruta: ruta?.segundos ?? null },
        tropiezos: { valores: validos.map((intento) => intento.pasos.filter((paso) => paso.senales.length).length) },
        hitos: { valores: validos.map((intento) => intento.hitosAlcanzados), total: ruta?.paginas.length ?? 0 },
        eficiencia: eficiencias.length
          ? redondear(eficiencias.reduce((a, b) => a + b, 0) / eficiencias.length)
          : null,
      },
      hitos: (ruta?.paginas ?? []).map((pagina, k) => ({
        pagina,
        alcanzados: validos.filter((intento) => intento.hitos[k]?.alcanzado).length,
        de: validos.length,
        pasos: validos
          .filter((intento) => intento.hitos[k]?.alcanzado)
          .map((intento) => ({ intento: intento.id, paso: intento.hitos[k].paso })),
        salen: validos
          .filter((intento) => intento.seSepara && !intento.seSepara.seDetuvo && intento.seSepara.tramo - 1 === k)
          .map((intento) => ({ intento: intento.id, paso: intento.seSepara.paso })),
        senalDominante: senalDominante(validos.flatMap((intento) => intento.pasos.filter((paso) => paso.pagina === pagina))),
      })),
      seSepara: primeraSeparacion,
    };
  });
}

function armarKpis(intentos, ruta) {
  const validos = intentos.filter((intento) => intento.resultado !== "error");
  return {
    intentos: intentos.length,
    validos: validos.length,
    // Los «sin medir» (sin ruta de la Guía ni juez) son válidos, pero no cuentan en «llegan n de m».
    medidos: validos.filter((intento) => intento.resultado !== "sin_medir").length,
    errores: intentos.length - validos.length,
    logrados: validos.filter((intento) => intento.resultado === "logrado").length,
    // Sin ruta, las cifras de la ruta no existen (null), no son 0.
    directos: ruta ? validos.filter((intento) => intento.logro === "directo").length : null,
    siguenLaRuta: ruta ? validos.filter((intento) => intento.sigueLaRuta).length : null,
    pasosMediana: mediana(validos.map((intento) => intento.pasos.length)),
    segundosMediana: mediana(validos.map((intento) => intento.duracion)),
    pasosIdeales: ruta?.pasosIdeales ?? null,
    tramos: ruta?.tramos.length ?? 0,
    hitos: ruta?.paginas.length ?? 0,
  };
}

/** "2026-11-21_07-28-42" → "2026-11-21T07:28:42" (hora local); un id de corrida "2026-11-21T10-28-42Z" queda en UTC. */
export function fechaIsoDe(fecha) {
  const partes = /^(\d{4}-\d{2}-\d{2})[_T](\d{2})-(\d{2})-(\d{2})(Z?)/.exec(String(fecha ?? ""));
  return partes ? `${partes[1]}T${partes[2]}:${partes[3]}:${partes[4]}${partes[5]}` : null;
}

/**
 * El árbol nombra perfiles, no intentos: con repeticiones (`desktop`, `desktop-2`), un tramo es de los intentos del
 * perfil cuyo camino lo recorre (de ninguno, si ninguno calza). Con un intento por perfil, ese intento. Los
 * interrumpidos no están en el árbol.
 */
function intentosDelTramoSegun(crudos, ubicaciones) {
  const porPerfil = new Map();
  crudos.forEach(({ perfil: carpeta, run }, i) => {
    if (fueraDelArbol(run)) return;
    const perfil = perfilDelRun(run, carpeta);
    if (!porPerfil.has(perfil)) porPerfil.set(perfil, []);
    porPerfil.get(perfil).push({ id: carpeta, camino: ubicaciones[i].camino });
  });
  return (perfil, origen, destino) => {
    const suyos = porPerfil.get(perfil) ?? [{ id: perfil, camino: [] }];
    if (suyos.length === 1) return [suyos[0].id];
    const pasaron = suyos.filter(({ camino }) => camino.some((pagina, i) => pagina === origen && camino[i + 1] === destino));
    return pasaron.map(({ id }) => id);
  };
}

/**
 * Arma la tanda completa para las pantallas.
 * @param {{ id: string, arbol: object | null, criterio: object | null,
 *           intentos: { perfil: string, run: object, video: boolean }[] }} entrada   `perfil`: la carpeta del intento
 * @returns {Tanda}
 */
export function armarTanda({ id, arbol, criterio, intentos: crudos, estadoDelArbol = arbol ? "ok" : "falta", guia = null }) {
  const nodosCrudos = arbol?.nodes ?? [];
  const idPorClave = new Map();
  const idPorUrl = new Map();
  for (const nodo of nodosCrudos) {
    idPorClave.set(claveDeNodo(nodo.url, nodo.title), nodo.id);
    if (!idPorUrl.has(normalizarUrl(nodo.url))) idPorUrl.set(normalizarUrl(nodo.url), nodo.id);
  }
  const buscarNodo = (url, titulo) =>
    url ? (idPorClave.get(claveDeNodo(url, titulo)) ?? idPorUrl.get(normalizarUrl(url)) ?? null) : null;

  const { grupos, paginaDeNodo, alias } = unirNodos(nodosCrudos);
  const ubicaciones = crudos.map(({ run }) => ubicarIntento(run, buscarNodo, paginaDeNodo));
  const conError = new Set(crudos.filter(({ run }) => errorDelIntento(run)).map(({ perfil }) => perfil));
  const ramasUnidas = unirRamas(arbol?.branches ?? [], paginaDeNodo, intentosDelTramoSegun(crudos, ubicaciones), conError);
  const ruta = rutaEnPaginas(arbol?.recommended_route ?? null, paginaDeNodo, new Map(ramasUnidas.map((r) => [r.id, r])));

  const inicios = new Set(grupos.filter(({ nodos }) => nodos.some((nodo) => nodo.is_start)).map(({ id }) => id));
  const intentos = crudos.map((crudo, i) => armarIntento(crudo, ubicaciones[i], ruta, inicios));
  const nodoFinalDe = new Map(intentos.map((intento, i) => [intento.id, ubicaciones[i].nodoFinal]));
  const finalesPorNodo = finalesCorregidos(nodosCrudos, intentos, nodoFinalDe);
  const paginas = armarPaginas(grupos, finalesPorNodo, ruta, ramasUnidas, capturasDePaginas(intentos));
  const finalesDe = new Map(paginas.map((pagina) => [pagina.id, pagina.finales]));
  const resultadoDe = new Map(intentos.map((intento) => [intento.id, intento.resultado]));
  const tramosDeRuta = new Set((ruta?.tramos ?? []).map((tramo) => `${tramo.origen}>${tramo.destino}`));
  const ramas = ramasUnidas.map((rama) => ({
    ...rama,
    resultado: resultadoDeRama(rama, finalesDe.get(rama.destino), resultadoDe),
    enRuta: tramosDeRuta.has(rama.id),
  }));

  const url = arbol?.url ?? intentos.find((intento) => intento.inicio)?.inicio.url ?? "";
  const fecha = arbol?.timestamp ?? id.split("/").at(-1);
  const evidencias = criterio?.evidence ?? arbol?.criteria?.evidence ?? [];
  const textoDelCriterio = criterio?.criterion ?? arbol?.criteria?.criterion ?? null;
  const tanda = {
    id,
    tarea: arbol?.task_id ?? id.split("/")[2] ?? null,
    instruccion: arbol?.instruction ?? "",
    // La tarea en palabras de alguien sin contexto (la que leen los exploradores «sin contexto»), si la tanda la tiene.
    instruccionSinContexto: typeof arbol?.tarea_sin_contexto === "string" && arbol.tarea_sin_contexto.trim() ? arbol.tarea_sin_contexto.trim() : null,
    url,
    host: hostDe(url),
    fecha,
    fechaIso: fechaIsoDe(fecha),
    motor: arbol?.engine ?? null,
    criterio: textoDelCriterio ? { texto: textoDelCriterio, evidencias: [...evidencias] } : null,
    // Tanda de exploradores: abren ramas a propósito (no pueden terminar antes del 40 % de las acciones), así que
    // sus pasos no dicen cuánto le cuesta el sitio a alguien.
    exploradores: Boolean(arbol?.conjunto_exploradores) || (intentos.length > 0 && intentos.every((intento) => intento.perfil.startsWith("explorador"))),
    intentos,
    telarana: { paginas, ramas, ruta, rutaEnInicio: ruta ? null : rutaEnLaPaginaDeInicio(arbol?.recommended_route ?? null, paginaDeNodo), alias },
    // La ruta de la Guía contra la que se midió cada intento (route.json de la corrida que la tanda lista en sus inputs).
    rutaGuia: rutaDeLaGuia(guia, (url, titulo) => {
      const nodo = buscarNodo(url, titulo);
      return nodo ? (paginaDeNodo.get(nodo) ?? null) : null;
    }, paginas),
    kpis: armarKpis(intentos, ruta),
    perfiles: armarPerfiles(intentos, ruta),
    porConocimiento: porConocimiento(intentos),
    // route_tree.json: "ok"; "falta" (tanda incompleta: el evaluador lo escribe al final) o "danado" (no es JSON).
    arbol: estadoDelArbol,
    hallazgos: [],
    titulares: null,
  };
  // El titular mira todos los hallazgos (no depende de cuántos desvíos hubo antes del recorte).
  const todos = calcularHallazgos(tanda, { maximo: Infinity });
  tanda.hallazgos = recortarHallazgos(todos);
  tanda.titulares = calcularTitulares(tanda, todos);
  return tanda;
}

/** Niveles de conocimiento de los exploradores, en el orden en que se comparan. */
export const NIVELES_DE_CONOCIMIENTO = ["sin_contexto", "conoce_tema"];

/**
 * Resultado por nivel de conocimiento (como la tabla del report.md del evaluador): por nivel, intentos, cuántos lo
 * lograron. null si la tanda no tiene los dos niveles.
 * @param {{ conocimiento: string | null, resultado: string }[]} intentos
 * @returns {{ nivel: string, intentos: number, logrados: number }[] | null}
 */
export function porConocimiento(intentos) {
  const niveles = NIVELES_DE_CONOCIMIENTO.map((nivel) => [nivel, intentos.filter((intento) => intento.conocimiento === nivel)]);
  if (niveles.some(([, suyos]) => !suyos.length)) return null;
  return niveles.map(([nivel, suyos]) => ({
    nivel,
    intentos: suyos.length,
    logrados: suyos.filter((intento) => intento.resultado === "logrado").length,
  }));
}

/**
 * La captura que representa una tanda en Corridas: la de después del primer clic que se queda en
 * la página de inicio y cambia la pantalla (suele ser cerrar el aviso emergente), en un intento
 * válido de escritorio; si no hay, la captura de inicio.
 */
export function capturaDeTanda(tanda) {
  const candidatos = [...tanda.intentos]
    .filter((intento) => intento.inicio)
    .sort((a, b) => puntajeDeCaptura(a) - puntajeDeCaptura(b));
  for (const intento of candidatos) {
    if (intento.resultado === "error") break;
    const inicial = intento.camino[0];
    const paso = intento.pasos.find(
      (p) => ACCIONES_DE_CLIC.has(p.accion) && p.pagina === inicial && !p.salePagina && (p.cambio ?? 0) >= CAMBIO_DE_LA_CAPTURA,
    );
    if (paso?.captura) return { perfil: intento.id, archivo: paso.captura };
  }
  const [primero] = candidatos;
  return primero?.inicio.captura ? { perfil: primero.id, archivo: primero.inicio.captura } : null;
}

/**
 * Lo que muestra la lista de corridas: una fila liviana por tanda (GET /api/tandas).
 * @param {Tanda} tanda
 */
export function resumirTanda(tanda) {
  const { kpis } = tanda;
  return {
    id: tanda.id,
    tarea: tanda.tarea,
    instruccion: tanda.instruccion,
    url: tanda.url,
    host: tanda.host,
    fecha: tanda.fecha,
    fechaIso: tanda.fechaIso,
    intentos: kpis.intentos,
    validos: kpis.validos,
    medidos: kpis.medidos,
    errores: kpis.errores,
    logrados: kpis.logrados,
    perfiles: tanda.intentos.map((intento) => ({
      intento: intento.id,
      perfil: intento.perfil,
      nombre: intento.nombrePerfil,
      resultado: intento.resultado,
    })),
    captura: capturaDeTanda(tanda),
    paginas: tanda.telarana.paginas.length,
    arbol: tanda.arbol ?? "ok",
  };
}
