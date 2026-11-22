// Feature "vista": reemplaza una sección de la página por una vista nueva, dibujada
// con un componente del catálogo (src/componentes/) y los datos de la sección original.
//
// Todo lo específico del sitio viene en la plantilla (las opciones del tema): de dónde
// leer los datos, qué componente usar y qué elemento original accionar. La sección
// original queda oculta debajo: el sitio sigue funcionando y se puede volver a ella.
//
// Opciones: una lista de vistas. Cada una:
//   id          nombre único de la vista
//   rutas       pathnames donde aplica (sin `rutas`, en todas); la barra final no cuenta
//   contenedor  selector de la sección original: se oculta y la vista va justo antes
//   reemplazar  false para sumar la vista sin ocultar el contenedor (que queda como ancla)
//   items       selector de cada elemento de la sección (relativo al contenedor)
//   datos       o los items ya hechos, en el tema (p. ej. las tareas que midieron los agentes)
//   campos      { campo: regla } para leer cada elemento (ver content/plantillas.js)
//   accion      { selector } del elemento original a clickear al abrir un item
//   componente  id del componente del catálogo
//   opciones    lo que necesite el componente (textos, cantidades, …)

(() => {
  const CLASE_ORIGINAL = "mt-vista-original"; // en <html>: se ve la sección original
  const estado = new Map(); // id de vista → { firma, nodo, contenedor, items }

  const html = () => document.documentElement;
  const sinBarraFinal = (ruta) => String(ruta).replace(/\/+$/, "");

  function quitar(id) {
    const previo = estado.get(id);
    if (!previo) return;
    previo.nodo.remove();
    previo.contenedor.removeAttribute("data-mt-oculto");
    estado.delete(id);
  }

  // Clic normal en un item: acciona el elemento original para que el sitio navegue a
  // su manera (sin recargar, en las SPA). Con Ctrl/Cmd/clic medio, o si el original ya
  // no existe, deja que nuestro enlace funcione como un enlace común.
  function abrir(item, evento) {
    if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    if (!item.original?.isConnected) return;
    evento.preventDefault();
    item.original.click();
  }

  const contexto = {
    abrir,
    viendoOriginal: () => html().classList.contains(CLASE_ORIGINAL),
    alternarOriginal: () => html().classList.toggle(CLASE_ORIGINAL),
  };

  function leerItems(contenedor, { datos, items, campos, accion }) {
    // Copias: abajo se les pone `original`, y no hay que tocar las opciones del tema.
    if (datos) return [].concat(datos).map((item) => ({ ...item }));
    return [...contenedor.querySelectorAll(items)]
      .map((el) => ({
        ...MiTema.plantillas.leerCampos(el, campos),
        original: accion?.selector ? el.querySelector(accion.selector) : null,
      }))
      .filter((item) => item.titulo || item.enlace);
  }

  function actualizarVista(vista) {
    const { id, rutas, contenedor: selector, componente, opciones = {}, reemplazar = true } = vista;
    const enRuta = !rutas || rutas.some((ruta) => sinBarraFinal(ruta) === sinBarraFinal(location.pathname));
    const contenedor = enRuta ? document.querySelector(selector) : null;
    const dibujante = MiTema.componentes.get(componente);
    if (!dibujante) console.warn(`[mi-tema] La vista "${id}" pide el componente "${componente}", que no existe.`);
    if (!contenedor || !dibujante) return quitar(id);

    const items = leerItems(contenedor, vista);
    // Sin datos (p. ej. la portada de YouTube sin sesión), se deja la sección original.
    if (items.length === 0) return quitar(id);

    // El idioma entra en la firma: si cambia, la vista se redibuja con los textos nuevos. El
    // componente puede sumar lo que lee de la página por su cuenta (p. ej. las opciones de un <select>).
    const firma = JSON.stringify([
      MiTema.idioma.actual(),
      items.map(({ original, ...datos }) => datos),
      dibujante.firma?.(items, opciones) ?? null,
    ]);
    const previo = estado.get(id);
    if (previo && previo.firma === firma && previo.nodo.isConnected && previo.contenedor === contenedor) {
      // Mismos datos: no se redibuja, pero el sitio pudo recrear sus elementos.
      previo.items.forEach((item, i) => (item.original = items[i].original));
      return;
    }

    const nodo = dibujante.dibujar(items, opciones, contexto);
    // El componente puede negarse (p. ej. no encontró en la página los datos que necesita).
    if (!nodo) return quitar(id);
    nodo.classList.add("mt-vista");
    nodo.dataset.mtVista = id;
    if (previo?.nodo.isConnected) previo.nodo.replaceWith(nodo);
    else contenedor.before(nodo);
    if (previo && previo.contenedor !== contenedor) previo.contenedor.removeAttribute("data-mt-oculto");
    if (reemplazar) contenedor.setAttribute("data-mt-oculto", "");
    estado.set(id, { firma, nodo, contenedor, items });
  }

  let esperandoCarga = false;
  let ultimas = [];

  function actualizar(vistas = []) {
    // A mitad del parseo una sección puede estar incompleta (un <select> con la mitad de sus opciones).
    if (document.readyState === "loading") {
      ultimas = vistas;
      if (!esperandoCarga) {
        esperandoCarga = true;
        document.addEventListener("DOMContentLoaded", () => {
          esperandoCarga = false;
          actualizar(ultimas);
        }, { once: true });
      }
      return;
    }
    for (const vista of [].concat(vistas)) {
      try {
        actualizarVista(vista);
      } catch (error) {
        console.error(`[mi-tema] Error en la vista "${vista.id}", se deja la página original:`, error);
        quitar(vista.id);
      }
    }
  }

  MiTema.registrarFeature("vista", { actualizar });
})();
