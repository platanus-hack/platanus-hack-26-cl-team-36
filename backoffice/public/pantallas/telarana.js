// Pestaña Telaraña (diseño §10.5): una telaraña radial con el inicio al centro, un anillo por paso y la ruta
// recomendada como eje recto (hacia la derecha; hacia abajo si el lienzo es más alto que ancho), panel de detalle y
// cámara (pan, zoom, ajuste).
//
// El estado de la vista vive en el hash: pagina=. Los clics escriben parámetros con
// ctx.actualizarParametros y actualizar(ctx) los aplica: una sola fuente de verdad.

import { kbd } from "../nucleo/atajos.js";
import { conservarFoco, el, esUrlWeb, recortarAlMedio, reemplazar, svg } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { conGlobo, ocultarGlobo } from "../nucleo/globo.js";
import { icono, insignia } from "../nucleo/iconos.js";
import { nombreDePagina, textoDeAccion, textoDeTitular } from "../datos/textos.js";
import { crearCamara } from "../telarana/camara.js";
import {
  finalesPorPagina,
  hitosDeRuta,
  intentosPorPagina,
  salidasDePagina,
  totalesDeTerminales,
  vecindario,
} from "../telarana/cuentas.js";
import { RESULTADOS, distribuir, geometriaRadial } from "../telarana/distribuir.js";
import { atascosPorPagina } from "../telarana/atascos.js";
import { claseDeTramo, dibujarEscena } from "../telarana/escena.js";
import { nombreConNivel } from "../datos/nombres.js";

