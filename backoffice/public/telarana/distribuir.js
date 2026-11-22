// Distribución de la telaraña (diseño §10.5.1). Puro: no toca document ni window, así node:test lo importa.
//
// La telaraña es un grafo dirigido por columnas, de izquierda a derecha:
// - columna 0: la página de inicio;
// - columnas intermedias: las demás páginas según cuántos pasos están del inicio;
// - la última columna de páginas es la de la meta: el final de la ruta recomendada (sin ruta, la página donde más lo
//   lograron) y las páginas donde alguien encontró la respuesta;
// - una columna más a la derecha, las terminales (Logrado, Fallido, Abandonado, Error).
// distribuir() decide la columna (capa) y la altura (fila, en filas de alto) de cada página: dentro de cada columna
// el orden sale de barridos de baricentro, con una parada virtual en cada columna que un tramo salta, para enredar lo
// menos posible; el tronco (la ruta, o el camino más transitado) queda en una fila recta, y = 0. geometria() lo
// convierte en coordenadas y caminos SVG: los avances son curvas hacia la derecha; los pasos laterales (dentro de una
// columna) rodean por el pasillo de la derecha; las vueltas atrás bajan o suben por los pasillos entre columnas y pasan por
// encima o por debajo de las columnas que saltan, sin cruzar estaciones.

export const RESULTADOS = ["logrado", "fallido", "abandonado", "sin_medir", "error"];

const comparar = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
const redondear = (n) => Math.round(n * 10) / 10;
const redondearFila = (n) => Math.round(n * 1000) / 1000 || 0; // sin −0
const idDeRama = (rama) => rama.id ?? `${rama.origen}>${rama.destino}`;
const promedio = (valores) => valores.reduce((suma, valor) => suma + valor, 0) / valores.length;

/** Id de la terminal de un resultado: "fin:logrado". */
export const idDeTerminal = (resultado) => `fin:${resultado}`;
/** Id del tramo final de una página a una terminal: "n3>fin:logrado". */
export const idDeTramoFinal = (pagina, resultado) => `${pagina}>${idDeTerminal(resultado)}`;

/** Barridos de baricentro por omisión (el primero, de izquierda a derecha, arma el orden inicial). */
export const BARRIDOS = 9;

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

// Separación mínima, en filas, entre dos elementos seguidos de una columna (de arriba hacia abajo). Una página lleva
// su etiqueta debajo del punto; una parada virtual es solo un tramo que pasa; una terminal, un punto con la etiqueta
// al costado.
const SEPARACION = {
  pagina: { pagina: 1, virtual: 0.75, terminal: 0.75 },
  virtual: { pagina: 0.4, virtual: 0.25, terminal: 0.4 },
  terminal: { pagina: 0.5, virtual: 0.25, terminal: 0.5 },
};
const PESO_DEL_TRONCO = 1e6;
const VUELTAS_DE_AJUSTE = 12;

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
 * Posiciones en el orden dado, cada una al menos `separaciones[i]` debajo de la anterior, lo más cerca posible de las
 * deseadas (mínimos cuadrados con pesos). Es una regresión isotónica (unir bloques vecinos que se pisan) sobre las
 * posiciones menos la separación acumulada.
 * @param {number[]} deseadas  @param {number[]} pesos  @param {number[]} separaciones  (largo n − 1)
 */
export function acomodar(deseadas, pesos, separaciones) {
  const corrimiento = [0];
  for (let i = 1; i < deseadas.length; i += 1) corrimiento.push(corrimiento[i - 1] + separaciones[i - 1]);
  const bloques = [];
  deseadas.forEach((deseada, i) => {
    bloques.push({ suma: pesos[i] * (deseada - corrimiento[i]), peso: pesos[i], desde: i, hasta: i });
    while (bloques.length > 1) {
      const [a, b] = bloques.slice(-2);
      if (a.suma / a.peso <= b.suma / b.peso) break;
      bloques.splice(-2, 2, { suma: a.suma + b.suma, peso: a.peso + b.peso, desde: a.desde, hasta: b.hasta });
    }
  });
  const salida = new Array(deseadas.length);
  for (const bloque of bloques) for (let i = bloque.desde; i <= bloque.hasta; i += 1) salida[i] = bloque.suma / bloque.peso + corrimiento[i];
  return salida;
}

/** Cruces entre dos columnas vecinas: pares de enlaces (izquierda, derecha) cuyos extremos van en orden contrario. */
function crucesEntre(enlaces, posicion) {
  let cruces = 0;
  for (let i = 0; i < enlaces.length; i += 1) {
    const [a1, b1] = enlaces[i];
    for (let j = i + 1; j < enlaces.length; j += 1) {
      const [a2, b2] = enlaces[j];
      if ((posicion.get(a1) - posicion.get(a2)) * (posicion.get(b1) - posicion.get(b2)) < 0) cruces += 1;
    }
  }
  return cruces;
}

