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
// menos posible; el tronco (la ruta, o el camino más transitado) queda en una fila recta, y = 0, y las demás páginas se
// reparten encima y debajo de él. geometria() lo convierte en coordenadas y caminos SVG: los tramos hacia la derecha
// son rectas (o piezas casi rectas por sus paradas); las vueltas atrás y los pasos laterales, arcos bajos. Ninguna
// forma depende de dónde quedan los nombres: si un tramo pasa por encima de uno, se arregla en la distribución.

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
 * Reparte las páginas a los dos lados del tronco sin enredar más. Un grupo de elementos unidos entre sí sin pasar por
 * el tronco solo se toca con el resto a través de él: puede pasar entero al otro lado (pegado al tronco y en espejo,
 * así lo más cercano al tronco sigue cerca). Pasa si así no hay más cruces y quedan más parejas las páginas de arriba
 * y las de abajo. Modifica `columnas` (y `posicion`, con `numerar`).
 */
function repartirAlrededorDelTronco({ columnas, elementos, derecha, posicion, numerar, crucesTotales }) {
  const libres = [...elementos.values()].filter((e) => !e.tronco).map((e) => e.id);
  const grupoDe = new Map(libres.map((id) => [id, id]));
  const raiz = (id) => (grupoDe.get(id) === id ? id : raiz(grupoDe.get(id)));
  for (const id of libres) for (const otro of derecha.get(id) ?? []) if (grupoDe.has(otro)) grupoDe.set(raiz(otro), raiz(id));
  const grupos = new Map();
  for (const id of libres) {
    if (!grupos.has(raiz(id))) grupos.set(raiz(id), []);
    grupos.get(raiz(id)).push(id);
  }
  const conTronco = new Set(columnas.filter((columna) => columna.some((id) => elementos.get(id).tronco)));
  const desequilibrio = () => {
    let suma = 0;
    for (const columna of conTronco) for (const id of columna) if (elementos.get(id).clase === "pagina") suma += Math.sign(posicion.get(id));
    return Math.abs(suma);
  };
  // Los grupos grandes primero (empate: el id de su primer elemento, para que no dependa del orden de la entrada).
  const ordenados = [...grupos.values()]
    .filter((grupo) => grupo.every((id) => conTronco.has(columnas[elementos.get(id).columna])))
    .sort((a, b) => b.length - a.length || comparar(a[0], b[0]));
  // Lo lejos del tronco que quedan, en puestos: a igual reparto, mejor más cerca (los tramos bajan menos).
  const lejania = () => [...posicion.values()].reduce((suma, valor) => suma + Math.abs(valor), 0);
  const ubicar = (orden) =>
    orden.forEach((columna, c) => {
      columnas[c] = columna;
      numerar(columna);
    });
  let actual = { cruces: crucesTotales(), parejo: desequilibrio(), lejos: lejania() };
  for (const grupo of ordenados) {
    const suyos = new Set(grupo);
    const abajo = grupo.reduce((suma, id) => suma + Math.sign(posicion.get(id)), 0) > 0;
    const antes = columnas.map((columna) => [...columna]);
    let mejor = null;
    // Al otro lado, en espejo; o del mismo lado, pegado al tronco.
    for (const alOtroLado of [true, false]) {
      ubicar(antes.map((columna) => [...columna]));
      const debajo = abajo !== alOtroLado;
      for (const c of new Set(grupo.map((id) => elementos.get(id).columna))) {
        const enGrupo = columnas[c].filter((id) => suyos.has(id));
        if (alOtroLado) enGrupo.reverse();
        const resto = columnas[c].filter((id) => !suyos.has(id));
        const t = resto.findIndex((id) => elementos.get(id).tronco);
        columnas[c] = debajo ? [...resto.slice(0, t + 1), ...enGrupo, ...resto.slice(t + 1)] : [...resto.slice(0, t), ...enGrupo, ...resto.slice(t)];
        numerar(columnas[c]);
      }
      const nuevo = { cruces: crucesTotales(), parejo: desequilibrio(), lejos: lejania(), orden: columnas.map((columna) => [...columna]) };
      const base = mejor ?? actual;
      if (nuevo.cruces <= actual.cruces && (nuevo.parejo < base.parejo || (nuevo.parejo === base.parejo && nuevo.lejos < base.lejos))) mejor = nuevo;
    }
    if (mejor) actual = mejor;
    ubicar(mejor ? mejor.orden : antes);
  }
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

  // 7. Orden dentro de cada columna. El inicial: el tronco al medio y las demás, de la más visitada a la menos
  // (empate: id), alternando debajo y encima de él (así las páginas se reparten a los dos lados del tronco y los
  // tramos bajan o suben la mitad); después, un barrido de izquierda a derecha por baricentro. Luego, barridos
  // alternados (de derecha a izquierda mirando las vecinas de la derecha, y al revés) con trasposiciones de vecinos;
  // queda el orden con menos cruces. La posición de cada elemento se cuenta desde el tronco de su columna (o desde
  // el medio, si el tronco no pasa por ella), para que el baricentro compare alturas y no índices.
  const posicion = new Map();
  const numerar = (columna) => {
    const i = columna.findIndex((id) => elementos.get(id).tronco);
    const centro = i >= 0 ? i : (columna.length - 1) / 2;
    columna.forEach((id, j) => posicion.set(id, j - centro));
  };
  const porVisitas = (x, y) => elementos.get(y).visitas - elementos.get(x).visitas || comparar(x, y);
  const alrededorDelTronco = (columna, primeroArriba) => {
    const [arriba, abajo] = [[], []];
    columna
      .filter((id) => !elementos.get(id).tronco)
      .sort(porVisitas)
      .forEach((id, k) => ((k % 2 === 1) !== primeroArriba ? arriba : abajo).push(id));
    return [...arriba.reverse(), ...columna.filter((id) => elementos.get(id).tronco), ...abajo];
  };
  // A igual baricentro decide, si `mirarAdelante`, el baricentro del otro lado (adónde sigue: un tramo largo no se
  // cruza con los que salen de la misma página hacia otro lado); si no, o si también empatan, el orden que traían.
  const ordenarPor = (c, lado, mirarAdelante) => {
    const baricentro = (id, vecinas = []) => (vecinas.length ? promedio(vecinas.map((v) => posicion.get(v))) : posicion.get(id));
    const otro = lado === izquierda ? derecha : izquierda;
    const valor = new Map(columnas[c].map((id) => [id, [baricentro(id, lado.get(id)), mirarAdelante ? baricentro(id, otro.get(id)) : 0]]));
    numerar(columnas[c].sort((x, y) => valor.get(x)[0] - valor.get(y)[0] || valor.get(x)[1] - valor.get(y)[1] || posicion.get(x) - posicion.get(y)));
  };
  // Un paso lateral es un arco a la derecha de su columna: lo cruzan los tramos que salen hacia la derecha de las
  // estaciones que quedan entre sus dos puntas.
  const laterales = tramos.filter((tramo) => tramo.tipo === "lateral").map((tramo) => [tramo.origen, tramo.destino]);
  const crucesDeLaterales = () => {
    let n = 0;
    for (const [a, b] of laterales) {
      const [desde, hasta] = [posicion.get(a), posicion.get(b)].sort((x, y) => x - y);
      for (const id of columnas[elementos.get(a).columna]) if (posicion.get(id) > desde && posicion.get(id) < hasta) n += derecha.get(id)?.length ?? 0;
    }
    return n;
  };
  const crucesTotales = () => enlacesDe.reduce((suma, enlaces) => suma + crucesEntre(enlaces, posicion), 0) + crucesDeLaterales() / 2;
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
  // Desde cada orden inicial (la más visitada debajo del tronco o encima; y, por si enreda menos, todas por visitas
  // con el tronco arriba) y con cada desempate, los barridos; queda el orden con menos cruces (a igual cuenta, el
  // primero: las páginas repartidas a los dos lados del tronco).
  const barrer = ([inicial, mirarAdelante]) => {
    inicial.forEach((columna, c) => {
      columnas[c] = [...columna];
      numerar(columnas[c]);
    });
    for (let c = 1; c < columnas.length; c += 1) ordenarPor(c, izquierda, mirarAdelante);
    let mejor = { orden: columnas.map((columna) => [...columna]), cruces: crucesTotales() };
    for (let barrido = 2; barrido <= barridos; barrido += 1) {
      if (barrido % 2 === 0) for (let c = columnas.length - 2; c >= 0; c -= 1) ordenarPor(c, derecha, mirarAdelante);
      else for (let c = 1; c < columnas.length; c += 1) ordenarPor(c, izquierda, mirarAdelante);
      trasponer();
      const cruces = crucesTotales();
      if (cruces < mejor.cruces) mejor = { orden: columnas.map((columna) => [...columna]), cruces };
    }
    return mejor;
  };
  const iniciales = [
    ...[false, true].map((primeroArriba) => columnas.map((columna) => alrededorDelTronco(columna, primeroArriba))),
    columnas.map((columna) => [...columna].sort(porVisitas)),
  ];
  const mejorOrden = [true, false]
    .flatMap((mirarAdelante) => iniciales.map((inicial) => barrer([inicial, mirarAdelante])))
    .reduce((mejor, otro) => (otro.cruces < mejor.cruces ? otro : mejor)).orden;
  mejorOrden.forEach((columna, c) => {
    columnas[c] = columna;
    numerar(columna);
  });
  repartirAlrededorDelTronco({ columnas, elementos, derecha, posicion, numerar, crucesTotales });

  // 8. Altura (en filas). Primero apiladas desde el tronco (que queda en 0); después, vueltas en que cada elemento se
  // acerca al promedio de sus vecinas de los dos lados sin cambiar el orden ni acercarse más que la separación (así
  // un callejón sin salida queda a la altura de la página de la que salió y los tramos largos van derechos).
  const y = new Map();
  const separacion = (a, b) => SEPARACION[elementos.get(a).clase][elementos.get(b).clase];
  const ancla = (columna) => columna.findIndex((id) => elementos.get(id).tronco);
  const calcularAlturas = () => {
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
  };
  calcularAlturas();

  // 9. Tramos largos derechos: cada parada virtual se prueba en el puesto de su columna más cercano a la recta entre
  // las dos puntas de su tramo; se queda allí si no suma cruces. Así un tramo largo no sube hasta arriba de una columna
  // para bajar en la siguiente (un codo). Después, las alturas otra vez.
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    let movidas = 0;
    let cruces = crucesTotales();
    for (const tramo of tramos) {
      const suyas = paradas.get(tramo.id) ?? [];
      if (!suyas.length) continue;
      const [a, b] = [elementos.get(tramo.origen), elementos.get(tramo.destino)];
      for (const id of suyas) {
        const { columna: c } = elementos.get(id);
        const recta = y.get(a.id) + ((y.get(b.id) - y.get(a.id)) * (c - a.columna)) / (b.columna - a.columna);
        const sin = columnas[c].filter((otro) => otro !== id);
        const puesto = sin.filter((otro) => y.get(otro) < recta).length;
        if (sin[puesto - 1] === columnas[c][puesto - 1] && columnas[c][puesto] === id) continue; // ya está ahí
        const antes = columnas[c];
        columnas[c] = [...sin.slice(0, puesto), id, ...sin.slice(puesto)];
        numerar(columnas[c]);
        const nuevos = crucesTotales();
        if (nuevos <= cruces) {
          cruces = nuevos;
          movidas += 1;
        } else {
          columnas[c] = antes;
          numerar(antes);
        }
      }
    }
    if (!movidas) break;
    calcularAlturas();
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
//
// Los tramos casi nunca se doblan: la forma de un tramo depende solo de sus extremos y sus paradas, nunca de dónde
// quedan los nombres de otras estaciones (si un tramo pasa por encima de un nombre, se arregla en la distribución).

/** Alto de una fila de la telaraña, en px de escena (el ajuste a la vista lo usa para no alejar de más). */
export const ALTO_FILA = 96;

/**
 * Cuánto (en grados) puede apartarse la tangente de un avance de la recta de cada una de sus piezas. En los extremos
 * sale y llega con la dirección de la recta; en cada parada virtual dobla de a poco (la bisectriz de las dos piezas
 * vecinas, acotada a esto). Con 14° ninguna pieza se aparta de su recta más de un 6 % de su largo.
 */
export const GIRO_MAXIMO = 14;
// Las vueltas atrás son arcos bajos hacia afuera del tronco: sus puntos de control quedan esta fracción de fila más
// allá del extremo más alto (o más bajo), y la curva, a 0.75 de eso (0.375 filas).
const ALTURA_DE_VUELTA = 0.5;
// Pasos laterales (dentro de una columna): un arco hacia la derecha, con los puntos de control a esta fracción del
// ancho de columna (la curva se aparta 0.75 de eso).
const ANCHO_DE_LATERAL = 0.3;
const HACIA_LA_DERECHA = new Set(["tronco", "avance", "final"]);

const distanciaEntre = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const acotar = (valor, minimo, maximo) => Math.min(maximo, Math.max(minimo, valor));

/**
 * Las piezas cúbicas [p, c1, c2, q] de un avance que pasa por `puntos` (x creciente): una por par de puntos
 * seguidos, con los puntos de control a un tercio de su largo. En el primero y el último punto la tangente es la de
 * la recta de su pieza; en cada parada, la bisectriz de las dos piezas vecinas, acotada a GIRO_MAXIMO de cada una
 * (si doblan más que el doble de eso, queda una esquina chica).
 */
export function piezasDeAvance(puntos) {
  const maximo = (GIRO_MAXIMO * Math.PI) / 180;
  const rectas = puntos.slice(1).map((q, i) => Math.atan2(q.y - puntos[i].y, q.x - puntos[i].x));
  return rectas.map((recta, i) => {
    const [p, q] = [puntos[i], puntos[i + 1]];
    const brazo = distanciaEntre(p, q) / 3;
    const sale = i === 0 ? recta : acotar((rectas[i - 1] + recta) / 2, recta - maximo, recta + maximo);
    const llega = i === rectas.length - 1 ? recta : acotar((recta + rectas[i + 1]) / 2, recta - maximo, recta + maximo);
    return [p, { x: p.x + brazo * Math.cos(sale), y: p.y + brazo * Math.sin(sale) }, { x: q.x - brazo * Math.cos(llega), y: q.y - brazo * Math.sin(llega) }, q];
  });
}

/**
 * Arco bajo de una vuelta atrás (de a, a la derecha, hacia b): hacia afuera del tronco (por debajo si los dos
 * extremos quedan en promedio bajo el tronco; si no, por encima), sin apartarse más de 0.375 filas de la altura de
 * sus extremos. Depende solo de los extremos.
 */
export function arcoDeVuelta(a, b, altoFila) {
  const afuera = (a.y + b.y) / 2 > 0 ? 1 : -1;
  const y = (afuera > 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y)) + afuera * ALTURA_DE_VUELTA * altoFila;
  const tercio = (a.x - b.x) / 3;
  return [a, { x: a.x - tercio, y }, { x: b.x + tercio, y }, b];
}

