// Pestaña Telaraña (diseño §10.5): un grafo dirigido de izquierda a derecha, con el inicio a la izquierda, la meta a
// la derecha y las demás páginas en columnas según los pasos desde el inicio; la ruta recomendada es una fila recta.
// Panel de detalle, cámara (pan, zoom, ajuste) y modo historia ligado a Replay.
//
// El estado de la vista vive en el hash: pagina=, historia=, paso=. Los clics escriben parámetros con
// ctx.actualizarParametros y actualizar(ctx) los aplica: una sola fuente de verdad.

import { kbd } from "../nucleo/atajos.js";
import { conservarFoco, el, esUrlWeb, recortarAlMedio, reemplazar, svg } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { conGlobo, ocultarGlobo } from "../nucleo/globo.js";
import { icono, insignia, marcaDeSenal } from "../nucleo/iconos.js";
import { normalizarPaso } from "../nucleo/rutas.js";
import { nombreDePagina, textoDeAccion, textoDeFirma, textoDeTitular } from "../datos/textos.js";
import { altoDeFilaPara, altoDelLienzo, crearCamara, franjaConMasEstaciones, zoomLegible } from "../telarana/camara.js";
import {
  finalesPorPagina,
  hitosDeRuta,
  intentosPorPagina,
  recorridoDeHistoria,
  salidasDePagina,
  totalesDeTerminales,
  vecindario,
} from "../telarana/cuentas.js";
import { ALTO_FILA, RESULTADOS, distribuir, geometria } from "../telarana/distribuir.js";
import { atascosPorPagina } from "../telarana/atascos.js";
import { claseDeTramo, dibujarEscena } from "../telarana/escena.js";
import { crearHistoria } from "../telarana/historia.js";
import { etiquetasDeEstaciones } from "../telarana/nombres.js";
import { nombreConNivel } from "../datos/nombres.js";

