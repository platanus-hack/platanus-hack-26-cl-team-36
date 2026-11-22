// Huevo de pascua de la Platanus Hack 26, donde nació el proyecto: «Platanus Hack 26» en el pie de la portada es un
// botón (index.html; sin JavaScript es solo texto). Al apretarlo sus letras cobran vida (saltan en ola, de izquierda
// a derecha, recorriendo los colores del logo) y suelta cientos de plátanos desde el texto (platanos.js; three.js se
// empieza a cargar al acercarse). Con prefers-reduced-motion las letras no saltan.

import { COLORES_PLATANO, lanzarPlatanos, precargarPlatanos } from "./platanos.js";

const movimientoReducido = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Lo que dura la ola de las letras (ms), sin contar el escalonado entre letras. */
export const DURACION_OLA = 900;
/** Cuánto después de la anterior salta cada letra (ms). */
export const PASO_ENTRE_LETRAS = 45;

/** Los colores que recorre la letra `i` de `n`: el degradado del logo, empezando más adelante en cada letra. Puro. */
export function coloresDeLaLetra(i, n) {
  const desde = Math.round((i / Math.max(1, n)) * COLORES_PLATANO.length);
  return COLORES_PLATANO.map((_, k) => COLORES_PLATANO[(desde + k) % COLORES_PLATANO.length]);
}

// Cada letra en su propio <span> (para que salte sola). El nombre accesible es el aria-label del botón.
function separarEnLetras(boton) {
  if (boton.querySelector(".huevo-letra")) return;
  const letras = [...boton.textContent].map((caracter) => {
    const letra = document.createElement("span");
    letra.className = "huevo-letra";
    letra.setAttribute("aria-hidden", "true");
    letra.textContent = caracter;
    return letra;
  });
  boton.replaceChildren(...letras);
}

function cobrarVida(boton) {
  if (movimientoReducido()) return;
  const letras = [...boton.querySelectorAll(".huevo-letra")];
  letras.forEach((letra, i) => {
    const colores = coloresDeLaLetra(i, letras.length);
    const opciones = { duration: DURACION_OLA, delay: i * PASO_ENTRE_LETRAS, easing: "ease-in-out" };
    letra.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(-0.7em) scale(1.25) rotate(-8deg)", offset: 0.3 },
        { transform: "translateY(0.15em) scale(0.95) rotate(4deg)", offset: 0.6 },
        { transform: "translateY(0) scale(1)" },
      ],
      opciones,
    );
    // Sale de su color y vuelve a él (sin color en el primer y el último cuadro: los pone el navegador).
    letra.animate(
      [
        { offset: 0, textShadow: "0 0 0px transparent" },
        ...colores.map((color, k) => ({ offset: (k + 1) / (colores.length + 1), color, textShadow: `0 0 10px ${color}` })),
        { offset: 1, textShadow: "0 0 0px transparent" },
      ],
      opciones,
    );
  });
}

const boton = typeof document === "undefined" ? null : document.querySelector(".huevo");
if (boton) {
  separarEnLetras(boton);
  boton.addEventListener("click", () => {
    cobrarVida(boton);
    lanzarPlatanos(boton);
  });
  boton.addEventListener("pointerenter", () => precargarPlatanos());
  boton.addEventListener("focus", () => precargarPlatanos());
}