/**
 * @param {{ paginas: { id: string, esInicio?: boolean, visitas?: number,
 *             finales?: Partial<Record<"logrado"|"fallido"|"abandonado"|"sin_medir"|"error", number>> }[],
 *           ramas: { id?: string, origen: string, destino: string, intentos?: number, resultado?: string }[],
 *           ruta: { paginas: string[] } | null }} entrada
 * @param {{ barridos?: number }} [opciones]  barridos de baricentro (1: solo el orden inicial)
 */
export function distribuir(entrada, { barridos = BARRIDOS } = {}) {
  const paginas = [...(entrada?.paginas ?? [])].filter((pagina) => pagina?.id != null).sort((a, b) => comparar(a.id, b.id));
  if (!paginas.length) return { ...VACIA, estaciones: [], terminales: [], tramos: [], tronco: [] };
  const porId = new Map(paginas.map((pagina) => [pagina.id, pagina]));
  const logros = (id) => Number(porId.get(id)?.finales?.logrado ?? 0);

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

  // 2. Columna: el tronco fijo (i); el resto, los pasos desde el inicio (relajación en orden BFS).
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

  // 3. La meta, a la derecha de todas las demás páginas: el final del tronco si es la ruta (sin ruta, la página
  // donde más lo lograron) y las páginas de respuesta que no son un paso intermedio del tronco.
  const intermedias = new Set(tronco.slice(0, -1));
  const metas = new Set();
  if (troncoEsRuta) metas.add(tronco.at(-1));
  else {
    const mejor = paginas.filter((pagina) => logros(pagina.id) > 0).sort((a, b) => logros(b.id) - logros(a.id) || comparar(a.id, b.id))[0];
    if (mejor && !intermedias.has(mejor.id)) metas.add(mejor.id);
  }
  for (const pagina of paginas) if (logros(pagina.id) > 0 && !intermedias.has(pagina.id)) metas.add(pagina.id);
  metas.delete(inicio);
  if (metas.size) {
    const columnaDeMeta = Math.max(0, ...paginas.filter((pagina) => !metas.has(pagina.id)).map((pagina) => capa.get(pagina.id))) + 1;
    for (const id of metas) capa.set(id, columnaDeMeta);
  }
  const capas = Math.max(...capa.values()) + 1;

  // 4. Tipo de cada tramo con las columnas ya fijas: hacia la derecha, avance; dentro de la misma columna, un paso
  // lateral; hacia la izquierda, una vuelta atrás.
  const siguienteEnTronco = new Map(tronco.slice(0, -1).map((id, indice) => [id, tronco[indice + 1]]));
  const tipoDe = (rama) => {
    if (siguienteEnTronco.get(rama.origen) === rama.destino) return "tronco";
    const salto = capa.get(rama.destino) - capa.get(rama.origen);
    return salto > 0 ? "avance" : salto === 0 ? "lateral" : "retroceso";
  };
  const tramos = ramas.map((rama) => {
    const tipo = tipoDe(rama);
    return { id: idDeRama(rama), origen: rama.origen, destino: rama.destino, tipo, intentos: rama.intentos ?? 0, resultado: rama.resultado ?? null, escalas: [] };
  });

  // 5. Terminales: una columna más allá de la meta, solo para los resultados presentes.
  const totales = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
  for (const pagina of paginas) {
    for (const r of RESULTADOS) {
      const n = Number(pagina.finales?.[r] ?? 0);
      if (n > 0) {
        totales[r] += n;
        tramos.push({ id: idDeTramoFinal(pagina.id, r), origen: pagina.id, destino: idDeTerminal(r), tipo: "final", intentos: n, resultado: r, escalas: [] });
      }
    }
  }

  // 6. Elementos por columna: páginas, terminales y una parada virtual en cada columna que salta un tramo hacia la
  // derecha (así el orden también acomoda los tramos largos). Logrado sigue la fila del tronco si la ruta llega.
  const columnas = Array.from({ length: capas + 1 }, () => []);
  const elementos = new Map();
  const agregar = (elemento) => {
    elementos.set(elemento.id, elemento);
    columnas[elemento.columna].push(elemento.id);
  };
  for (const pagina of paginas) agregar({ id: pagina.id, clase: "pagina", columna: capa.get(pagina.id), tronco: enTronco.has(pagina.id), visitas: pagina.visitas ?? 0 });
  const logradoEnTronco = troncoEsRuta && logros(tronco.at(-1)) > 0;
  for (const r of RESULTADOS) if (totales[r]) agregar({ id: idDeTerminal(r), clase: "terminal", columna: capas, tronco: r === "logrado" && logradoEnTronco, visitas: totales[r] });

  const izquierda = new Map();
  const derecha = new Map();
  const enlacesDe = Array.from({ length: capas + 1 }, () => []); // enlaces entre la columna c y la c + 1
  const enlazar = (a, b) => {
    if (!derecha.has(a)) derecha.set(a, []);
    if (!izquierda.has(b)) izquierda.set(b, []);
    derecha.get(a).push(b);
    izquierda.get(b).push(a);
    enlacesDe[elementos.get(a).columna].push([a, b]);
  };
  const paradas = new Map(); // tramo → ids de sus paradas virtuales
  for (const tramo of tramos) {
    const a = elementos.get(tramo.origen);
    const b = elementos.get(tramo.destino);
    if (!a || !b || b.columna <= a.columna) continue;
    let anterior = a.id;
    const suyas = [];
    for (let c = a.columna + 1; c < b.columna; c += 1) {
      const id = `${tramo.id}@${c}`;
      agregar({ id, clase: "virtual", columna: c, tronco: tramo.tipo === "tronco", visitas: tramo.intentos });
      enlazar(anterior, id);
      suyas.push(id);
      anterior = id;
    }
    enlazar(anterior, b.id);
    paradas.set(tramo.id, suyas);
  }

  // 7. Orden dentro de cada columna. El inicial: por visitas (empate: id), y un barrido de izquierda a derecha por
  // baricentro. Después, barridos alternados (de derecha a izquierda mirando las vecinas de la derecha, y al revés)
  // con trasposiciones de vecinos; queda el orden con menos cruces.
  const posicion = new Map();
  const numerar = (columna) => columna.forEach((id, i) => posicion.set(id, i));
  const porVisitas = (x, y) => elementos.get(y).visitas - elementos.get(x).visitas || comparar(x, y);
  for (const columna of columnas) numerar(columna.sort(porVisitas));
  const ordenarPor = (c, lado) => {
    const valor = new Map(
      columnas[c].map((id) => {
        const vecinas = lado.get(id) ?? [];
        return [id, vecinas.length ? promedio(vecinas.map((v) => posicion.get(v))) : posicion.get(id)];
      }),
    );
    numerar(columnas[c].sort((x, y) => valor.get(x) - valor.get(y) || posicion.get(x) - posicion.get(y)));
  };
  const crucesTotales = () => enlacesDe.reduce((suma, enlaces) => suma + crucesEntre(enlaces, posicion), 0);
  const crucesDelPar = (u, v) => {
    // Cruces de los enlaces de u con los de v si u queda antes que v.
    let n = 0;
    for (const lado of [izquierda, derecha]) {
      for (const x of lado.get(u) ?? []) for (const y of lado.get(v) ?? []) if (posicion.get(x) > posicion.get(y)) n += 1;
    }
    return n;
  };
  const trasponer = () => {
    for (let vuelta = 0; vuelta < 8; vuelta += 1) {
      let mejoro = false;
      for (const columna of columnas) {
        for (let i = 0; i + 1 < columna.length; i += 1) {
          const [u, v] = [columna[i], columna[i + 1]];
          if (crucesDelPar(u, v) > crucesDelPar(v, u)) {
            columna[i] = v;
            columna[i + 1] = u;
            numerar(columna);
            mejoro = true;
          }
        }
      }
      if (!mejoro) break;
    }
  };
  for (let c = 1; c < columnas.length; c += 1) ordenarPor(c, izquierda);
  let mejorOrden = columnas.map((columna) => [...columna]);
  let menosCruces = crucesTotales();
  for (let barrido = 2; barrido <= barridos; barrido += 1) {
    if (barrido % 2 === 0) for (let c = columnas.length - 2; c >= 0; c -= 1) ordenarPor(c, derecha);
    else for (let c = 1; c < columnas.length; c += 1) ordenarPor(c, izquierda);
    trasponer();
    const cruces = crucesTotales();
    if (cruces < menosCruces) {
      menosCruces = cruces;
      mejorOrden = columnas.map((columna) => [...columna]);
    }
  }
  mejorOrden.forEach((columna, c) => {
    columnas[c] = columna;
    numerar(columna);
  });

  // 8. Altura (en filas). Primero apiladas desde el tronco (que queda en 0); después, vueltas en que cada elemento se
  // acerca al promedio de sus vecinas de los dos lados sin cambiar el orden ni acercarse más que la separación (así
  // un callejón sin salida queda a la altura de la página de la que salió y los tramos largos van derechos).
  const y = new Map();
  const separacion = (a, b) => SEPARACION[elementos.get(a).clase][elementos.get(b).clase];
  const ancla = (columna) => columna.findIndex((id) => elementos.get(id).tronco);
  for (const columna of columnas) {
    const apiladas = [0];
    for (let i = 1; i < columna.length; i += 1) apiladas.push(apiladas[i - 1] + separacion(columna[i - 1], columna[i]));
    const i = ancla(columna);
    const corrimiento = i >= 0 ? apiladas[i] : (apiladas.at(-1) ?? 0) / 2;
    columna.forEach((id, j) => y.set(id, apiladas[j] - corrimiento));
  }
  for (let vuelta = 0; vuelta < VUELTAS_DE_AJUSTE; vuelta += 1) {
    const indices = [...columnas.keys()];
    if (vuelta % 2) indices.reverse();
    for (const c of indices) {
      const columna = columnas[c];
      if (!columna.length) continue;
      const deseadas = columna.map((id) => {
        if (elementos.get(id).tronco) return 0;
        const vecinas = [...(izquierda.get(id) ?? []), ...(derecha.get(id) ?? [])];
        return vecinas.length ? promedio(vecinas.map((v) => y.get(v))) : y.get(id);
      });
      const pesos = columna.map((id) => (elementos.get(id).tronco ? PESO_DEL_TRONCO : 1));
      const nuevas = acomodar(deseadas, pesos, columna.slice(1).map((id, i) => separacion(columna[i], id)));
      const i = ancla(columna);
      const corrimiento = i >= 0 ? nuevas[i] : 0;
      columna.forEach((id, j) => y.set(id, nuevas[j] - corrimiento));
    }
  }
  const fila = (id) => redondearFila(y.get(id));

  for (const tramo of tramos) tramo.escalas = (paradas.get(tramo.id) ?? []).map((id) => ({ capa: elementos.get(id).columna, fila: fila(id) }));
  const terminales = RESULTADOS.filter((r) => totales[r]).map((r) => ({ id: idDeTerminal(r), resultado: r, capa: capas, fila: fila(idDeTerminal(r)), total: totales[r] }));
  const estaciones = paginas
    .map((pagina) => {
      const indice = tronco.indexOf(pagina.id);
      const tipo = pagina.id === inicio ? "inicio" : troncoEsRuta && indice !== -1 ? "hito" : "pagina";
      return { id: pagina.id, capa: capa.get(pagina.id), fila: fila(pagina.id), tipo, hito: troncoEsRuta && indice !== -1 ? indice : null };
    })
    .sort((a, b) => a.capa - b.capa || a.fila - b.fila || comparar(a.id, b.id));

  const filas = [0, ...[...elementos.keys()].map(fila)];
  return { estaciones, terminales, tramos, tronco, troncoEsRuta, capas, filaMin: Math.min(...filas), filaMax: Math.max(...filas) };
}

