// Distribución de la telaraña (diseño §10.5.1). Puro: no toca document ni window, así node:test lo importa.
//
// distribuir() decide capa y fila de cada página: la ruta recomendada es el tronco (fila 0); los desvíos que vuelven
// (o terminan bien) van a un lado (filas negativas), los que solo fallan al otro (positivas); los finales son
// terminales. Con eso se dibujan dos formas:
// - geometriaRadial() (por defecto): la telaraña. El inicio al centro, un anillo por capa (los pasos desde el
//   inicio), la ruta como eje recto hacia la derecha y las demás páginas repartidas por ángulo en su anillo, arriba o
//   abajo del eje según la fila. Los tramos son curvas en coordenadas polares que siguen la tela.
// - geometria(): el mapa de metro de izquierda a derecha (o vertical), como vista secundaria.

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

// ── Telaraña radial ─────────────────────────────────────────────────────

/** Ángulo máximo a cada lado del eje: deja libre la parte de atrás del inicio. */
export const LIMITE_ANGULAR = Math.PI * 0.94;
const suave = (t) => t * t * (3 - 2 * t); // sale y llega en dirección radial
const salida = (t) => 1 - (1 - t) ** 3; // se aparta pronto del eje y después avanza

/**
 * Radio de la hebra de un anillo en el ángulo θ: igual al radio sobre cada rayo y un poco menor entre dos rayos,
 * como una tela que cede. Las estaciones se ponen sobre la hebra, así quedan justo encima del hilo dibujado.
 */
export const radioDeHebra = (radio, angulo, rayos = 16, caida = 0.06) => radio * (1 - (caida * (1 - Math.cos(rayos * angulo))) / 2);

/** Primer ángulo a partir de `deseado`, en pasos de sep/4 hacia `dir` (0: alterna), a ≥ sep de los ocupados. */
function huecoLibre(deseado, ocupados, sep, dir) {
  for (let k = 0; k <= 160; k += 1) {
    const salto = (k * sep) / 4;
    const candidatos = dir === 0 ? [deseado + salto, deseado - salto] : [deseado + dir * salto];
    for (const angulo of candidatos) {
      if (Math.abs(angulo) > LIMITE_ANGULAR) continue;
      if (ocupados.every((otro) => Math.abs(otro - angulo) >= sep * 0.999)) return angulo;
    }
  }
  return deseado;
}

/**
 * Coordenadas radiales y caminos SVG de la telaraña.
 * - Centro (0, 0): la estación de capa 0 y fila 0 (el inicio del eje).
 * - Anillo de una estación = su capa; el de una terminal, uno más allá de la última página que termina en ella.
 * - Radio del anillo c: radio(c−1) + paso, o más si sus nodos no caben a `espacio` de distancia.
 * - Ángulo: el eje (fila 0) en 0; arriba (fila < 0) negativos y abajo (fila > 0) positivos, en el orden de las filas,
 *   cerca del promedio de sus páginas previas y a ≥ espacio/radio uno de otro.
 * - eje "derecha": x = ρ·cos θ, y = ρ·sin θ; eje "abajo" (lienzos altos): x e y se intercambian, el eje baja.
 * → { orientacion: "radial", eje, posiciones, caminos, polares: Map<id, {anillo, radio, angulo}>,
 *     anclas: Map<id, "abajo"|"derecha"|"izquierda">, anillos: [{ capa, radio, d, etiqueta }], rayos: string[],
 *     extension, caja }
 */
