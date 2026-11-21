// Armazón (diseño §5.11, §10.1): barra lateral (escritorio), barra superior y cajón (móvil, < 820 px). La barra
// lateral tiene marca, buscador (abre la paleta), Corridas, tandas recientes con su estado, "Próximamente",
// atajos e idioma. Se redibuja al cambiar de idioma; al cambiar de ruta solo se actualiza aria-current.

import { abrirHojaDeAtajos, kbd } from "./atajos.js";
import { pedirTandas } from "./datos.js";
import { conservarFoco, el, reemplazar } from "./dom.js";
import { EVENTO_IDIOMA, IDIOMAS, cambiarIdioma, fmt, idioma, t } from "./i18n.js";
import { icono } from "./iconos.js";
import { abrirPaleta } from "./paleta.js";
import { enlaceATanda } from "./rutas.js";

const RECIENTES = 6;
const ESCRITORIO = "(min-width: 820px)";

let lateral = null;
let barra = null;
let cajon = null;
let tandas = [];
let rutaActual = null;

/** Estado de una tanda para la barra lateral, con respaldo para la forma anterior de la API. */
export function estadoDeTanda(resumen) {
  const intentos = typeof resumen.intentos === "number" ? resumen.intentos : 0;
  const errores = resumen.errores ?? 0;
  const validos = resumen.validos ?? intentos - errores;
  const logrados = resumen.logrados ?? resumen.exitos ?? 0;
  const tipo = validos === 0 ? "error" : validos > logrados ? "fallido" : errores ? "error" : "logrado";
  return { tipo, intentos, errores, validos, logrados };
}

const ICONO_DE_ESTADO = { logrado: "logrado", fallido: "fallido", error: "error-herramienta" };

function marca() {
  return el(
    "a",
    { class: "marca", href: "#/", "data-foco": "shell:marca" },
    icono("marca", { clase: "marca-icono" }),
    el("span", { class: "marca-nombre", texto: t("comun.marca.nombre") }),
    el("span", { class: "marca-producto", texto: t("comun.marca.producto") }),
  );
}

function selectorDeIdioma() {
  return el(
    "div",
    { class: "lateral-idioma" },
    el("span", { class: "etiqueta-micro", texto: t("comun.shell.idioma") }),
    el(
      "div",
      { class: "segmentado", role: "group", "aria-label": t("comun.shell.idioma") },
      IDIOMAS.map((codigo) =>
        el("button", {
          type: "button",
          lang: codigo,
          "aria-pressed": codigo === idioma() ? "true" : "false",
          "aria-label": t(`comun.idioma.${codigo}`),
          "data-foco": `shell:idioma:${codigo}`,
          texto: codigo.toUpperCase(),
          onclick: () => cambiarIdioma(codigo),
        }),
      ),
    ),
  );
}

function listaDeRecientes() {
  if (!tandas.length) return el("p", { class: "lateral-vacio texto-3", texto: t("comun.shell.sinTandas") });
  return el(
    "ul",
    { class: "lateral-recientes" },
    tandas.slice(0, RECIENTES).map((resumen) => {
      const estado = estadoDeTanda(resumen);
      const fecha = resumen.fechaIso ?? resumen.fecha;
      return el(
        "li",
        {},
        el(
          "a",
          { class: "lateral-tanda", href: enlaceATanda(resumen.id), "data-tanda": resumen.id, "data-foco": `shell:tanda:${resumen.id}`, title: resumen.instruccion ?? null },
          el(
            "span",
            { class: `lateral-tanda-estado estado-${estado.tipo}`, role: "img", "aria-label": t("comun.shell.estadoTanda", estado) },
            icono(ICONO_DE_ESTADO[estado.tipo]),
          ),
          el("span", { class: "lateral-tanda-nombre truncar", texto: resumen.tarea ?? resumen.host ?? resumen.id }),
          el("span", { class: "lateral-tanda-fecha", title: fmt.fechaLegible(fecha), texto: fmt.tiempoRelativo(fecha) }),
        ),
      );
    }),
  );
}

function proximamente() {
  return el(
    "details",
    { class: "lateral-proximamente" },
    el("summary", { class: "lateral-enlace" }, icono("proximamente"), el("span", { texto: t("comun.proximamente.titulo") })),
    el(
      "ul",
      {},
      el("li", {}, el("span", { texto: t("comun.proximamente.gatillar") }), " ", el("code", { texto: 'just local explore <url> "<tarea>"' })),
      el("li", { texto: t("comun.proximamente.inventario") }),
      el("li", { texto: t("comun.proximamente.happyPath") }),
      el("li", { texto: t("comun.proximamente.propuestas") }),
    ),
  );
}