// ── Geometría ───────────────────────────────────────────────────────────

const RADIO_DE_VUELTA = 28;
const SEPARACION_DE_VUELTAS = 7;
// Dentro de un pasillo, los pasos laterales van un poco a la derecha de su centro y las vueltas atrás un poco a la
// izquierda, para no montarse.
const DESVIO_EN_PASILLO = 6;
// Una vuelta atrás entre columnas vecinas baja o sube por el pasillo si las separa al menos esta fracción de fila; si
// no, da una vuelta (un escalón más chico se vería como un pico).
const ESCALON_MINIMO = 0.4;
const HACIA_LA_DERECHA = new Set(["tronco", "avance", "final"]);

const distanciaEntre = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const hacia = (desde, hasta, largo) => {
  const d = distanciaEntre(desde, hasta) || 1;
  return { x: redondear(desde.x + ((hasta.x - desde.x) * largo) / d), y: redondear(desde.y + ((hasta.y - desde.y) * largo) / d) };
};

/**
 * Pendiente (dy/dx) en cada punto de una curva que pasa por los puntos dados (x creciente) sin pasarse de largo:
 * interpolación cúbica monótona (Fritsch–Carlson); en un punto intermedio que es un máximo o un mínimo pasa
 * horizontal. En los extremos, `extremos` veces la pendiente de la cuerda vecina (0: horizontal).
 */
