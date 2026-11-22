// Marco de una tanda, dentro de su hoja: una sola fila con «← <origen>», la tarea, el sitio y cuántos llegan, las
// pestañas (enlaces, no pestañas ARIA) y el menú ⋯ con la fecha y Copiar enlace; debajo, el panel de la pestaña.
// Se arma al instante con lo que dice el id (la tarea y el sitio) y un esqueleto; ponerTanda() completa el resto.
// Los atajos (1–3, c, Esc) van solo en el globo de cada botón.

import { kbd, registrarAtajos } from "./atajos.js";
import { copiarEnlace } from "./avisos.js";
import { partesDeTanda } from "./almacen.js";
import { EVENTO_PROPUESTA, pedirPropuesta } from "./datos.js";
import { el, esUrlWeb, reemplazar } from "./dom.js";
import { esqueleto } from "./estados.js";
import { conGlobo, ocultarGlobo } from "./globo.js";
import { fmt, t } from "./i18n.js";
import { icono } from "./iconos.js";
import { NOMBRES_DE_PESTANA, PESTANAS, enlaceATanda, parametrosQueSiguen } from "./rutas.js";
import { limpiarTitulos } from "../tanda/titulos.js";

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Cifras de la tanda con respaldo para la forma anterior de la API. */
function cifras(tanda) {
  const kpis = tanda.kpis ?? {};
  const intentos = kpis.intentos ?? tanda.intentos?.length ?? 0;
  const validos = kpis.validos ?? intentos - (kpis.errores ?? 0);
  // Los «sin medir» son válidos pero no cuentan en «llegan n de m».
  const medidos = kpis.medidos ?? validos;
  const logrados = kpis.logrados ?? kpis.exitos ?? 0;
  return { validos, medidos, logrados };
}

function insigniaDeLlegan({ logrados, validos, medidos }) {
  if (!validos) return el("span", { class: "insignia insignia-neutro" }, icono("abandonado"), el("span", { texto: t("comun.marco.ningunoValido") }));
  if (!medidos) return el("span", { class: "insignia insignia-sin_medir" }, icono("sin-medir"), el("span", { texto: t("comun.marco.sinMedir") }));
  const todos = logrados === medidos;
  return el(
    "span",
    {
      class: `insignia ${todos ? "insignia-logrado" : "insignia-fallido"}`,
      title: medidos < validos ? t("comun.marco.algunosSinMedir", { n: validos - medidos }) : null,
    },
    icono(todos ? "logrado" : "fallido"),
    el("span", { texto: t("comun.marco.llegan", { n: logrados, de: medidos }) }),
  );
}

/** Contenido de un globo: descripción + tecla. */
const globoConTecla = (descripcion, tecla) => () => el("span", { class: "globo-con-tecla" }, el("span", { texto: descripcion }), kbd(tecla));

function sitioDe(tanda) {
  const host = tanda.host ?? null;
  if (!tanda.url || !esUrlWeb(tanda.url)) return host ? el("span", { class: "marco-sitio", texto: host }) : null;
  return el(
    "a",
    { class: "marco-sitio", href: tanda.url, target: "_blank", rel: "noreferrer noopener", title: t("comun.marco.abrirSitio", { host: host ?? tanda.url }) },
    el("span", { texto: host ?? tanda.url }),
    icono("enlace-externo"),
  );
}

/** El menú ⋯: la fecha de la corrida y Copiar enlace. Se cierra al elegir, con Esc o al hacer clic afuera. */
function crearMenu(senal) {
  const fecha = el("p", { class: "marco-menu-fecha" });
  const copiar = el(
    "button",
    { type: "button", class: "marco-menu-item", role: "menuitem", "aria-keyshortcuts": "c", "data-foco": "marco:copiar" },
    icono("copiar"),
    el("span", { texto: t("comun.marco.copiarEnlace") }),
  );
  const menu = el("div", { class: "marco-menu", role: "menu", hidden: true }, fecha, copiar);
  const boton = el(
    "button",
    { type: "button", class: "boton boton-icono marco-mas", "aria-label": t("comun.marco.mas"), "aria-haspopup": "menu", "aria-expanded": "false", "data-foco": "marco:mas" },
    icono("mas"),
  );
  const abierto = () => !menu.hidden;
  const cerrar = (devolverFoco = false) => {
    if (!abierto()) return false;
    menu.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    if (devolverFoco) boton.focus({ preventScroll: true });
    return true;
  };
  const abrir = () => {
    menu.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    copiar.focus({ preventScroll: true });
  };
  boton.addEventListener("click", () => (abierto() ? cerrar() : abrir()), { signal: senal });
  copiar.addEventListener("click", () => {
    cerrar(true);
    copiarEnlace();
  }, { signal: senal });
  document.addEventListener("pointerdown", (evento) => abierto() && !menu.contains(evento.target) && !boton.contains(evento.target) && cerrar(), { signal: senal });
  conGlobo(copiar, globoConTecla(t("comun.atajos.desc.copiarEnlace"), "c"), { senal });
  return {
    nodo: el("div", { class: "marco-menu-ancla" }, boton, menu),
    cerrar,
    ponerFecha(texto, iso) {
      reemplazar(fecha, texto ? el("time", { datetime: iso ?? null, texto }) : null);
      fecha.hidden = !texto;
    },
  };
}