/** Arco de un paso lateral (de a hacia b, en la misma columna): hacia la derecha, entre las dos alturas. */
export function arcoLateral(a, b, anchoCapa) {
  const x = a.x + ANCHO_DE_LATERAL * anchoCapa;
  return [a, { x, y: a.y }, { x, y: b.y }, b];
}

const enCubica = ([p, c1, c2, q], t) => {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: redondear(a * p.x + b * c1.x + c * c2.x + d * q.x), y: redondear(a * p.y + b * c1.y + c * c2.y + d * q.y) };
};
const MUESTRAS = 16;
/** Un arco como polilínea (16 muestras), para la caja del mapa y para medirlo. */
const muestrear = (pieza) => [pieza[0], ...Array.from({ length: MUESTRAS }, (_, k) => enCubica(pieza, (k + 1) / MUESTRAS))];

const caminoDeCubicas = (piezas) =>
  `M${piezas[0][0].x} ${piezas[0][0].y}` +
  piezas.map(([, c1, c2, q]) => ` C${redondear(c1.x)} ${redondear(c1.y)}, ${redondear(c2.x)} ${redondear(c2.y)}, ${q.x} ${q.y}`).join("");

/** ¿Van todos los puntos sobre una misma recta? (entonces el avance es una recta, sin paradas visibles) */
function enUnaRecta(puntos) {
  const [a, b] = [puntos[0], puntos.at(-1)];
  const largo = distanciaEntre(a, b) || 1;
  return puntos.every((p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / largo < 0.5);
}

/**
 * Coordenadas y caminos SVG: x = capa·anchoCapa, y = fila·altoFila.
 * - Tramos hacia la derecha (tronco, avances y finales): rectas; con paradas, piezas casi rectas que doblan de a
 *   poco en cada parada (piezasDeAvance).
 * - Pasos laterales (dentro de una columna): un arco hacia la derecha (arcoLateral).
 * - Vueltas atrás: un arco bajo hacia afuera del tronco (arcoDeVuelta).
 * Ninguna forma depende de los nombres de las estaciones.
 * → { posiciones: Map<id, {x, y}>, caminos: Map<tramoId, string>, recorridos: Map<tramoId, {x, y}[]> (los puntos
 *     por los que pasa cada camino: las paradas de un avance; muestras del arco de una vuelta o un paso lateral),
 *     caja: { x, y, ancho, alto } }
 */
export function geometria(distribucion, { anchoCapa = 220, altoFila = ALTO_FILA, margen = 60 } = {}) {
  const posiciones = new Map();
  const caminos = new Map();
  const recorridos = new Map();
  const nodos = [...(distribucion?.estaciones ?? []), ...(distribucion?.terminales ?? [])];
  if (!nodos.length) return { posiciones, caminos, recorridos, caja: { x: 0, y: 0, ancho: 0, alto: 0 } };

  const punto = (capa, fila) => ({ x: redondear(capa * anchoCapa), y: redondear(fila * altoFila) });
  for (const nodo of nodos) posiciones.set(nodo.id, punto(nodo.capa, nodo.fila));
  const puntosDeCaja = [...posiciones.values()];

  for (const tramo of distribucion.tramos ?? []) {
    const a = posiciones.get(tramo.origen);
    const b = posiciones.get(tramo.destino);
    if (!a || !b) continue;
    let puntos;
    let d;
    if (b.x > a.x) {
      puntos = [a, ...(tramo.escalas ?? []).map((escala) => punto(escala.capa, escala.fila)), b];
      d = enUnaRecta(puntos) ? `M${a.x} ${a.y} L${b.x} ${b.y}` : caminoDeCubicas(piezasDeAvance(puntos));
    } else {
      const arco = b.x === a.x ? arcoLateral(a, b, anchoCapa) : arcoDeVuelta(a, b, altoFila);
      puntos = muestrear(arco);
      d = caminoDeCubicas([arco]);
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
