// Lo que el backoffice calcula a partir de una tanda del evaluador: lógica pura, sin archivos,
// para poder probarla con datos fijos. Entra lo que hay en la fuente (route_tree.json, criteria.json
// y el run.json de cada perfil) y sale lo que dibujan las pantallas (forma exacta: §3 del diseño).
//
// No arma frases para la pantalla: lo que es texto de la interfaz sale como clave + variables
// ({ clave, vars }) o como campos estructurados, y public/datos/textos.js lo traduce.

import { demorasDelIntento, hallazgos as calcularHallazgos, titulares as calcularTitulares } from "./hallazgos.js";
import { titularPaginas, unirNodos } from "./paginas.js";
import { claveDeNodo, consultaDe, hostDe, normalizarUrl, rutaLegible, rutaSinConsulta } from "./url.js";

/**
 * @typedef {import("./hallazgos.js").Hallazgo} Hallazgo
 * @typedef {import("./hallazgos.js").Texto} Texto
 * @typedef {import("./hallazgos.js").Demora} Demora
 * @typedef {{ n: number, de: number }} Conteo
 * @typedef {"logrado" | "fallido" | "abandonado" | "error"} Resultado
 *
 * @typedef {Object} ErrorDeHerramienta
 * @property {"internal_error" | "api_error" | "no_response" | "refusal" | "juez" | "sin_inicio"} tipo
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
 * @property {string} id
 * @property {string} perfil
 * @property {string} nombrePerfil
 * @property {{ ancho: number | null, alto: number | null }} viewport
 * @property {string | null} modelo
 * @property {string | null} motor
 * @property {Resultado} resultado
 * @property {"success" | "failed" | "abandoned"} resultadoJuez
 * @property {"directo" | "indirecto" | null} logro
 * @property {string} justificacion
 * @property {ErrorDeHerramienta | null} error
 * @property {string | null} motivoDeFin
 * @property {string} respuesta
 * @property {number | null} duracion
 * @property {number | null} costoUsd
 * @property {{ url: string, titulo: string, captura: string | null } | null} inicio
 * @property {string | null} capturaFinal
 * @property {boolean} video
 * @property {Paso[]} pasos
 * @property {string[]} camino
 * @property {{ pagina: string, alcanzado: boolean, paso: number | null }[]} hitos
 * @property {number} hitosAlcanzados
 * @property {boolean} sigueLaRuta
 * @property {{ tramo: number, paso: number, pagina: string | null, seDetuvo: boolean } | null} seSepara
 * @property {boolean} vuelveALaRuta
 * @property {number | null} vuelveEnPaso
 * @property {Demora[]} demoras
 *
 * @typedef {{ logrado: number, fallido: number, abandonado: number, error: number }} Finales
 *
 * @typedef {Object} Pagina
 * @property {string} id
 * @property {string} titulo
 * @property {string | null} tituloCorto
 * @property {"sitio" | "inicio" | "url"} tituloTipo
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
 * @property {{ accion: string, intentos: number, perfiles: string[] }[]} acciones
 * @property {string} accion
 * @property {number} exitos
 * @property {number} fallos
 * @property {number} errores
 * @property {number} intentos
 * @property {string[]} perfiles
 * @property {string[]} intentosIds
 * @property {number | null} medianaSegundos
 * @property {number} pasosMinimos
 * @property {"exito" | "mixto" | "fallo" | "abandono" | "error"} resultado
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
 * @property {string | null} modeloUsuarios
 * @property {string | null} modeloJuez
 * @property {{ texto: string, evidencias: string[] } | null} criterio
 * @property {Intento[]} intentos
 * @property {{ paginas: Pagina[], ramas: Rama[], ruta: Ruta | null, alias: Record<string, string> }} telarana
 * @property {Object} kpis
 * @property {Perfil[]} perfiles
 * @property {Hallazgo[]} hallazgos
 * @property {{ tanda: Texto, telarana: Texto, perfiles: Texto }} titulares
 */