/** El subrayado de la pestaña actual se desliza a la elegida (180 ms); la primera vez se pone sin animar. */
function crearSubrayado(nav, senal) {
  const barra = el("span", { class: "pestanas-subrayado", "aria-hidden": "true" });
  nav.append(barra);
  let puesto = false;
  const mover = () => {
    const actual = nav.querySelector('.pestana[aria-current="page"]');
    if (!actual || !actual.offsetWidth) return;
    const inicio = actual.offsetLeft + 12;
    const ancho = Math.max(0, actual.offsetWidth - 24);
    barra.classList.toggle("pestanas-subrayado-animado", puesto && !movimientoReducido());
    barra.style.setProperty("--x", `${inicio}px`);
    barra.style.setProperty("--ancho", `${ancho}px`);
    puesto = true;
  };
  const observador = new ResizeObserver(() => {
    puesto = false;
    mover();
  });
  observador.observe(nav);
  senal.addEventListener("abort", () => observador.disconnect(), { once: true });
  return mover;
}

/**
 * Arma el marco. → { raiz, panel, ponerTanda(tanda), actualizar(ruta), cerrarMenu(), desmontar() }.
 * @param {{ tandaId: string, ruta: object, navegar: (hash: string) => void,
 *           volver: { clave: string, hash: string }, alVolver?: () => void, escapar: () => boolean }} opciones
 *   alVolver: cierra la hoja (← y Esc); escapar: lo que hace Esc antes de cerrarla (la pantalla suelta su selección);
 *   true si lo usó.
 */
