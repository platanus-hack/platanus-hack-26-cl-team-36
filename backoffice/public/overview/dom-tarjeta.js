// Una tarjeta de revisión del Overview (spec §3.5): barra de navegador, captura (según el dispositivo), nombre con
// la marca y los cuadritos de agentes, las 4 etapas, los medidores por goal (o el motivo) y el pie (con cuántas
// revisiones anteriores de la página reemplazó, que llevan al historial).
//
// Enlaces (contrato §6.5, §7.1): la tarjeta entera lleva a la telaraña del primer goal con tanda; si no hay, a la de
// la tanda de su captura; solo si tampoco hay, al avance de la revisión. Cada fila de goal con tanda lleva a la suya.
// Un <a> no puede contener otros, así que va el patrón de enlace estirado: el nombre del sitio es el enlace principal
// y su ::after cubre la tarjeta; lo que tiene su propio enlace o un globo (etapas, cuadritos, goals, motivo, tiempo)
// queda encima, y un clic ahí que no es en un enlace sigue al principal. El foco del principal se ve en toda la
// tarjeta.
//
// Se reconcilia por partes: cada parte tiene su firma y solo se rehace la que cambió (al refrescar suele ser el
// tiempo del pie), así no se reinician la línea de escaneo ni los pulsos. Los <img> de la captura son siempre los
// mismos mientras su src no cambie (ver overview/capturas.js).

import { el } from "../nucleo/dom.js";
import { icono24 } from "../nucleo/iconos.js";
import { enlaceARevisiones, enlaceATanda } from "../nucleo/rutas.js";
import { inicial } from "./marca.js";
import { cifra, etiquetaDeTarjeta, textoDeAviso, textoDeTiempo } from "./textos.js";

const ICONO_DE_ETAPA = { catalog: "catalogo", guide: "ruta", visitor: "visitantes", improver: "tema" };

function barra(modelo) {
  return el(
    "div",
    { class: "ov-barra", "aria-hidden": "true" },
    el("span", { class: "ov-barra-punto" }),
    el("span", { class: "ov-barra-punto" }),
    el("span", { class: "ov-barra-punto" }),
    el(
      "span",
      { class: "ov-url" },
      icono24("candado", { tamano: 10, trazo: 2.4 }),
      el("span", { class: "ov-url-texto" }, modelo.host, el("span", { class: "ov-url-ruta", texto: modelo.ruta })),
    ),
  );
}

function pildora(modelo, t) {
  return el("span", { class: "ov-pildora" }, el("span", { class: "ov-pildora-punto", "aria-hidden": "true" }), t(`overview.estado.${modelo.estado}`));
}

const marcador = () => el("span", { class: "ov-marcador", "aria-hidden": "true" });

/**
 * La captura según el filtro: All = escritorio con el teléfono asomando; Desktop = solo escritorio; Mobile = el
 * teléfono al centro sobre la captura de escritorio desenfocada. Reutiliza los <img> de `registro.imagenes`.
 */
function captura(modelo, registro, { t, imagenes, src }) {
  const modo = modelo.dispositivo;
  const usar = (previa, ruta, opciones) => {
    if (previa && ruta && previa.getAttribute("src") === ruta) {
      previa.alt = opciones.alt;
      return previa;
    }
    imagenes.soltar(previa);
    return ruta ? imagenes.tomar(ruta, opciones) : null;
  };
  const srcEscritorio = src(modelo.capturas.desktop);
  const srcMovil = modo === "desktop" ? null : src(modelo.capturas.mobile);
  const escritorio = usar(registro.imagenes.escritorio, srcEscritorio, {
    alt: modo === "mobile" ? "" : t("overview.tarjeta.capturaEscritorio", { sitio: modelo.sitio }),
    color: true,
  });
  const movil = usar(registro.imagenes.movil, srcMovil, { alt: t("overview.tarjeta.capturaMovil", { sitio: modelo.sitio }) });
  escritorio?.setAttribute("class", "ov-img-escritorio");
  movil?.setAttribute("class", "ov-img-movil");
  registro.imagenes = { escritorio, movil };
  return el(
    "div",
    { class: `ov-captura ov-captura-${modo}` },
    escritorio ?? (modo === "mobile" ? null : marcador()),
    modo === "desktop" ? null : el("span", { class: "ov-telefono" }, movil ?? marcador()),
    pildora(modelo, t),
  );
}