const PASO_DE_PAN = 60;
/** Las acciones de una rama, las de la gente primero y los saltos del explorador al final. */
const accionesEnOrden = (rama) => [...(rama?.acciones ?? [])].sort((a, b) => Number(!!a.salto) - Number(!!b.salto));
const reducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Holgura para las etiquetas fuera de la caja de la geometría (debajo de las estaciones y a la derecha de las
// terminales con el eje a la derecha; a los lados con el eje hacia abajo).
const HOLGURA = {
  derecha: { izquierda: 0, derecha: 150, abajo: 40 },
  abajo: { izquierda: 60, derecha: 120, abajo: 20 },
};

function crearPantalla(contenedor, ctx) {
  const { tanda, t, fmt, senal } = ctx;
  const paginas = new Map((tanda.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const ramas = new Map((tanda.telarana?.ramas ?? []).map((rama) => [rama.id, rama]));
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  const perfiles = (tanda.perfiles ?? []).map((perfil) => ({ id: perfil.perfil, nombre: perfil.nombre ?? perfil.perfil }));
  const nombreDePerfil = (id) => nombreConNivel(perfiles.find((perfil) => perfil.id === id)?.nombre ?? intentos.get(id)?.nombrePerfil ?? id, t);
  const nombre = (pagina) => nombreDePagina(pagina, t);
  // El grosor de los tramos y el eje (el camino más transitado) cuentan intentos distintos, no las veces que se pasó
  // por cada tramo: un explorador que va y vuelve 40 veces entre dos páginas no engorda el tramo.
  const distribucion = distribuir(tanda.telarana ?? {});

  const estado = {
    seleccion: null,
    resaltado: null, // Set de ids resaltados por puntero o foco
    eje: null, // "derecha" o "abajo" (lienzos más altos que anchos)
    geo: null,
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
    ariaDeEstacion(pagina, estacion, atascos = 0) {
      const partes = [nombre(pagina)];
      if (estacion.tipo === "inicio") partes.push(t("telarana.estacion.inicio"));
      else if (estacion.tipo === "hito") partes.push(t("telarana.estacion.hito", { n: estacion.hito + 1, total: distribucion.tronco.length }));
      partes.push(t("telarana.estacion.visitas", { n: pagina.visitas ?? 0 }));
      if ((pagina.variantes?.length ?? 0) > 1) partes.push(t("telarana.estacion.variantesDeUrl", { n: pagina.variantes.length }));
      if (atascos) partes.push(t("telarana.atasco.aria", { n: atascos }));
      return partes.join(", ");
    },
    detalleDeVariantes: (n) => t("telarana.estacion.variantes", { n }),
    visitas: (n) => t("telarana.estacion.visitas", { n }),
    etiquetaDeResultado: (resultado) => t(`comun.resultado.${resultado}`),
    ariaDeTerminal: (resultado, n) => t("telarana.terminal.aria", { resultado: t(`comun.resultado.${resultado}`), n }),
    anillo: (n) => t("telarana.anillo.paso", { n }),
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
    botonDeCamara("alejar", "alejar", "-", () => alejar()),
    botonDeCamara("acercar", "acercar", "+", () => acercar()),
    botonDeCamara("ajustar", "ajustar", "0", () => ajustar()),
  );
  const mapa = el(
    "div",
    { class: "telarana-mapa" },
    lienzo,
    zoom,
    el("p", { id: idInstrucciones, class: "visualmente-oculto", texto: t("telarana.lienzo.instrucciones") }),
  );
  const leyenda = construirLeyenda();
  const panel = el("aside", { class: "panel-telarana tarjeta", "aria-label": t("telarana.panel.etiqueta"), "aria-live": "off" });

  reemplazar(
    contenedor,
    el("header", { class: "telarana-cabecera" }, titular, zonaDeAvisos),
    distribucion.estaciones.length
      ? el("div", { class: "telarana-cuerpo" }, el("div", { class: "telarana-columna" }, mapa, leyenda), panel)
      : vacio({ titulo: t("telarana.lienzo.vacio") }),
  );

  function construirLeyenda() {
    const muestra = (clases) =>
      svg(
        "svg",
        { class: "leyenda-muestra", viewBox: "0 0 28 10", width: 28, height: 10, "aria-hidden": "true" },
        svg("g", { class: `tramo ${clases}` }, svg("path", { class: "tramo-trazo", d: "M2 5 L26 5", "stroke-width": 3 })),
      );
    // Solo los tipos de tramo que aparecen en esta tanda (el tronco, siempre).
    const fuera = distribucion.tramos.filter((tramo) => tramo.tipo !== "tronco");
    const clases = new Set(fuera.map(claseDeTramo));
    const items = [
      ["tramo-tronco", distribucion.troncoEsRuta ? "ruta" : "eje"],
      ...[["exito", "exito"], ["mixto", "mixto"], ["fallo", "fallo"], ["abandono", "abandono"], ["error", "error"]]
        .filter(([clase]) => clases.has(clase))
        .map(([clase, clave]) => [`tramo-${clase}`, clave]),
      fuera.some((tramo) => tramo.tipo === "retroceso") ? ["tramo-retroceso tramo-exito", "retroceso"] : null,
    ].filter(Boolean);
    const hayAtascos = atascosPorPagina(tanda).size > 0;
    return el(
      "div",
      { class: "telarana-leyenda" },
      el("span", { class: "visualmente-oculto", texto: t("telarana.leyenda.titulo") }),
      el(
        "ul",
        { "aria-label": t("telarana.leyenda.titulo") },
        items.map(([clasesDeMuestra, clave]) => el("li", {}, muestra(clasesDeMuestra), el("span", { texto: t(`telarana.leyenda.${clave}`) }))),
        el("li", { class: "leyenda-anillo", texto: t("telarana.leyenda.anillo") }),
        hayAtascos ? el("li", { class: "leyenda-atasco" }, icono("atasco"), el("span", { texto: t("telarana.leyenda.atasco") })) : null,
        el("li", { class: "leyenda-grosor", texto: t("telarana.leyenda.grosor") }),
      ),
    );
  }

  // ── Escena y cámara ───────────────────────────────────────────────────
  let camara = null;
  // Dónde se trabaron: marca en la estación y líneas en su globo.
  const atascosActuales = () => atascosPorPagina(tanda);
  const lineaDeAtasco = (atasco) => {
    const partes = [];
    if (atasco.demora) partes.push(t("telarana.atasco.demora", { n: atasco.demora }));
    if (atasco.tropiezos) partes.push(t("telarana.atasco.tropiezos", { n: atasco.tropiezos }));
    if (atasco.repetidos) partes.push(t("telarana.atasco.repetidos", { n: atasco.repetidos }));
    return t("telarana.atasco.linea", { nombre: intentos.get(atasco.intento)?.nombrePerfil ?? atasco.intento, detalle: partes.join(", ") });
  };
  const tooltipDeEstacion = (pagina) => () => {
    const atascos = atascosActuales().get(pagina.id) ?? [];
    return el(
      "span",
      { class: "telarana-globo" },
      el("span", { class: "telarana-globo-titulo", texto: pagina.titulo || nombre(pagina) }),
      pagina.url ? el("span", { class: "mono telarana-globo-url", texto: recortarAlMedio(pagina.url, 80) }) : null,
      atascos.length
        ? el(
            "span",
            { class: "telarana-globo-atasco" },
            el("span", { class: "telarana-globo-atasco-titulo" }, icono("atasco"), el("span", { texto: t("telarana.atasco.titulo") })),
            atascos.map((atasco) => el("span", { texto: lineaDeAtasco(atasco) })),
          )
        : null,
    );
  };
  const marcarAtascos = () => {
    const cuantos = new Map([...atascosActuales()].map(([pagina, lista]) => [pagina, lista.length]));
    estado.dibujo?.marcarAtascos(cuantos);
  };

  const tooltipDeTramo = (tramo) => () => {
    const desde = paginas.get(tramo.origen);
    const filas = [];
    if (tramo.tipo === "final") {
      filas.push(el("span", { class: "telarana-globo-titulo", texto: nombre(desde) }));
      filas.push(el("span", { texto: t("telarana.tramo.final", { resultado: t(`comun.resultado.${tramo.resultado}`), n: tramo.intentos }) }));
      return el("span", { class: "telarana-globo" }, filas);
    }
    const rama = ramas.get(tramo.id);
    filas.push(el("span", { class: "telarana-globo-titulo", texto: t("telarana.tramo.titulo", { desde: nombre(desde), hasta: nombre(paginas.get(tramo.destino)) }) }));
    if (tramo.tipo === "retroceso") filas.push(el("span", { class: "texto-3", texto: t("telarana.tramo.vuelta") }));
    for (const accion of accionesEnOrden(rama)) filas.push(el("span", { class: "telarana-globo-accion" }, el("span", { texto: textoDeAccion(accion.accion, t) }), el("span", { class: "num texto-3", title: t("telarana.panel.intentosDeAccion"), texto: `×${accion.intentos}` })));
    const desglose = [t("telarana.tramo.intentos", { n: rama?.intentos ?? tramo.intentos })];
    if (rama?.exitos) desglose.push(t("telarana.tramo.exitos", { n: rama.exitos }));
    if (rama?.fallos) desglose.push(t("telarana.tramo.fallos", { n: rama.fallos }));
    if (rama?.errores) desglose.push(t("telarana.tramo.errores", { n: rama.errores }));
    filas.push(el("span", { class: "texto-2", texto: desglose.join(" · ") }));
    const extra = [];
    if (rama?.perfiles?.length) extra.push(fmt.lista(rama.perfiles.map(nombreDePerfil)));
    if (Number.isFinite(rama?.medianaSegundos)) extra.push(t("telarana.tramo.mediana", { duracion: fmt.duracion(rama.medianaSegundos) }));
    if (extra.length) filas.push(el("span", { class: "texto-3", texto: extra.join(" · ") }));
    return el("span", { class: "telarana-globo" }, filas);
  };

  function cajaVisible() {
    const { caja } = estado.geo;
    const holgura = HOLGURA[estado.eje] ?? HOLGURA.derecha;
    return { x: caja.x - holgura.izquierda, y: caja.y, ancho: caja.ancho + holgura.izquierda + holgura.derecha, alto: caja.alto + holgura.abajo };
  }

  function dibujar() {
    // Anillos como círculos simples y sin rayos: la estructura de la telaraña, sin decorarla como tela de araña.
    estado.geo = geometriaRadial(distribucion, { eje: estado.eje, rayos: 0, caida: 0 });
    lienzo.dataset.eje = estado.eje;
    estado.dibujo = dibujarEscena({
      escena,
      distribucion,
      geo: estado.geo,
      paginas,
      ramas,
      textos,
      urlDeCaptura,
      intentos,
      particulas: !reducido(),
    });
    marcarAtascos();
    for (const [id, boton] of estado.dibujo.estaciones) {
      const pagina = paginas.get(id);
      conGlobo(boton, tooltipDeEstacion(pagina), { senal });
      boton.addEventListener("click", () => elegir(id), { signal: senal });
    }
    for (const tramo of distribucion.tramos) {
      const golpe = estado.dibujo.tramos.get(tramo.id)?.querySelector(".tramo-golpe");
      if (golpe) conGlobo(golpe, tooltipDeTramo(tramo), { senal });
    }
    estado.dibujo.marcarEleccion(estado.seleccion);
    estado.dibujo.contarTerminales(totalesDeTerminales(finalesPorPagina(tanda)));
    aislar();
  }

  function ajustar() {
    if (!camara || !estado.geo) return;
    camara.ajustar(cajaVisible());
  }

  function acercar() {
    camara?.acercar();
  }
  function alejar() {
    camara?.alejar();
  }

  function introducir() {
    if (estado.introHecha || reducido()) return;
    estado.introHecha = true;
    const trazos = [...escena.querySelectorAll(".tramo-tronco .tramo-trazo")];
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

  function alCambiarTamano() {
    const ancho = contenedor.clientWidth;
    if (!ancho || !distribucion.estaciones.length) return;
    // Lienzo más alto que ancho (teléfonos): el eje baja, así la telaraña aprovecha el alto.
    const eje = lienzo.clientHeight > lienzo.clientWidth * 1.05 ? "abajo" : "derecha";
    const cambio = eje !== estado.eje;
    if (!cambio && Math.abs(ancho - estado.ancho) < 2) return;
    estado.ancho = ancho;
    const primera = !estado.geo;
    if (cambio) {
      estado.eje = eje;
      dibujar();
    }
    ajustar();
    introducir();
    // Si el primer dibujo llegó después de aplicar los parámetros (ancho 0 al montar), se aplican de nuevo.
    if (primera && estado.montado) aplicar(estado.ctx.parametros);
  }

  // ── Aislamiento: resaltado > elección ─────────────────────────────────
  function aislar() {
    if (!estado.dibujo) return;
    let ids = null;
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

  // ── Elegir una página ─────────────────────────────────────────────────
  function elegir(id) {
    ctx.actualizarParametros({ pagina: estado.seleccion === id ? null : id });
  }

  // ── Panel ─────────────────────────────────────────────────────────────
  const encabezado = (texto, nivel = "h3") => el(nivel, { class: "panel-telarana-titulo", texto });
  const botonQuitar = (clave, accion, foco) => {
    const boton = el("button", { type: "button", class: "boton boton-icono", "aria-label": t(clave), title: t(clave), "data-foco": foco }, icono("cerrar"));
    boton.addEventListener("click", accion);
    return boton;
  };
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

  function listaDeTerminales() {
    const totales = totalesDeTerminales(finalesPorPagina(tanda));
    const presentes = RESULTADOS.filter((r) => totales[r] > 0);
    if (!presentes.length) return el("p", { class: "texto-3", texto: t("telarana.panel.nadieTermino") });
    return el(
      "ul",
      { class: "panel-telarana-terminales" },
      presentes.map((r) => el("li", {}, insignia(r), el("span", { class: "num", texto: String(totales[r]) }))),
    );
  }

  function panelGeneral() {
    const hitos = new Map(hitosDeRuta(tanda).map((hito) => [hito.pagina, hito]));
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
              el("span", { class: "truncar", texto: nombre(pagina) }),
              hito?.de ? el("span", { class: "num texto-3", "aria-label": t("telarana.panel.conteoAria", hito), texto: t("telarana.panel.conteo", hito) }) : null,
            );
            boton.addEventListener("click", () => elegir(id));
            return el("li", {}, boton);
          }),
        ),
      ),
      el("section", { class: "panel-telarana-seccion" }, encabezado(t("telarana.panel.terminaron")), listaDeTerminales()),
    ];
  }

  function panelDePagina(id) {
    const pagina = paginas.get(id);
    const estacion = distribucion.estaciones.find((cada) => cada.id === id);
    const finales = finalesPorPagina(tanda).get(id);
    const terminan = finales ? RESULTADOS.filter((r) => finales[r] > 0) : [];
    const pasaron = intentosPorPagina(tanda, id);
    const salidas = salidasDePagina(tanda, id);
    const variantes = pagina.variantes ?? [];
    const captura = urlDeCaptura(pagina.captura);
    const marca =
      estacion?.tipo === "inicio"
        ? t("telarana.panel.inicio")
        : estacion?.tipo === "hito"
          ? t("telarana.panel.hito", { n: estacion.hito + 1 })
          : null;
    return [
      el(
        "div",
        { class: "panel-telarana-cabecera" },
        el("div", {}, marca ? el("span", { class: "insignia insignia-acento", texto: marca }) : null, encabezado(nombre(pagina))),
        botonQuitar("telarana.panel.quitar", () => ctx.actualizarParametros({ pagina: null }), "telarana:panel:quitar"),
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
      terminan.length
        ? el(
            "section",
            { class: "panel-telarana-seccion" },
            encabezado(t("telarana.panel.terminanAqui")),
            el("ul", { class: "panel-telarana-terminales" }, terminan.map((r) => el("li", {}, insignia(r), el("span", { class: "num", texto: String(finales[r]) })))),
          )
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
    conservarFoco(panel, () => {
      if (estado.seleccion && paginas.has(estado.seleccion)) reemplazar(panel, panelDePagina(estado.seleccion));
      else reemplazar(panel, panelGeneral());
    });
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

    // pagina= (con los alias de páginas fusionadas)
    let pagina = parametros.pagina ?? null;
    if (pagina) {
      const canonica = tanda.telarana?.alias?.[pagina] ?? pagina;
      if (!paginas.has(canonica)) {
        estado.avisos.push(t("comun.estado.paginaNoExiste", { pagina }));
        return reescribir({ pagina: null });
      }
      if (canonica !== pagina) return reescribir({ pagina: canonica });
    }
    const nuevaSeleccion = pagina;
    const cambioDeSeleccion = nuevaSeleccion !== estado.seleccion;
    estado.seleccion = nuevaSeleccion;
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

  // ── Atajos de la pestaña (§7) ─────────────────────────────────────────
  ctx.atajos.registrar({
    "+": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => acercar() },
    "-": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => alejar() },
    0: { descripcion: () => t("comun.atajos.desc.ajustar"), accion: () => ajustar() },
    Escape: {
      descripcion: () => t("comun.atajos.desc.cerrar"),
      accion: () => {
        if (ocultarGlobo()) return;
        if (estado.seleccion) {
          const id = estado.seleccion;
          ctx.actualizarParametros({ pagina: null });
          estado.dibujo?.estaciones.get(id)?.focus({ preventScroll: true });
        }
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
        puedeArrastrar: (evento) => !evento.target.closest?.(".estacion, button, a, select"),
        alTocarFondo: () => {
          if (estado.seleccion) ctx.actualizarParametros({ pagina: null });
        },
      });
      // Primer dibujo con el ancho real; después, al cambiar de tamaño.
      alCambiarTamano();
      const observador = new ResizeObserver(() => alCambiarTamano());
      observador.observe(contenedor);
      senal.addEventListener("abort", () => observador.disconnect(), { once: true });
      aplicar(ctx.parametros);
      estado.montado = true;
    },
    actualizar(nuevo) {
      estado.ctx = nuevo;
      return aplicar(nuevo.parametros) !== false;
    },
    desmontar() {},
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
    pantalla?.desmontar();
    pantalla = null;
  },
};
