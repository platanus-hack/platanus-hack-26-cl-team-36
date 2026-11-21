// Utilidades para las plantillas (que son datos, no código) y para dibujar componentes.
//
//   MiTema.plantillas.leerCampos(elemento, campos) → { campo: "valor" }
//   MiTema.dom.crear(tag, props, hijos)            → Element, sin innerHTML
//
// Una regla de campo dice de dónde sacar un valor dentro de un elemento de la página:
//   { "selector": "a.titulo" }                                → su texto
//   { "selector": "a.titulo", "atributo": "href" }            → un atributo
//   { "selector": ".fila", "partes": "span", "separador": " • " } → textos de varios hijos unidos
//   { ..., "patron": "v=([\\w-]+)", "formato": "https://i.ytimg.com/vi/$1/hqdefault.jpg" }
//        → pasa el valor por una expresión regular y arma uno nuevo con sus grupos
//   [ regla1, regla2 ]                                        → la primera que dé algo
// Sin `selector`, la regla se aplica al elemento mismo.

(() => {
  // Solo URLs http(s) (absolutas o relativas a la página). Así una plantilla nunca puede
  // colar `javascript:` ni `data:` en un enlace o una imagen.
  function urlSegura(valor) {
    if (!valor) return "";
    try {
      const url = new URL(valor, location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function transformar(valor, { patron, formato = "$1" }) {
    const coincidencia = valor.match(new RegExp(patron));
    if (!coincidencia) return "";
    return formato.replace(/\$(\d)/g, (_, i) => coincidencia[Number(i)] ?? "");
  }

  function leer(raiz, regla) {
    if (Array.isArray(regla)) {
      for (const alternativa of regla) {
        const valor = leer(raiz, alternativa);
        if (valor) return valor;
      }
      return "";
    }

    const el = regla.selector ? raiz.querySelector(regla.selector) : raiz;
    if (!el) return "";

    let valor;
    if (regla.partes) {
      valor = [...el.querySelectorAll(regla.partes)]
        .map((parte) => parte.textContent.trim())
        .filter(Boolean)
        .join(regla.separador ?? " ");
    } else if (regla.atributo) {
      valor = el.getAttribute(regla.atributo) ?? "";
    } else {
      valor = el.textContent ?? "";
    }

    valor = valor.replace(/\s+/g, " ").trim();
    return regla.patron ? transformar(valor, regla) : valor;
  }

  function leerCampos(raiz, campos) {
    return Object.fromEntries(Object.entries(campos).map(([nombre, regla]) => [nombre, leer(raiz, regla)]));
  }

  // Crea elementos sin innerHTML: el texto de la página va siempre como texto, `href` y
  // `src` pasan por urlSegura, y no se aceptan atributos de eventos (`on…`).
  function crear(tag, props = {}, hijos = []) {
    const el = document.createElement(tag);
    for (const [clave, valor] of Object.entries(props)) {
      if (valor == null || valor === false || valor === "") continue;
      if (clave === "clase") el.className = valor;
      else if (clave === "texto") el.textContent = valor;
      else if (clave === "href" || clave === "src") {
        const url = urlSegura(valor);
        if (url) el.setAttribute(clave, url);
      } else if (!/^on/i.test(clave)) el.setAttribute(clave, valor);
    }
    for (const hijo of [].concat(hijos)) if (hijo) el.append(hijo);
    return el;
  }

  MiTema.plantillas = { leer, leerCampos, transformar, urlSegura };
  MiTema.dom = { crear };
})();
