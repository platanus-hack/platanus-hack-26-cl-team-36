// La telaraña de un goal mientras su revisión corre: el camino de la Guía como eje (happy path) y encima lo que
// llevan los intentos del Visitante, a partir de sus trace.json (o route.json / run.json si ya terminaron). Lógica
// pura: une los recorridos como build_route_tree (agents/app/visitor/visitor/route_tree.py) y se los pasa a
// armarTanda, así las páginas y los tramos salen igual que en la telaraña de una tanda terminada.

import { armarTanda } from "./derivar.js";
import { claveDeNodo, normalizarUrl, rutaSinConsulta } from "./url.js";

export const PERFIL_DE_LA_GUIA = "guia";
const SALTO = "volver_a_nodo";
const SENALES_DE_ERROR = new Set(["no_effect", "visible_error", "went_back"]);
const CLICS = { left_click: "clic", double_click: "doble clic", triple_click: "triple clic" };
const FINALES = ["success", "failed", "abandoned", "unmeasured"];

const texto = (valor) => (typeof valor === "string" ? valor : "");
const numero = (valor) => (Number.isFinite(valor) ? valor : 0);

/** Un paso de route.json / trace.json de la Guía con la forma de un paso de run.json (url y título de después). */
export function pasoDeGuia(paso) {
  const objetivo = paso?.target ?? {};
  return {
    number: paso?.number,
    action: texto(paso?.action),
    description: texto(paso?.label) || texto(paso?.action),
    element: { text: objetivo.text || objetivo.name || null, href: objetivo.href ?? null, tag: objetivo.tag ?? null },
    url_before: texto(paso?.url_before),
    title_before: texto(paso?.title_before),
    url: texto(paso?.url_after),
    title: texto(paso?.title_after),
    signals: [],
    screenshot: paso?.screenshot ?? null,
    decided_at: texto(paso?.decided_at),
    executed_at: texto(paso?.executed_at),
    settled_at: texto(paso?.settled_at),
    seconds_since_start: numero(paso?.seconds_since_start),
  };
}

/**
 * Un recorrido (con la forma de run.json) a partir de un trace.json, un route.json de la Guía o un run.json; null si
 * no se puede ubicar (sin pasos legibles ni inicio). Tolera un archivo a medio escribir: se queda con los pasos que
 * traen URL.
 * @param {object} datos
 * @param {{ guia?: boolean, carpeta?: string, enCurso?: boolean }} opciones
 */
export function recorridoDe(datos, { guia = false, carpeta = PERFIL_DE_LA_GUIA, enCurso = false } = {}) {
  if (!datos || typeof datos !== "object") return null;
  const crudos = Array.isArray(datos.steps) ? datos.steps.filter((paso) => paso && typeof paso === "object") : [];
  const pasos = (guia ? crudos.map(pasoDeGuia) : crudos).filter((paso) => texto(paso.url));
  const primero = pasos[0];
  const inicio = datos.start?.url
    ? { url: texto(datos.start.url), title: texto(datos.start.title), screenshot: datos.start.screenshot ?? null }
    : primero?.url_before
      ? { url: primero.url_before, title: texto(primero.title_before), screenshot: null }
      : null;
  if (!inicio) return null;
  return {
    ...(guia ? {} : datos),
    profile: guia ? PERFIL_DE_LA_GUIA : texto(datos.profile) || carpeta,
    start: inicio,
    steps: pasos.map((paso, i) => ({ ...paso, number: Number.isInteger(paso.number) ? paso.number : i + 1 })),
    // Un intento en curso todavía no tiene veredicto: «sin medir» lo dibuja neutro y no suma finales.
    verdict: datos.verdict ?? { outcome: "unmeasured" },
    enCurso,
  };
}

const firmaDelPaso = (paso) => {
  const etiqueta = CLICS[paso.action] && (paso.element?.text || paso.element?.href || paso.element?.tag);
  return etiqueta ? `${CLICS[paso.action]} «${etiqueta}»` : texto(paso.description) || texto(paso.action);
};

