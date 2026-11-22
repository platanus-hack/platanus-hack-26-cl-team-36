// Componente "atajo": un formulario corto que arma el enlace directo (deep link) a la página de
// resultados de un sitio con lo que elige el usuario, para saltarse un formulario largo o
// escondido. Las opciones de cada campo se copian de un <select> de la página (así siguen al
// día) o vienen en el tema. El resultado es un <a> común: se abre, se comparte o va a otra pestaña.
//
// Items, uno por campo (en `datos` del tema):
//   nombre    el parámetro de la URL
//   etiqueta  texto visible, por idioma { es, en }
//   opciones  selector del <select> de la página del que copiar las opciones (y la elegida)
//   valores   o la lista fija [{ valor, texto }], con `texto` por idioma
//   valor     el elegido al empezar (si no, el de la página o el primero)
//
// Opciones:
//   destino   URL de la página de resultados, del mismo sitio (relativa a la página)
//   fijos     { parametro: valor } que van siempre en el enlace
//   invertir  [nombreA, nombreB]: un botón entre esos dos campos intercambia lo elegido
//   textos    por idioma, para reemplazar los genéricos del diccionario (claves `atajo.*`
//             de comun/idioma.js): { es: { titulo, subtitulo, boton, invertir }, en: {…} }
//
// Si a un campo le faltan opciones (la página cambió), no dibuja nada y queda la página original.

(() => {
  const { crear } = MiTema.dom;
  const { enIdioma, textosDe, urlMismoSitio } = MiTema.plantillas;

  const CLAVES = ["titulo", "subtitulo", "boton", "invertir"];

  // Los parámetros van en el orden de los campos y después los fijos, como los arma el sitio.
  function armarEnlace(destino, valores = {}, fijos = {}) {
    const base = urlMismoSitio(destino);
    if (!base) return "";
    const url = new URL(base);
    for (const [nombre, valor] of Object.entries(valores)) if (valor) url.searchParams.set(nombre, valor);
    for (const [nombre, valor] of Object.entries(fijos)) if (!url.searchParams.has(nombre)) url.searchParams.set(nombre, valor);
    return url.href;
  }

  // → { opciones: [{ valor, texto, grupo }], elegido }
  function leerOpciones(campo, idioma, raiz = document) {
    if (campo.valores) {
      const opciones = campo.valores.map(({ valor, texto }) => ({ valor: String(valor), texto: enIdioma(texto, idioma), grupo: "" }));
      return { opciones, elegido: campo.valor ?? opciones[0]?.valor ?? "" };
    }
    const select = campo.opciones ? raiz.querySelector(campo.opciones) : null;
    if (!select) return { opciones: [], elegido: "" };
    const opciones = [...select.options]
      .filter((opcion) => opcion.value)
      .map((opcion) => ({
        valor: opcion.value,
        texto: opcion.textContent.replace(/\s+/g, " ").trim(),
        grupo: opcion.parentElement?.tagName === "OPTGROUP" ? opcion.parentElement.label : "",
      }));
    return { opciones, elegido: campo.valor ?? select.value ?? opciones[0]?.valor ?? "" };
  }

  // Opciones consecutivas del mismo grupo van juntas en un <optgroup>, como en el original.
  function hijosDelSelect(opciones, elegido) {
    const hijos = [];
    let grupo = null;
    for (const { valor, texto, grupo: nombre } of opciones) {
      const opcion = crear("option", { value: valor, texto, selected: valor === elegido ? "selected" : null });
      if (!nombre) {
        grupo = null;
        hijos.push(opcion);
      } else {
        if (grupo?.label !== nombre) hijos.push((grupo = crear("optgroup", { label: nombre })));
        grupo.append(opcion);
      }
    }
    return hijos;
  }

  function dibujar(campos, opciones) {
    const idioma = MiTema.idioma.actual();
    const t = textosDe("atajo", CLAVES, opciones.textos, idioma);
    if (!armarEnlace(opciones.destino)) return null;

    const leidos = campos.map((campo) => ({ campo, ...leerOpciones(campo, idioma) }));
    if (leidos.some(({ campo, opciones: lista }) => !campo.nombre || lista.length === 0)) return null;

    const ir = crear("a", { clase: "mt-atajo__ir" }, [
      crear("span", { texto: t.boton }),
      crear("span", { clase: "mt-atajo__flecha", "aria-hidden": "true" }),
    ]);
    const selects = new Map();
    const actualizarEnlace = () => {
      const valores = Object.fromEntries([...selects].map(([nombre, select]) => [nombre, select.value]));
      ir.setAttribute("href", armarEnlace(opciones.destino, valores, opciones.fijos));
    };

    const [nombreA, nombreB] = opciones.invertir ?? [];
    const filas = leidos.flatMap(({ campo, opciones: lista, elegido }) => {
      const select = crear("select", { clase: "mt-atajo__select", name: campo.nombre }, hijosDelSelect(lista, elegido));
      select.addEventListener("change", actualizarEnlace);
      selects.set(campo.nombre, select);
      const etiqueta = crear("label", { clase: "mt-atajo__campo", "data-mt-campo": campo.nombre }, [
        crear("span", { clase: "mt-atajo__etiqueta", texto: enIdioma(campo.etiqueta, idioma) || campo.nombre }),
        crear("span", { clase: "mt-atajo__control" }, select),
      ]);
      if (campo.nombre !== nombreA || !leidos.some((l) => l.campo.nombre === nombreB)) return [etiqueta];

      const invertir = crear("button", { clase: "mt-atajo__invertir", type: "button", "aria-label": t.invertir, title: t.invertir }, [
        crear("span", { clase: "mt-atajo__invertir-icono", "aria-hidden": "true" }),
      ]);
      invertir.addEventListener("click", () => {
        const a = selects.get(nombreA);
        const b = selects.get(nombreB);
        [a.value, b.value] = [b.value, a.value];
        actualizarEnlace();
      });
      return [etiqueta, invertir];
    });
    actualizarEnlace();

    return crear("section", { clase: "mt-atajo" }, [
      crear("header", { clase: "mt-atajo__cabecera" }, [
        crear("h2", { clase: "mt-atajo__titulo", texto: t.titulo }),
        t.subtitulo && crear("p", { clase: "mt-atajo__bajada", texto: t.subtitulo }),
      ]),
      crear("div", { clase: "mt-atajo__campos" }, [...filas, ir]),
    ]);
  }

  MiTema.registrarComponente("atajo", { dibujar, armarEnlace, leerOpciones });
})();