// Motivos de fin que son fallas de la herramienta, no del usuario: los _INTERRUPTED_REASONS de
// agents/app/web_evaluator/batch.py. El orden es el de la tabla del diseño (§2.1).
const MOTIVOS_DE_ERROR = ["internal_error", "api_error", "no_response", "refusal"];
const SIN_VEREDICTO = "No se pudo obtener el veredicto";
const LARGO_DEL_RESUMEN = 140;
const CAMBIO_QUE_CUENTA = 0.05;
const CAMBIO_DE_LA_CAPTURA = 0.2;
const ANCHO_DE_ESCRITORIO = 1000;
const ORDEN_DE_SENALES = ["visible_error", "went_back", "no_effect", "security_block"];
const RESULTADO_DEL_JUEZ = { success: "logrado", failed: "fallido", abandoned: "abandonado" };
const ACCIONES_DE_CLIC = new Set(["left_click", "double_click", "triple_click"]);

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
  if (MOTIVOS_DE_ERROR.includes(run.end_reason)) {
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

const DIRECCIONES = { down: "abajo", up: "arriba", left: "izquierda", right: "derecha" };

/**
 * La acción de un paso, estructurada (como action_signature del evaluador, pero sin frase).
 * @returns {Firma}
 */
export function firmaDelPaso(paso) {
  const descripcion = String(paso.description ?? "");
  const [x = null, y = null] = Array.isArray(paso.coordinates) ? paso.coordinates : [];
  const base = { tipo: "otra", objetivo: null, direccion: null, cantidad: null, x, y, original: descripcion };
  const elemento = paso.element ?? {};
  const etiqueta = String(elemento.text ?? "").trim() || elemento.href || null;
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

// Cuánto de la ruta recomendada sigue un camino: el largo del prefijo común.
function prefijoComun(camino, paginasDeRuta) {
  let i = 0;
  while (i < camino.length && i < paginasDeRuta.length && camino[i] === paginasDeRuta[i]) i += 1;
  return i;
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
function unirRamas(ramasCrudas, paginaDeNodo, intentosConError) {
  const porPar = new Map();
  for (const cruda of ramasCrudas) {
    const origen = paginaDeNodo.get(cruda.source);
    const destino = paginaDeNodo.get(cruda.target);
    if (!origen || !destino || origen === destino) continue;
    const id = `${origen}>${destino}`;
    let rama = porPar.get(id);
    if (!rama) {
      rama = { id, origen, destino, acciones: [], exitos: 0, fallos: 0, errores: 0, perfiles: [], tiempos: [], pasos: [] };
      porPar.set(id, rama);
    }
    // Un intento con error nunca es success, así que cada tramo suyo quedó como fallo en el árbol.
    const perfiles = cruda.profiles ?? [];
    const conError = perfiles.filter((perfil) => intentosConError.has(perfil)).length;
    rama.exitos += cruda.successes ?? 0;
    rama.fallos += Math.max(0, (cruda.failures ?? 0) - conError);
    rama.errores += conError;
    for (const perfil of perfiles) if (!rama.perfiles.includes(perfil)) rama.perfiles.push(perfil);
    rama.tiempos.push(...(cruda.times_s ?? []));
    rama.pasos.push(...(cruda.steps ?? []));
    const texto = String(cruda.action ?? "");
    const accion = rama.acciones.find((otra) => otra.accion.toLocaleLowerCase() === texto.toLocaleLowerCase());
    if (accion) {
      accion.intentos += perfiles.length;
      for (const perfil of perfiles) if (!accion.perfiles.includes(perfil)) accion.perfiles.push(perfil);
    } else {
      rama.acciones.push({ accion: texto, intentos: perfiles.length, perfiles: [...new Set(perfiles)] });
    }
  }
  return [...porPar.values()].map(({ tiempos, pasos, ...rama }) => {
    const acciones = rama.acciones.sort((a, b) => b.intentos - a.intentos || (a.accion < b.accion ? -1 : 1));
    return {
      ...rama,
      acciones,
      accion: acciones[0]?.accion ?? "",
      intentos: rama.exitos + rama.fallos + rama.errores,
      intentosIds: [...rama.perfiles],
      medianaSegundos: mediana(tiempos),
      pasosMinimos: pasos.length ? Math.min(...pasos) : 1,
    };
  });
}

/** Cómo terminó lo que pasó por una rama, para su color. */
export function resultadoDeRama(rama, finalesDelDestino) {
  if (rama.exitos === 0 && rama.fallos === 0 && rama.errores > 0) return "error";
  if (rama.exitos > 0 && rama.fallos === 0) return "exito";
  if (rama.exitos > 0) return "mixto";
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

// La ruta recomendada del evaluador, pasada a páginas: consecutivas iguales se juntan y cada tramo es
// la rama unida entre dos hitos.
function rutaEnPaginas(rutaCruda, paginaDeNodo, ramaPorId) {
  if (!rutaCruda) return null;
  const paginas = [];
  for (const nodo of [rutaCruda.start_node, ...(rutaCruda.steps ?? []).map((paso) => paso.target)]) {
    const pagina = paginaDeNodo.get(nodo);
    if (pagina && pagina !== paginas.at(-1)) paginas.push(pagina);
  }
  if (!paginas.length) return null;
  const tramos = paginas.slice(1).map((destino, k) => {
    const rama = ramaPorId.get(`${paginas[k]}>${destino}`);
    return {
      origen: paginas[k],
      destino,
      accion: rama?.accion ?? "",
      pasos: rama?.pasosMinimos ?? 1,
      segundos: rama?.medianaSegundos ?? null,
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
  return { sigueLaRuta: false, seSepara, vuelveALaRuta: vuelveEnPaso !== null, vuelveEnPaso };
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

function armarPasos(run, ubicacion, ruta) {
  const enRuta = new Set(ruta?.paginas ?? []);
  return (run.steps ?? []).map((crudo, i) => {
    const pagina = ubicacion.paginas[i];
    // La página de antes es la del paso anterior; si no se ubicó, la de url_before.
    const previa = i === 0 ? ubicacion.paginaInicial : ubicacion.paginas[i - 1];
    const paginaAntes = previa ?? ubicacion.paginaDe(crudo.url_before, crudo.title_before);
    const senales = crudo.signals ?? [];
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
      carril: !ruta ? "sin-ruta" : enRuta.has(pagina) ? "en-ruta" : "fuera-de-ruta",
      rutaAqui: rutaDesde(paginaAntes, pagina, salePagina, ruta),
    };
  });
}

function armarIntento({ perfil, run, video }, ubicacion, ruta) {
  const error = errorDelIntento(run);
  const resultadoJuez = run.verdict?.outcome ?? "abandoned";
  const resultado = error ? "error" : (RESULTADO_DEL_JUEZ[resultadoJuez] ?? "abandonado");
  const pasos = armarPasos(run, ubicacion, ruta);
  const { camino, llegadas } = ubicacion;
  const hitos = hitosDelCamino(camino, llegadas, ruta);
  const ultimoPaso = pasos.at(-1)?.numero ?? 0;
  const { sigueLaRuta, seSepara, vuelveALaRuta, vuelveEnPaso } = separacion(camino, llegadas, ruta, ultimoPaso);
  const [ancho, alto] = String(run.viewport ?? "").split("x").map(Number);
  const duracionDelRun = typeof run.duration_s === "number" && run.duration_s > 0 ? run.duration_s : null;
  const costo = run.token_usage?.equivalent_cost_usd;
  const intento = {
    id: perfil,
    perfil,
    nombrePerfil: run.profile_name || perfil,
    viewport: { ancho: ancho || null, alto: alto || null },
    modelo: run.model ?? null,
    motor: run.engine ?? null,
    resultado,
    resultadoJuez,
    logro: resultado === "logrado" ? (sigueLaRuta ? "directo" : "indirecto") : null,
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
    pasos,
    camino,
    hitos,
    hitosAlcanzados: hitos.filter((hito) => hito.alcanzado).length,
    sigueLaRuta,
    seSepara,
    vuelveALaRuta,
    vuelveEnPaso,
    demoras: [],
  };
  intento.demoras = error
    ? []
    : demorasDelIntento(intento, ruta, { logrado: resultado === "logrado", paginaFinal: camino.at(-1) ?? null });
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
        error: 0,
      },
    ]),
  );
  // El evaluador contó el final de un intento con error como abandono (o fallo): pasa a "error".
  for (const intento of intentos) {
    if (intento.resultado !== "error") continue;
    const suyos = finales.get(nodoFinalDe.get(intento.id));
    if (!suyos) continue;
    const campo = intento.resultadoJuez === "failed" ? "fallido" : intento.resultadoJuez === "success" ? "logrado" : "abandonado";
    suyos[campo] = Math.max(0, suyos[campo] - 1);
    suyos.error += 1;
  }
  return finales;
}

function armarPaginas(grupos, finalesPorNodo, ruta, ramas, capturas) {
  const enRuta = ruta?.paginas ?? [];
  const base = grupos.map(({ id, nodos }) => {
    const [primero] = nodos;
    const finales = { logrado: 0, fallido: 0, abandonado: 0, error: 0 };
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
      nombre: suyos[0].nombrePerfil,
      intentos: suyos.map((intento) => intento.id),
      validos: validos.length,
      errores: suyos.length - validos.length,
      logrados: logrados.length,
      directos: logrados.filter((intento) => intento.logro === "directo").length,
      metricas: {
        exito: conteo(logrados.length, validos.length),
        adherencia: conteo(validos.filter((intento) => intento.sigueLaRuta).length, validos.length),
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
  const contar = (estado) =>
    validos.reduce((total, intento) => total + intento.pasos.filter((paso) => paso.estado === estado).length, 0);
  return {
    intentos: intentos.length,
    validos: validos.length,
    errores: intentos.length - validos.length,
    logrados: validos.filter((intento) => intento.resultado === "logrado").length,
    directos: validos.filter((intento) => intento.logro === "directo").length,
    siguenLaRuta: validos.filter((intento) => intento.sigueLaRuta).length,
    pasosMediana: mediana(validos.map((intento) => intento.pasos.length)),
    segundosMediana: mediana(validos.map((intento) => intento.duracion)),
    pasosIdeales: ruta?.pasosIdeales ?? null,
    tramos: ruta?.tramos.length ?? 0,
    hitos: ruta?.paginas.length ?? 0,
    sinEfecto: contar("sin_efecto"),
    noCumplidas: contar("no_cumplida"),
  };
}

/** "2026-11-21_07-28-42" → "2026-11-21T07:28:42" (hora local, sin zona), o null. */
export function fechaIsoDe(fecha) {
  const partes = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(String(fecha ?? ""));
  return partes ? `${partes[1]}T${partes[2]}:${partes[3]}:${partes[4]}` : null;
}

/**
 * Arma la tanda completa para las pantallas.
 * @param {{ id: string, arbol: object | null, criterio: object | null,
 *           intentos: { perfil: string, run: object, video: boolean }[] }} entrada
 * @returns {Tanda}
 */
export function armarTanda({ id, arbol, criterio, intentos: crudos }) {
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
  const ramasUnidas = unirRamas(arbol?.branches ?? [], paginaDeNodo, conError);
  const ruta = rutaEnPaginas(arbol?.recommended_route ?? null, paginaDeNodo, new Map(ramasUnidas.map((r) => [r.id, r])));

  const intentos = crudos.map((crudo, i) => armarIntento(crudo, ubicaciones[i], ruta));
  const nodoFinalDe = new Map(intentos.map((intento, i) => [intento.id, ubicaciones[i].nodoFinal]));
  const finalesPorNodo = finalesCorregidos(nodosCrudos, intentos, nodoFinalDe);
  const paginas = armarPaginas(grupos, finalesPorNodo, ruta, ramasUnidas, capturasDePaginas(intentos));
  const finalesDe = new Map(paginas.map((pagina) => [pagina.id, pagina.finales]));
  const tramosDeRuta = new Set((ruta?.tramos ?? []).map((tramo) => `${tramo.origen}>${tramo.destino}`));
  const ramas = ramasUnidas.map((rama) => ({
    ...rama,
    resultado: resultadoDeRama(rama, finalesDe.get(rama.destino)),
    enRuta: tramosDeRuta.has(rama.id),
  }));

  const url = arbol?.url ?? intentos.find((intento) => intento.inicio)?.inicio.url ?? "";
  const fecha = arbol?.timestamp ?? id.split("/").at(-1);
  const evidencias = criterio?.evidence ?? arbol?.criteria?.evidence ?? [];
  const textoDelCriterio = criterio?.criterion ?? arbol?.criteria?.criterion ?? null;
  const tanda = {
    id,
    tarea: arbol?.task_id ?? (id.includes("/") ? id.split("/")[0] : null),
    instruccion: arbol?.instruction ?? "",
    url,
    host: hostDe(url),
    fecha,
    fechaIso: fechaIsoDe(fecha),
    motor: arbol?.engine ?? null,
    modeloUsuarios: arbol?.user_model ?? null,
    modeloJuez: arbol?.judge_model ?? null,
    criterio: textoDelCriterio ? { texto: textoDelCriterio, evidencias: [...evidencias] } : null,
    intentos,
    telarana: { paginas, ramas, ruta, alias },
    kpis: armarKpis(intentos, ruta),
    perfiles: armarPerfiles(intentos, ruta),
    hallazgos: [],
    titulares: null,
  };
  tanda.hallazgos = calcularHallazgos(tanda);
  tanda.titulares = calcularTitulares(tanda, tanda.hallazgos);
  return tanda;
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
    errores: kpis.errores,
    logrados: kpis.logrados,
    siguenLaRuta: kpis.siguenLaRuta,
    pasosMediana: kpis.pasosMediana,
    pasosIdeales: kpis.pasosIdeales,
    perfiles: tanda.intentos.map((intento) => ({
      intento: intento.id,
      perfil: intento.perfil,
      nombre: intento.nombrePerfil,
      resultado: intento.resultado,
    })),
    titular: tanda.titulares.tanda,
    captura: capturaDeTanda(tanda),
    paginas: tanda.telarana.paginas.length,
  };
}