function nombre(modelo, { t, fmt }) {
  const { estados, n } = modelo.cuadritos;
  return el(
    "div",
    { class: "ov-nombre" },
    el("span", { class: "ov-marca", "aria-hidden": "true", texto: inicial(modelo.sitio, modelo.host) }),
    // href y aria-label los pone actualizarTarjeta (cambian sin rehacer la parte).
    el("a", { class: "ov-sitio ov-tarjeta-enlace", "data-foco": `overview:tarjeta:${modelo.key}`, texto: modelo.sitio }),
    el(
      "span",
      { class: "ov-agentes-tarjeta", title: t("overview.tarjeta.agentes", { n, cifra: cifra(n, fmt) }) },
      estados.length ? el("span", { class: "ov-cuadritos-tarjeta", "aria-hidden": "true" }, estados.map((estado) => el("span", { class: `ov-q ov-q-${estado}` }))) : null,
      el("span", { class: "ov-agentes-cifra", texto: cifra(n, fmt) }),
    ),
  );
}

function etapas(modelo, t) {
  return el(
    "div",
    { class: "ov-etapas" },
    modelo.etapas.map((etapa) => [
      etapa.linea ? el("span", { class: `ov-etapa-linea ov-linea-${etapa.linea}`, "aria-hidden": "true" }) : null,
      el(
        "span",
        { class: `ov-etapa ov-etapa-${etapa.estado}`, title: t(`overview.etapa.${etapa.fase}`) },
        icono24(etapa.estado === "fallido" ? "cruz" : ICONO_DE_ETAPA[etapa.fase], { tamano: 14, trazo: 2 }),
      ),
    ]),
  );
}

function goals(modelo, t) {
  const { visibles, mas } = modelo.medidores;
  const aviso = modelo.aviso;
  const fila = (medidor, ...hijos) =>
    medidor.tanda
      ? el(
          "li",
          {},
          el(
            "a",
            { class: "ov-goal ov-goal-enlace", href: enlaceATanda(medidor.tanda), title: medidor.instruccion, "data-foco": `overview:goal:${modelo.key}:${medidor.goal}` },
            hijos,
          ),
        )
      : el("li", {}, el("div", { class: "ov-goal", title: medidor.instruccion }, hijos));
  return el(
    "ul",
    { class: "ov-goals" },
    visibles.map((medidor) =>
      fila(
        medidor,
        el("span", { class: "ov-goal-texto", texto: medidor.instruccion }),
        el(
          "span",
          { class: "ov-medidor", "aria-hidden": "true" },
          medidor.tramos.length
            ? medidor.tramos.map((tramo) => el("span", { class: `ov-tramo ov-tramo-${tramo}` }))
            : el("span", { class: "ov-tramo ov-tramo-vacio" }),
        ),
        el("span", { class: `ov-goal-cifra ov-tono-${medidor.tono}`, texto: medidor.texto }),
      ),
    ),
    mas ? el("li", { class: "ov-goal-mas", texto: t("overview.tarjeta.masGoals", { n: mas }) }) : null,
    aviso
      ? el(
          "li",
          { class: `ov-aviso ov-tono-${aviso.tono}`, title: aviso.detalle || null },
          icono24(aviso.tipo === "sin_avance" ? "reloj" : "alerta", { tamano: 14, trazo: 2 }),
          el("span", { texto: textoDeAviso(aviso, t) }),
        )
      : null,
  );
}

function pie(modelo, { t, fmt }) {
  const tiempo = textoDeTiempo(modelo.tiempo, { t, fmt });
  const relativo = modelo.tiempo?.tipo === "relativo";
  return el(
    "div",
    { class: "ov-pie" },
    relativo
      ? el("time", { class: "ov-tiempo", datetime: modelo.tiempo.fecha, title: fmt.fechaLegible(modelo.tiempo.fecha), texto: tiempo })
      : el("span", { class: "ov-tiempo", texto: tiempo }),
    modelo.anteriores
      ? el("a", { class: "ov-anteriores", href: enlaceARevisiones("historial"), "data-foco": `overview:anteriores:${modelo.key}`, texto: t("overview.tarjeta.anteriores", { n: modelo.anteriores }) })
      : null,
    modelo.acento
      ? el("span", { class: "ov-tema" }, t("overview.tarjeta.tema"), el("span", { class: "ov-tema-muestra", "aria-hidden": "true", estilo: { "--acento-tema": modelo.acento } }))
      : null,
  );
}