export function pendientesMonotonas(puntos, extremos = 0) {
  const n = puntos.length;
  const anchos = [];
  const secantes = [];
  for (let i = 0; i + 1 < n; i += 1) {
    anchos.push(puntos[i + 1].x - puntos[i].x);
    secantes.push((puntos[i + 1].y - puntos[i].y) / anchos[i]);
  }
  return puntos.map((_, i) => {
    if (i === 0) return extremos * secantes[0] || 0; // sin −0
    if (i === n - 1) return extremos * secantes[n - 2] || 0;
    const [antes, despues] = [secantes[i - 1], secantes[i]];
    if (antes * despues <= 0) return 0;
    const [w1, w2] = [2 * anchos[i] + anchos[i - 1], anchos[i] + 2 * anchos[i - 1]];
    return (w1 + w2) / (w1 / antes + w2 / despues);
  });
}

// Cómo sale un avance de su estación y cómo llega a la otra: la altura del primer punto de control es la de la salida
// más esta fracción de lo que sube o baja el primer tramo (y la del último, la de llegada menos esta fracción del
// último tramo). 1/6: a media pendiente de la cuerda (suave); 0: horizontal; 1: baja (o sube) enseguida al salir, o
// recién al llegar. Las combinaciones van de la preferida a la última (nunca baja al salir y otra vez al llegar).
const EXTREMOS = [
  [1 / 6, 1 / 6],
  [0, 0],
  [1 / 6, 0],
  [0, 1 / 6],
  [1, 0],
  [1, 1 / 6],
  [0, 1],
  [1 / 6, 1],
];

