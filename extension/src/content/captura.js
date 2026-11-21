// Captura de la página para los votos (ver background/votos.js).
//
// Cuando el usuario vota, el background pide `{ tipo: "voto:capturar" }` a esta pestaña
// (solo al frame principal) y esto responde:
//
//   { url, temaId, temaActivo, original, editado }
//
//   url         location.href completa (el background le quita query y hash)
//   temaId      `data-mt-tema` de <html> (null si la página no tiene tema)
//   temaActivo  si <html> tiene la clase `mi-tema` (el botón está encendido)
//   original    HTML de la página SIN lo que agrega Chameleon: sin las vistas ni el botón de
//               modo foco, sin `data-mt-*` (la sección que ocultaba una vista vuelve a verse),
//               sin las clases `mi-tema*`/`mt-*` de <html> ni las propiedades `--mt-*`.
//   editado     HTML tal como se ve, con lo que agrega Chameleon (menos los restos de una
//               transición en curso). El CSS del tema no está en el DOM (se inyecta con
//               scripting.insertCSS): lo agrega el background.
//
// Limpieza en los dos (tamaño y privacidad): `<script>` sin contenido (queda la etiqueta
// con su `src`), sin `value` en los `<input>` (salvo botones), `<textarea>` vacíos, sin
// `nonce`, sin el `content` de los `<meta>` con tokens, y URIs `data:` de más de
// MAX_DATA_URI caracteres recortadas a su cabecera (en atributos y en `<style>`).
//
// También responde `{ tipo: "estado:pagina" }` → `{ temaId, temaActivo }` sin capturar
// nada: lo usa el popup (popup/popup.js) para decidir si pregunta "¿Mejor o peor?".
//
// Nunca se toca la página real: se trabaja sobre una copia importada a un documento
// inerte (createHTMLDocument), donde no se cargan imágenes ni corren scripts ni
// constructores de custom elements. Es liviano: solo registra el listener y no hace nada
// hasta que lo llaman.
//
// Si una feature o un componente inserta un nodo nuevo en la página, agregar su id a
// IDS_INSERTADOS (o marcarlo con `data-mt-vista`/la clase `mt-vista`), o aparecerá en el
// original. test/votos.test.js revisa las constantes `ID_… = "mt-…"` de src/.