/** Contenido de la barra lateral (también va dentro del cajón móvil). */
function contenidoLateral({ enCajon = false } = {}) {
  return [
    el(
      "div",
      { class: "lateral-cabecera" },
      marca(),
      enCajon
        ? el("button", { type: "button", class: "boton boton-icono", "aria-label": t("comun.shell.cerrarMenu"), onclick: () => cajon.close() }, icono("cerrar"))
        : null,
    ),
    el(
      "button",
      { type: "button", class: "lateral-buscar", "data-foco": "shell:buscar", "aria-label": t("comun.shell.abrirBuscador"), onclick: () => abrirPaleta() },
      icono("buscar"),
      el("span", { class: "lateral-buscar-texto", texto: t("comun.shell.buscar") }),
      kbd("Mod+k"),
    ),
    el(
      "nav",
      { class: "lateral-nav", "aria-label": t("comun.shell.navegacion") },
      el(
        "ul",
        {},
        el(
          "li",
          {},
          el(
            "a",
            { class: "lateral-enlace lateral-corridas", href: "#/", "data-foco": "shell:corridas" },
            icono("corridas"),
            el("span", { texto: t("comun.shell.corridas") }),
            el(
              "span",
              { class: "lateral-cuenta" },
              el("span", { "aria-hidden": "true", texto: String(tandas.length) }),
              el("span", { class: "visualmente-oculto", texto: t("comun.shell.cuentaTandas", { n: tandas.length }) }),
            ),
          ),
        ),
      ),
      el("h2", { class: "etiqueta-micro lateral-subtitulo", texto: t("comun.shell.tandasRecientes") }),
      listaDeRecientes(),
    ),
    el(
      "div",
      { class: "lateral-pie" },
      proximamente(),
      el(
        "button",
        { type: "button", class: "lateral-enlace", "data-foco": "shell:atajos", onclick: () => abrirHojaDeAtajos() },
        icono("teclado"),
        el("span", { texto: t("comun.shell.atajos") }),
        kbd("?"),
      ),
      selectorDeIdioma(),
    ),
  ];
}

function barraSuperior() {
  return [
    el(
      "button",
      {
        type: "button",
        class: "boton boton-icono",
        "aria-label": t("comun.shell.abrirMenu"),
        "aria-haspopup": "dialog",
        "aria-controls": "cajon",
        "data-foco": "shell:menu",
        onclick: abrirCajon,
      },
      icono("menu"),
    ),
    marca(),
    el("button", { type: "button", class: "boton boton-icono", "aria-label": t("comun.shell.abrirBuscador"), "data-foco": "shell:buscar-movil", onclick: () => abrirPaleta() }, icono("buscar")),
  ];
}

function abrirCajon() {
  reemplazar(cajon, el("div", { class: "cajon-contenido" }, contenidoLateral({ enCajon: true })));
  marcarActual(cajon);
  cajon.showModal();
  (cajon.querySelector('[aria-current="page"]') ?? cajon.querySelector("a, button"))?.focus();
}

function marcarActual(contenedor) {
  if (!contenedor) return;
  const enCorridas = rutaActual?.tipo === "corridas";
  contenedor.querySelectorAll(".lateral-corridas").forEach((enlace) => {
    if (enCorridas) enlace.setAttribute("aria-current", "page");
    else enlace.removeAttribute("aria-current");
  });
  contenedor.querySelectorAll(".lateral-tanda").forEach((enlace) => {
    if (rutaActual?.tipo === "tanda" && enlace.dataset.tanda === rutaActual.tandaId) enlace.setAttribute("aria-current", "page");
    else enlace.removeAttribute("aria-current");
  });
}

function dibujar() {
  const saltar = document.querySelector(".saltar");
  if (saltar) saltar.textContent = t("comun.shell.saltar");
  conservarFoco(lateral, () => reemplazar(lateral, contenidoLateral()));
  conservarFoco(barra, () => reemplazar(barra, barraSuperior()));
  if (cajon.open) conservarFoco(cajon, () => reemplazar(cajon, el("div", { class: "cajon-contenido" }, contenidoLateral({ enCajon: true }))));
  for (const contenedor of [lateral, cajon]) marcarActual(contenedor);
}

/** Arma el armazón sobre #lateral, #barra-superior y #cajon de index.html. */
export function iniciarShell() {
  lateral = document.getElementById("lateral");
  barra = document.getElementById("barra-superior");
  cajon = document.getElementById("cajon");
  lateral.setAttribute("aria-label", t("comun.shell.navegacion"));

  // Saltar al contenido: un botón (un enlace #contenido rompería el enrutador por hash).
  if (!document.querySelector(".saltar")) {
    document.body.prepend(
      el("button", {
        type: "button",
        class: "saltar",
        onclick: () => document.getElementById("contenido")?.focus(),
      }),
    );
  }

  cajon.addEventListener("click", (evento) => {
    if (evento.target === cajon) cajon.close();
    else if (evento.target instanceof Element && evento.target.closest("a[href]")) cajon.close();
  });
  matchMedia(ESCRITORIO).addEventListener("change", (consulta) => consulta.matches && cajon.open && cajon.close());

  addEventListener(EVENTO_IDIOMA, () => {
    lateral.setAttribute("aria-label", t("comun.shell.navegacion"));
    dibujar();
  });
  addEventListener("backoffice:ruta", (evento) => {
    rutaActual = evento.detail;
    for (const contenedor of [lateral, cajon]) marcarActual(contenedor);
  });

  dibujar();
  pedirTandas()
    .then((datos) => {
      tandas = datos.tandas;
      dibujar();
    })
    .catch(() => {});
}

/** Tandas que conoce el armazón (para la paleta). */
export function tandasDelShell() {
  return tandas;
}
