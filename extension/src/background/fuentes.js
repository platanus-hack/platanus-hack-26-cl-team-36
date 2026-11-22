// Fuentes empaquetadas para los temas (src/fuentes/). Lógica pura, sin `browser.*`.
// Un tema remoto no puede declarar @font-face ni url() (css-remoto.js): nombra la familia, p. ej.
// `font-family: "MT Inter", "MT Inter Fallback", Inter, system-ui, sans-serif`, y el background inyecta
// fuentes/fuentes.css junto al tema. El navegador descarga cada archivo solo si algún texto lo usa.

export const HOJA_FUENTES = "fuentes/fuentes.css";

export const FUENTES = [
  { familia: "MT Inter", archivo: "fuentes/inter.woff2", licencia: "fuentes/OFL-inter.txt" },
  { familia: "MT Serif", archivo: "fuentes/source-serif.woff2", licencia: "fuentes/OFL-source-serif.txt" },
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

// Inyecta el CSS del tema y, si nombra una fuente empaquetada, la hoja de las @font-face, que `leerHoja` entrega como
// texto con las url() ya absolutas (hojaConUrlsAbsolutas). Si la hoja falla, el tema queda con sus fuentes de respaldo.
// `insertCSS` es browser.scripting.insertCSS (aquí no se toca `browser.*`). Al apagar Chameleon solo se quita la
// clase mi-tema: las caras quedan registradas pero sin uso, lo que es inocuo.
export async function inyectarCssDeTema(css, target, insertCSS, leerHoja) {
  await Promise.all([insertCSS({ target, css }), usaFuentes(css) && inyectarHoja(target, insertCSS, leerHoja)]);
}

// Las url() de fuentes.css son relativas a la hoja ("inter.woff2"). Con insertCSS({ files }), Firefox las resuelve
// contra la hoja, pero Chrome contra la página: pediría https://<sitio>/inter.woff2 (404, y el sitio lo vería). Por eso
// la hoja va como texto con las url() absolutas. `urlDe` es browser.runtime.getURL (moz-extension://<uuid>/… en
// Firefox, chrome-extension://<id>/… en Chrome).
export function hojaConUrlsAbsolutas(texto, urlDe) {
  const carpeta = HOJA_FUENTES.slice(0, HOJA_FUENTES.lastIndexOf("/") + 1);
  return texto.replace(/url\("([\w.-]+)"\)/g, (_, archivo) => `url("${urlDe(carpeta + archivo)}")`);
}

async function inyectarHoja(target, insertCSS, leerHoja) {
  try {
    await insertCSS({ target, css: await leerHoja() });
  } catch (error) {
    console.warn("[mi-tema] No se pudieron inyectar las fuentes del tema:", error);
  }
}
