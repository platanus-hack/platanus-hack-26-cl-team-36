// Distribución de la telaraña como mapa de metro de izquierda a derecha (diseño §10.5.1). Puro: no toca document
// ni window, así node:test lo importa.
//
// distribuir() decide capa (columna) y fila de cada página: la ruta recomendada es el tronco, recto en la fila 0;
// los desvíos que vuelven (o terminan bien) van arriba, los que solo fallan van abajo; los finales son terminales
// a la derecha. geometria() pasa capas y filas a coordenadas y arma los caminos SVG de cada tramo.

export const RESULTADOS = ["logrado", "fallido", "abandonado", "error"];

const comparar = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
const redondear = (n) => Math.round(n * 10) / 10;
const idDeRama = (rama) => rama.id ?? `${rama.origen}>${rama.destino}`;

/** Id de la terminal de un resultado: "fin:logrado". */
export const idDeTerminal = (resultado) => `fin:${resultado}`;
/** Id del tramo final de una página a una terminal: "n3>fin:logrado". */
export const idDeTramoFinal = (pagina, resultado) => `${pagina}>${idDeTerminal(resultado)}`;

const VACIA = Object.freeze({
  estaciones: [],
  terminales: [],
  tramos: [],
  tronco: [],
  troncoEsRuta: false,
  capas: 0,
  filaMin: 0,
  filaMax: 0,
});

/** Sin ruta: desde el inicio, la rama saliente con más intentos (empate: id) hacia una página no visitada. */
function troncoMasTransitado(inicio, salientes) {
  const tronco = [inicio];
  const visitadas = new Set(tronco);
  let actual = inicio;
  for (;;) {
    const candidatas = (salientes.get(actual) ?? []).filter((rama) => !visitadas.has(rama.destino));
    if (!candidatas.length) break;
    candidatas.sort((a, b) => (b.intentos ?? 0) - (a.intentos ?? 0) || comparar(idDeRama(a), idDeRama(b)));
    actual = candidatas[0].destino;
    visitadas.add(actual);
    tronco.push(actual);
  }
  return tronco;
}

/**
 * @param {{ paginas: { id: string, esInicio?: boolean, visitas?: number,
 *             finales?: Partial<Record<"logrado"|"fallido"|"abandonado"|"error", number>> }[],
 *           ramas: { id?: string, origen: string, destino: string, intentos?: number, resultado?: string }[],
 *           ruta: { paginas: string[] } | null }} entrada
 */
