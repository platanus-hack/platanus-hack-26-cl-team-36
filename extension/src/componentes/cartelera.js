// Componente "cartelera": un item destacado grande, una fila deslizable con los
// siguientes y una lista compacta con el resto. Sirve para cualquier lista de
// contenido con imagen (videos, artículos, productos…).
//
// Campos que usa de cada item (los define la plantilla):
//   titulo, enlace, imagen, imagen_grande (opcional, para el destacado),
//   insignia (p. ej. la duración), subtitulo, detalle
//
// Opciones:
//   fila    cuántos items van en la fila deslizable (por defecto 8)
//   textos  por idioma, para reemplazar los genéricos del diccionario (claves `cartelera.*`
//           de comun/idioma.js): { es: { titulo, destacado, boton, fila, lista, original,
//           volver }, en: {…} }. Un objeto plano ({ titulo, … }) vale para todos los idiomas.

(() => {
  const { crear } = MiTema.dom;

  const CLAVES = ["titulo", "destacado", "boton", "fila", "lista", "original", "volver"];

  // Textos en el idioma actual: los del diccionario, reemplazados por los del tema.
  function textosEn(idioma, propios = {}) {
    const genericos = Object.fromEntries(CLAVES.map((clave) => [clave, MiTema.idioma.t(idioma, `cartelera.${clave}`)]));
    const porIdioma = propios[idioma];
    const planos = Object.values(propios).every((valor) => typeof valor === "string") ? propios : {};
    return { ...genericos, ...planos, ...(porIdioma && typeof porIdioma === "object" ? porIdioma : {}) };
  }

  function miniatura(item, { grande = false } = {}) {
    const img = crear("img", { src: (grande && item.imagen_grande) || item.imagen, alt: "", loading: "lazy" });
    // La imagen grande no siempre existe: si falla, se usa la normal.
    if (grande && item.imagen_grande && item.imagen) {
      img.addEventListener("error", () => img.setAttribute("src", MiTema.plantillas.urlSegura(item.imagen)), { once: true });
    }
    return crear("div", { clase: "mt-cartelera__imagen" }, [
      img,
      item.insignia && crear("span", { clase: "mt-cartelera__insignia", texto: item.insignia }),
    ]);
  }

  function textos(item) {
    return [
      crear("h3", { clase: "mt-cartelera__titulo", texto: item.titulo }),
      item.subtitulo && crear("p", { clase: "mt-cartelera__subtitulo", texto: item.subtitulo }),
      item.detalle && crear("p", { clase: "mt-cartelera__detalle", texto: item.detalle }),
    ];
  }

  function enlace(item, clase, hijos, contexto) {
    const a = crear("a", { clase, href: item.enlace, title: item.titulo }, hijos);
    a.addEventListener("click", (evento) => contexto.abrir(item, evento));
    return a;
  }

  function dibujar(items, opciones, contexto) {
    const t = textosEn(MiTema.idioma.actual(), opciones.textos);
    const enFila = opciones.fila ?? 8;
    const [destacado, ...resto] = items;
    const fila = resto.slice(0, enFila);
    const lista = resto.slice(enFila);

    const alternar = crear("button", { clase: "mt-cartelera__alternar", type: "button" });
    const rotular = () => (alternar.textContent = contexto.viendoOriginal() ? t.volver : t.original);
    rotular();
    alternar.addEventListener("click", () => {
      contexto.alternarOriginal();
      rotular();
    });

    return crear("section", { clase: "mt-cartelera" }, [
      crear("header", { clase: "mt-cartelera__cabecera" }, [crear("h2", { texto: t.titulo }), alternar]),
      crear("div", { clase: "mt-cartelera__cuerpo" }, [
        enlace(destacado, "mt-cartelera__destacado", [
          miniatura(destacado, { grande: true }),
          crear("div", { clase: "mt-cartelera__info" }, [
            crear("span", { clase: "mt-cartelera__etiqueta", texto: t.destacado }),
            ...textos(destacado),
            crear("span", { clase: "mt-cartelera__boton", texto: `▶ ${t.boton}` }),
          ]),
        ], contexto),

        fila.length > 0 && crear("h3", { clase: "mt-cartelera__seccion", texto: t.fila }),
        fila.length > 0 && crear("div", { clase: "mt-cartelera__fila" },
          fila.map((item) => enlace(item, "mt-cartelera__tarjeta", [miniatura(item), ...textos(item)], contexto))),

        lista.length > 0 && crear("h3", { clase: "mt-cartelera__seccion", texto: t.lista }),
        lista.length > 0 && crear("div", { clase: "mt-cartelera__lista" },
          lista.map((item) => enlace(item, "mt-cartelera__compacto", [
            miniatura(item),
            crear("div", { clase: "mt-cartelera__textos" }, textos(item)),
          ], contexto))),
      ]),
    ]);
  }

  MiTema.registrarComponente("cartelera", { dibujar });
})();
