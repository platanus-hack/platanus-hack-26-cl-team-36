// Perfiles: cálculos puros (diseño §8 WP5, §10.7). Escalas de los gráficos, filas de la tabla, orden y a qué paso
// del Replay lleva cada marca, celda o fila. No toca document ni window: node:test lo importa tal cual.
//
// Reglas de honestidad (§2.4): `null` es "no aplica" y nunca entra a un dominio ni se convierte en 0; los intentos
// con error de la herramienta no cuentan en las métricas, pero siguen visibles (con sus valores en null).

/** @typedef {{ intento: string, paso: number, modo?: "antes" }} Destino  parámetros del Replay */

const esNumero = (valor) => typeof valor === "number" && Number.isFinite(valor);

/** Mediana de los números de la lista (ignora null); null si no hay ninguno. */
export function mediana(valores) {
  const ordenados = (valores ?? []).filter(esNumero).sort((a, b) => a - b);
  if (!ordenados.length) return null;
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
}

/**
 * Dominio [mínimo, máximo] de una columna: los valores (sin null) y la referencia de la ruta si la hay.
 * `desdeCero` fija el mínimo en 0 (conteos como tropiezos e hitos). Si todo es igual, se abre un poco para que el
 * punto no quede en un borde. Sin ningún número → null.
 * @param {(number | null)[]} valores
 * @param {{ referencia?: number | null, desdeCero?: boolean }} [opciones]
 * @returns {[number, number] | null}
 */
export function dominioDe(valores, { referencia = null, desdeCero = false } = {}) {
  const numeros = (valores ?? []).filter(esNumero);
  if (esNumero(referencia)) numeros.push(referencia);
  if (desdeCero) numeros.push(0);
  if (!numeros.length) return null;
  let minimo = Math.min(...numeros);
  let maximo = Math.max(...numeros);
  if (minimo === maximo) {
    if (desdeCero || minimo === 0) maximo = minimo + 1;
    else {
      const holgura = Math.max(1, Math.abs(minimo) * 0.1);
      minimo -= holgura;
      maximo += holgura;
    }
  }
  return [minimo, maximo];
}

/**
 * Escala lineal: valor del dominio → fracción 0..1 (acotada). null → null.
 * @param {[number, number]} dominio
 */
export function escalaLineal(dominio) {
  const [minimo, maximo] = dominio;
  const ancho = maximo - minimo || 1;
  return (valor) => (esNumero(valor) ? Math.min(1, Math.max(0, (valor - minimo) / ancho)) : null);
}

// ── Intentos → filas ───────────────────────────────────────────────────

/** Pasos con alguna señal (los "tropiezos"). */
export const tropiezosDe = (intento) => (intento.pasos ?? []).filter((paso) => (paso.senales ?? []).length > 0).length;

const esError = (intento) => intento.resultado === "error";

/**
 * Una fila por intento con lo que muestran la tabla y los gráficos. Los intentos con error llevan sus métricas en
 * null (no aplica) y `motivo: "error"`; sin ruta, Δ ruta es null con `motivoRuta: "sinRuta"`.
 * @param {object} tanda  Tanda de la API (§3.2)
 */
export function filasDeIntentos(tanda) {
  const ruta = tanda?.telarana?.ruta ?? null;
  const pasosIdeales = esNumero(ruta?.pasosIdeales) ? ruta.pasosIdeales : null;
  const totalHitos = ruta?.paginas?.length ?? null;
  const intentos = tanda?.intentos ?? [];
  const porPerfil = new Map();
  for (const intento of intentos) porPerfil.set(intento.perfil, (porPerfil.get(intento.perfil) ?? 0) + 1);
  const ordenDePerfil = new Map((tanda?.perfiles ?? []).map((perfil, indice) => [perfil.perfil, indice]));

  return intentos.map((intento, indice) => {
    const error = esError(intento);
    const pasos = error ? null : (intento.pasos ?? []).length;
    return {
      id: intento.id,
      perfil: intento.perfil,
      nombre: intento.nombrePerfil ?? intento.perfil ?? intento.id,
      variosPorPerfil: (porPerfil.get(intento.perfil) ?? 0) > 1,
      ordenOriginal: indice,
      ordenDePerfil: ordenDePerfil.get(intento.perfil) ?? indice,
      resultado: intento.resultado,
      logro: intento.logro ?? null,
      error,
      pasos,
      delta: pasos !== null && pasosIdeales !== null ? pasos - pasosIdeales : null,
      motivoDelta: error ? "error" : pasosIdeales === null ? "sinRuta" : null,
      hitos: error || totalHitos === null ? null : { n: intento.hitosAlcanzados ?? 0, de: totalHitos },
      tropiezos: error ? null : tropiezosDe(intento),
      segundos: error || !esNumero(intento.duracion) ? null : intento.duracion,
      costo: esNumero(intento.costoUsd) ? intento.costoUsd : null,
      destino: destinoDeIntento(intento),
    };
  });
}