/** Tramos de un recorrido: lo que pasa entre llegar a un nodo y salir de él (como build_route_tree). */
function tramosDe(recorrido) {
  let actual = claveDeNodo(recorrido.start.url, recorrido.start.title);
  let llegada = 0;
  let pasos = 0;
  let senales = new Set();
  const tramos = [];
  for (const paso of recorrido.steps) {
    const destino = claveDeNodo(paso.url, paso.title);
    pasos += 1;
    for (const senal of paso.signals ?? []) senales.add(senal);
    if (destino === actual) continue;
    const segundos = numero(paso.seconds_since_start);
    tramos.push({ origen: actual, destino, firma: firmaDelPaso(paso), segundos: segundos - llegada, pasos, senales, salto: paso.action === SALTO, paso });
    actual = destino;
    llegada = segundos;
    pasos = 0;
    senales = new Set();
  }
  return { tramos, final: actual };
}

// Los nodos desde los que se llegó a `final` por tramos hacia adelante (_leads_to).
function llevanA(final, tramos) {
  const entrantes = new Map();
  for (const tramo of tramos) {
    const atras = tramo.salto || tramo.senales.has("went_back");
    if (atras || (tramo.senales.has("revisit") && tramo.destino !== final)) continue;
    if (!entrantes.has(tramo.destino)) entrantes.set(tramo.destino, new Set());
    entrantes.get(tramo.destino).add(tramo.origen);
  }
  const utiles = new Set([final]);
  const pendientes = [final];
  while (pendientes.length) {
    for (const origen of entrantes.get(pendientes.pop()) ?? []) {
      if (!utiles.has(origen)) {
        utiles.add(origen);
        pendientes.push(origen);
      }
    }
  }
  return utiles;
}

/**
 * Une la Guía y los intentos en un route_tree.json: nodos, ramas y, como ruta recomendada, el camino de la Guía.
 * Los ids de nodo salen en orden de aparición (primero la Guía), así no cambian mientras las trazas crecen.
 * @param {{ guia: object | null, intentos: object[], guiaFallo?: boolean }} entrada   recorridos de recorridoDe()
 */
export function arbolEnVivo({ guia, intentos, guiaFallo = false }) {
  const nodos = new Map();
  const ramas = new Map();
  const visitar = (clave, url, titulo, perfil) => {
    if (!nodos.has(clave)) {
      nodos.set(clave, {
        id: `n${nodos.size + 1}`,
        url: normalizarUrl(url),
        title: texto(titulo).trim(),
        visits: 0,
        profiles: [],
        is_start: false,
        endings: Object.fromEntries(FINALES.map((final) => [final, 0])),
      });
    }
    const nodo = nodos.get(clave);
    nodo.visits += 1;
    if (!nodo.profiles.includes(perfil)) nodo.profiles.push(perfil);
    return nodo;
  };
  const sumarRama = (tramo, perfil, fallo) => {
    const clave = `${tramo.origen}\n${tramo.destino}\n${tramo.firma.toLocaleLowerCase()}`;
    if (!ramas.has(clave)) {
      ramas.set(clave, {
        source: nodos.get(tramo.origen).id,
        target: nodos.get(tramo.destino).id,
        action: tramo.firma,
        successes: 0,
        failures: 0,
        times_s: [],
        steps: [],
        profiles: [],
      });
    }
    const rama = ramas.get(clave);
    if (tramo.salto) rama.salto = true;
    if (fallo !== null) rama[fallo ? "failures" : "successes"] += 1;
    rama.times_s.push(Math.round(tramo.segundos * 10) / 10);
    rama.steps.push(tramo.pasos);
    rama.profiles.push(perfil);
  };
  const recorrer = (recorrido) => {
    const perfil = recorrido.profile;
    visitar(claveDeNodo(recorrido.start.url, recorrido.start.title), recorrido.start.url, recorrido.start.title, perfil).is_start = true;
    const { tramos, final } = tramosDe(recorrido);
    for (const tramo of tramos) visitar(tramo.destino, tramo.paso.url, tramo.paso.title, perfil);
    return { tramos, final };
  };

  let ruta = null;
  if (guia) {
    const { tramos } = recorrer(guia);
    for (const tramo of tramos) sumarRama(tramo, PERFIL_DE_LA_GUIA, guiaFallo);
    ruta = {
      start_node: nodos.get(claveDeNodo(guia.start.url, guia.start.title)).id,
      end_node: nodos.get(tramos.at(-1)?.destino ?? claveDeNodo(guia.start.url, guia.start.title)).id,
      steps: tramos.map((tramo) => ({ source: nodos.get(tramo.origen).id, target: nodos.get(tramo.destino).id, action: tramo.firma, preceding_actions: [] })),
      estimated_probability: null,
    };
  }
  for (const intento of intentos) {
    const { tramos, final } = recorrer(intento);
    const resultado = FINALES.includes(intento.verdict?.outcome) ? intento.verdict.outcome : "abandoned";
    if (!intento.enCurso) nodos.get(final).endings[resultado] += 1;
    const utiles = resultado === "success" ? llevanA(final, tramos) : new Set();
    for (const tramo of tramos) {
      const fallo =
        tramo.salto ||
        !utiles.has(tramo.destino) ||
        (tramo.senales.has("revisit") && tramo.destino !== final) ||
        [...tramo.senales].some((senal) => SENALES_DE_ERROR.has(senal));
      // Un intento en curso no sabe todavía si sus tramos llevan a algo: no suma éxitos ni fallos.
      sumarRama(tramo, intento.profile, intento.enCurso ? null : fallo);
    }
  }
  return { nodes: [...nodos.values()], branches: [...ramas.values()], recommended_route: ruta };
}