/** Las partes en el orden en que van, con su firma (qué datos la cambian) y cómo se arma. */
function partes(modelo, registro, deps) {
  const { t, fmt, src } = deps;
  return [
    ["barra", [modelo.host, modelo.ruta], () => barra(modelo)],
    [
      "captura",
      [modelo.dispositivo, modelo.estado, modelo.sitio, src(modelo.capturas.desktop), modelo.dispositivo === "desktop" ? null : src(modelo.capturas.mobile)],
      () => captura(modelo, registro, deps),
    ],
    ["nombre", [modelo.sitio, modelo.host, modelo.cuadritos], () => nombre(modelo, { t, fmt })],
    ["etapas", modelo.etapas, () => etapas(modelo, t)],
    ["goals", [modelo.medidores, modelo.aviso && textoDeAviso(modelo.aviso, t), modelo.aviso?.detalle ?? null], () => goals(modelo, t)],
    ["pie", [textoDeTiempo(modelo.tiempo, { t, fmt }), modelo.tiempo?.tipo === "relativo" ? modelo.tiempo.fecha : null, modelo.anteriores, modelo.acento], () => pie(modelo, { t, fmt })],
  ];
}

function actualizarTarjeta(registro, modelo, deps) {
  const { articulo: a } = registro;
  const clase = `ov-tarjeta ov-tarjeta-${modelo.estado}`;
  if (a.className !== clase) a.className = clase;

  // Color de marca por CSSOM (la CSP no admite estilos en línea): sin color todavía, la baldosa queda neutra.
  const marca = deps.marcaDe(modelo);
  if (marca) {
    if (a.style.getPropertyValue("--marca") !== marca.color) a.style.setProperty("--marca", marca.color);
    if (a.dataset.marca !== marca.texto) a.dataset.marca = marca.texto;
  } else {
    a.style.removeProperty("--marca");
    delete a.dataset.marca;
  }

  for (const [nombreDeParte, datos, armar] of partes(modelo, registro, deps)) {
    const firma = JSON.stringify(datos);
    if (registro.firmas[nombreDeParte] === firma) continue;
    const nuevo = armar();
    registro.partes[nombreDeParte].replaceWith(nuevo);
    registro.partes[nombreDeParte] = nuevo;
    registro.firmas[nombreDeParte] = firma;
  }

  // El enlace principal: la telaraña de modelo.tanda (primer goal con tanda, o la de la captura) o el avance.
  const enlace = registro.partes.nombre.querySelector(".ov-tarjeta-enlace");
  const href = modelo.tanda ? enlaceATanda(modelo.tanda) : deps.enlace(modelo.revision);
  if (enlace.getAttribute("href") !== href) enlace.setAttribute("href", href);
  const etiqueta = etiquetaDeTarjeta(modelo, deps);
  if (enlace.getAttribute("aria-label") !== etiqueta) enlace.setAttribute("aria-label", etiqueta);
  registro.modelo = modelo;
}

/**
 * Crea una tarjeta. `deps`: { t, fmt, imagenes, src(captura) → url | null, enlace(revision) → hash del avance,
 * marcaDe(modelo) → { color, texto } | null }. → { key, li, articulo, actualizar(modelo), soltar() }
 */
export function crearTarjeta(modelo, deps) {
  const hueco = () => el("span", { hidden: true });
  const registro = {
    key: modelo.key,
    partes: { barra: hueco(), captura: hueco(), nombre: hueco(), etapas: hueco(), goals: hueco(), pie: hueco() },
    firmas: {},
    imagenes: { escritorio: null, movil: null },
    modelo: null,
  };
  const { partes: p } = registro;
  registro.articulo = el(
    "article",
    { class: "ov-tarjeta" },
    p.barra,
    p.captura,
    el("div", { class: "ov-cuerpo" }, p.nombre, p.etapas, p.goals, p.pie),
  );
  // Un clic sobre lo que queda encima del enlace estirado (una etapa, los cuadritos, un goal sin tanda) y que no es un
  // enlace sigue al principal; los enlaces se atienden solos y los clics con modificador no se tocan.
  registro.articulo.addEventListener("click", (evento) => {
    if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
    if (!(evento.target instanceof Element) || evento.target.closest("a")) return;
    registro.partes.nombre.querySelector(".ov-tarjeta-enlace")?.click();
  });
  registro.li = el("li", { class: "ov-celda" }, registro.articulo);
  registro.actualizar = (nuevo) => actualizarTarjeta(registro, nuevo, deps);
  registro.soltar = () => {
    deps.imagenes.soltar(registro.imagenes.escritorio);
    deps.imagenes.soltar(registro.imagenes.movil);
    registro.imagenes = { escritorio: null, movil: null };
    registro.li.remove();
  };
  registro.actualizar(modelo);
  return registro;
}