/**
 * Formas posibles de un avance (tramos cúbicos [p, c1, c2, q]), de la preferida a la última. Todas llevan los puntos
 * de control a un tercio del ancho de cada tramo (no se arquean como una S marcada) y la tangente continua en cada
 * parada: con la pendiente de pendientesMonotonas (no se doblan en cada una) o, como última opción, horizontal;
 * cambia cómo salen y cómo llegan.
 */
export function formasDeAvance(puntos) {
  const ultimo = puntos.length - 1;
  // Por las paradas: con la pendiente que sigue la forma del recorrido o, si eso enreda, horizontal (la última opción).
  const porLasParadas = ultimo > 1 ? [pendientesMonotonas(puntos, 0), puntos.map(() => 0)] : [puntos.map(() => 0)];
  return porLasParadas.flatMap((pendientes) => EXTREMOS.map(([salida, llegada]) => {
    const tramos = [];
    for (let i = 1; i < puntos.length; i += 1) {
      const [p, q] = [puntos[i - 1], puntos[i]];
      const tercio = (q.x - p.x) / 3;
      const c1 = { x: p.x + tercio, y: i === 1 ? p.y + salida * (q.y - p.y) : p.y + pendientes[i - 1] * tercio };
      const c2 = { x: q.x - tercio, y: i === ultimo ? q.y - llegada * (q.y - p.y) : q.y - pendientes[i] * tercio };
      tramos.push([p, c1, c2, q]);
    }
    return tramos;
  }));
}

const enCubica = ([p, c1, c2, q], t) => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * p.x + b * c1.x + c * c2.x + d * q.x, y: a * p.y + b * c1.y + c * c2.y + d * q.y };
};

const MUESTRAS = 24;
// Dos tramos que salen de (o llegan a) la misma estación se juntan ahí: eso no cuenta como cruce.
const CERCA_DEL_EXTREMO = 12;
// Un cruce enreda más que pasar por encima de un nombre (el nombre tiene fondo y se sigue leyendo).
const PESO_DE_UN_CRUCE = 1.5;
/** La curva como polilínea (24 muestras por tramo cúbico). */
const muestrear = (tramos) => [tramos[0][0], ...tramos.flatMap((tramo) => Array.from({ length: MUESTRAS }, (_, k) => enCubica(tramo, (k + 1) / MUESTRAS)))];

/** Cuántas cajas atraviesa la polilínea. */
function cajasQueTapa(linea, cajas) {
  let tapadas = 0;
  for (const caja of cajas) if (linea.some(({ x, y }) => x > caja.x0 && x < caja.x1 && y > caja.y0 && y < caja.y1)) tapadas += 1;
  return tapadas;
}