// ── Orden de la tabla (?orden=<columna> | -<columna>) ───────────────────

export const COLUMNAS_ORDENABLES = ["perfil", "resultado", "pasos", "delta", "hitos", "tropiezos", "tiempo", "costo"];

const RANGO_DE_RESULTADO = { "logrado:directo": 0, "logrado:indirecto": 1, logrado: 1, fallido: 2, abandonado: 3, error: 4 };

const VALOR_DE_COLUMNA = {
  perfil: (fila) => fila.ordenDePerfil,
  resultado: (fila) => RANGO_DE_RESULTADO[fila.logro ? `${fila.resultado}:${fila.logro}` : fila.resultado] ?? 5,
  pasos: (fila) => fila.pasos,
  delta: (fila) => fila.delta,
  hitos: (fila) => fila.hitos?.n ?? null,
  tropiezos: (fila) => fila.tropiezos,
  tiempo: (fila) => fila.segundos,
  costo: (fila) => fila.costo,
};

/** "-pasos" → { columna: "pasos", descendente: true }; desconocida o vacía → null (orden de la API). */
export function parsearOrden(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  const descendente = texto.startsWith("-");
  const columna = descendente ? texto.slice(1) : texto;
  return COLUMNAS_ORDENABLES.includes(columna) ? { columna, descendente } : null;
}

/** { columna, descendente } → "-pasos" | "pasos". */
export const textoDeOrden = (orden) => (orden ? `${orden.descendente ? "-" : ""}${orden.columna}` : null);

/** Siguiente orden al pulsar una columna: ascendente la primera vez, después alterna. */
export function siguienteOrden(actual, columna) {
  if (actual?.columna === columna) return { columna, descendente: !actual.descendente };
  return { columna, descendente: false };
}

/**
 * Ordena las filas sin mutar la lista. Estable (empata por el orden de la API) y los "no aplica" (null) siempre al
 * final, sea cual sea la dirección.
 */
export function ordenarFilas(filas, orden) {
  const lista = [...(filas ?? [])];
  if (!orden) return lista.sort((a, b) => a.ordenOriginal - b.ordenOriginal);
  const valor = VALOR_DE_COLUMNA[orden.columna];
  const signo = orden.descendente ? -1 : 1;
  return lista.sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    const nulaA = !esNumero(va);
    const nulaB = !esNumero(vb);
    if (nulaA !== nulaB) return nulaA ? 1 : -1;
    if (!nulaA && va !== vb) return (va - vb) * signo;
    return a.ordenOriginal - b.ordenOriginal;
  });
}

// ── Destinos en el Replay ─────────────────────────────────────────────

/**
 * Paso del Replay que mejor cuenta un intento: dónde deja la ruta si se separó (y no se detuvo ahí); si no, el
 * último paso (la respuesta de un logrado, dónde se detuvo un fallido, dónde falló la herramienta).
 * @returns {Destino}
 */
export function destinoDeIntento(intento) {
  const total = (intento.pasos ?? []).length;
  const separa = intento.resultado !== "error" && intento.seSepara && !intento.seSepara.seDetuvo ? intento.seSepara.paso : null;
  const paso = esNumero(separa) && separa >= 1 ? separa : Math.max(1, total);
  return { intento: intento.id, paso };
}

/** Llegar en el paso 0 es empezar ahí: se abre el paso 1 en modo «Antes», que muestra esa página. */
const destinoDeLlegada = (intento, paso) => (paso >= 1 ? { intento, paso } : { intento, paso: 1, modo: "antes" });

