// Pestaña Telaraña (diseño §10.5): un grafo dirigido de izquierda a derecha, con el inicio al medio a la izquierda,
// la meta al medio a la derecha y las demás páginas repartidas encima y debajo. Dos caminos y nada más: el camino
// feliz (la ruta recomendada, que llega a la meta directo) y el camino ineficiente (desvíos, vueltas atrás y los
// caminos que dan vueltas o no llegan). La leyenda, de dos elementos, resalta uno u otro. Panel de detalle por página
// y cámara (pan, zoom, ajuste).
//
// El estado de la vista vive en el hash: pagina=, camino=. Los clics escriben parámetros con ctx.actualizarParametros
// y actualizar(ctx) los aplica: una sola fuente de verdad.

import { kbd } from "../nucleo/atajos.js";
import { conservarFoco, el, esUrlWeb, recortarAlMedio, reemplazar, svg } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { conGlobo, ocultarGlobo } from "../nucleo/globo.js";
import { icono, insignia } from "../nucleo/iconos.js";
import { nombreDePagina, textoDeAccion, textoDeTitular } from "../datos/textos.js";
import { nombreConNivel } from "../datos/nombres.js";
import { altoDeFilaPara, altoDelLienzo, crearCamara, zoomLegible } from "../telarana/camara.js";
import { RESULTADOS, finalesPorPagina, hitosDeRuta, intentosPorPagina, salidasDePagina, totalesDeFinales, vecindario } from "../telarana/cuentas.js";
import { ALTO_FILA, distribuir, geometria } from "../telarana/distribuir.js";
import { CAMINOS, caminoDeTramo, dibujarEscena } from "../telarana/escena.js";
import { etiquetasDeEstaciones } from "../telarana/nombres.js";

