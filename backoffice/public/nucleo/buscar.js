// Búsqueda difusa de la paleta (diseño §5.6). Pura.

/** Sin tildes y en minúsculas: "Telaraña" → "telarana". */
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

const SEPARADOR = /[^\p{L}\p{N}]+/u;

function puntuarTermino(texto, termino) {
  if (texto.startsWith(termino)) return 3;
  if (texto.split(SEPARADOR).some((palabra) => palabra.startsWith(termino))) return 2;
  // Iniciales: "wbf" → "wom-baja-fibra".
  const iniciales = texto.split(SEPARADOR).filter(Boolean).map((palabra) => palabra[0]).join("");
  if (termino.length > 1 && iniciales.includes(termino)) return 1;
  // Subsecuencia compacta: las letras en orden y no muy dispersas (si no, casi todo calza con todo).
  const tope = Math.max(termino.length * 3, termino.length + 6);
  for (let inicio = texto.indexOf(termino[0]); inicio !== -1; inicio = texto.indexOf(termino[0], inicio + 1)) {
    let desde = inicio + 1;
    let calza = true;
    for (const letra of termino.slice(1)) {
      const posicion = texto.indexOf(letra, desde);
      if (posicion === -1 || posicion - inicio >= tope) {
        calza = false;
        break;
      }
      desde = posicion + 1;
    }
    if (calza) return 1;
  }
  return null;
}

/**
 * Qué tan bien calza `consulta` con `texto`: prefijo 3 > comienzo de palabra 2 > subsecuencia 1; null si no calza.
 * Con varias palabras, cada una debe calzar y vale la peor.
 */
export function puntuar(texto, consulta) {
  const objetivo = normalizar(texto).trim();
  const buscado = normalizar(consulta).trim();
  if (!buscado) return 0;
  const entero = puntuarTermino(objetivo, buscado);
  if (entero !== null && entero > 1) return entero;
  const terminos = buscado.split(/\s+/).filter(Boolean);
  if (terminos.length < 2) return entero;
  let peor = Infinity;
  for (const termino of terminos) {
    const puntaje = puntuarTermino(objetivo, termino);
    if (puntaje === null) return entero;
    peor = Math.min(peor, puntaje);
  }
  return Math.max(peor, entero ?? 0);
}

/**
 * Filtra y ordena opciones de la paleta ({ titulo, subtitulo?, palabras? }). El título pesa más que el resto.
 * Consulta vacía → las primeras `limite` en su orden original. Orden estable entre iguales.
 */
export function filtrarOpciones(opciones, consulta, limite = 50) {
  if (!normalizar(consulta).trim()) return opciones.slice(0, limite);
  const puntuadas = [];
  opciones.forEach((opcion, indice) => {
    const enTitulo = puntuar(opcion.titulo, consulta);
    const resto = [opcion.titulo, opcion.subtitulo, opcion.palabras].filter(Boolean).join(" ");
    const enResto = enTitulo === null ? puntuar(resto, consulta) : null;
    const puntaje = enTitulo ?? (enResto === null ? null : enResto - 0.5);
    if (puntaje !== null) puntuadas.push({ opcion, puntaje, indice });
  });
  puntuadas.sort((a, b) => b.puntaje - a.puntaje || a.indice - b.indice);
  // Si hay calces buenos (prefijo o comienzo de palabra), las subsecuencias sueltas sobran.
  const mejor = puntuadas[0]?.puntaje ?? 0;
  const utiles = mejor >= 1.5 ? puntuadas.filter(({ puntaje }) => puntaje >= 1.5) : puntuadas;
  return utiles.slice(0, limite).map(({ opcion }) => opcion);
}
