// Crear elementos sin innerHTML: todo texto que viene de una corrida (títulos de páginas de
// terceros, lo que escribió el agente) entra como texto, nunca como HTML.

const SVG_NS = "http://www.w3.org/2000/svg";

function armar(nodo, atributos, hijos) {
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave.startsWith("on") && typeof valor === "function") {
      nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave === "texto") {
      nodo.textContent = String(valor);
    } else if (clave === "style") {
      // Por CSSOM y no como atributo: la política de seguridad no admite estilos en línea.
      nodo.style.cssText = String(valor);
    } else {
      nodo.setAttribute(clave, valor === true ? "" : String(valor));
    }
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

export const el = (etiqueta, atributos, ...hijos) => armar(document.createElement(etiqueta), atributos, hijos);
export const svg = (etiqueta, atributos, ...hijos) => armar(document.createElementNS(SVG_NS, etiqueta), atributos, hijos);

export function recortar(texto, largo) {
  const limpio = String(texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio;
}