const cruzan = (p1, p2, p3, p4) => {
  const lado = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return lado(p3, p4, p1) * lado(p3, p4, p2) < 0 && lado(p1, p2, p3) * lado(p1, p2, p4) < 0;
};
const lejosDeLosExtremos = new WeakMap(); // polilínea → { puntos lejos de sus extremos, caja }
function lejos(linea, cerca) {
  if (!lejosDeLosExtremos.has(linea)) {
    const [p0, p1] = [linea[0], linea.at(-1)];
    const puntos = linea.filter((p) => Math.hypot(p.x - p0.x, p.y - p0.y) > cerca && Math.hypot(p.x - p1.x, p.y - p1.y) > cerca);
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    lejosDeLosExtremos.set(linea, { puntos, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
  }
  return lejosDeLosExtremos.get(linea);
}
/** ¿Se cruzan las dos polilíneas lejos de sus extremos (donde los tramos de una misma estación se juntan)? */
function seCruzan(a, b, cerca) {
  const [la, lb] = [lejos(a, cerca), lejos(b, cerca)];
  if (la.puntos.length < 2 || lb.puntos.length < 2 || la.x1 < lb.x0 || lb.x1 < la.x0 || la.y1 < lb.y0 || lb.y1 < la.y0) return false;
  for (let i = 1; i < la.puntos.length; i += 1) {
    for (let j = 1; j < lb.puntos.length; j += 1) if (cruzan(la.puntos[i - 1], la.puntos[i], lb.puntos[j - 1], lb.puntos[j])) return true;
  }
  return false;
}

const caminoDeCubicas = (tramos) =>
  `M${tramos[0][0].x} ${tramos[0][0].y}` +
  tramos.map(([, c1, c2, q]) => ` C${redondear(c1.x)} ${redondear(c1.y)}, ${redondear(c2.x)} ${redondear(c2.y)}, ${q.x} ${q.y}`).join("");

/** Recorrido en ángulos rectos por los puntos dados, con las esquinas redondeadas. */
function trazoOrtogonal(puntos, radio) {
  const limpios = puntos.filter((p, i) => i === 0 || p.x !== puntos[i - 1].x || p.y !== puntos[i - 1].y);
  let d = `M${limpios[0].x} ${limpios[0].y}`;
  for (let i = 1; i < limpios.length - 1; i += 1) {
    const [antes, esquina, despues] = [limpios[i - 1], limpios[i], limpios[i + 1]];
    const r = Math.min(radio, distanciaEntre(antes, esquina) / 2, distanciaEntre(esquina, despues) / 2);
    const entrada = hacia(esquina, antes, r);
    const salida = hacia(esquina, despues, r);
    d += ` L${entrada.x} ${entrada.y} Q${esquina.x} ${esquina.y}, ${salida.x} ${salida.y}`;
  }
  const ultimo = limpios.at(-1);
  return `${d} L${ultimo.x} ${ultimo.y}`;
}

/**
 * Coordenadas y caminos SVG: x = capa·anchoCapa, y = fila·altoFila.
 * - Tramos hacia la derecha: curvas suaves que pasan por sus paradas sin pasarse de largo (recta si todo va a la misma
 *   altura), con los puntos de control a un tercio de cada tramo; de sus formas posibles (formasDeAvance), la que pasa
 *   por encima de menos nombres de otras estaciones (`etiqueta`: la caja del nombre bajo el punto).
 * - Pasos laterales (dentro de una columna): rodean por el pasillo de la derecha.
 * - Vueltas atrás: salen por el pasillo de la izquierda; si saltan columnas, cruzan por encima (o por debajo, lo que
 *   quede más cerca) de las páginas de esas columnas y bajan por el pasillo de la derecha de la página de destino.
 *   Entre columnas vecinas casi a la misma altura dan una vuelta por arriba o por abajo (nunca un pico).
 * → { posiciones: Map<id, {x, y}>, caminos: Map<tramoId, string>, recorridos: Map<tramoId, {x, y}[]> (los puntos
 *     por los que pasa cada camino: paradas o esquinas), caja: { x, y, ancho, alto } }
 */
/** Alto de una fila de la telaraña, en px de escena (el ajuste a la vista lo usa para no alejar de más). */
export const ALTO_FILA = 96;

/**
 * Caja del nombre de una estación respecto de su punto, en px de escena, con el ajuste a la vista de siempre
 * (k ≈ 0.6). La pantalla pasa la del zoom con que se ve (camara.js, cajaDeEtiqueta).
 */
export const ETIQUETA = Object.freeze({ ancho: 200, alto: 54, arriba: 15 });

export function geometria(distribucion, { anchoCapa = 220, altoFila = ALTO_FILA, margen = 60, etiqueta = ETIQUETA, elegirFormas = true } = {}) {
  const posiciones = new Map();
  const caminos = new Map();
  const recorridos = new Map();
  const estaciones = distribucion?.estaciones ?? [];
  const nodos = [...estaciones, ...(distribucion?.terminales ?? [])];
  if (!nodos.length) return { posiciones, caminos, recorridos, caja: { x: 0, y: 0, ancho: 0, alto: 0 } };

  const punto = (capa, fila) => ({ x: redondear(capa * anchoCapa), y: redondear(fila * altoFila) });
  const capaDe = new Map();
  for (const nodo of nodos) {
    posiciones.set(nodo.id, punto(nodo.capa, nodo.fila));
    capaDe.set(nodo.id, nodo.capa);
  }
  // Alto ocupado por las páginas de cada columna: las vueltas largas pasan por encima o por debajo.
  const alto = new Map();
  for (const estacion of estaciones) {
    const { y } = posiciones.get(estacion.id);
    const actual = alto.get(estacion.capa) ?? { min: y, max: y };
    alto.set(estacion.capa, { min: Math.min(actual.min, y), max: Math.max(actual.max, y) });
  }
  // Nombres de las estaciones (debajo de su punto): los avances eligen la forma que pasa por encima de menos.
  const nombres = estaciones.map((estacion) => {
    const { x, y } = posiciones.get(estacion.id);
    return { id: estacion.id, x0: x - etiqueta.ancho / 2, x1: x + etiqueta.ancho / 2, y0: y + etiqueta.arriba, y1: y + etiqueta.arriba + etiqueta.alto };
  });
  const pasillo = anchoCapa / 2;
  const vueltas = { arriba: 0, abajo: 0 };
  const puntosDeCaja = [...posiciones.values()];

  // Avances: de sus formas posibles, la que pasa por encima de menos nombres ajenos y cruza menos avances ya trazados
  // (primero el tronco, después los más transitados); a igual cuenta, la preferida.
  // Dos vueltas: en la segunda, cada avance se vuelve a elegir mirando todos los demás.
  const avances = new Map();
  const trazados = new Map(); // tramo → polilínea elegida (también los pasos laterales, que no cambian)
  const prioridad = (tramo) => (tramo.tipo === "tronco" ? Infinity : tramo.intentos ?? 0);
  const candidatos = [];
  for (const tramo of distribucion.tramos ?? []) {
    const [a, b] = [posiciones.get(tramo.origen), posiciones.get(tramo.destino)];
    if (!a || !b) continue;
    if (b.x === a.x) {
      const x = a.x + pasillo + DESVIO_EN_PASILLO;
      trazados.set(tramo.id, [a, { x, y: a.y }, { x, y: b.y }, b]);
    }
    if (b.x <= a.x) continue;
    const puntos = [a, ...(tramo.escalas ?? []).map((escala) => punto(escala.capa, escala.fila)), b];
    if (puntos.every((p) => p.y === a.y)) {
      avances.set(tramo.id, `M${a.x} ${a.y} L${b.x} ${b.y}`);
      trazados.set(tramo.id, [a, b]);
      continue;
    }
    const ajenos = nombres.filter((caja) => caja.id !== tramo.origen && caja.id !== tramo.destino);
    const formas = formasDeAvance(puntos).map((forma) => ({ forma, linea: muestrear(forma), tapadas: 0 }));
    if (elegirFormas) for (const forma of formas) forma.tapadas = cajasQueTapa(forma.linea, ajenos);
    candidatos.push({ tramo, formas });
  }
  candidatos.sort((x, y) => prioridad(y.tramo) - prioridad(x.tramo) || comparar(x.tramo.id, y.tramo.id));
  for (let vuelta = 0; vuelta < (elegirFormas ? 2 : 1); vuelta += 1) {
    for (const { tramo, formas } of candidatos) {
      const otras = [...trazados].filter(([id]) => id !== tramo.id).map(([, linea]) => linea);
      const costos = !elegirFormas ? [0] : formas.map(({ linea, tapadas }) => tapadas + PESO_DE_UN_CRUCE * otras.filter((otra) => seCruzan(linea, otra, CERCA_DEL_EXTREMO)).length);
      const elegida = formas[costos.indexOf(Math.min(...costos))];
      avances.set(tramo.id, caminoDeCubicas(elegida.forma));
      trazados.set(tramo.id, elegida.linea);
    }
  }

  for (const tramo of distribucion.tramos ?? []) {
    const a = posiciones.get(tramo.origen);
    const b = posiciones.get(tramo.destino);
    if (!a || !b) continue;
    let puntos;
    let d;
    if (b.x > a.x) {
      puntos = [a, ...(tramo.escalas ?? []).map((escala) => punto(escala.capa, escala.fila)), b];
      d = avances.get(tramo.id);
    } else if (b.x === a.x) {
      const x = redondear(a.x + pasillo + DESVIO_EN_PASILLO);
      puntos = [a, { x, y: a.y }, { x, y: b.y }, b];
      d = trazoOrtogonal(puntos, RADIO_DE_VUELTA);
    } else {
      const desde = capaDe.get(tramo.origen);
      const hasta = capaDe.get(tramo.destino);
      const xa = redondear(a.x - pasillo - DESVIO_EN_PASILLO);
      const xb = redondear(b.x + pasillo - DESVIO_EN_PASILLO);
      if (desde - hasta === 1 && Math.abs(a.y - b.y) >= altoFila * ESCALON_MINIMO) {
        // Columnas vecinas: por el pasillo que las separa.
        puntos = [a, { x: xa, y: a.y }, { x: xa, y: b.y }, b];
        d = trazoOrtogonal(puntos, RADIO_DE_VUELTA);
      } else if (desde - hasta === 1) {
        // Columnas vecinas casi a la misma altura: por el pasillo quedaría un escalón invisible (o un pico sobre la
        // fila). Da una vuelta: por arriba, sobre los puntos, si arriba de las dos no hay estaciones cerca (con las
        // patas lejos de los nombres); si no, por debajo de los nombres, con las patas en el pasillo.
        const libreArriba = !estaciones.some((e) => {
          const p = posiciones.get(e.id);
          return (e.capa === desde || e.capa === hasta) && p.y < Math.min(a.y, b.y) && p.y > Math.min(a.y, b.y) - altoFila * 1.6;
        });
        const [xSale, xLlega, yBanda] = libreArriba
          ? [redondear(a.x - pasillo * 0.55), redondear(b.x + pasillo * 0.45), redondear(Math.min(a.y, b.y) - altoFila * 0.45)]
          : [redondear(a.x - pasillo + DESVIO_EN_PASILLO), xa, redondear(Math.max(a.y, b.y) + altoFila * 0.85)];
        puntos = [a, { x: xSale, y: a.y }, { x: xSale, y: yBanda }, { x: xLlega, y: yBanda }, { x: xLlega, y: b.y }, b];
        d = trazoOrtogonal(puntos, RADIO_DE_VUELTA);
      } else {
        let min = Math.min(a.y, b.y);
        let max = Math.max(a.y, b.y);
        for (let c = hasta + 1; c < desde; c += 1) {
          const columna = alto.get(c);
          if (columna) {
            min = Math.min(min, columna.min);
            max = Math.max(max, columna.max);
          }
        }
        const arriba = a.y - min + (b.y - min) <= max - a.y + (max - b.y);
        const k = arriba ? vueltas.arriba++ : vueltas.abajo++;
        // Por encima, sobre el punto más alto; por debajo, bajo la etiqueta de la página más baja.
        const yBanda = redondear(arriba ? min - altoFila * 0.45 - SEPARACION_DE_VUELTAS * k : max + altoFila * 0.85 + SEPARACION_DE_VUELTAS * k);
        puntos = [a, { x: xa, y: a.y }, { x: xa, y: yBanda }, { x: xb, y: yBanda }, { x: xb, y: b.y }, b];
        d = trazoOrtogonal(puntos, RADIO_DE_VUELTA);
      }
    }
    puntosDeCaja.push(...puntos);
    caminos.set(tramo.id, d);
    recorridos.set(tramo.id, puntos);
  }

  const xs = puntosDeCaja.map((p) => p.x);
  const ys = puntosDeCaja.map((p) => p.y);
  const x0 = Math.min(...xs) - margen;
  const y0 = Math.min(...ys) - margen;
  const caja = { x: redondear(x0), y: redondear(y0), ancho: redondear(Math.max(...xs) + margen - x0), alto: redondear(Math.max(...ys) + margen - y0) };
  return { posiciones, caminos, recorridos, caja };
}

/**
 * Cruces entre tramos hacia la derecha (tronco, avances y finales), medidos tramo a tramo entre columnas vecinas
 * con las paradas de cada uno. Las vueltas atrás y los pasos laterales no cuentan.
 */
export function contarCruces(distribucion, geo) {
  const porPasillo = new Map();
  for (const tramo of distribucion?.tramos ?? []) {
    const puntos = HACIA_LA_DERECHA.has(tramo.tipo) ? geo?.recorridos?.get(tramo.id) : null;
    if (!puntos) continue;
    for (let i = 1; i < puntos.length; i += 1) {
      const clave = `${puntos[i - 1].x}>${puntos[i].x}`;
      if (!porPasillo.has(clave)) porPasillo.set(clave, []);
      porPasillo.get(clave).push([puntos[i - 1].y, puntos[i].y]);
    }
  }
  let cruces = 0;
  for (const segmentos of porPasillo.values()) {
    for (let i = 0; i < segmentos.length; i += 1) {
      for (let j = i + 1; j < segmentos.length; j += 1) {
        if ((segmentos[i][0] - segmentos[j][0]) * (segmentos[i][1] - segmentos[j][1]) < 0) cruces += 1;
      }
    }
  }
  return cruces;
}