export function distribuir(entrada) {
  const paginas = [...(entrada?.paginas ?? [])].filter((pagina) => pagina?.id != null).sort((a, b) => comparar(a.id, b.id));
  if (!paginas.length) return { ...VACIA, estaciones: [], terminales: [], tramos: [], tronco: [] };
  const porId = new Map(paginas.map((pagina) => [pagina.id, pagina]));

  // Ramas válidas, sin bucles sobre la misma página, en un orden que no depende del de la entrada.
  const ramas = [...(entrada?.ramas ?? [])]
    .filter((rama) => porId.has(rama.origen) && porId.has(rama.destino) && rama.origen !== rama.destino)
    .sort((a, b) => comparar(idDeRama(a), idDeRama(b)));
  const salientes = new Map();
  const entrantes = new Map();
  for (const rama of ramas) {
    if (!salientes.has(rama.origen)) salientes.set(rama.origen, []);
    if (!entrantes.has(rama.destino)) entrantes.set(rama.destino, []);
    salientes.get(rama.origen).push(rama);
    entrantes.get(rama.destino).push(rama.origen);
  }

  // 1. Tronco: la ruta recomendada; sin ruta, el camino más transitado desde el inicio.
  const deRuta = [...new Set((entrada?.ruta?.paginas ?? []).filter((id) => porId.has(id)))];
  const inicio = paginas.find((pagina) => pagina.esInicio)?.id ?? deRuta[0] ?? paginas[0].id;
  const troncoEsRuta = deRuta.length > 0;
  const tronco = troncoEsRuta ? deRuta : troncoMasTransitado(inicio, salientes);
  const enTronco = new Set(tronco);

  // 2. Capa: el tronco fijo (i); el resto por relajación en orden BFS desde el inicio.
  const capa = new Map(tronco.map((id, indice) => [id, indice]));
  const orden = [];
  const vistos = new Set([inicio]);
  const cola = [inicio];
  while (cola.length) {
    const actual = cola.shift();
    orden.push(actual);
    for (const rama of salientes.get(actual) ?? []) {
      if (!vistos.has(rama.destino)) {
        vistos.add(rama.destino);
        cola.push(rama.destino);
      }
    }
  }
  for (const id of orden) {
    if (capa.has(id)) continue;
    const previas = (entrantes.get(id) ?? []).filter((origen) => capa.has(origen)).map((origen) => capa.get(origen));
    capa.set(id, previas.length ? Math.min(...previas) + 1 : 0);
  }
  const maximaAlcanzada = Math.max(0, ...capa.values());
  for (const pagina of paginas) if (!capa.has(pagina.id)) capa.set(pagina.id, maximaAlcanzada + 1);
  const capas = Math.max(...capa.values()) + 1;

  // 3. Tipo de cada tramo. Una rama entre una página del tronco y otra en la misma capa es un paso lateral hacia
  // adelante (no se volvió a una página anterior): se dibuja como avance.
  const siguienteEnTronco = new Map(tronco.slice(0, -1).map((id, indice) => [id, tronco[indice + 1]]));
  const tramos = ramas.map((rama) => {
    const desde = capa.get(rama.origen);
    const hasta = capa.get(rama.destino);
    let tipo;
    if (siguienteEnTronco.get(rama.origen) === rama.destino) tipo = "tronco";
    else if (hasta > desde) tipo = "avance";
    else if (hasta === desde && (enTronco.has(rama.origen) || enTronco.has(rama.destino))) tipo = "avance";
    else tipo = "retroceso";
    return { id: idDeRama(rama), origen: rama.origen, destino: rama.destino, tipo, intentos: rama.intentos ?? 0, resultado: rama.resultado ?? null };
  });

  // 4. Lado: arriba si algún camino desde la página llega al tronco o a una página donde alguien lo logró.
  const buenas = paginas.filter((pagina) => enTronco.has(pagina.id) || (pagina.finales?.logrado ?? 0) > 0).map((pagina) => pagina.id);
  const llegaBien = new Set(buenas);
  const pendientes = [...buenas];
  while (pendientes.length) {
    const actual = pendientes.pop();
    for (const origen of entrantes.get(actual) ?? []) {
      if (!llegaBien.has(origen)) {
        llegaBien.add(origen);
        pendientes.push(origen);
      }
    }
  }

  // 5. Fila: por capa, ordenando por baricentro de las previas ya ubicadas (empate: visitas, id).
  const fila = new Map(tronco.map((id) => [id, 0]));
  const porCapa = new Map();
  for (const pagina of paginas) {
    if (enTronco.has(pagina.id)) continue;
    const c = capa.get(pagina.id);
    if (!porCapa.has(c)) porCapa.set(c, []);
    porCapa.get(c).push(pagina);
  }
  const baricentro = (id) => {
    const previas = (entrantes.get(id) ?? []).filter((origen) => fila.has(origen)).map((origen) => fila.get(origen));
    return previas.length ? previas.reduce((suma, valor) => suma + valor, 0) / previas.length : 0;
  };
  const desempate = (a, b) => (b.visitas ?? 0) - (a.visitas ?? 0) || comparar(a.id, b.id);
  for (const c of [...porCapa.keys()].sort((a, b) => a - b)) {
    const grupo = porCapa.get(c).map((pagina) => ({ pagina, b: baricentro(pagina.id) }));
    const arriba = grupo.filter(({ pagina }) => llegaBien.has(pagina.id));
    const abajo = grupo.filter(({ pagina }) => !llegaBien.has(pagina.id));
    arriba.sort((x, y) => y.b - x.b || desempate(x.pagina, y.pagina)).forEach(({ pagina }, i) => fila.set(pagina.id, -(i + 1)));
    abajo.sort((x, y) => x.b - y.b || desempate(x.pagina, y.pagina)).forEach(({ pagina }, i) => fila.set(pagina.id, i + 1));
  }

  // 6. Terminales: una columna más allá de la última capa, solo para los resultados presentes.
  const totales = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  for (const pagina of paginas) {
    for (const r of RESULTADOS) {
      const n = Number(pagina.finales?.[r] ?? 0);
      if (n > 0) {
        totales[r] += n;
        tramos.push({ id: idDeTramoFinal(pagina.id, r), origen: pagina.id, destino: idDeTerminal(r), tipo: "final", intentos: n, resultado: r });
      }
    }
  }
  const terminales = [];
  let siguienteFila = 1;
  for (const r of RESULTADOS) {
    if (!totales[r]) continue;
    terminales.push({ id: idDeTerminal(r), resultado: r, capa: capas, fila: r === "logrado" ? 0 : siguienteFila++, total: totales[r] });
  }

  const estaciones = paginas
    .map((pagina) => {
      const indice = tronco.indexOf(pagina.id);
      const tipo = pagina.id === inicio ? "inicio" : troncoEsRuta && indice !== -1 ? "hito" : "pagina";
      return { id: pagina.id, capa: capa.get(pagina.id), fila: fila.get(pagina.id), tipo, hito: troncoEsRuta && indice !== -1 ? indice : null };
    })
    .sort((a, b) => a.capa - b.capa || a.fila - b.fila || comparar(a.id, b.id));

  const filas = [0, ...estaciones.map((e) => e.fila), ...terminales.map((e) => e.fila)];
  return { estaciones, terminales, tramos, tronco, troncoEsRuta, capas, filaMin: Math.min(...filas), filaMax: Math.max(...filas) };
}

/**
 * Coordenadas y caminos SVG. Horizontal: x = capa·anchoCapa, y = fila·altoFila. Vertical: x = fila·anchoFila,
 * y = capa·altoCapa (las capas bajan, las filas van a izquierda y derecha).
 * → { orientacion, posiciones: Map<id, {x, y}>, caminos: Map<tramoId, string>, caja: { x, y, ancho, alto } }
 */