const PASO_DE_PAN = 60;
/** Las acciones de una rama, las de la gente primero y los saltos del explorador al final. */
const accionesEnOrden = (rama) => [...(rama?.acciones ?? [])].sort((a, b) => Number(!!a.salto) - Number(!!b.salto));
const MARGEN_DE_FRANJA = 40; // px de escena sobre y bajo la franja encuadrada (el punto y la etiqueta)
const MARGEN_BAJO_EL_LIENZO = 16; // px entre la leyenda (o el lienzo) y el borde de abajo de la ventana
const reducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Holgura para las etiquetas fuera de la caja de la geometría (la mitad del nombre del inicio a la izquierda, debajo
// de las estaciones y a la derecha de las terminales).
const HOLGURA = { izquierda: 50, derecha: 180, abajo: 40 };
// Ajuste a la vista (en plano): el mapa entra a lo ancho (el inicio a la izquierda y la meta a la derecha) y las filas
// se estiran lo que pida el nombre de una estación con ese zoom, para que no se monte sobre el punto o la marca de
// atasco de la de abajo. Un mapa más alto que el lienzo agranda el lienzo (hasta el 80 % de la ventana) y, si aun así
// no cabe, se recorre arrastrando.

function crearPantalla(contenedor, ctx) {
  const { tanda, t, fmt, senal } = ctx;
  const paginas = new Map((tanda.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const ramas = new Map((tanda.telarana?.ramas ?? []).map((rama) => [rama.id, rama]));
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  const perfiles = (tanda.perfiles ?? []).map((perfil) => ({ id: perfil.perfil, nombre: perfil.nombre ?? perfil.perfil }));
  const nombreDePerfil = (id) => nombreConNivel(perfiles.find((perfil) => perfil.id === id)?.nombre ?? intentos.get(id)?.nombrePerfil ?? id, t);
  const nombre = (pagina) => nombreDePagina(pagina, t);
  // Lo que se ve en cada estación: si varias empiezan igual, lo que las distingue va adelante (telarana/nombres.js).
  const etiquetas = etiquetasDeEstaciones(tanda.telarana?.paginas ?? [], nombre, { primeras: tanda.telarana?.ruta?.paginas ?? [] });
  const distribucion = distribuir(tanda.telarana ?? {});
  const tramosExistentes = new Set(distribucion.tramos.map((tramo) => tramo.id));

  const estado = {
    seleccion: null,
    resaltado: null, // Set de ids resaltados por puntero o foco
    historiaId: null,
    historia: null,
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
  };
  const urlDeCaptura = (captura) => (captura?.archivo ? ctx.urlDeArchivo(captura.perfil, captura.archivo) : null);

  // ── Esqueleto de la vista ─────────────────────────────────────────────
  contenedor.classList.add("p-telarana");
  const titular = el("h2", { class: "telarana-titular", tabindex: "-1", "data-foco-inicial": "", texto: textoDeTitular(tanda.titulares?.telarana, tanda, t) });
  const zonaDeAvisos = el("div", { class: "telarana-avisos" });

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
  const herramientas = el(
    "div",
    { class: "telarana-herramientas", role: "toolbar", "aria-label": t("telarana.herramientas") },
    el("div", { class: "telarana-historia-control" }, botonDeHistoria, intentos.size ? selectorDeHistoria : null),
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
      : vacio({ titulo: t(tanda.arbol === "danado" ? "telarana.lienzo.arbolDanado" : tanda.arbol === "falta" ? "telarana.lienzo.arbolFalta" : "telarana.lienzo.vacio") }),
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
      // Las vueltas atrás y los pasos laterales, con las mismas clases que los tramos dibujados.
      ...["retroceso", "lateral"]
        .filter((tipo) => fuera.some((tramo) => tramo.tipo === tipo))
        .map((tipo) => [`tramo-${tipo} tramo-${claseDeTramo({ tipo })}`, tipo]),
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
        el("li", { class: "leyenda-columnas", texto: t("telarana.leyenda.columnas") }),
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
    estado.historia?.reubicar(estado.dibujo, estado.geo.posiciones);
  }

  function ajustar() {
    if (!camara || !estado.geo) return;
    const caja = cajaVisible();
    const legible = zoomLegible(estado.altoFila ?? ALTO_FILA);
    const encuadre = camara.encuadre(caja, { minimo: legible });
    // Si aun así no cabe (teléfonos, tandas grandes): se ve desde el inicio (a la izquierda) y a la altura de la ruta,
    // sin dejar vacío arriba ni abajo del mapa.
    const { clientWidth: ancho, clientHeight: alto } = lienzo;
    if (caja.ancho * encuadre.k > ancho) encuadre.tx = -caja.x * encuadre.k;
    if (caja.alto * encuadre.k > alto) {
      // La franja que deja dentro más estaciones (el inicio, la meta y las terminales valen por diez), sin vacío arriba ni
      // abajo del mapa.
      const arriba = -caja.y * encuadre.k;
      const abajo = alto - (caja.y + caja.alto) * encuadre.k;
      const ty = franjaConMasEstaciones(puntosParaEncuadrar(), alto / encuadre.k, MARGEN_DE_FRANJA);
      encuadre.ty = Math.min(arriba, Math.max(abajo, ty === null ? alto / 2 : ty * encuadre.k));
    }
    camara.poner(encuadre);
  }

  /** Alturas (px de escena) de las estaciones y terminales, con su peso para el encuadre. */
  function puntosParaEncuadrar() {
    const importantes = new Set([distribucion.tronco[0], distribucion.tronco.at(-1), ...distribucion.terminales.map((t) => t.id)]);
    return [...distribucion.estaciones, ...distribucion.terminales].map(({ id }) => ({ y: estado.geo.posiciones.get(id).y, peso: importantes.has(id) ? 10 : 1 }));
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

  /**
   * El lienzo llena lo que queda de la ventana bajo su borde de arriba (con la página sin desplazar), dejando lugar
   * debajo para la leyenda: sin ella no se leen los colores ni el grosor en la primera vista.
   */
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
    const zoom = zoomDelAncho();
    const altoFila = altoDeFilaPara(zoom, ALTO_FILA);
    const redibujar = primera || altoFila !== estado.altoFila || Math.abs(zoom - estado.zoomDelAncho) > 0.02;
    estado.altoFila = altoFila;
    estado.zoomDelAncho = zoom;
    if (redibujar) dibujar();
    ajustar();
    introducir();
    // Si el primer dibujo llegó después de aplicar los parámetros (ancho 0 al montar), se aplican de nuevo.
    if (primera && estado.montado) aplicar(estado.ctx.parametros);
  }

  // ── Aislamiento: resaltado > historia > elección ──────────────────────
  function aislar() {
    if (!estado.dibujo) return;
    let ids = null;
    if (estado.resaltado && !estado.historia) ids = estado.resaltado;
    else if (estado.historia) ids = estado.historiaIds;
    else if (estado.seleccion) ids = vecindario(distribucion, estado.seleccion);
    estado.dibujo.aislar(ids);
    // En la historia, las partículas de los demás intentos se apagan.
    for (const particula of escena.querySelectorAll(".particula")) {
      particula.classList.toggle("particula-fuera", !!estado.historiaId && particula.dataset.intento !== estado.historiaId);
    }
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
      if (estado.historia && (evento.key === "ArrowLeft" || evento.key === "ArrowRight")) return; // la historia manda
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

  // ── Historia ──────────────────────────────────────────────────────────
  function intentoPorDefecto() {
    const candidatos = [...intentos.values()];
    const elegido = candidatos.find((intento) => intento.id === selectorDeHistoria.value) ?? candidatos.find((intento) => intento.resultado !== "error") ?? candidatos[0];
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
              // Lo que distingue a la página adelante (como en su estación); el nombre completo, al pasar el puntero.
              el("span", { class: "truncar", title: nombre(pagina), texto: textos.etiqueta(pagina) }),
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
      // paso=0 es la pantalla inicial (enlaces de hitos): la historia la muestra en el paso 1, como Replay.
      if (total && parametros.paso === "0") return reescribir({ paso: "1" });
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
    h: { descripcion: () => t("comun.atajos.desc.historia"), accion: () => alternarHistoria() },
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
          if (estado.seleccion && !estado.historia) ctx.actualizarParametros({ pagina: null });
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
    desmontar() {
      detenerHistoria();
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
