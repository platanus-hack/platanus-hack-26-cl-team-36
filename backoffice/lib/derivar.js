// Lo que el backoffice calcula a partir de una tanda del evaluador: lógica pura, sin archivos,
// para poder probarla con datos fijos. Entra lo que hay en disco (route_tree.json, criteria.json
// y el run.json de cada perfil) y sale lo que dibujan las pantallas.

import { claveDeNodo, hostDe, normalizarUrl } from "./url.js";

// Estado de un paso. El evaluador guarda la expectativa pero no la compara con el resultado,
// así que la v0 solo distingue lo que delatan las señales (.specs/backoffice-v0.md, sección 4).
export const ESTADOS_DE_PASO = {
  no_cumplida: "No cumplida",
  sin_efecto: "Sin efecto",
  sin_evaluar: "Sin evaluar",
};

export function estadoDelPaso(senales = []) {
  if (senales.includes("went_back") || senales.includes("visible_error")) return "no_cumplida";
  if (senales.includes("no_effect")) return "sin_efecto";
  return "sin_evaluar";
}

function rutaLegible(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "/" : u.pathname}`;
  } catch {
    return String(url ?? "");
  }
}

// "Lo que pasó" en un paso, armado con el cambio de URL o título, screen_change y signals.
export function loQuePaso(paso) {
  const frases = [];
  const senales = paso.signals ?? [];
  const cambioDeUrl = normalizarUrl(paso.url_before) !== normalizarUrl(paso.url);
  const cambioDeTitulo = (paso.title_before ?? "").trim() !== (paso.title ?? "").trim();

  if (senales.includes("went_back")) frases.push("Volvió a la página anterior.");
  if (cambioDeUrl) {
    frases.push(`Pasó de ${rutaLegible(paso.url_before)} a ${rutaLegible(paso.url)}.`);
  }
  if (cambioDeTitulo && paso.title) frases.push(`La página se llama «${paso.title.trim()}».`);
  if (!cambioDeUrl && !cambioDeTitulo) {
    if (senales.includes("no_effect")) {
      frases.push("La pantalla no cambió.");
    } else if (typeof paso.screen_change === "number") {
      frases.push(`Cambió el ${Math.round(paso.screen_change * 100)} % de la pantalla, en la misma página.`);
    }
  }
  if (senales.includes("visible_error")) frases.push("Apareció un error en pantalla.");
  if (senales.includes("security_block")) frases.push("El evaluador bloqueó el envío de un formulario.");
  if (paso.error_detail) frases.push(`Detalle: ${paso.error_detail}`);
  return frases.join(" ") || "Sin cambios registrados.";
}

function mediana(numeros) {
  if (!numeros.length) return null;
  const orden = [...numeros].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}

function porcentaje(parte, total) {
  return total ? Math.round((100 * parte) / total) : 0;
}

// Anillo de cada nodo: su distancia en ramas desde el inicio.
export function anillos(nodos, ramas) {
  const salida = new Map();
  for (const rama of ramas) {
    if (rama.source === rama.target) continue;
    if (!salida.has(rama.source)) salida.set(rama.source, []);
    salida.get(rama.source).push(rama.target);
  }
  const distancia = new Map();
  const cola = nodos.filter((nodo) => nodo.is_start).map((nodo) => nodo.id);
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
  return new Map(nodos.map((nodo) => [nodo.id, distancia.get(nodo.id) ?? maximo + 1]));
}

// Cómo terminó lo que pasó por una rama, para su color.
export function resultadoDeRama(rama, nodoDestino) {
  if (rama.successes > 0 && rama.failures === 0) return "exito";
  if (rama.successes > 0) return "mixto";
  const finales = nodoDestino?.endings ?? {};
  return (finales.abandoned ?? 0) > 0 && !(finales.failed ?? 0) ? "abandono" : "fallo";
}

// Recorre un intento como lo hace build_route_tree: cada paso cae en un nodo, y el camino es
// la secuencia de nodos distintos que visitó.
function ubicarPasos(run, idPorClave) {
  const idDe = (url, titulo) =>
    idPorClave.get(claveDeNodo(url, titulo)) ?? idPorClave.get(`url:${normalizarUrl(url)}`) ?? null;
  const inicio = run.start?.url ? idDe(run.start.url, run.start.title) : null;
  const camino = inicio ? [inicio] : [];
  const pasoDeLlegada = inicio ? [0] : [];
  const nodosDePaso = [];
  for (const paso of run.steps ?? []) {
    const nodo = idDe(paso.url, paso.title);
    nodosDePaso.push(nodo);
    if (nodo && nodo !== camino.at(-1)) {
      camino.push(nodo);
      pasoDeLlegada.push(paso.number);
    }
  }
  return { camino, pasoDeLlegada, nodosDePaso };
}

// Cuánto de la ruta recomendada sigue un camino: el largo del prefijo común.
function prefijoComun(camino, rutaNodos) {
  let i = 0;
  while (i < camino.length && i < rutaNodos.length && camino[i] === rutaNodos[i]) i += 1;
  return i;
}

export function armarTanda({ id, arbol, criterio, intentos: crudos }) {
  const nodosCrudos = arbol?.nodes ?? [];
  const ramasCrudas = arbol?.branches ?? [];
  const ruta = arbol?.recommended_route ?? null;
  const rutaNodos = ruta ? [ruta.start_node, ...ruta.steps.map((paso) => paso.target)] : [];

  const idPorClave = new Map();
  for (const nodo of nodosCrudos) {
    idPorClave.set(claveDeNodo(nodo.url, nodo.title), nodo.id);
    if (!idPorClave.has(`url:${normalizarUrl(nodo.url)}`)) idPorClave.set(`url:${normalizarUrl(nodo.url)}`, nodo.id);
  }

  const capturaDeNodo = new Map();
  const intentos = crudos.map(({ perfil, run, video }) => {
    const { camino, pasoDeLlegada, nodosDePaso } = ubicarPasos(run, idPorClave);
    const enInicio = camino[0];
    if (enInicio && run.start?.screenshot && !capturaDeNodo.has(enInicio)) {
      capturaDeNodo.set(enInicio, { perfil, archivo: run.start.screenshot });
    }
    const pasos = (run.steps ?? []).map((paso, i) => {
      const nodo = nodosDePaso[i];
      if (nodo && paso.screenshot && !capturaDeNodo.has(nodo)) {
        capturaDeNodo.set(nodo, { perfil, archivo: paso.screenshot });
      }
      return {
        numero: paso.number,
        accion: paso.action,
        descripcion: paso.description,
        elemento: paso.element?.text ?? paso.element?.href ?? null,
        coordenadas: paso.coordinates ?? null,
        expectativa: paso.expectation ?? "",
        urlAntes: paso.url_before,
        url: paso.url,
        titulo: paso.title,
        capturaAntes: paso.screenshot_before,
        captura: paso.screenshot,
        segundos: paso.seconds_since_start,
        duracion: paso.duration_s,
        cambio: paso.screen_change,
        senales: paso.signals ?? [],
        estado: estadoDelPaso(paso.signals),
        loQuePaso: loQuePaso(paso),
        nodo,
      };
    });

    const comun = prefijoComun(camino, rutaNodos);
    const sigueLaRuta = rutaNodos.length > 1 && comun === rutaNodos.length;
    let seSepara = null;
    if (rutaNodos.length > 1 && camino.length && !sigueLaRuta) {
      const seDetuvo = comun === camino.length;
      seSepara = {
        etapa: comun, // en qué paso de la ruta recomendada se separa (1 = el primero)
        paso: seDetuvo ? (run.steps?.at(-1)?.number ?? 0) : pasoDeLlegada[comun],
        nodo: seDetuvo ? null : camino[comun],
        seDetuvo,
      };
    }
    const vuelve =
      seSepara && !seSepara.seDetuvo
        ? camino.slice(comun + 1).some((nodo) => rutaNodos.indexOf(nodo) >= comun)
        : false;

    const [ancho, alto] = String(run.viewport ?? "").split("x").map(Number);
    return {
      perfil,
      nombrePerfil: run.profile_name || perfil,
      viewport: { ancho: ancho || null, alto: alto || null },
      modelo: run.model,
      motor: run.engine,
      resultado: run.verdict?.outcome ?? "abandoned",
      justificacion: run.verdict?.justification ?? "",
      motivoDeFin: run.end_reason,
      respuesta: run.final_message ?? "",
      duracion: run.duration_s,
      inicio: run.start?.url
        ? { url: run.start.url, titulo: run.start.title, captura: run.start.screenshot }
        : null,
      capturaFinal: run.final_screenshot || null,
      video: Boolean(video),
      pasos,
      camino,
      sigueLaRuta,
      seSepara,
      vuelveALaRuta: vuelve,
    };
  });

  const anilloDe = anillos(nodosCrudos, ramasCrudas);
  const enRuta = new Set(rutaNodos);
  const ramasDeRuta = new Set(
    (ruta?.steps ?? []).map((paso) => `${paso.source}>${paso.target}>${paso.action.toLowerCase()}`),
  );
  const nodoPorId = new Map(nodosCrudos.map((nodo) => [nodo.id, nodo]));
  const nodos = nodosCrudos.map((nodo) => ({
    id: nodo.id,
    url: nodo.url,
    titulo: nodo.title,
    visitas: nodo.visits,
    perfiles: nodo.profiles,
    esInicio: nodo.is_start,
    finales: nodo.endings,
    anillo: anilloDe.get(nodo.id),
    enRuta: enRuta.has(nodo.id),
    captura: capturaDeNodo.get(nodo.id) ?? null,
  }));
  const ramas = ramasCrudas.map((rama) => ({
    origen: rama.source,
    destino: rama.target,
    accion: rama.action,
    exitos: rama.successes,
    fallos: rama.failures,
    intentos: rama.successes + rama.failures,
    perfiles: [...new Set(rama.profiles)],
    medianaSegundos: rama.median_time_s,
    resultado: resultadoDeRama(rama, nodoPorId.get(rama.target)),
    enRuta: ramasDeRuta.has(`${rama.source}>${rama.target}>${rama.action.toLowerCase()}`),
  }));

  // Pasos que da la ruta recomendada: por cada rama, el menor número de pasos con que se recorrió.
  const pasosDeRama = new Map(
    ramasCrudas.map((rama) => [`${rama.source}>${rama.target}>${rama.action.toLowerCase()}`, Math.min(...rama.steps)]),
  );
  const pasosIdeales = (ruta?.steps ?? []).reduce(
    (total, paso) => total + (pasosDeRama.get(`${paso.source}>${paso.target}>${paso.action.toLowerCase()}`) ?? 1),
    0,
  );

  const conInicio = intentos.filter((intento) => intento.inicio);
  const exitos = conInicio.filter((intento) => intento.resultado === "success");
  const kpis = {
    intentos: conInicio.length,
    exitos: exitos.length,
    siguenLaRuta: conInicio.filter((intento) => intento.sigueLaRuta).length,
    pasosMediana: mediana(conInicio.map((intento) => intento.pasos.length)),
    pasosIdeales: ruta ? pasosIdeales : null,
    tramosDeRuta: ruta?.steps.length ?? 0,
    noCumplidas: conInicio.reduce(
      (total, intento) => total + intento.pasos.filter((paso) => paso.estado === "no_cumplida").length,
      0,
    ),
    sinEfecto: conInicio.reduce(
      (total, intento) => total + intento.pasos.filter((paso) => paso.estado === "sin_efecto").length,
      0,
    ),
  };

  const perfiles = [...new Set(conInicio.map((intento) => intento.perfil))].map((perfil) => {
    const suyos = conInicio.filter((intento) => intento.perfil === perfil);
    const exitosos = suyos.filter((intento) => intento.resultado === "success");
    const desviados = suyos.filter((intento) => intento.seSepara && !intento.seSepara.seDetuvo);
    const pasos = suyos.flatMap((intento) => intento.pasos);
    const tropiezos = pasos.filter((paso) => paso.estado !== "sin_evaluar").length;
    const eficiencias = exitosos.map((intento) =>
      Math.min(1, (pasosIdeales || 1) / Math.max(1, intento.pasos.length)),
    );
    const primeraSeparacion = suyos
      .map((intento) => intento.seSepara)
      .filter(Boolean)
      .sort((a, b) => a.etapa - b.etapa)[0];
    return {
      perfil,
      nombre: suyos[0].nombrePerfil,
      intentos: suyos.length,
      exitos: exitosos.length,
      // Por cada tramo de la ruta recomendada, qué parte de los intentos sigue en ella.
      enRutaPorTramo: (ruta?.steps ?? []).map((_, i) =>
        porcentaje(suyos.filter((intento) => prefijoComun(intento.camino, rutaNodos) >= i + 2).length, suyos.length),
      ),
      seSepara: primeraSeparacion ?? null,
      metricas: {
        exito: porcentaje(exitosos.length, suyos.length),
        eficiencia: eficiencias.length
          ? Math.round((100 * eficiencias.reduce((a, b) => a + b, 0)) / eficiencias.length)
          : 0,
        adherencia: porcentaje(suyos.filter((intento) => intento.sigueLaRuta).length, suyos.length),
        sinTropiezos: pasos.length ? 100 - porcentaje(tropiezos, pasos.length) : 0,
        recuperacion: desviados.length
          ? porcentaje(desviados.filter((intento) => intento.vuelveALaRuta).length, desviados.length)
          : null,
      },
    };
  });

  return {
    id,
    tarea: arbol?.task_id ?? null,
    url: arbol?.url ?? conInicio[0]?.inicio?.url ?? "",
    host: hostDe(arbol?.url ?? conInicio[0]?.inicio?.url ?? ""),
    instruccion: arbol?.instruction ?? "",
    fecha: arbol?.timestamp ?? id.split("/").at(-1),
    motor: arbol?.engine ?? null,
    modeloUsuarios: arbol?.user_model ?? null,
    modeloJuez: arbol?.judge_model ?? null,
    criterio: criterio ?? arbol?.criteria ?? null,
    intentos,
    telarana: {
      nodos,
      ramas,
      ruta: ruta
        ? {
            nodos: rutaNodos,
            tramos: ruta.steps.map((paso) => ({ origen: paso.source, destino: paso.target, accion: paso.action })),
            probabilidad: ruta.estimated_probability,
            segundos: ruta.total_median_time_s,
          }
        : null,
      anilloMaximo: Math.max(0, ...nodos.map((nodo) => nodo.anillo)),
    },
    kpis,
    perfiles,
  };
}

// Lo que muestra la grilla de corridas: una fila liviana por tanda.
export function resumirTanda(tanda) {
  const primero = tanda.intentos.find((intento) => intento.inicio);
  return {
    id: tanda.id,
    tarea: tanda.tarea,
    url: tanda.url,
    host: tanda.host,
    instruccion: tanda.instruccion,
    fecha: tanda.fecha,
    intentos: tanda.kpis.intentos,
    exitos: tanda.kpis.exitos,
    perfiles: tanda.intentos.map((intento) => ({ perfil: intento.perfil, resultado: intento.resultado })),
    captura: primero ? { perfil: primero.perfil, archivo: primero.inicio.captura } : null,
    nodos: tanda.telarana.nodos.length,
  };
}