const PASO_DE_PAN = 60;
/** Las acciones de una rama, las de la gente primero y los saltos del explorador al final. */
const accionesEnOrden = (rama) => [...(rama?.acciones ?? [])].sort((a, b) => Number(!!a.salto) - Number(!!b.salto));
const MARGEN_BAJO_EL_LIENZO = 16; // px entre la leyenda (o el lienzo) y el borde de abajo de la ventana
const reducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Holgura para las etiquetas fuera de la caja de la geometría (la mitad del nombre del inicio a la izquierda y de la
// meta a la derecha, y debajo de las estaciones).
const HOLGURA = { izquierda: 70, derecha: 90, abajo: 40 };
// Ajuste a la vista: el mapa entra a lo ancho (el inicio a la izquierda y la meta a la derecha) y las filas se estiran
// lo que pida el nombre de una estación con ese zoom, para que no se monte sobre el punto de la de abajo. Si aun así
// no cabe de alto, se recorre arrastrando.

function crearPantalla(contenedor, ctx) {
  const { tanda, t, fmt, senal } = ctx;
  const paginas = new Map((tanda.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const ramas = new Map((tanda.telarana?.ramas ?? []).map((rama) => [rama.id, rama]));
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  const nombreDePerfil = (id) => nombreConNivel((tanda.perfiles ?? []).find((perfil) => perfil.perfil === id)?.nombre ?? intentos.get(id)?.nombrePerfil ?? id, t);
  const nombre = (pagina) => nombreDePagina(pagina, t);
  // Lo que se ve en cada estación: si varias empiezan igual, lo que las distingue va adelante (telarana/nombres.js).
  const etiquetas = etiquetasDeEstaciones(tanda.telarana?.paginas ?? [], nombre, { primeras: tanda.telarana?.ruta?.paginas ?? [] });
  const distribucion = distribuir(tanda.telarana ?? {});
  const caminoDe = (tramo) => caminoDeTramo(tramo, distribucion.troncoEsRuta);
  const caminosPresentes = CAMINOS.filter((camino) => distribucion.tramos.some((tramo) => caminoDe(tramo) === camino));

  const estado = {
    seleccion: null,
    camino: null, // "feliz" | "ineficiente" | null: el camino resaltado desde la leyenda
    resaltado: null, // Set de ids resaltados por puntero o foco
    geo: null,
    altoFila: null, // alto de fila con que se dibujó (depende del ancho del lienzo)
    altoDelLienzo: null, // px: lo que queda de la ventana bajo el lienzo
    zoomDelAncho: null, // zoom con que el mapa entra a lo ancho del lienzo
    dibujo: null,
    ancho: 0,
    introHecha: false,
    profundidad: 0,
    avisos: [],
    ctx,
  };

  // ── Textos que la escena necesita ─────────────────────────────────────
  const textos = {
    nombre,
    etiqueta: (pagina) => etiquetas.get(pagina.id) ?? nombre(pagina),
    ariaDeEstacion(pagina, estacion) {
      const partes = [nombre(pagina)];
      if (estacion.tipo === "inicio") partes.push(t("telarana.estacion.inicio"));
      else if (estacion.tipo === "hito") partes.push(t("telarana.estacion.hito", { n: estacion.hito + 1, total: distribucion.tronco.length }));
      partes.push(t("telarana.estacion.visitas", { n: pagina.visitas ?? 0 }));
      if ((pagina.variantes?.length ?? 0) > 1) partes.push(t("telarana.estacion.variantesDeUrl", { n: pagina.variantes.length }));
      return partes.join(", ");
    },
    detalleDeVariantes: (n) => t("telarana.estacion.variantes", { n }),
    visitas: (n) => t("telarana.estacion.visitas", { n }),
  };
  const urlDeCaptura = (captura) => (captura?.archivo ? ctx.urlDeArchivo(captura.perfil, captura.archivo) : null);

  // ── Esqueleto de la vista ─────────────────────────────────────────────
  contenedor.classList.add("p-telarana");
  const titular = el("h2", { class: "telarana-titular", tabindex: "-1", "data-foco-inicial": "", texto: textoDeTitular(tanda.titulares?.telarana, tanda, t) });
  const zonaDeAvisos = el("div", { class: "telarana-avisos" });

  const escena = el("div", { class: "escena" });
  const idInstrucciones = "telarana-instrucciones";
  const lienzo = el(
    "div",
    {
      class: "lienzo",
      tabindex: "0",
      role: "group",
      "aria-label": t("telarana.lienzo.etiqueta"),
      "aria-describedby": idInstrucciones,
      "data-foco": "telarana:lienzo",
    },
    escena,
  );
  const botonDeCamara = (clave, nombreIcono, tecla, accion) => {
    const boton = el(
      "button",
      { type: "button", class: "boton boton-icono", "aria-label": t(`telarana.camara.${clave}`), "aria-keyshortcuts": tecla, "data-foco": `telarana:camara:${clave}` },
      icono(nombreIcono),
    );
    boton.addEventListener("click", accion, { signal: senal });
    conGlobo(boton, () => el("span", { class: "globo-con-tecla" }, el("span", { texto: t(`telarana.camara.${clave}`) }), kbd(tecla)), { senal });
    return boton;
  };
  const zoom = el(
    "div",
    { class: "telarana-zoom", role: "group", "aria-label": t("telarana.camara.controles") },
    botonDeCamara("alejar", "alejar", "-", () => camara?.alejar()),
    botonDeCamara("acercar", "acercar", "+", () => camara?.acercar()),
    botonDeCamara("ajustar", "ajustar", "0", () => ajustar()),
  );
  const mapa = el(
    "div",
    { class: "telarana-mapa" },
    lienzo,
    zoom,
    el("p", { id: idInstrucciones, class: "visualmente-oculto", texto: t("telarana.lienzo.instrucciones") }),
  );
  const botonesDeCamino = new Map();
  const leyenda = construirLeyenda();
  const panel = el("aside", { class: "panel-telarana tarjeta", "aria-label": t("telarana.panel.etiqueta"), "aria-live": "off" });

  reemplazar(
    contenedor,
    el("header", { class: "telarana-cabecera" }, titular, zonaDeAvisos),
    distribucion.estaciones.length
      ? el("div", { class: "telarana-cuerpo" }, el("div", { class: "telarana-columna" }, mapa, leyenda), panel)
      : vacio({ titulo: t(tanda.arbol === "danado" ? "telarana.lienzo.arbolDanado" : tanda.arbol === "falta" ? "telarana.lienzo.arbolFalta" : "telarana.lienzo.vacio") }),
  );

  /** La leyenda: un botón por camino presente; tocarlo resalta ese camino (y tocarlo otra vez, lo quita). */
  function construirLeyenda() {
    const muestra = (camino) =>
      svg(
        "svg",
        { class: "leyenda-muestra", viewBox: "0 0 28 10", width: 28, height: 10, "aria-hidden": "true" },
        svg("g", { class: `tramo tramo-${camino}` }, svg("path", { class: "tramo-trazo", d: "M2 5 L26 5", "stroke-width": 3 })),
      );
    return el(
      "div",
      { class: "telarana-leyenda", role: "group", "aria-label": t("telarana.leyenda.titulo") },
      caminosPresentes.map((camino) => {
        const boton = el(
          "button",
          { type: "button", class: `leyenda-camino leyenda-${camino}`, "aria-pressed": "false", "data-foco": `telarana:camino:${camino}`, title: t(`telarana.leyenda.${camino}Ayuda`) },
          muestra(camino),
          el("span", { texto: t(`telarana.leyenda.${camino}`) }),
        );
        boton.addEventListener("click", () => ctx.actualizarParametros({ camino: estado.camino === camino ? null : camino, pagina: null }), { signal: senal });
        botonesDeCamino.set(camino, boton);
        return boton;
      }),
    );
  }

  // ── Globos ────────────────────────────────────────────────────────────
  const tooltipDeEstacion = (pagina) => () =>
    el(
      "span",
      { class: "telarana-globo" },
      el("span", { class: "telarana-globo-titulo", texto: pagina.titulo || nombre(pagina) }),
      pagina.url ? el("span", { class: "mono telarana-globo-url", texto: recortarAlMedio(pagina.url, 80) }) : null,
    );

  const tooltipDeTramo = (tramo) => () => {
    const rama = ramas.get(tramo.id);
    const filas = [
      el("span", { class: "telarana-globo-titulo", texto: t("telarana.tramo.titulo", { desde: nombre(paginas.get(tramo.origen)), hasta: nombre(paginas.get(tramo.destino)) }) }),
      el("span", { class: `telarana-globo-camino telarana-globo-${caminoDe(tramo)}`, texto: t(`telarana.leyenda.${caminoDe(tramo)}`) }),
    ];
    if (tramo.tipo === "retroceso") filas.push(el("span", { class: "texto-3", texto: t("telarana.tramo.vuelta") }));
    for (const accion of accionesEnOrden(rama)) filas.push(el("span", { class: "telarana-globo-accion" }, el("span", { texto: textoDeAccion(accion.accion, t) }), el("span", { class: "num texto-3", title: t("telarana.panel.intentosDeAccion"), texto: `×${accion.intentos}` })));
    const desglose = [t("telarana.tramo.intentos", { n: rama?.intentos ?? tramo.intentos })];
    if (rama?.llegaron) desglose.push(t("telarana.tramo.llegaron", { n: rama.llegaron }));
    if (rama?.noLlegaron) desglose.push(t("telarana.tramo.noLlegaron", { n: rama.noLlegaron }));
    if (rama?.errores) desglose.push(t("telarana.tramo.errores", { n: rama.errores }));
    filas.push(el("span", { class: "texto-2", texto: desglose.join(" · ") }));
    const extra = [];
    if (rama?.perfiles?.length) extra.push(fmt.lista(rama.perfiles.map(nombreDePerfil)));
    if (Number.isFinite(rama?.medianaSegundos)) extra.push(t("telarana.tramo.mediana", { duracion: fmt.duracion(rama.medianaSegundos) }));
    if (extra.length) filas.push(el("span", { class: "texto-3", texto: extra.join(" · ") }));
    return el("span", { class: "telarana-globo" }, filas);
  };

  // ── Escena y cámara ───────────────────────────────────────────────────
  let camara = null;

  function cajaVisible() {
    const { caja } = estado.geo;
    return { x: caja.x - HOLGURA.izquierda, y: caja.y, ancho: caja.ancho + HOLGURA.izquierda + HOLGURA.derecha, alto: caja.alto + HOLGURA.abajo };
  }

  /** Zoom con que se ve el mapa entero a lo ancho del lienzo. */
  function zoomDelAncho() {
    const { caja } = geometria(distribucion);
    return lienzo.clientWidth / (caja.ancho + HOLGURA.izquierda + HOLGURA.derecha);
  }

  function dibujar() {
    estado.geo = geometria(distribucion, { altoFila: estado.altoFila ?? ALTO_FILA });
    estado.dibujo = dibujarEscena({ escena, distribucion, geo: estado.geo, paginas, textos, urlDeCaptura });
    for (const [id, boton] of estado.dibujo.estaciones) {
      conGlobo(boton, tooltipDeEstacion(paginas.get(id)), { senal });
      boton.addEventListener("click", () => elegir(id), { signal: senal });
    }
    for (const tramo of distribucion.tramos) {
      const golpe = estado.dibujo.tramos.get(tramo.id)?.querySelector(".tramo-golpe");
      if (golpe) conGlobo(golpe, tooltipDeTramo(tramo), { senal });
    }
    estado.dibujo.marcarEleccion(estado.seleccion);
    aislar();
  }

  function ajustar() {
    if (!camara || !estado.geo) return;
    const caja = cajaVisible();
    const encuadre = camara.encuadre(caja, { minimo: zoomLegible(estado.altoFila ?? ALTO_FILA) });
    // Si aun así no cabe (teléfonos, tandas grandes): se ve desde el inicio (a la izquierda) y con el tronco (el inicio y
    // la meta, en y = 0) a media altura del lienzo; el resto se recorre arrastrando.
    const { clientWidth: ancho, clientHeight: alto } = lienzo;
    if (caja.ancho * encuadre.k > ancho) encuadre.tx = -caja.x * encuadre.k;
    if (caja.alto * encuadre.k > alto) encuadre.ty = alto / 2;
    camara.poner(encuadre);
  }

  /** Al abrir, el camino feliz se dibuja de izquierda a derecha. */
  function introducir() {
    if (estado.introHecha || reducido()) return;
    estado.introHecha = true;
    const trazos = [...escena.querySelectorAll(".tramo-feliz .tramo-trazo")];
    const total = Math.max(1, trazos.length);
    trazos.forEach((trazo, indice) => {
      let largo = 0;
      try {
        largo = trazo.getTotalLength();
      } catch {
        largo = 0;
      }
      if (!largo) return;
      trazo.animate(
        [
          { strokeDasharray: `${largo} ${largo}`, strokeDashoffset: largo },
          { strokeDasharray: `${largo} ${largo}`, strokeDashoffset: 0 },
        ],
        { duration: 600 / total, delay: (600 / total) * indice, easing: "linear", fill: "backwards" },
      );
    });
  }

  /** El lienzo llena lo que queda de la ventana bajo su borde de arriba, dejando lugar debajo para la leyenda. */
  function dimensionarLienzo() {
    const caja = lienzo.getBoundingClientRect();
    const arriba = caja.top + window.scrollY;
    const bajoElLienzo = Math.max(0, leyenda.getBoundingClientRect().bottom - caja.bottom);
    const alto = altoDelLienzo(window.innerHeight, arriba, MARGEN_BAJO_EL_LIENZO + bajoElLienzo);
    if (alto === estado.altoDelLienzo) return false;
    estado.altoDelLienzo = alto;
    contenedor.style.setProperty("--alto-del-lienzo", `${alto}px`);
    return true;
  }

  function alCambiarTamano() {
    const cambioElAlto = dimensionarLienzo();
    const ancho = contenedor.clientWidth;
    if (!ancho || !distribucion.estaciones.length) return;
    const primera = !estado.geo;
    if (!primera && Math.abs(ancho - estado.ancho) < 2) {
      if (cambioElAlto) ajustar();
      return;
    }
    estado.ancho = ancho;
    // Alto de fila para que los nombres quepan viendo el mapa entero a lo ancho.
    const zoomAncho = zoomDelAncho();
    const altoFila = altoDeFilaPara(zoomAncho, ALTO_FILA);
    const redibujar = primera || altoFila !== estado.altoFila || Math.abs(zoomAncho - estado.zoomDelAncho) > 0.02;
    estado.altoFila = altoFila;
    estado.zoomDelAncho = zoomAncho;
    if (redibujar) dibujar();
    ajustar();
    introducir();
    // Si el primer dibujo llegó después de aplicar los parámetros (ancho 0 al montar), se aplican de nuevo.
    if (primera && estado.montado) aplicar(estado.ctx.parametros);
  }

  // ── Aislamiento: resaltado > elección > camino ────────────────────────
  /** Los tramos de un camino y las estaciones que tocan. */
  function idsDelCamino(camino) {
    const ids = new Set();
    for (const tramo of distribucion.tramos) {
      if (caminoDe(tramo) !== camino) continue;
      ids.add(tramo.id);
      ids.add(tramo.origen);
      ids.add(tramo.destino);
    }
    return ids;
  }

  function aislar() {
    if (!estado.dibujo) return;
    let ids = estado.camino ? idsDelCamino(estado.camino) : null;
    if (estado.resaltado) ids = estado.resaltado;
    else if (estado.seleccion) ids = vecindario(distribucion, estado.seleccion);
    estado.dibujo.aislar(ids);
  }

  function resaltar(objetivo) {
    const estacion = objetivo?.closest?.(".estacion");
    const tramo = objetivo?.closest?.(".tramo");
    let ids = null;
    if (estacion) ids = vecindario(distribucion, estacion.dataset.pagina);
    else if (tramo && tramo.closest(".escena")) {
      const datos = distribucion.tramos.find((cada) => cada.id === tramo.dataset.tramo);
      if (datos) ids = new Set([datos.id, datos.origen, datos.destino]);
    }
    const igual = (a, b) => a === b || (a && b && a.size === b.size && [...a].every((id) => b.has(id)));
    if (igual(ids, estado.resaltado)) return;
    estado.resaltado = ids;
    aislar();
  }
  escena.addEventListener("pointerover", (evento) => evento.pointerType === "mouse" && resaltar(evento.target), { signal: senal });
  escena.addEventListener("pointerleave", () => resaltar(null), { signal: senal });
  escena.addEventListener("focusin", (evento) => {
    resaltar(evento.target);
    // Si la estación enfocada quedó fuera de la vista, la cámara vuela hasta ella.
    const id = evento.target.closest?.(".estacion")?.dataset.pagina;
    const p = id ? estado.geo?.posiciones.get(id) : null;
    if (p && camara && !camara.esVisible(p.x, p.y)) camara.volarA(p.x, p.y);
  }, { signal: senal });
  escena.addEventListener("focusout", (evento) => {
    if (!escena.contains(evento.relatedTarget)) resaltar(null);
  }, { signal: senal });
  // Enfocar con Tab una estación fuera de la vista desplaza el lienzo aunque sea overflow:hidden: se anula.
  lienzo.addEventListener("scroll", () => {
    lienzo.scrollLeft = 0;
    lienzo.scrollTop = 0;
  }, { signal: senal });

  // Con el foco en el mapa, las flechas lo mueven (lienzo.instrucciones lo dice).
  lienzo.addEventListener(
    "keydown",
    (evento) => {
      if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
      const flechas = { ArrowLeft: [PASO_DE_PAN, 0], ArrowRight: [-PASO_DE_PAN, 0], ArrowUp: [0, PASO_DE_PAN], ArrowDown: [0, -PASO_DE_PAN] };
      const movimiento = flechas[evento.key];
      if (!movimiento || !camara) return;
      evento.preventDefault();
      camara.mover(...movimiento);
    },
    { signal: senal },
  );

  function elegir(id) {
    ctx.actualizarParametros({ pagina: estado.seleccion === id ? null : id });
  }

  // ── Panel ─────────────────────────────────────────────────────────────
  const encabezado = (texto, nivel = "h3") => el(nivel, { class: "panel-telarana-titulo", texto });
  const enlaceAReplay = (intento, paso) =>
    el(
      "a",
      {
        class: "panel-telarana-replay",
        href: ctx.enlace("replay", { intento: intento.id, paso: paso ?? undefined }),
        "aria-label": t("telarana.panel.abrirEnReplay", { nombre: intento.nombrePerfil ?? intento.id, n: paso ?? 1 }),
      },
      el("span", { texto: t("telarana.panel.paso", { n: paso ?? 1 }) }),
      icono("siguiente"),
    );
  const listaDeFinales = (cuentas) => {
    const presentes = RESULTADOS.filter((r) => cuentas[r] > 0);
    return el("ul", { class: "panel-telarana-finales" }, presentes.map((r) => el("li", {}, insignia(r), el("span", { class: "num", texto: String(cuentas[r]) }))));
  };

  function panelGeneral() {
    const hitos = new Map(hitosDeRuta(tanda).map((hito) => [hito.pagina, hito]));
    const totales = totalesDeFinales(finalesPorPagina(tanda));
    return [
      el("p", { class: "panel-telarana-prompt", texto: t("telarana.panel.elegir") }),
      distribucion.troncoEsRuta ? null : avisoEnLinea(t(tanda.telarana?.rutaEnInicio ? "telarana.panel.rutaEnInicio" : "telarana.panel.sinRuta")),
      el(
        "section",
        { class: "panel-telarana-seccion" },
        encabezado(t(distribucion.troncoEsRuta ? "telarana.panel.ruta" : "telarana.panel.eje")),
        el(
          "ol",
          { class: "panel-telarana-ruta" },
          distribucion.tronco.map((id, indice) => {
            const pagina = paginas.get(id);
            const hito = hitos.get(id);
            const boton = el(
              "button",
              { type: "button", class: "panel-telarana-hito", "data-foco": `telarana:ruta:${id}` },
              el("span", { class: "panel-telarana-numero", "aria-hidden": "true", texto: String(indice + 1) }),
              // Lo que distingue a la página adelante (como en su estación); el nombre completo, al pasar el puntero.
              el("span", { class: "truncar", title: nombre(pagina), texto: textos.etiqueta(pagina) }),
              hito?.de ? el("span", { class: "num texto-3", "aria-label": t("telarana.panel.conteoAria", hito), texto: t("telarana.panel.conteo", hito) }) : null,
            );
            boton.addEventListener("click", () => elegir(id));
            return el("li", {}, boton);
          }),
        ),
      ),
      RESULTADOS.some((r) => totales[r] > 0) ? el("section", { class: "panel-telarana-seccion" }, encabezado(t("telarana.panel.terminaron")), listaDeFinales(totales)) : null,
    ];
  }

  function panelDePagina(id) {
    const pagina = paginas.get(id);
    const estacion = distribucion.estaciones.find((cada) => cada.id === id);
    const finales = finalesPorPagina(tanda).get(id);
    const pasaron = intentosPorPagina(tanda, id);
    const salidas = salidasDePagina(tanda, id);
    const variantes = pagina.variantes ?? [];
    const captura = urlDeCaptura(pagina.captura);
    const marca = estacion?.tipo === "inicio" ? t("telarana.panel.inicio") : estacion?.tipo === "hito" ? t("telarana.panel.hito", { n: estacion.hito + 1 }) : null;
    const quitar = el("button", { type: "button", class: "boton boton-icono", "aria-label": t("telarana.panel.quitar"), title: t("telarana.panel.quitar"), "data-foco": "telarana:panel:quitar" }, icono("cerrar"));
    quitar.addEventListener("click", () => ctx.actualizarParametros({ pagina: null }));
    return [
      el(
        "div",
        { class: "panel-telarana-cabecera" },
        el("div", {}, marca ? el("span", { class: "insignia insignia-acento", texto: marca }) : null, encabezado(nombre(pagina))),
        quitar,
      ),
      pagina.titulo && pagina.titulo !== nombre(pagina) ? el("p", { class: "prosa texto-2", texto: pagina.titulo }) : null,
      pagina.url && !esUrlWeb(pagina.url) ? el("span", { class: "panel-telarana-url mono", texto: recortarAlMedio(pagina.url, 56) }) : null,
      pagina.url && esUrlWeb(pagina.url)
        ? el(
            "a",
            { class: "panel-telarana-url mono", href: pagina.url, target: "_blank", rel: "noreferrer noopener", title: t("telarana.panel.abrirPagina") },
            el("span", { texto: recortarAlMedio(pagina.url, 56) }),
            icono("enlace-externo"),
          )
        : null,
      el("p", {
        class: "texto-2",
        texto: t("telarana.panel.visitas", { visitas: t("telarana.estacion.visitas", { n: pagina.visitas ?? 0 }), perfiles: fmt.lista((pagina.perfiles ?? []).map(nombreDePerfil)) }),
      }),
      captura ? el("img", { class: "panel-telarana-captura", src: captura, alt: t("telarana.panel.captura", { perfil: nombreDePerfil(pagina.captura.perfil) }), loading: "lazy", decoding: "async" }) : null,
      variantes.length > 1
        ? el(
            "section",
            { class: "panel-telarana-seccion" },
            encabezado(t("telarana.panel.variantes")),
            el(
              "ul",
              { class: "panel-telarana-variantes" },
              variantes.map((variante) =>
                el(
                  "li",
                  {},
                  el("span", { class: variante.consulta ? "mono" : "texto-3", title: variante.url, texto: variante.consulta ? `?${variante.consulta}` : t("telarana.panel.sinConsulta") }),
                  el("span", { class: "texto-3", texto: `${t("telarana.estacion.visitas", { n: variante.visitas ?? 0 })} · ${fmt.lista((variante.perfiles ?? []).map(nombreDePerfil))}` }),
                ),
              ),
            ),
          )
        : null,
      finales && RESULTADOS.some((r) => finales[r] > 0)
        ? el("section", { class: "panel-telarana-seccion" }, encabezado(t("telarana.panel.terminanAqui")), listaDeFinales(finales))
        : null,
      salidas.length
        ? el(
            "section",
            { class: "panel-telarana-seccion" },
            encabezado(t("telarana.panel.salidas")),
            el(
              "ul",
              { class: "panel-telarana-salidas" },
              salidas.map((rama) =>
                el(
                  "li",
                  {},
                  el("span", { class: "panel-telarana-destino" }, icono("siguiente"), el("span", { texto: nombre(paginas.get(rama.destino)) }), el("span", { class: "num texto-3", title: t("telarana.panel.intentosDeAccion"), texto: `×${rama.intentos}` })),
                  // Cómo se llegó a esa salida: las acciones de la gente primero; un salto del explorador es una
                  // acción más de esta salida (no otro destino).
                  accionesEnOrden(rama).map((accion) =>
                    el("span", { class: "texto-3 panel-telarana-accion", title: t("telarana.panel.intentosDeAccion"), texto: t(accion.salto ? "telarana.panel.accionSalto" : "telarana.panel.accion", { accion: textoDeAccion(accion.accion, t), n: accion.intentos }) }),
                  ),
                ),
              ),
            ),
          )
        : null,
      el(
        "section",
        { class: "panel-telarana-seccion" },
        encabezado(t("telarana.panel.pasaron")),
        pasaron.length
          ? el(
              "ul",
              { class: "panel-telarana-intentos" },
              pasaron.map(({ intento, paso }) =>
                el("li", {}, el("span", { class: "truncar", texto: nombreConNivel(intento.nombrePerfil ?? intento.id, t) }), insignia(intento.resultado, { logro: intento.logro, compacta: true }), enlaceAReplay(intento, paso)),
              ),
            )
          : el("p", { class: "texto-3", texto: t("telarana.panel.nadiePaso") }),
      ),
    ];
  }

  function pintarPanel() {
    if (!panel.isConnected) return;
    conservarFoco(panel, () => reemplazar(panel, estado.seleccion && paginas.has(estado.seleccion) ? panelDePagina(estado.seleccion) : panelGeneral()));
  }

  // ── Parámetros ────────────────────────────────────────────────────────
  function reescribir(cambios) {
    estado.profundidad += 1;
    try {
      ctx.actualizarParametros(cambios);
    } finally {
      estado.profundidad -= 1;
    }
  }

  function aplicar(parametros) {
    if (estado.profundidad === 0) estado.avisos = [];

    // camino= (solo los que hay en esta tanda)
    const camino = caminosPresentes.includes(parametros.camino) ? parametros.camino : null;
    if (parametros.camino && !camino) return reescribir({ camino: null });
    estado.camino = camino;
    for (const [clave, boton] of botonesDeCamino) boton.setAttribute("aria-pressed", String(clave === camino));

    // pagina= (con los alias de páginas fusionadas)
    const pagina = parametros.pagina ?? null;
    if (pagina) {
      const canonica = tanda.telarana?.alias?.[pagina] ?? pagina;
      if (!paginas.has(canonica)) {
        estado.avisos.push(t("comun.estado.paginaNoExiste", { pagina }));
        return reescribir({ pagina: null });
      }
      if (canonica !== pagina) return reescribir({ pagina: canonica });
    }
    const cambioDeSeleccion = pagina !== estado.seleccion;
    estado.seleccion = pagina;
    estado.dibujo?.marcarEleccion(estado.seleccion);

    aislar();
    pintarPanel();
    reemplazar(zonaDeAvisos, estado.avisos.map((texto) => avisoEnLinea(texto, "atencion")));

    if (cambioDeSeleccion && estado.seleccion && camara && estado.geo) {
      const p = estado.geo.posiciones.get(estado.seleccion);
      if (p && !camara.esVisible(p.x, p.y)) camara.volarA(p.x, p.y);
      ctx.anunciar(t("telarana.panel.elegida", { nombre: nombre(paginas.get(estado.seleccion)) }));
    }
    return true;
  }

  // ── Atajos de la pestaña ──────────────────────────────────────────────
  ctx.atajos.registrar({
    "+": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => camara?.acercar() },
    "-": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => camara?.alejar() },
    0: { descripcion: () => t("comun.atajos.desc.ajustar"), accion: () => ajustar() },
    Escape: {
      descripcion: () => t("comun.atajos.desc.cerrar"),
      accion: () => {
        if (ocultarGlobo()) return;
        if (estado.seleccion) {
          const id = estado.seleccion;
          ctx.actualizarParametros({ pagina: null });
          estado.dibujo?.estaciones.get(id)?.focus({ preventScroll: true });
        } else if (estado.camino) ctx.actualizarParametros({ camino: null });
      },
    },
  });

  return {
    async montar() {
      await ctx.cargarEstilos("estilos/telarana.css");
      // Si otra navegación reemplazó la vista mientras cargaba el CSS, no se arma ni se registra nada.
      if (ctx.senal.aborted) return;
      if (!distribucion.estaciones.length) {
        aplicar(ctx.parametros);
        return;
      }
      camara = crearCamara(lienzo, escena, {
        senal,
        reducido,
        puedeArrastrar: (evento) => !evento.target.closest?.(".estacion, button, a"),
        alTocarFondo: () => {
          if (estado.seleccion) ctx.actualizarParametros({ pagina: null });
        },
      });
      // Primer dibujo con el ancho real; después, al cambiar de tamaño.
      alCambiarTamano();
      const observador = new ResizeObserver(() => alCambiarTamano());
      observador.observe(contenedor);
      // El alto de la ventana (y lo que ocupa la cabecera, p. ej. al abrir la instrucción) cambia el alto del lienzo.
      window.addEventListener("resize", () => alCambiarTamano(), { signal: senal });
      senal.addEventListener("abort", () => observador.disconnect(), { once: true });
      aplicar(ctx.parametros);
      estado.montado = true;
    },
    actualizar(nuevo) {
      estado.ctx = nuevo;
      return aplicar(nuevo.parametros) !== false;
    },
  };
}

let pantalla = null;

export default {
  titulo: (ctx) => ctx.t("comun.pestana.telarana"),
  async montar(contenedor, ctx) {
    pantalla = crearPantalla(contenedor, ctx);
    await pantalla.montar();
  },
  actualizar(ctx) {
    return pantalla ? pantalla.actualizar(ctx) : false;
  },
  desmontar() {
    pantalla = null;
  },
};