export function geometriaRadial(distribucion, { paso = 190, espacio = 150, margen = 60, eje = "derecha", rayos: cuantosRayos = 16, caida = 0.06 } = {}) {
  const posiciones = new Map();
  const caminos = new Map();
  const polares = new Map();
  const anclas = new Map();
  const estaciones = distribucion?.estaciones ?? [];
  const terminales = distribucion?.terminales ?? [];
  const vacia = { orientacion: "radial", eje, posiciones, caminos, polares, anclas, anillos: [], rayos: [], extension: 0, caja: { x: 0, y: 0, ancho: 0, alto: 0 } };
  if (!estaciones.length) return vacia;
  const tramos = distribucion.tramos ?? [];
  const r = redondear;
  const abajo = eje === "abajo";
  const cartesiano = (radio, angulo) => {
    const a = radio * Math.cos(angulo);
    const b = radio * Math.sin(angulo);
    return abajo ? { x: r(b), y: r(a) } : { x: r(a), y: r(b) };
  };

  // 1. Anillos. Las páginas de capa 0 que no son el centro van al primer anillo.
  const centro = estaciones.find((e) => e.capa === 0 && e.fila === 0) ?? estaciones.find((e) => e.tipo === "inicio") ?? estaciones[0];
  const anillo = new Map();
  const fila = new Map();
  for (const estacion of estaciones) {
    anillo.set(estacion.id, estacion.id === centro.id ? 0 : Math.max(1, estacion.capa));
    fila.set(estacion.id, estacion.id === centro.id ? 0 : estacion.fila);
  }
  const ultimoDePaginas = Math.max(0, ...anillo.values());
  const fuentes = new Map();
  for (const tramo of tramos) {
    if (tramo.tipo !== "final" || !anillo.has(tramo.origen)) continue;
    if (!fuentes.has(tramo.destino)) fuentes.set(tramo.destino, []);
    fuentes.get(tramo.destino).push(tramo);
  }
  for (const terminal of terminales) {
    const suyas = fuentes.get(terminal.id) ?? [];
    anillo.set(terminal.id, (suyas.length ? Math.max(...suyas.map((tramo) => anillo.get(tramo.origen))) : ultimoDePaginas) + 1);
  }
  const ultimo = Math.max(...anillo.values());

  // 2. Radios: cada anillo un paso más afuera, o lo necesario para que su lado más poblado quepa.
  const radios = [0];
  for (let c = 1; c <= ultimo; c += 1) {
    let arriba = 0;
    let debajo = 0;
    for (const estacion of estaciones) {
      if (anillo.get(estacion.id) !== c) continue;
      if (fila.get(estacion.id) < 0) arriba += 1;
      else if (fila.get(estacion.id) > 0) debajo += 1;
    }
    for (const terminal of terminales) if (anillo.get(terminal.id) === c) debajo += 1;
    radios[c] = Math.max(radios[c - 1] + paso, ((Math.max(arriba, debajo) + 1) * espacio) / LIMITE_ANGULAR);
  }

  // 3. Ángulos de las estaciones, anillo por anillo desde adentro.
  const angulo = new Map([[centro.id, 0]]);
  const previas = new Map();
  for (const tramo of tramos) {
    if (tramo.tipo === "final") continue;
    if (!previas.has(tramo.destino)) previas.set(tramo.destino, []);
    previas.get(tramo.destino).push(tramo.origen);
  }
  const ocupadosPorAnillo = new Map();
  for (let c = 1; c <= ultimo; c += 1) {
    const sep = espacio / radios[c];
    const delAnillo = estaciones.filter((e) => e.id !== centro.id && anillo.get(e.id) === c);
    const deseado = (id) => {
      const conocidas = (previas.get(id) ?? []).filter((origen) => origen !== centro.id && angulo.has(origen) && anillo.get(origen) < c);
      if (!conocidas.length) return fila.get(id) * sep;
      return conocidas.reduce((suma, origen) => suma + angulo.get(origen), 0) / conocidas.length;
    };
    const hayEje = delAnillo.some((e) => fila.get(e.id) === 0);
    for (const e of delAnillo) if (fila.get(e.id) === 0) angulo.set(e.id, 0);
    for (const lado of [-1, 1]) {
      // Del eje hacia afuera, en el orden de las filas: cada una al menos `sep` más allá de la anterior.
      const grupo = delAnillo.filter((e) => Math.sign(fila.get(e.id)) === lado).sort((a, b) => lado * (fila.get(a.id) - fila.get(b.id)));
      const valores = [];
      let anterior = hayEje ? 0 : -lado * (sep / 2);
      for (const e of grupo) {
        const propio = lado * deseado(e.id);
        const valor = Math.max(propio, anterior + sep);
        valores.push(valor);
        anterior = valor;
      }
      // Si se pasan del límite, se vuelven a apretar desde afuera.
      for (let i = valores.length - 1; i >= 0; i -= 1) {
        const tope = i === valores.length - 1 ? LIMITE_ANGULAR : valores[i + 1] - sep;
        valores[i] = Math.min(valores[i], tope);
      }
      grupo.forEach((e, i) => angulo.set(e.id, lado * valores[i]));
    }
    ocupadosPorAnillo.set(c, delAnillo.map((e) => angulo.get(e.id)));
  }

  // 4. Terminales: cerca del ángulo de las páginas que terminan en ella; Logrado se queda donde cae (en el eje si la
  // ruta llega), las demás se apartan del eje hacia abajo.
  for (const terminal of terminales) {
    const c = anillo.get(terminal.id);
    const sep = espacio / radios[c];
    const suyas = fuentes.get(terminal.id) ?? [];
    const peso = suyas.reduce((suma, tramo) => suma + Math.max(1, tramo.intentos ?? 0), 0);
    let deseado = peso ? suyas.reduce((suma, tramo) => suma + (angulo.get(tramo.origen) ?? 0) * Math.max(1, tramo.intentos ?? 0), 0) / peso : 0;
    const exito = terminal.resultado === "logrado";
    if (!exito && deseado > -sep / 2) deseado = Math.max(deseado, sep);
    const ocupados = ocupadosPorAnillo.get(c) ?? [];
    const elegido = huecoLibre(deseado, ocupados, sep, exito ? 0 : 1);
    angulo.set(terminal.id, elegido);
    ocupadosPorAnillo.set(c, [...ocupados, elegido]);
  }

  // 5. Posiciones sobre la hebra de su anillo.
  for (const [id, c] of anillo) {
    const theta = angulo.get(id) ?? 0;
    const radio = c === 0 ? 0 : radioDeHebra(radios[c], theta, cuantosRayos, caida);
    polares.set(id, { anillo: c, radio: r(radio), angulo: Math.round(theta * 10000) / 10000 });
    const punto = cartesiano(radio, theta);
    posiciones.set(id, punto);
    const esTerminal = terminales.some((t) => t.id === id);
    anclas.set(id, !abajo && !esTerminal ? "abajo" : punto.x < -1 ? "izquierda" : "derecha");
  }

  // 6. Caminos: curvas en polares (el radio y el ángulo se interpolan), que salen y llegan siguiendo la tela.
  const puntosDeCaja = [...posiciones.values()];
  const vueltas = { [-1]: 0, 1: 0 };
  for (const tramo of tramos) {
    const a = polares.get(tramo.origen);
    const b = polares.get(tramo.destino);
    if (!a || !b) continue;
    const thetaA = a.radio === 0 ? b.angulo : a.angulo;
    const thetaB = b.radio === 0 ? thetaA : b.angulo;
    const delta = thetaB - thetaA;
    const mismoAnillo = a.anillo === b.anillo;
    let forma;
    if (tramo.tipo === "retroceso") {
      const medio = (a.angulo + b.angulo) / 2;
      const lado = Math.abs(medio) > 1e-6 ? Math.sign(medio) : -1;
      const k = vueltas[lado]++;
      const ladeo = lado * Math.min(0.6, (0.55 * paso) / Math.max(a.radio, b.radio, paso)) * (1 + 0.3 * k);
      const comba = paso * (mismoAnillo ? 0.5 : 0.22);
      forma = (t) => ({ radio: a.radio + (b.radio - a.radio) * t + comba * Math.sin(Math.PI * t), angulo: thetaA + delta * t + ladeo * Math.sin(Math.PI * t) });
    } else if (mismoAnillo) {
      const comba = paso * 0.3;
      forma = (t) => ({ radio: a.radio + (b.radio - a.radio) * t + comba * Math.sin(Math.PI * t), angulo: thetaA + delta * t });
    } else if (Math.abs(delta) < 1e-6) {
      forma = null; // recta sobre un rayo (el eje, o una rama que sale derecho del inicio)
    } else {
      const f = tramo.tipo === "final" ? salida : suave;
      forma = (t) => ({ radio: a.radio + (b.radio - a.radio) * t, angulo: thetaA + delta * f(t) });
    }
    const desde = posiciones.get(tramo.origen);
    const hasta = posiciones.get(tramo.destino);
    if (!forma) {
      caminos.set(tramo.id, `M${desde.x} ${desde.y} L${hasta.x} ${hasta.y}`);
      continue;
    }
    const largo = Math.abs(delta) * Math.max(a.radio, b.radio) + Math.abs(b.radio - a.radio) + paso;
    const n = Math.min(48, Math.max(10, Math.ceil(largo / 24)));
    const puntos = [desde];
    for (let i = 1; i < n; i += 1) {
      const p = forma(i / n);
      puntos.push(cartesiano(p.radio, p.angulo));
    }
    puntos.push(hasta);
    puntosDeCaja.push(...puntos);
    caminos.set(tramo.id, puntos.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" "));
  }

  // 7. Caja: todo lo dibujado y el primer anillo entero, para que el inicio se lea como el centro de la tela.
  const primero = radios[1] ?? paso;
  const xs = [...puntosDeCaja.map((p) => p.x), -primero - margen / 2, primero + margen / 2];
  const ys = [...puntosDeCaja.map((p) => p.y), -primero - margen / 2, primero + margen / 2];
  const x0 = Math.min(...xs) - margen;
  const y0 = Math.min(...ys) - margen;
  const caja = { x: r(x0), y: r(y0), ancho: r(Math.max(...xs) + margen - x0), alto: r(Math.max(...ys) + margen - y0) };

  // 8. Guías: los anillos como hebras entre rayos, con su etiqueta ("paso n") donde no pise nada, y los rayos.
  const extension = r(radios[ultimo] + paso * 0.6);
  const dentro = (p) => p.x >= caja.x + 16 && p.x <= caja.x + caja.ancho - 16 && p.y >= caja.y + 16 && p.y <= caja.y + caja.alto - 16;
  const nodos = [...posiciones.values()];
  const anillos = [];
  for (let c = 1; c <= ultimo; c += 1) {
    const muestras = Math.max(96, cuantosRayos * 8); // sin rayos, el anillo sigue siendo un círculo bien muestreado
    const puntos = [];
    for (let i = 0; i < muestras; i += 1) {
      const theta = (i / muestras) * 2 * Math.PI;
      puntos.push(cartesiano(radioDeHebra(radios[c], theta, cuantosRayos, caida), theta));
    }
    const d = `${puntos.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")} Z`;
    let etiqueta = null;
    for (let grados = -90; grados <= -8; grados += 6) {
      const theta = (grados * Math.PI) / 180;
      const p = cartesiano(radioDeHebra(radios[c], theta, cuantosRayos, caida), theta);
      if (!dentro(p) || nodos.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < 70)) continue;
      etiqueta = p;
      break;
    }
    anillos.push({ capa: c, radio: r(radios[c]), d, etiqueta });
  }
  const rayos = Array.from({ length: cuantosRayos }, (_, i) => {
    const p = cartesiano(extension, (i / cuantosRayos) * 2 * Math.PI);
    return `M0 0 L${p.x} ${p.y}`;
  });

  return { orientacion: "radial", eje, posiciones, caminos, polares, anclas, anillos, rayos, extension, caja };
}