(() => {
  const MAX_DATA_URI = 2048; // caracteres

  // Nodos que agrega Chameleon: no van en el original.
  const IDS_INSERTADOS = ["mt-foco", "mt-frente"];
  const ATRIBUTO_VISTA = "data-mt-vista";
  const CLASE_VISTA = "mt-vista";

  // Restos de una transición en curso (content/transicion.js): no van en ninguno.
  const IDS_TEMPORALES = ["mt-frente"];
  const ATRIBUTOS_TEMPORALES = ["data-mt-pieza", "data-mt-transicion"];
  const PROPIEDADES_TEMPORALES = /^--mt-[fa]-\d+$/;
  const PROPIEDADES_PROPIAS = /^--mt-/;

  // Inputs cuyo `value` es el texto visible del botón, no algo que escribió el usuario.
  const INPUTS_CON_VALOR = new Set(["button", "submit", "reset"]);
  const META_CON_TOKEN = /csrf|xsrf|token|nonce/i;

  // ---------- Lógica pura (se testea con Node) ----------

  // Quita `mi-tema` y `mi-tema-*` de cualquier nodo y además `mt-*` en <html>. En los
  // demás nodos no se tocan las `mt-*`: Bootstrap y Tailwind usan `mt-3` (margin-top).
  function limpiarClases(valor, esRaiz) {
    return valor
      .split(/\s+/)
      .filter((clase) => clase && clase !== "mi-tema" && !clase.startsWith("mi-tema-") && !(esRaiz && clase.startsWith("mt-")))
      .join(" ");
  }

  // Quita del atributo `style` las propiedades personalizadas cuyo nombre cumple `patron`.
  // Solo las nuestras (`--mt-*`), cuyo valor es un número: nunca trae `;`.
  function quitarPropiedades(estilo, patron) {
    return estilo
      .replace(/(^|;)\s*(--[\w-]+)\s*:[^;]*/g, (declaracion, separador, nombre) => (patron.test(nombre) ? separador : declaracion))
      .replace(/;(\s*;)+/g, ";")
      .replace(/^\s*;\s*/, "")
      .trim();
  }

  // `data:image/png;base64,AAAA…` de más de `max` caracteres → `data:image/png;base64,`.
  function recortarDataUris(valor, max = MAX_DATA_URI) {
    if (!valor.includes("data:")) return valor;
    return valor.replace(/data:([^,"'\s)]*),[^"'\s)]*/gi, (uri, cabecera) => (uri.length > max ? `data:${cabecera},` : uri));
  }

  const clasesDe = (el) => (el.getAttribute("class") ?? "").split(/\s+/);

  function esInsertado(el) {
    return IDS_INSERTADOS.includes(el.getAttribute("id")) || el.hasAttribute(ATRIBUTO_VISTA) || clasesDe(el).includes(CLASE_VISTA);
  }

  function esTemporal(el) {
    return IDS_TEMPORALES.includes(el.getAttribute("id"));
  }

  function limpiarAtributos(el, { original, esRaiz }) {
    const etiqueta = el.localName;
    for (const nombre of el.getAttributeNames()) {
      const valor = el.getAttribute(nombre);
      if (nombre === "nonce") {
        el.removeAttribute(nombre);
      } else if (nombre.startsWith("data-mt-")) {
        if (original || ATRIBUTOS_TEMPORALES.includes(nombre)) el.removeAttribute(nombre);
      } else if (nombre === "value" && etiqueta === "input" && !INPUTS_CON_VALOR.has((el.getAttribute("type") ?? "").toLowerCase())) {
        el.removeAttribute(nombre);
      } else if (nombre === "content" && etiqueta === "meta" && META_CON_TOKEN.test(el.getAttribute("name") ?? el.getAttribute("http-equiv") ?? "")) {
        el.removeAttribute(nombre);
      } else if (nombre === "class" && original) {
        const limpio = limpiarClases(valor, esRaiz);
        if (!limpio) el.removeAttribute(nombre);
        else if (limpio !== valor) el.setAttribute(nombre, limpio);
      } else if (nombre === "style" && valor.includes("--mt-")) {
        const limpio = quitarPropiedades(valor, original ? PROPIEDADES_PROPIAS : PROPIEDADES_TEMPORALES);
        if (!limpio) el.removeAttribute(nombre);
        else if (limpio !== valor) el.setAttribute(nombre, recortarDataUris(limpio));
      } else if (valor.length > MAX_DATA_URI && valor.includes("data:")) {
        el.setAttribute(nombre, recortarDataUris(valor));
      }
    }
  }

  function limpiarContenido(el) {
    switch (el.localName) {
      case "script":
      case "textarea":
        if (el.textContent) el.textContent = "";
        break;
      case "style": {
        const texto = el.textContent;
        const recortado = recortarDataUris(texto);
        if (recortado !== texto) el.textContent = recortado;
        break;
      }
    }
  }

  // Limpia `raiz` (un <html> copiado, nunca el de la página) en el lugar.
  // modo "original": quita todo lo de Chameleon. modo "editado": solo los restos temporales.
  function limpiar(raiz, { modo }) {
    const original = modo === "original";
    const pila = [raiz];
    while (pila.length > 0) {
      const el = pila.pop();
      if (el !== raiz && (esTemporal(el) || (original && esInsertado(el)))) {
        el.remove();
        continue;
      }
      limpiarAtributos(el, { original, esRaiz: el === raiz });
      limpiarContenido(el);
      pila.push(...el.children);
    }
    return raiz;
  }

  // ---------- Con el DOM real ----------

  function serializarDoctype(doctype) {
    if (!doctype) return "";
    const { name, publicId, systemId } = doctype;
    const publico = publicId ? ` PUBLIC "${publicId}"` : "";
    const sistema = systemId ? `${publicId ? "" : " SYSTEM"} "${systemId}"` : "";
    return `<!DOCTYPE ${name}${publico}${sistema}>\n`;
  }

  // Copia el <html> a un documento inerte, lo limpia y lo serializa.
  function copiar(documento, modo) {
    const inerte = documento.implementation.createHTMLDocument("");
    const raiz = inerte.importNode(documento.documentElement, true);
    limpiar(raiz, { modo });
    return serializarDoctype(documento.doctype) + raiz.outerHTML;
  }

  function capturar(documento) {
    const html = documento.documentElement; // se lee al momento: el sitio pudo reemplazarlo
    return {
      url: documento.URL,
      temaId: html.getAttribute("data-mt-tema") || null,
      temaActivo: html.classList.contains("mi-tema"),
      original: copiar(documento, "original"),
      editado: copiar(documento, "editado"),
    };
  }

  // Estado liviano para el popup (decide qué preguntar), sin copiar el HTML.
  function estadoPagina(documento) {
    const html = documento.documentElement;
    return { temaId: html.getAttribute("data-mt-tema") || null, temaActivo: html.classList.contains("mi-tema") };
  }

  browser.runtime.onMessage.addListener((mensaje) => {
    switch (mensaje?.tipo) {
      case "voto:capturar":
        return Promise.resolve().then(() => capturar(document));
      case "estado:pagina":
        return Promise.resolve(estadoPagina(document));
      default:
        return undefined; // no es para nosotros
    }
  });

  globalThis.MiTema.captura = {
    IDS_INSERTADOS,
    MAX_DATA_URI,
    limpiarClases,
    quitarPropiedades,
    recortarDataUris,
    limpiar,
    serializarDoctype,
    capturar,
    estadoPagina,
  };
})();
