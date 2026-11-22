// Crear elementos sin innerHTML (diseño §5.4). Todo texto que viene de una corrida (títulos de páginas de
// terceros, lo que escribió el agente) entra como nodo de texto, nunca como HTML. Los estilos dinámicos van por
// CSSOM (`estilo: { "--x": "12px" }`): la política de seguridad no admite estilos en línea.

const SVG_NS = "http://www.w3.org/2000/svg";

const aGuiones = (propiedad) =>
  propiedad.startsWith("--") ? propiedad : propiedad.replace(/[A-Z]/g, (letra) => `-${letra.toLowerCase()}`);

function* aplanar(hijos) {
  for (const hijo of hijos) {
    if (Array.isArray(hijo)) yield* aplanar(hijo);
    else if (hijo !== null && hijo !== undefined && hijo !== false && hijo !== true) yield hijo;
  }
}

const aNodo = (hijo) => (hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));

function armar(nodo, atributos, hijos) {
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave.startsWith("on") && typeof valor === "function") {
      nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === "texto") {
      nodo.textContent = String(valor);
    } else if (clave === "estilo") {
      for (const [propiedad, dato] of Object.entries(valor)) {
        if (dato !== null && dato !== undefined && dato !== false) nodo.style.setProperty(aGuiones(propiedad), String(dato));
      }
    } else if (clave === "style") {
      console.error("dom: `style` en texto no está permitido (CSP); usa `estilo: { propiedad: valor }`");
    } else {
      nodo.setAttribute(clave, valor === true ? "" : String(valor));
    }
  }
  for (const hijo of aplanar(hijos)) nodo.append(aNodo(hijo));
  return nodo;
}

/** el("a", { href, class, texto, estilo: { "--x": "1" }, onclick }, ...hijos). Hijos null/false/undefined se omiten. */
export const el = (etiqueta, atributos, ...hijos) => armar(document.createElement(etiqueta), atributos, hijos);
export const svg = (etiqueta, atributos, ...hijos) => armar(document.createElementNS(SVG_NS, etiqueta), atributos, hijos);

/** replaceChildren con aplanado y sin nulos. */
export function reemplazar(padre, ...hijos) {
  padre.replaceChildren(...[...aplanar(hijos)].map(aNodo));
  return padre;
}

/** true si `texto` es una URL http(s): solo esas se vuelven enlaces (una corrida podría traer javascript: o data:). */
export function esUrlWeb(texto) {
  try {
    const { protocol } = new URL(String(texto ?? ""));
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function recortar(texto, largo) {
  const limpio = String(texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length > largo ? `${limpio.slice(0, Math.max(1, largo - 1)).trimEnd()}…` : limpio;
}

/** Corta por el medio, que en una URL es lo menos informativo: "https://wom.cl/…/internet-fibra/index.html". */
export function recortarAlMedio(texto, largo) {
  const limpio = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (limpio.length <= largo) return limpio;
  const disponible = Math.max(2, largo - 1);
  // En una URL se conserva el origen y el final del camino, cortando en un "/" si se puede.
  const origen = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i.exec(limpio)?.[0];
  let cabeza = origen && origen.length <= disponible * 0.5 ? origen : limpio.slice(0, Math.ceil(disponible * 0.45));
  let cola = limpio.slice(limpio.length - (disponible - cabeza.length));
  const barra = cola.indexOf("/");
  if (origen && barra > 0 && barra < cola.length * 0.4) cola = cola.slice(barra);
  if (cabeza.endsWith("/") && cola.startsWith("/")) cola = cola.slice(1);
  return `${cabeza}…${cola}`;
}

/**
 * Contrato de foco (§5.4): guarda el `data-foco` del elemento activo, corre `actualizar` y devuelve el foco al
 * elemento con la misma clave dentro de `raiz`; si ya no está y el foco se perdió, a `[data-foco-respaldo]`.
 * Acepta `actualizar` asíncrono (devuelve su promesa).
 */
export function conservarFoco(raiz, actualizar) {
  const activo = document.activeElement;
  const dentro = activo && raiz.contains(activo);
  const clave = dentro ? activo.closest("[data-foco]")?.getAttribute("data-foco") : null;
  const restaurar = () => {
    if (!dentro) return;
    const actual = document.activeElement;
    if (clave) {
      const destino = raiz.querySelector(`[data-foco="${CSS.escape(clave)}"]`);
      if (destino) {
        if (destino !== actual) destino.focus({ preventScroll: true });
        return;
      }
    }
    if (!actual || actual === document.body || !actual.isConnected) {
      raiz.querySelector("[data-foco-respaldo]")?.focus({ preventScroll: true });
    }
  };
  const resultado = actualizar();
  if (resultado && typeof resultado.then === "function") return resultado.then((valor) => (restaurar(), valor));
  restaurar();
  return resultado;
}

const estilosCargados = new Map();
// La carpeta de app.js (/backoffice/v/<versión>/): una hoja relativa sale de la misma versión que los módulos.
const RAIZ_DE_LA_APP = new URL("../", import.meta.url);

/** Agrega <link rel=stylesheet> una sola vez; resuelve al cargar (o al fallar, con un aviso en consola). */
export function cargarEstilos(href) {
  const absoluto = new URL(href, RAIZ_DE_LA_APP).href;
  if (estilosCargados.has(absoluto)) return estilosCargados.get(absoluto);
  const existente = [...document.querySelectorAll('link[rel="stylesheet"]')].find((enlace) => enlace.href === absoluto);
  const promesa = existente
    ? Promise.resolve()
    : new Promise((resolver) => {
        const enlace = el("link", { rel: "stylesheet", href: absoluto });
        enlace.addEventListener("load", () => resolver(), { once: true });
        enlace.addEventListener(
          "error",
          () => {
            console.warn(`No se pudo cargar la hoja de estilos ${href}`);
            resolver();
          },
          { once: true },
        );
        document.head.append(enlace);
      });
  estilosCargados.set(absoluto, promesa);
  return promesa;
}

/** Copia texto al portapapeles. → true si pudo. */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