/**
 * A qué paso lleva una celda del mapa perfiles × hitos (en este orden): donde un intento deja la ruta en ese hito;
 * el primer paso con la señal dominante en esa página; donde llegó; y si nadie llegó, dónde se separó el primer
 * intento válido (o su último paso). Un perfil sin intentos válidos lleva al de error (su último paso).
 * @param {object} perfil   Perfil de la API
 * @param {number} k        índice del hito (0 = inicio)
 * @param {object} tanda
 * @returns {Destino | null}
 */
export function destinoDeCelda(perfil, k, tanda) {
  const hito = perfil?.hitos?.[k];
  const intentos = new Map((tanda?.intentos ?? []).map((intento) => [intento.id, intento]));
  const propios = (perfil?.intentos ?? []).map((id) => intentos.get(id)).filter(Boolean);
  const validos = propios.filter((intento) => !esError(intento));
  if (!validos.length) return propios.length ? destinoDeIntento(propios[0]) : null;
  if (!hito) return destinoDeIntento(validos[0]);

  const sale = hito.salen?.find((salida) => esNumero(salida.paso) && salida.paso >= 1);
  if (sale) return { intento: sale.intento, paso: sale.paso };

  if (hito.senalDominante) {
    for (const intento of validos) {
      const paso = (intento.pasos ?? []).find((p) => p.pagina === hito.pagina && (p.senales ?? []).includes(hito.senalDominante));
      if (paso) return { intento: intento.id, paso: paso.numero };
    }
  }

  const llegada = hito.pasos?.find((p) => esNumero(p.paso));
  if (llegada) return destinoDeLlegada(llegada.intento, llegada.paso);

  return destinoDeIntento(validos[0]);
}

/** Fracción para el tono de una celda: alcanzados/de; null si el perfil no tiene intentos válidos. */
export const fraccionDeCelda = (hito) => (hito && hito.de > 0 ? hito.alcanzados / hito.de : null);

/**
 * Puntos de una métrica por perfil (un punto por intento válido), con el dominio compartido por la columna.
 * @param {object} tanda
 * @param {"pasos" | "tiempo" | "tropiezos" | "hitos"} metrica
 * @returns {{ dominio: [number, number] | null, referencia: number | null,
 *             filas: { perfil: string, nombre: string, puntos: { intento: string, valor: number, resultado: string,
 *                      logro: string | null, destino: Destino }[], errores: number }[] }}
 */
export function puntosDeMetrica(tanda, metrica) {
  const ruta = tanda?.telarana?.ruta ?? null;
  const referencia =
    metrica === "pasos" ? (ruta?.pasosIdeales ?? null)
    : metrica === "tiempo" ? (ruta?.segundos ?? null)
    : metrica === "hitos" ? (ruta?.paginas?.length ?? null)
    : null;
  const valorDe = {
    pasos: (intento) => (intento.pasos ?? []).length,
    tiempo: (intento) => (esNumero(intento.duracion) ? intento.duracion : null),
    tropiezos: tropiezosDe,
    hitos: (intento) => (ruta ? (intento.hitosAlcanzados ?? 0) : null),
  }[metrica];
  const intentos = new Map((tanda?.intentos ?? []).map((intento) => [intento.id, intento]));
  const filas = (tanda?.perfiles ?? []).map((perfil) => {
    const propios = (perfil.intentos ?? []).map((id) => intentos.get(id)).filter(Boolean);
    const puntos = propios
      .filter((intento) => !esError(intento))
      .map((intento) => ({
        intento: intento.id,
        valor: valorDe(intento),
        resultado: intento.resultado,
        logro: intento.logro ?? null,
        destino: destinoDeIntento(intento),
      }))
      .filter((punto) => esNumero(punto.valor));
    return { perfil: perfil.perfil, nombre: perfil.nombre ?? perfil.perfil, puntos, errores: propios.filter(esError).length };
  });
  const desdeCero = metrica === "tropiezos" || metrica === "hitos";
  const dominio = dominioDe(filas.flatMap((fila) => fila.puntos.map((punto) => punto.valor)), { referencia, desdeCero });
  return { dominio, referencia: esNumero(referencia) ? referencia : null, filas };
}

/** ¿Todos los perfiles tienen a lo sumo un intento válido? (la nota "son conteos, no tasas") */
export const unoPorPerfil = (tanda) => (tanda?.perfiles ?? []).length > 0 && tanda.perfiles.every((perfil) => (perfil.validos ?? 0) <= 1);