export function montarMarco({ tandaId, ruta, navegar, volver, alVolver = () => navegar(volver.hash), escapar = () => false }) {
  const partes = partesDeTanda(tandaId) ?? { host: null, objetivo: tandaId };
  const controlador = new AbortController();
  const senal = controlador.signal;
  let tanda = null;
  let rutaActual = ruta;

  const titulo = el("h1", { id: "marco-titulo", class: "marco-titulo truncar", tabindex: "-1", texto: partes.objetivo });
  const sitio = el("span", { class: "marco-hueco" }, partes.host ? el("span", { class: "marco-sitio", texto: partes.host }) : null);
  const insignia = el("span", { class: "marco-hueco" }, el("span", { class: "esqueleto marco-insignia-esqueleto", "aria-hidden": "true" }));

  const etiquetaDeVolver = t("comun.marco.origen." + volver.clave);
  const botonVolver = el(
    "a",
    { class: "boton boton-secundario marco-volver", href: volver.hash, "data-foco": "marco:volver", "aria-label": t("comun.marco.volver", { origen: etiquetaDeVolver }), "aria-keyshortcuts": "Escape" },
    icono("anterior"),
    el("span", { texto: etiquetaDeVolver }),
  );
  botonVolver.addEventListener("click", (evento) => {
    if (evento.button || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    evento.preventDefault();
    alVolver();
  }, { signal: senal });
  conGlobo(botonVolver, globoConTecla(t("comun.marco.volver", { origen: etiquetaDeVolver }), "Escape"), { senal });

  const enlacesDePestana = new Map(
    PESTANAS.map((pestana, indice) => {
      const enlace = el(
        "a",
        { class: "pestana", href: enlaceATanda(tandaId, pestana), "data-foco": `marco:pestana:${pestana}`, "aria-keyshortcuts": String(indice + 1) },
        el("span", { texto: t(NOMBRES_DE_PESTANA[pestana]) }),
        pestana === "propuesta" ? el("span", { class: "pestana-punto", "aria-hidden": "true" }) : null,
      );
      conGlobo(enlace, globoConTecla(t(NOMBRES_DE_PESTANA[pestana]), String(indice + 1)), { senal });
      return [pestana, enlace];
    }),
  );
  const nav = el("nav", { class: "pestanas", "aria-label": t("comun.marco.vistas") }, el("ul", {}, [...enlacesDePestana.values()].map((enlace) => el("li", {}, enlace))));
  const moverSubrayado = crearSubrayado(nav, senal);
  const menu = crearMenu(senal);

  const panel = el("section", { id: "panel-tanda", class: "panel-tanda", tabindex: "-1" }, esqueleto("hoja"));
  const raiz = el(
    "div",
    { class: "marco-tanda" },
    el("header", { class: "marco-cabecera" }, botonVolver, el("div", { class: "marco-identidad" }, titulo, sitio, insignia), nav, menu.nodo),
    panel,
  );

  // La pestaña Propuesta late mientras el Diseñador diseña: lo dice el primer pedido y, después, la propia pantalla.
  const ponerEstadoDePropuesta = (estado) => enlacesDePestana.get("propuesta")?.classList.toggle("pestana-en-curso", estado === "running");
  document.addEventListener(EVENTO_PROPUESTA, (evento) => evento.detail?.tandaId === tandaId && ponerEstadoDePropuesta(evento.detail.estado), { signal: senal });

  function actualizar(nuevaRuta) {
    const enfocada = document.activeElement?.classList?.contains("pestana") && raiz.contains(document.activeElement);
    rutaActual = nuevaRuta;
    const siguen = parametrosQueSiguen(nuevaRuta.parametros);
    for (const [pestana, enlace] of enlacesDePestana) {
      enlace.setAttribute("href", enlaceATanda(tandaId, pestana, siguen));
      if (pestana === nuevaRuta.pestana) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
    }
    panel.setAttribute("aria-label", t(NOMBRES_DE_PESTANA[nuevaRuta.pestana]));
    if (enfocada) enlacesDePestana.get(nuevaRuta.pestana)?.focus({ preventScroll: true });
    requestAnimationFrame(moverSubrayado);
  }
  actualizar(ruta);

  function ponerTanda(datos) {
    tanda = limpiarTitulos(datos);
    titulo.textContent = tanda.tarea ?? tanda.host ?? partes.objetivo;
    titulo.title = tanda.instruccion || titulo.textContent;
    reemplazar(sitio, sitioDe(tanda));
    reemplazar(insignia, insigniaDeLlegan(cifras(tanda)));
    const fecha = tanda.fechaIso ?? tanda.fecha;
    menu.ponerFecha(fecha ? t("comun.marco.corrida", { fecha: fmt.fechaLegible(fecha) }) : null, tanda.fechaIso ?? null);
    pedirPropuesta(tanda.id)
      .then((propuesta) => !senal.aborted && ponerEstadoDePropuesta(propuesta?.estado))
      .catch(() => {});
  }

  const atajos = {
    c: { descripcion: t("comun.atajos.desc.copiarEnlace"), accion: () => copiarEnlace() },
    Escape: {
      descripcion: t("comun.atajos.desc.cerrarTanda"),
      accion: () => {
        if (menu.cerrar(true) || ocultarGlobo() || escapar()) return;
        alVolver();
      },
    },
  };
  // Una fila en la hoja de atajos con los nombres de las pestañas («1 / 2 / 3: Mapa · Replay · Propuesta»).
  const nombresDePestanas = () => PESTANAS.map((pestana) => t(NOMBRES_DE_PESTANA[pestana])).join(" · ");
  PESTANAS.forEach((pestana, indice) => {
    atajos[String(indice + 1)] = { descripcion: nombresDePestanas, accion: () => navegar(enlaceATanda(tandaId, pestana, parametrosQueSiguen(rutaActual.parametros))) };
  });
  const quitarAtajos = registrarAtajos(atajos, { ambito: "pantalla", grupo: "tanda" });

  return {
    raiz,
    panel,
    titulo,
    ponerTanda,
    actualizar,
    desmontar() {
      controlador.abort();
      quitarAtajos();
    },
  };
}
