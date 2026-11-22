// Componente "atajo": un formulario corto que arma el enlace directo (deep link) a la página de
// resultados de un sitio con lo que elige el usuario, para saltarse un formulario largo o
// escondido. Las opciones de cada campo se copian de un <select> de la página (así siguen al
// día) o vienen en el tema. El resultado es un <a> común: se abre, se comparte o va a otra pestaña.
//
// Items, uno por campo (en `datos` del tema):
//   nombre     el parámetro de la URL
//   etiqueta   texto visible, por idioma { es, en }
//   opciones   selector del <select> de la página del que copiar las opciones (y la elegida)
//   valores    o la lista fija [{ valor, texto }], con `texto` por idioma
//   valor      el elegido al empezar (si no, el de la página; si no hay, queda "Elige una opción")
//   requerido  true: sin elegirlo, el enlace queda deshabilitado
//
// Opciones:
//   destino   URL de la página de resultados, del mismo sitio (relativa a la página). Puede
//             llevar marcadores `{nombre}` en la ruta o el hash: ese campo va ahí y no en la query
//   fijos     { parametro: valor } que van siempre en el enlace
//   invertir  [nombreA, nombreB]: un botón entre esos dos campos intercambia lo elegido
//   textos    por idioma, para reemplazar los genéricos del diccionario (claves `atajo.*`
//             de comun/idioma.js): { es: { titulo, subtitulo, boton, invertir, elegir }, en: {…} }.
//             Sin `titulo` no hay titular y el formulario se nombra con `atajo.etiqueta`
//
// Si a un campo le faltan opciones (la página cambió), no dibuja nada y queda la página original.

