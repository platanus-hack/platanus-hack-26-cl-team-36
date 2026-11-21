// Pestaña Telaraña (diseño §10.5): mapa de metro de izquierda a derecha con la ruta recomendada como tronco recto,
// filtro por perfil que atenúa (nunca saca), panel de detalle, cámara (pan, zoom, ajuste) y modo historia ligado a
// Replay. Bajo 720 px de ancho el metro se vuelve vertical y la página se desplaza con normalidad.
//
// El estado de la vista vive en el hash: perfil=, pagina=, historia=, paso=. Los clics escriben parámetros con
// ctx.actualizarParametros y actualizar(ctx) los aplica: una sola fuente de verdad.

import { kbd } from "../nucleo/atajos.js";
import { conservarFoco, el, recortarAlMedio, reemplazar, svg } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { conGlobo, ocultarGlobo } from "../nucleo/globo.js";
import { icono, insignia, marcaDeSenal } from "../nucleo/iconos.js";
import { normalizarPaso } from "../nucleo/rutas.js";
import { nombreDePagina, textoDeFirma, textoDeTitular } from "../datos/textos.js";
import { crearCamara } from "../telarana/camara.js";
import {
  activosDePerfil,
  finalesPorPagina,
  hitosDeRuta,
  intentosPorPagina,
  perfilVecino,
  recorridoDeHistoria,
  salidasDePagina,
  totalesDeTerminales,
  vecindario,
} from "../telarana/cuentas.js";
import { RESULTADOS, distribuir, geometria } from "../telarana/distribuir.js";
import { dibujarEscena } from "../telarana/escena.js";
import { crearHistoria } from "../telarana/historia.js";