export function geometria(
  distribucion,
  { orientacion = "horizontal", anchoCapa = 220, altoFila = 96, anchoFila = 150, altoCapa = 120, margen = 60 } = {},
) {
  const vertical = orientacion === "vertical";
  const posiciones = new Map();
  const caminos = new Map();
  const nodos = [...(distribucion?.estaciones ?? []), ...(distribucion?.terminales ?? [])];
  if (!nodos.length) return { orientacion, posiciones, caminos, caja: { x: 0, y: 0, ancho: 0, alto: 0 } };

  const punto = (c, f) => (vertical ? { x: redondear(f * anchoFila), y: redondear(c * altoCapa) } : { x: redondear(c * anchoCapa), y: redondear(f * altoFila) });
  const filaDe = new Map();
  for (const nodo of nodos) {
    posiciones.set(nodo.id, punto(nodo.capa, nodo.fila));
    filaDe.set(nodo.id, nodo.fila);
  }
  const { filaMin = 0, filaMax = 0 } = distribucion;
  const r = redondear;
  let extremoMenor = Infinity;
  let extremoMayor = -Infinity;
  let extremoMayorCapa = -Infinity;
  const vueltas = { menor: 0, mayor: 0 };

  for (const tramo of distribucion.tramos ?? []) {
    const a = posiciones.get(tramo.origen);
    const b = posiciones.get(tramo.destino);
    if (!a || !b) continue;
    let d;
    if (tramo.tipo === "tronco") {
      d = `M${r(a.x)} ${r(a.y)} L${r(b.x)} ${r(b.y)}`;
    } else if (tramo.tipo === "retroceso") {
      // Arco por encima de la fila más alta; si los dos extremos están bajo el tronco, por debajo de la más baja
      // (así no cruza todo el mapa). Cada vuelta del mismo lado se separa un poco de la anterior.
      const abajo = (filaDe.get(tramo.origen) ?? 0) > 0 && (filaDe.get(tramo.destino) ?? 0) > 0;
      const k = abajo ? vueltas.mayor++ : vueltas.menor++;
      const filaArco = abajo ? filaMax + 0.8 + 0.3 * k : filaMin - 0.8 - 0.3 * k;
      if (vertical) {
        const xA = r(filaArco * anchoFila);
        d = `M${r(a.x)} ${r(a.y)} C${xA} ${r(a.y)}, ${xA} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`;
        if (abajo) extremoMayor = Math.max(extremoMayor, xA);
        else extremoMenor = Math.min(extremoMenor, xA);
      } else {
        const yA = r(filaArco * altoFila);
        d = `M${r(a.x)} ${r(a.y)} C${r(a.x)} ${yA}, ${r(b.x)} ${yA}, ${r(b.x)} ${r(b.y)}`;
        if (abajo) extremoMayor = Math.max(extremoMayor, yA);
        else extremoMenor = Math.min(extremoMenor, yA);
      }
    } else if (vertical) {
      // avance y final: cúbica sobre el eje y; si están a la misma altura, una curva que se abre hacia abajo.
      if (a.y === b.y) {
        const bulto = r(a.y + altoCapa * 0.4);
        d = `M${r(a.x)} ${r(a.y)} C${r(a.x)} ${bulto}, ${r(b.x)} ${bulto}, ${r(b.x)} ${r(b.y)}`;
        extremoMayorCapa = Math.max(extremoMayorCapa, bulto);
      } else {
        const ym = r((a.y + b.y) / 2);
        d = `M${r(a.x)} ${r(a.y)} C${r(a.x)} ${ym}, ${r(b.x)} ${ym}, ${r(b.x)} ${r(b.y)}`;
      }
    } else if (a.x === b.x) {
      const bulto = r(a.x + anchoCapa * 0.4);
      d = `M${r(a.x)} ${r(a.y)} C${bulto} ${r(a.y)}, ${bulto} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`;
      extremoMayorCapa = Math.max(extremoMayorCapa, bulto);
    } else {
      const xm = r((a.x + b.x) / 2);
      d = `M${r(a.x)} ${r(a.y)} C${xm} ${r(a.y)}, ${xm} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`;
    }
    caminos.set(tramo.id, d);
  }

  const xs = [...posiciones.values()].map((p) => p.x);
  const ys = [...posiciones.values()].map((p) => p.y);
  // Los arcos de vuelta y los bultos laterales también entran en la caja.
  const ejeFila = vertical ? xs : ys;
  const ejeCapa = vertical ? ys : xs;
  if (Number.isFinite(extremoMenor)) ejeFila.push(extremoMenor);
  if (Number.isFinite(extremoMayor)) ejeFila.push(extremoMayor);
  if (Number.isFinite(extremoMayorCapa)) ejeCapa.push(extremoMayorCapa);
  const x0 = Math.min(...xs) - margen;
  const y0 = Math.min(...ys) - margen;
  const caja = { x: r(x0), y: r(y0), ancho: r(Math.max(...xs) + margen - x0), alto: r(Math.max(...ys) + margen - y0) };
  return { orientacion, posiciones, caminos, caja };
}