/** Id estable de una página (URL sin consulta + título): no cambia entre refrescos ni al pasar a la tanda terminada. */
const idEstable = (pagina) => {
  const url = pagina.variantes?.[0]?.url ?? pagina.url;
  return pagina.titulo ? `${rutaSinConsulta(url)} | ${pagina.titulo}` : `${normalizarUrl(url)} |`;
};

/**
 * Lo que dibuja la pantalla de una telaraña de tanda (armarTanda), en chico y con ids estables.
 * @param {{ telarana: { paginas: object[], ramas: object[], ruta: object | null } }} tanda
 */
export function telaranaCompacta(tanda) {
  const { paginas, ramas, ruta } = tanda.telarana;
  const id = new Map(paginas.map((pagina) => [pagina.id, idEstable(pagina)]));
  return {
    paginas: paginas.map((pagina) => ({
      id: id.get(pagina.id),
      titulo: pagina.titulo,
      tituloCorto: pagina.tituloCorto,
      url: pagina.url,
      esInicio: pagina.esInicio,
      visitas: pagina.visitas,
      finales: pagina.finales,
    })),
    ramas: ramas
      .filter((rama) => id.has(rama.origen) && id.has(rama.destino))
      .map((rama) => ({
        id: `${id.get(rama.origen)}>${id.get(rama.destino)}`,
        origen: id.get(rama.origen),
        destino: id.get(rama.destino),
        accion: rama.accion,
        intentos: rama.intentos,
        resultado: rama.resultado,
      })),
    ruta: ruta ? { paginas: ruta.paginas.map((pagina) => id.get(pagina)) } : null,
  };
}

/**
 * La telaraña de un goal en curso. null si todavía no hay nada que dibujar (ni la Guía ni intentos con inicio).
 * @param {{ goal: string, guia: object | null, intentos: object[], guiaFallo?: boolean }} entrada
 */
export function telaranaEnVivo({ goal, guia, intentos, guiaFallo = false }) {
  if (!guia && !intentos.length) return null;
  const arbol = arbolEnVivo({ guia, intentos, guiaFallo });
  const tanda = armarTanda({ id: `vivo/visitor/${goal}/en-curso`, arbol, criterio: null, intentos: intentos.map((run) => ({ perfil: run.folder ?? run.profile, run, video: false })) });
  return telaranaCompacta(tanda);
}
