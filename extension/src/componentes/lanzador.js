// Componente "lanzador": accesos directos a las tareas más buscadas de un sitio, cada uno un
// enlace a la página donde se completa. Sirve para cualquier sitio del que se conozcan sus
// tareas principales (los agentes las catalogan y verifican a qué URL llega cada una).
//
// Campos de cada item (en `datos` del tema, o leídos de la página con una plantilla):
//   titulo, enlace, detalle (opcional), insignia (opcional), imagen (opcional, un ícono)
//   titulo, detalle e insignia pueden venir por idioma: { es, en }.
//   enlace e imagen, solo del mismo sitio: una imagen de otro host serviría para rastrear.
//
// Opciones:
//   max     cuántas tareas mostrar (por defecto 6)
//   textos  por idioma, para reemplazar los genéricos del diccionario (claves `lanzador.*`
//           de comun/idioma.js): { es: { titulo, subtitulo }, en: {…} }

(() => {
  const { crear } = MiTema.dom;
  const { enIdioma, textosDe, urlMismoSitio } = MiTema.plantillas;

  const CLAVES = ["titulo", "subtitulo"];
  let vistas = 0; // para ids únicos del encabezado

  function tarea(item, idioma, contexto) {
    const insignia = enIdioma(item.insignia, idioma);
    const detalle = enIdioma(item.detalle, idioma);
    const imagen = urlMismoSitio(item.imagen);
    const a = crear("a", { clase: "mt-lanzador__tarea", href: urlMismoSitio(item.enlace) }, [
      imagen && crear("img", { clase: "mt-lanzador__icono", src: imagen, alt: "" }),
      crear("span", { clase: "mt-lanzador__textos" }, [
        crear("span", { clase: "mt-lanzador__titulo", texto: enIdioma(item.titulo, idioma) }),
        detalle && crear("span", { clase: "mt-lanzador__detalle", texto: detalle }),
      ]),
      insignia && crear("span", { clase: "mt-lanzador__insignia", texto: insignia }),
      crear("span", { clase: "mt-lanzador__flecha", "aria-hidden": "true" }),
    ]);
    a.addEventListener("click", (evento) => contexto.abrir(item, evento));
    return a;
  }

  function dibujar(items, opciones, contexto) {
    const idioma = MiTema.idioma.actual();
    const t = textosDe("lanzador", CLAVES, opciones.textos, idioma);
    const tareas = items.filter((item) => item.titulo && urlMismoSitio(item.enlace)).slice(0, opciones.max ?? 6);
    if (tareas.length === 0) return null;

    const idTitulo = `mt-lanzador-titulo-${++vistas}`;
    return crear("nav", { clase: "mt-lanzador", "aria-labelledby": idTitulo }, [
      crear("header", { clase: "mt-lanzador__cabecera" }, [
        crear("h2", { clase: "mt-lanzador__encabezado", id: idTitulo, texto: t.titulo }),
        t.subtitulo && crear("p", { clase: "mt-lanzador__bajada", texto: t.subtitulo }),
      ]),
      crear("ul", { clase: "mt-lanzador__lista" }, tareas.map((item) => crear("li", {}, tarea(item, idioma, contexto)))),
    ]);
  }

  MiTema.registrarComponente("lanzador", { dibujar });
})();