const ANCHO_VERTICAL = 720;
const PASO_DE_PAN = 60;
const reducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Holgura para las etiquetas fuera de la caja de la geometría (debajo de las estaciones y a la derecha de las
// terminales en horizontal; a la derecha de todo en vertical).
const HOLGURA = {
  horizontal: { derecha: 120, abajo: 40 },
  vertical: { derecha: 200, abajo: 20 },
};

function crearPantalla(contenedor, ctx) {
  const { tanda, t, fmt, senal } = ctx;
  const paginas = new Map((tanda.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const ramas = new Map((tanda.telarana?.ramas ?? []).map((rama) => [rama.id, rama]));
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  const perfiles = (tanda.perfiles ?? []).map((perfil) => ({ id: perfil.perfil, nombre: perfil.nombre ?? perfil.perfil }));
  const nombreDePerfil = (id) => perfiles.find((perfil) => perfil.id === id)?.nombre ?? intentos.get(id)?.nombrePerfil ?? id;
  const nombre = (pagina) => nombreDePagina(pagina, t);
  const distribucion = distribuir(tanda.telarana ?? {});
  const tramosExistentes = new Set(distribucion.tramos.map((tramo) => tramo.id));

  const estado = {
    perfil: null,
    seleccion: null,
    resaltado: null, // Set de ids resaltados por puntero o foco
    historiaId: null,
    historia: null,
    orientacion: null,
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
    etiquetaDeResultado: (resultado) => t(`comun.resultado.${resultado}`),
    ariaDeTerminal: (resultado, n) => t("telarana.terminal.aria", { resultado: t(`comun.resultado.${resultado}`), n }),
  };
  const urlDeCaptura = (captura) => (captura?.archivo ? ctx.urlDeArchivo(captura.perfil, captura.archivo) : null);

  // ── Esqueleto de la vista ─────────────────────────────────────────────
  contenedor.classList.add("p-telarana");
  const titular = el("h2", { class: "telarana-titular", tabindex: "-1", "data-foco-inicial": "", texto: textoDeTitular(tanda.titulares?.telarana, tanda, t) });
  const zonaDeAvisos = el("div", { class: "telarana-avisos" });

  const chips = new Map();
  const chip = (id, texto) => {
    const boton = el("button", {
      type: "button",
      class: "chip",
      "aria-pressed": "false",
      "data-foco": `telarana:perfil:${id ?? "todos"}`,
      texto,
      onclick: () => ctx.actualizarParametros({ perfil: id }),
    });
    chips.set(id, boton);
    return boton;
  };
  const grupoDePerfiles = el(
    "div",
    { class: "telarana-perfiles", role: "group", "aria-label": t("telarana.perfiles.grupo") },
    chip(null, t("telarana.perfiles.todos")),
    perfiles.map((perfil) => chip(perfil.id, perfil.nombre)),
  );

  const selectorDeHistoria = el(
    "select",
    { class: "telarana-intento", "aria-label": t("telarana.historia.intento"), "data-foco": "telarana:historia:intento" },
    [...intentos.values()].map((intento) => el("option", { value: intento.id, texto: [intento.nombrePerfil ?? intento.id, t(`comun.resultado.${intento.resultado}`)].join(" · ") })),
  );
  selectorDeHistoria.addEventListener(
    "change",
    () => {
      if (estado.historiaId) ctx.actualizarParametros({ historia: selectorDeHistoria.value, paso: null, pagina: null });
    },
    { signal: senal },
  );
  const botonDeHistoria = el(
    "button",
    { type: "button", class: "boton boton-secundario telarana-boton-historia", "aria-pressed": "false", "aria-keyshortcuts": "h", "data-foco": "telarana:historia" },
    icono("historia"),
    el("span", { texto: t("telarana.historia.boton") }),
    el("span", { class: "telarana-pista", "aria-hidden": "true" }, kbd("h")),
  );
  botonDeHistoria.addEventListener("click", () => alternarHistoria(), { signal: senal });
  const botonDe3d = el(
    "button",
    { type: "button", class: "boton boton-secundario telarana-boton-3d", "aria-pressed": "false", "aria-keyshortcuts": "v", "data-foco": "telarana:vista3d" },
    icono("vista-3d"),
    el("span", { texto: t("telarana.vista3d.boton") }),
    el("span", { class: "telarana-pista", "aria-hidden": "true" }, kbd("v")),
  );
  botonDe3d.addEventListener("click", () => alternar3d(), { signal: senal });
  conGlobo(botonDe3d, () => el("span", { class: "globo-con-tecla" }, el("span", { texto: t("telarana.vista3d.ayuda") }), kbd("v")), { senal });
  const herramientas = el(
    "div",
    { class: "telarana-herramientas", role: "toolbar", "aria-label": t("telarana.herramientas") },
    grupoDePerfiles,
    el("div", { class: "telarana-historia-control" }, botonDeHistoria, intentos.size ? selectorDeHistoria : null, botonDe3d),
  );

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
    el("header", { class: "telarana-cabecera" }, titular, zonaDeAvisos, herramientas),
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
    const items = [
      ["tramo-tronco", distribucion.troncoEsRuta ? "ruta" : "eje"],
      ["tramo-exito", "exito"],
      ["tramo-mixto", "mixto"],
      ["tramo-fallo", "fallo"],
      ["tramo-abandono", "abandono"],
      ["tramo-error", "error"],
      ["tramo-retroceso tramo-exito", "retroceso"],
    ];
    return el(
      "div",
      { class: "telarana-leyenda" },
      el("span", { class: "visualmente-oculto", texto: t("telarana.leyenda.titulo") }),
      el(
        "ul",
        { "aria-label": t("telarana.leyenda.titulo") },
        items.map(([clases, clave]) => el("li", {}, muestra(clases), el("span", { texto: t(`telarana.leyenda.${clave}`) }))),
        el("li", { class: "leyenda-grosor", texto: t("telarana.leyenda.grosor") }),
      ),
    );
  }

  // ── Escena y cámara ───────────────────────────────────────────────────
  let camara = null;
  const tooltipDeEstacion = (pagina) => () =>
    el(
      "span",
      { class: "telarana-globo" },
      el("span", { class: "telarana-globo-titulo", texto: pagina.titulo || nombre(pagina) }),
      pagina.url ? el("span", { class: "mono telarana-globo-url", texto: recortarAlMedio(pagina.url, 80) }) : null,
    );

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
    for (const accion of rama?.acciones ?? []) filas.push(el("span", { class: "telarana-globo-accion" }, el("span", { texto: accion.accion }), el("span", { class: "num texto-3", texto: `×${accion.intentos}` })));
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
    const holgura = HOLGURA[estado.orientacion];
    // En 3D las capturas se paran sobre las estaciones: más lugar arriba y a los lados.
    if (camara?.inclinado) return { x: caja.x - 60, y: caja.y - 160, ancho: caja.ancho + holgura.derecha + 120, alto: caja.alto + 160 };
    return { x: caja.x, y: caja.y, ancho: caja.ancho + holgura.derecha, alto: caja.alto + holgura.abajo };
  }

  function dibujar() {
    estado.geo = geometria(distribucion, { orientacion: estado.orientacion, altoCapa: 100 });
    lienzo.dataset.orientacion = estado.orientacion;
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
    estado.dibujo.contarTerminales(totalesDeTerminales(finalesPorPagina(tanda, estado.perfil)));
    aislar();
    estado.historia?.reubicar(estado.dibujo, estado.geo.posiciones);
  }

  function ajustar() {
    if (!camara || !estado.geo) return;
    const caja = cajaVisible();
    if (estado.orientacion === "vertical") {
      // Vertical: el lienzo crece con el contenido (sin desplazamiento interno); el zoom solo cambia la escala.
      const ancho = lienzo.clientWidth;
      const k = Math.min(1.25, Math.max(0.35, ancho / caja.ancho));
      lienzo.style.setProperty("--alto-lienzo", `${Math.ceil(caja.alto * k)}px`);
      camara.poner({ k, tx: (ancho - caja.ancho * k) / 2 - caja.x * k, ty: -caja.y * k });
      return;
    }
    camara.ajustar(caja);
  }

  function acercar() {
    camara?.acercar();
    ajustarAltoVertical();
  }
  function alejar() {
    camara?.alejar();
    ajustarAltoVertical();
  }
  function ajustarAltoVertical() {
    if (estado.orientacion !== "vertical" || !camara) return;
    const { k } = camara.estado();
    const caja = cajaVisible();
    lienzo.style.setProperty("--alto-lienzo", `${Math.ceil(caja.alto * k)}px`);
    camara.poner({ ty: -caja.y * k });
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
    const orientacion = ancho < ANCHO_VERTICAL ? "vertical" : "horizontal";
    const cambio = orientacion !== estado.orientacion;
    if (!cambio && Math.abs(ancho - estado.ancho) < 2) return;
    estado.ancho = ancho;
    const primera = !estado.geo;
    if (cambio) {
      estado.orientacion = orientacion;
      dibujar();
      ponerVista3d(estado.ctx.parametros?.vista === "3d", { animar: false });
    }
    ajustar();
    introducir();
    // Si el primer dibujo llegó después de aplicar los parámetros (ancho 0 al montar), se aplican de nuevo.
    if (primera && estado.montado) aplicar(estado.ctx.parametros);
  }

  // ── Aislamiento: resaltado > historia > elección > perfil ─────────────
  function aislar() {
    if (!estado.dibujo) return;
    const limite = activosDePerfil(tanda, estado.perfil);
    let ids = limite;
    if (estado.resaltado && !estado.historia) ids = estado.resaltado;
    else if (estado.historia) ids = estado.historiaIds;
    else if (estado.seleccion) ids = vecindario(distribucion, estado.seleccion, limite);
    estado.dibujo.aislar(ids);
    // Las partículas de otros perfiles (o de otros intentos, en la historia) se apagan.
    for (const particula of escena.querySelectorAll(".particula")) {
      const intento = intentos.get(particula.dataset.intento);
      const fuera = estado.historiaId ? particula.dataset.intento !== estado.historiaId : !!estado.perfil && intento?.perfil !== estado.perfil;
      particula.classList.toggle("particula-fuera", fuera);
    }
  }

  function resaltar(objetivo) {
    const estacion = objetivo?.closest?.(".estacion");
    const tramo = objetivo?.closest?.(".tramo");
    let ids = null;
    const limite = activosDePerfil(tanda, estado.perfil);
    if (estacion) ids = vecindario(distribucion, estacion.dataset.pagina, limite);
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
      if (estado.historia && (evento.key === "ArrowLeft" || evento.key === "ArrowRight")) return; // la historia manda
      if (estado.orientacion === "vertical" && movimiento[1] !== 0) return; // en vertical la página se desplaza
      evento.preventDefault();
      camara.mover(...movimiento);
    },
    { signal: senal },
  );

  // ── Elegir una página ─────────────────────────────────────────────────
  function elegir(id) {
    if (estado.historia) {
      ctx.actualizarParametros({ historia: null, paso: null, pagina: id });
      return;
    }
    ctx.actualizarParametros({ pagina: estado.seleccion === id ? null : id });
  }

  // ── Vista 3D (§10.5.4): el mismo mapa inclinado, con las capturas de pie sobre cada estación ─────────────
  let relojDeVista = 0;
  function ponerVista3d(pedida, { animar = true } = {}) {
    const activa = pedida && estado.orientacion === "horizontal";
    botonDe3d.hidden = estado.orientacion === "vertical";
    botonDe3d.setAttribute("aria-pressed", String(activa));
    if (!camara || activa === camara.inclinado) return;
    if (animar && !reducido()) {
      lienzo.classList.add("cambiando-vista");
      clearTimeout(relojDeVista);
      relojDeVista = setTimeout(() => lienzo.classList.remove("cambiando-vista"), 650);
    }
    if (activa) lienzo.dataset.vista = "3d";
    else delete lienzo.dataset.vista;
    const { caja } = estado.geo ?? { caja: { x: 0, y: 0, ancho: 0, alto: 0 } };
    camara.inclinar(activa, { x: Math.round(caja.x + caja.ancho / 2), y: Math.round(caja.y + caja.alto / 2) });
    ajustar();
  }
  function alternar3d() {
    if (estado.orientacion === "vertical") return;
    ctx.actualizarParametros({ vista: camara?.inclinado ? null : "3d" });
  }

  // ── Historia ──────────────────────────────────────────────────────────
  function intentoPorDefecto() {
    const candidatos = [...intentos.values()];
    const delPerfil = estado.perfil ? candidatos.filter((intento) => intento.perfil === estado.perfil) : candidatos;
    const elegido = delPerfil.find((intento) => intento.id === selectorDeHistoria.value) ?? delPerfil.find((intento) => intento.resultado !== "error") ?? delPerfil[0];
    return elegido?.id ?? null;
  }

  function alternarHistoria() {
    if (estado.historiaId) ctx.actualizarParametros({ historia: null, paso: null });
    else {
      const id = intentoPorDefecto();
      if (id) ctx.actualizarParametros({ historia: id, paso: null, pagina: null });
    }
  }

  let quitarAtajosDeHistoria = null;
  function iniciarHistoria(id) {
    detenerHistoria();
    const intento = intentos.get(id);
    const recorrido = recorridoDeHistoria(intento, tramosExistentes);
    estado.historiaId = id;
    estado.historiaIds = recorrido.ids;
    estado.historia = crearHistoria({
      recorrido,
      pasosDelIntento: intento.pasos ?? [],
      dibujo: estado.dibujo,
      posiciones: estado.geo.posiciones,
      camara,
      reducido,
      alCambiar: (paso, { reproduciendo }) => {
        pintarPanel();
        const pagina = paginas.get(recorrido.pasos[paso - 1]?.pagina);
        ctx.anunciar(t("telarana.historia.anuncio", { nombre: intento.nombrePerfil ?? id, paso, total: recorrido.pasos.length, pagina: pagina ? nombre(pagina) : "" }));
        if (!reproduciendo) ctx.actualizarParametros({ paso: String(paso) });
      },
    });
    selectorDeHistoria.value = id;
    botonDeHistoria.setAttribute("aria-pressed", "true");
    quitarAtajosDeHistoria = ctx.atajos.registrar({
      Space: { descripcion: () => t("comun.atajos.desc.historiaPasos"), accion: () => { estado.historia?.alternar(); pintarPanel(); } },
      ArrowLeft: { descripcion: () => t("comun.atajos.desc.historiaPasos"), accion: () => estado.historia?.mover(-1) },
      ArrowRight: { descripcion: () => t("comun.atajos.desc.historiaPasos"), accion: () => estado.historia?.mover(1) },
    });
  }

  function detenerHistoria() {
    estado.historia?.destruir();
    estado.historia = null;
    estado.historiaId = null;
    estado.historiaIds = null;
    botonDeHistoria.setAttribute("aria-pressed", "false");
    quitarAtajosDeHistoria?.();
    quitarAtajosDeHistoria = null;
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
    const totales = totalesDeTerminales(finalesPorPagina(tanda, estado.perfil));
    const presentes = RESULTADOS.filter((r) => totales[r] > 0);
    if (!presentes.length) return el("p", { class: "texto-3", texto: t("telarana.panel.nadieTermino") });
    return el(
      "ul",
      { class: "panel-telarana-terminales" },
      presentes.map((r) => el("li", {}, insignia(r), el("span", { class: "num", texto: String(totales[r]) }))),
    );
  }

  function panelGeneral() {
    const hitos = new Map(hitosDeRuta(tanda, estado.perfil).map((hito) => [hito.pagina, hito]));
    return [
      el("p", { class: "panel-telarana-prompt", texto: t("telarana.panel.elegir") }),
      distribucion.troncoEsRuta ? null : avisoEnLinea(t("telarana.panel.sinRuta")),
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
    const finales = finalesPorPagina(tanda, estado.perfil).get(id);
    const terminan = finales ? RESULTADOS.filter((r) => finales[r] > 0) : [];
    const pasaron = intentosPorPagina(tanda, id, estado.perfil);
    const salidas = salidasDePagina(tanda, id, estado.perfil);
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
      pagina.url
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
                  el("span", { class: "panel-telarana-destino" }, icono("siguiente"), el("span", { texto: nombre(paginas.get(rama.destino)) }), el("span", { class: "num texto-3", texto: `×${rama.intentos}` })),
                  (rama.acciones ?? []).map((accion) => el("span", { class: "texto-3 panel-telarana-accion", texto: `${accion.accion} ×${accion.intentos}` })),
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
                el("li", {}, el("span", { class: "truncar", texto: intento.nombrePerfil ?? intento.id }), insignia(intento.resultado, { logro: intento.logro, compacta: true }), enlaceAReplay(intento, paso)),
              ),
            )
          : el("p", { class: "texto-3", texto: t("telarana.panel.nadiePaso") }),
      ),
    ];
  }

  function panelDeHistoria() {
    const intento = intentos.get(estado.historiaId);
    const historia = estado.historia;
    const numero = historia.paso;
    const paso = intento.pasos?.[numero - 1] ?? null;
    const control = (clave, nombreIcono, accion, extra = {}) => {
      const boton = el("button", { type: "button", class: "boton boton-icono", "aria-label": t(`telarana.historia.${clave}`), title: t(`telarana.historia.${clave}`), "data-foco": `telarana:historia:${clave}`, ...extra }, nombreIcono.map((n) => icono(n)));
      boton.addEventListener("click", accion);
      return boton;
    };
    const reproduciendo = historia.reproduciendo;
    const captura = paso?.captura ? ctx.urlDeArchivo(intento.id, paso.captura) : null;
    return [
      el(
        "div",
        { class: "panel-telarana-cabecera" },
        el("div", {}, encabezado(t("telarana.historia.titulo", { nombre: intento.nombrePerfil ?? intento.id })), historia.total ? el("p", { class: "texto-3 num", texto: t("telarana.historia.pasoDe", { paso: numero, total: historia.total }) }) : null),
        botonQuitar("telarana.historia.quitar", () => ctx.actualizarParametros({ historia: null, paso: null }), "telarana:historia:quitar"),
      ),
      intento.resultado === "error" ? avisoEnLinea(t("telarana.historia.error"), "atencion") : null,
      historia.total
        ? el(
            "div",
            { class: "panel-telarana-controles", role: "group", "aria-label": t("telarana.historia.controles") },
            control("primero", ["anterior", "anterior"], () => historia.extremo(false)),
            control("anterior", ["anterior"], () => historia.mover(-1)),
            control(reproduciendo ? "pausar" : "reproducir", [reproduciendo ? "pausar" : "reproducir"], () => {
              historia.alternar();
              pintarPanel();
            }, { "data-foco": "telarana:historia:reproducir", "aria-keyshortcuts": "Space" }),
            control("siguiente", ["siguiente"], () => historia.mover(1)),
            control("ultimo", ["siguiente", "siguiente"], () => historia.extremo(true)),
          )
        : el("p", { class: "texto-3", texto: t("telarana.historia.sinPasos") }),
      paso
        ? [
            el("p", { class: "panel-telarana-firma" }, el("span", { texto: textoDeFirma(paso.firma, t) }), (paso.senales ?? []).map((senal) => marcaDeSenal(senal, { compacta: false }))),
            captura
              ? el("img", { class: "panel-telarana-captura", src: captura, alt: t("telarana.historia.captura", { n: numero }) })
              : el("p", { class: "texto-3", texto: t("telarana.historia.sinCaptura") }),
            paso.expectativa
              ? el("div", { class: "panel-telarana-esperaba" }, el("span", { class: "etiqueta-micro", texto: t("telarana.historia.esperaba") }), el("p", { class: "prosa texto-2", texto: paso.expectativa }))
              : null,
            el(
              "a",
              { class: "boton boton-secundario panel-telarana-abrir", href: ctx.enlace("replay", { intento: intento.id, paso: numero }), "data-foco": "telarana:historia:replay" },
              el("span", { texto: t("telarana.historia.abrirEnReplay") }),
              icono("siguiente"),
            ),
          ]
        : null,
    ];
  }

  function pintarPanel() {
    if (!panel.isConnected) return;
    conservarFoco(panel, () => {
      if (estado.historia) reemplazar(panel, panelDeHistoria());
      else if (estado.seleccion && paginas.has(estado.seleccion)) reemplazar(panel, panelDePagina(estado.seleccion));
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
    const raiz = estado.profundidad === 0;
    if (raiz) estado.avisos = [];

    // perfil=
    let perfil = parametros.perfil ?? null;
    if (perfil && !perfiles.some((cada) => cada.id === perfil)) {
      estado.avisos.push(t("telarana.perfiles.noExiste", { perfil }));
      perfil = null;
      return reescribir({ perfil: null });
    }
    const cambioDePerfil = perfil !== estado.perfil;
    estado.perfil = perfil;
    for (const [id, boton] of chips) boton.setAttribute("aria-pressed", String(id === perfil));

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

    // historia= y paso=
    const pedida = parametros.historia ?? null;
    if (pedida && !intentos.has(pedida)) {
      const respaldo = intentoPorDefecto();
      estado.avisos.push(t("telarana.historia.noExiste", { intento: pedida, nombre: intentos.get(respaldo)?.nombrePerfil ?? respaldo ?? "" }));
      return reescribir({ historia: respaldo, paso: null });
    }
    if (pedida && estado.geo) {
      if (pedida !== estado.historiaId) iniciarHistoria(pedida);
      const total = estado.historia.total;
      if (total) {
        const { paso, aviso } = normalizarPaso(parametros.paso, total);
        if (aviso) {
          estado.avisos.push(t(aviso.clave, aviso.vars));
          return reescribir({ paso: String(paso) });
        }
        if (paso !== estado.historia.paso || !estado.historiaColocada) {
          // Al montar, el mapa ya está ajustado entero: la cámara no se mueve hasta que la historia avance.
          estado.historia.irA(paso, { conCamara: !!estado.montado });
          estado.historiaColocada = true;
        }
      }
    } else if (!pedida && estado.historiaId) {
      detenerHistoria();
      estado.historiaColocada = false;
    }
    if (!pedida) estado.historiaColocada = false;

    ponerVista3d(parametros.vista === "3d");
    if (estado.dibujo && cambioDePerfil) estado.dibujo.contarTerminales(totalesDeTerminales(finalesPorPagina(tanda, estado.perfil)));
    aislar();
    pintarPanel();
    reemplazar(zonaDeAvisos, estado.avisos.map((texto) => avisoEnLinea(texto, "atencion")));

    if (cambioDeSeleccion && estado.seleccion && camara && estado.geo) {
      const p = estado.geo.posiciones.get(estado.seleccion);
      if (p && !camara.esVisible(p.x, p.y)) camara.volarA(p.x, p.y);
      ctx.anunciar(t("telarana.panel.elegida", { nombre: nombre(paginas.get(estado.seleccion)) }));
    }
    if (cambioDePerfil && raiz && estado.dibujo) {
      ctx.anunciar(perfil ? t("telarana.perfiles.anuncio", { nombre: nombreDePerfil(perfil) }) : t("telarana.perfiles.anuncioTodos"));
    }
    return true;
  }

  // ── Atajos de la pestaña (§7) ─────────────────────────────────────────
  const cambiarPerfil = (dir) => ctx.actualizarParametros({ perfil: perfilVecino(perfiles.map((perfil) => perfil.id), estado.perfil, dir) });
  ctx.atajos.registrar({
    "+": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => acercar() },
    "=": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => acercar() },
    "-": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => alejar() },
    0: { descripcion: () => t("comun.atajos.desc.ajustar"), accion: () => ajustar() },
    p: { descripcion: () => t("comun.atajos.desc.perfil"), accion: () => cambiarPerfil(1) },
    "Shift+P": { descripcion: () => t("comun.atajos.desc.perfil"), accion: () => cambiarPerfil(-1) },
    h: { descripcion: () => t("comun.atajos.desc.historia"), accion: () => alternarHistoria() },
    v: { descripcion: () => t("comun.atajos.desc.vista3d"), accion: () => alternar3d() },
    Escape: {
      descripcion: () => t("comun.atajos.desc.cerrar"),
      accion: () => {
        if (ocultarGlobo()) return;
        if (estado.historiaId) ctx.actualizarParametros({ historia: null, paso: null });
        else if (estado.seleccion) {
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
      if (!distribucion.estaciones.length) {
        aplicar(ctx.parametros);
        return;
      }
      camara = crearCamara(lienzo, escena, {
        senal,
        reducido,
        puedeArrastrar: (evento) => !evento.target.closest?.(".estacion, button, a, select") && (estado.orientacion !== "vertical" || evento.pointerType === "mouse"),
        alTocarFondo: () => {
          if (estado.seleccion && !estado.historia) ctx.actualizarParametros({ pagina: null });
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
    desmontar() {
      detenerHistoria();
      clearTimeout(relojDeVista);
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
    pantalla?.desmontar();
    pantalla = null;
  },
};
