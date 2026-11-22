// Animación del cambio de idioma del popup ("descifrado").
//
// Los textos están en comun/idioma.js; acá solo está el efecto:
//
//   animarCambio({ elementos, aplicar, raiz })
//     Llama a `aplicar()` (que pone los textos nuevos con `ponerTexto`) y, en cada elemento
//     cuyo texto cambió, las letras viejas se deshacen en caracteres al azar que se resuelven
//     de izquierda a derecha en el texto nuevo, escalonado de arriba hacia abajo (~700 ms).
//     El largo pasa del viejo al nuevo de a poco, así el layout no salta de golpe. Mientras
//     dura, `raiz` tiene aria-busy (los lectores de pantalla esperan al texto final) y
//     <html data-mt-idioma-cambio> para el CSS (idioma.css). Con prefers-reduced-motion:
//     cambio directo y un fundido corto.
//
//   ponerTexto(elemento, texto)
//     Todo texto del popup se pone con esto: si el elemento se está animando, cambia el
//     destino de la animación en vez de pisarla a mitad de camino.

const DURACION = 420; // ms que tarda cada elemento en resolverse
const ESCALONADO_TOTAL = 260; // ms entre el primer y el último elemento en empezar
const ESCALON_MAXIMO = 32;
const CADA_GLIFO = 45; // ms entre cambios de los caracteres al azar
const ANCHO_RUIDO = 14; // caracteres al azar a la vez, como mucho
// Glifos angostos (minúsculas sin m/w y signos finos): más anchos que el texto, harían que una
// línea se parta en dos a mitad de la animación y el popup crecería y volvería a encogerse.
const GLIFOS = "abcdefghijknopqrstuvxyz*+=/<>";
const FUNDIDO = 220; // ms, con prefers-reduced-motion

// ---------- Textos y animación ----------

const enCurso = new Map(); // elemento → { desde, hasta, retraso, mostrado }
let cuadro = null; // id de requestAnimationFrame
let cierre = null; // función que termina la animación actual

export function ponerTexto(elemento, texto) {
  const item = enCurso.get(elemento);
  if (item) item.hasta = texto;
  else if (elemento.textContent !== texto) elemento.textContent = texto;
}

// Pseudoazar estable por posición y momento: cada CADA_GLIFO ms cambian todos los glifos.
function glifo(posicion, tanda, semilla) {
  const mezcla = Math.imul(posicion + 1, 2654435761) ^ Math.imul(tanda + 1, 40503) ^ Math.imul(semilla + 1, 97);
  return GLIFOS[(mezcla >>> 0) % GLIFOS.length];
}

// Texto intermedio con avance p (0 → 1): adelante va el texto nuevo, en medio una franja de
// ruido y atrás lo que queda del viejo. Los espacios se respetan para que el texto se corte
// en líneas parecidas a las del texto final.
export function textoIntermedio(desde, hasta, p, tanda = 0, semilla = 0) {
  if (p <= 0) return desde;
  if (p >= 1) return hasta;
  const largo = Math.round(desde.length + (hasta.length - desde.length) * p);
  const ancho = Math.min(ANCHO_RUIDO, Math.max(3, Math.round(Math.max(desde.length, hasta.length) * 0.35)));
  const avance = p * (largo + ancho);
  const resueltos = Math.min(largo, Math.max(0, Math.floor(avance - ancho)));
  const ruido = Math.min(largo, Math.max(0, Math.floor(avance)));
  let texto = "";
  for (let i = 0; i < largo; i++) {
    if (i < resueltos && i < hasta.length) texto += hasta[i];
    else if (i >= ruido && i < desde.length) texto += desde[i];
    else {
      const referencia = i < hasta.length ? hasta[i] : desde[i];
      texto += /\s/.test(referencia ?? "") ? " " : glifo(i, tanda, semilla);
    }
  }
  return texto;
}

const suavizar = (p) => 1 - (1 - p) ** 2;

function terminarAnimacion() {
  cierre?.();
}

export function animarCambio({ elementos, aplicar, raiz }) {
  terminarAnimacion();
  const antes = new Map(elementos.map((elemento) => [elemento, elemento.textContent]));
  aplicar();

  const html = document.documentElement;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    html.dataset.mtIdiomaCambio = "fundido";
    const temporizador = setTimeout(() => cierre?.(), FUNDIDO);
    cierre = () => {
      clearTimeout(temporizador);
      delete html.dataset.mtIdiomaCambio;
      cierre = null;
    };
    return;
  }

  // Solo los que cambiaron y se ven; de arriba hacia abajo.
  const cambiados = elementos
    .filter((elemento) => elemento.isConnected && elemento.textContent !== antes.get(elemento))
    .filter((elemento) => elemento.getClientRects().length > 0 && !elemento.closest(".mt-oculto-visual"))
    .map((elemento) => ({ elemento, arriba: elemento.getBoundingClientRect().top }))
    .sort((a, b) => a.arriba - b.arriba);
  if (cambiados.length === 0) return;

  const escalon = cambiados.length > 1 ? Math.min(ESCALON_MAXIMO, ESCALONADO_TOTAL / (cambiados.length - 1)) : 0;
  cambiados.forEach(({ elemento }, i) => {
    const desde = antes.get(elemento);
    enCurso.set(elemento, { desde, hasta: elemento.textContent, retraso: i * escalon, semilla: i });
    elemento.textContent = desde;
  });
  html.dataset.mtIdiomaCambio = "descifrado";
  raiz.setAttribute("aria-busy", "true");

  const soltar = (elemento, item) => {
    elemento.textContent = item.hasta;
    delete elemento.dataset.mtDescifrando;
    enCurso.delete(elemento);
  };
  cierre = () => {
    cancelAnimationFrame(cuadro);
    for (const [elemento, item] of enCurso) soltar(elemento, item);
    delete html.dataset.mtIdiomaCambio;
    raiz.removeAttribute("aria-busy");
    cierre = null;
  };

  const inicio = performance.now();
  const avanzar = (ahora) => {
    const t = ahora - inicio;
    const tanda = Math.floor(t / CADA_GLIFO);
    for (const [elemento, item] of enCurso) {
      const p = (t - item.retraso) / DURACION;
      if (p >= 1) soltar(elemento, item);
      else if (p > 0) {
        // El tinte (idioma.css) arranca cuando le toca a cada elemento: así se ve la ola.
        if (!("mtDescifrando" in elemento.dataset)) elemento.dataset.mtDescifrando = "";
        elemento.textContent = textoIntermedio(item.desde, item.hasta, suavizar(p), tanda, item.semilla);
      }
    }
    if (enCurso.size > 0) cuadro = requestAnimationFrame(avanzar);
    else cierre();
  };
  cuadro = requestAnimationFrame(avanzar);
}