(() => {
  const { crear } = MiTema.dom;
  const { enIdioma, textosDe, urlMismoSitio } = MiTema.plantillas;

  const CLAVES = ["etiqueta", "boton", "invertir", "elegir"];
  const MARCADOR = /\{(\w+)\}/g;
  let vistas = 0; // para ids únicos del encabezado

  // Los parámetros van en el orden de los campos y después los fijos, como los arma el sitio.
  function armarEnlace(destino, valores = {}, fijos = {}) {
    const enRuta = new Set();
    const ruta = String(destino ?? "").replace(MARCADOR, (_, nombre) => {
      enRuta.add(nombre);
      return encodeURIComponent(valores[nombre] ?? "");
    });
    if ([...enRuta].some((nombre) => !valores[nombre])) return "";
    const base = urlMismoSitio(ruta);
    if (!base) return "";
    const url = new URL(base);
    for (const [nombre, valor] of Object.entries(valores)) if (valor && !enRuta.has(nombre)) url.searchParams.set(nombre, valor);
    for (const [nombre, valor] of Object.entries(fijos)) if (!url.searchParams.has(nombre)) url.searchParams.set(nombre, valor);
    return url.href;
  }

  const destinoValido = (destino) => Boolean(urlMismoSitio(String(destino ?? "").replace(MARCADOR, "x")));

  function selectDePagina(campo, raiz) {
    const select = campo.opciones ? raiz.querySelector(campo.opciones) : null;
    return select instanceof HTMLSelectElement ? select : null;
  }

  const opcionesUsables = (select) => [...select.options].filter((opcion) => opcion.value && !opcion.disabled);

  // → { opciones: [{ valor, texto, grupo }], elegido }; `elegido` vacío si no hay ninguno válido.
  function leerOpciones(campo, idioma, raiz = document) {
    let opciones;
    let elegido = campo.valor;
    if (campo.valores) {
      opciones = campo.valores.map(({ valor, texto }) => ({ valor: String(valor), texto: enIdioma(texto, idioma), grupo: "" }));
    } else {
      const select = selectDePagina(campo, raiz);
      if (!select) return { opciones: [], elegido: "" };
      opciones = opcionesUsables(select).map((opcion) => ({
        valor: opcion.value,
        texto: opcion.textContent.replace(/\s+/g, " ").trim(),
        grupo: opcion.parentElement?.tagName === "OPTGROUP" ? opcion.parentElement.label : "",
      }));
      elegido ??= select.value;
    }
    elegido = opciones.some((opcion) => opcion.valor === elegido) ? elegido : "";
    return { opciones, elegido };
  }

  // Lo que la vista suma a su firma: si la página cambia las opciones de un <select>, se redibuja.
  // Solo lee la página (nunca nuestros <select>, que no tienen esos selectores), así que redibujar
  // no vuelve a cambiar la firma.
  function firma(campos, _opciones, raiz = document) {
    return campos.map((campo) => {
      const select = campo.valores ? null : selectDePagina(campo, raiz);
      return select ? opcionesUsables(select).map((opcion) => opcion.value) : null;
    });
  }

  // Opciones consecutivas del mismo grupo van juntas en un <optgroup>, como en el original.
  function hijosDelSelect(opciones, elegido, textoElegir) {
    const hijos = [];
    if (!elegido) {
      const vacia = crear("option", { texto: textoElegir, selected: "selected" });
      // crear() omite los atributos vacíos, y sin `value` la opción valdría su texto.
      vacia.setAttribute("value", "");
      hijos.push(vacia);
    }
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

  const tieneValor = (select, valor) => [...select.options].some((opcion) => opcion.value === valor);

  function dibujar(campos, opciones) {
    const idioma = MiTema.idioma.actual();
    const t = textosDe("atajo", CLAVES, opciones.textos, idioma);
    if (!destinoValido(opciones.destino)) return null;

    const leidos = campos.map((campo) => ({ campo, ...leerOpciones(campo, idioma) }));
    if (leidos.some(({ campo, opciones: lista }) => !campo.nombre || lista.length === 0)) return null;

    const ir = crear("a", { clase: "mt-atajo__ir" }, [
      crear("span", { texto: t.boton }),
      crear("span", { clase: "mt-atajo__flecha", "aria-hidden": "true" }),
    ]);
    const selects = new Map();
    const actualizarEnlace = () => {
      const valores = Object.fromEntries([...selects].map(([nombre, select]) => [nombre, select.value]));
      const faltan = campos.some((campo) => campo.requerido && !valores[campo.nombre]);
      const href = faltan ? "" : armarEnlace(opciones.destino, valores, opciones.fijos);
      if (href) {
        ir.setAttribute("href", href);
        ir.removeAttribute("aria-disabled");
      } else {
        ir.removeAttribute("href");
        ir.setAttribute("aria-disabled", "true");
      }
    };

    const [nombreA, nombreB] = opciones.invertir ?? [];
    const filas = leidos.flatMap(({ campo, opciones: lista, elegido }) => {
      const select = crear("select", { clase: "mt-atajo__select", name: campo.nombre }, hijosDelSelect(lista, elegido, t.elegir));
      if (campo.requerido) select.required = true;
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
        // Si las listas difieren, asignar un valor que el otro no tiene lo dejaría en blanco.
        if (!tieneValor(a, b.value) || !tieneValor(b, a.value)) return;
        [a.value, b.value] = [b.value, a.value];
        actualizarEnlace();
      });
      return [etiqueta, invertir];
    });
    actualizarEnlace();

    const idTitulo = `mt-atajo-titulo-${++vistas}`;
    const nombre = t.titulo ? { "aria-labelledby": idTitulo } : { "aria-label": t.etiqueta };
    return crear("section", { clase: "mt-atajo", ...nombre }, [
      (t.titulo || t.subtitulo) && crear("header", { clase: "mt-atajo__cabecera" }, [
        t.titulo && crear("h2", { clase: "mt-atajo__titulo", id: idTitulo, texto: t.titulo }),
        t.subtitulo && crear("p", { clase: "mt-atajo__bajada", texto: t.subtitulo }),
      ]),
      crear("div", { clase: "mt-atajo__campos" }, [...filas, ir]),
    ]);
  }

  MiTema.registrarComponente("atajo", { dibujar, firma, armarEnlace, leerOpciones });
})();
