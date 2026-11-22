// Fuentes empaquetadas para los temas (src/fuentes/). Lógica pura, sin `browser.*`.
// Un tema remoto no puede declarar @font-face ni url() (css-remoto.js): nombra la familia, p. ej.
// `font-family: "MT Inter", "MT Inter Fallback", Inter, system-ui, sans-serif`, y el background inyecta
// fuentes/fuentes.css junto al tema. Firefox descarga cada archivo solo si algún texto lo usa.

export const HOJA_FUENTES = "fuentes/fuentes.css";

export const FUENTES = [
  { familia: "MT Inter", archivo: "fuentes/inter.woff2", licencia: "fuentes/OFL-inter.txt" },
  { familia: "MT Source Serif", archivo: "fuentes/source-serif.woff2", licencia: "fuentes/OFL-source-serif.txt" },
  { familia: "MT Archivo", archivo: "fuentes/archivo.woff2", licencia: "fuentes/OFL-archivo.txt" },
  { familia: "MT Geist", archivo: "fuentes/geist.woff2", licencia: "fuentes/OFL-geist.txt" },
  { familia: "MT Geist Mono", archivo: "fuentes/geist-mono.woff2", licencia: "fuentes/OFL-geist.txt" },
];

// "MT Geist Mono" y los "… Fallback" también calzan: basta con el comienzo del nombre.
const NOMBRADA = new RegExp(
  `(?<![\\w-])MT\\s+(?:${FUENTES.map((f) => f.familia.slice(3).replace(/ /g, "\\s+")).join("|")})(?![\\w-])`,
  "i",
);

// ¿El CSS del tema nombra alguna fuente empaquetada? Sin tema o sin nombrarlas, no se inyecta la hoja:
// así los sitios sin tema no ven nada de Chameleon, ni siquiera las caras en document.fonts.
export function usaFuentes(css) {
  return typeof css === "string" && NOMBRADA.test(css);
}
