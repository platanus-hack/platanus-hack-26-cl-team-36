// Armazón (diseño §5.11, §10.1, contrato §6): una barra superior fija de 56 px, sin navegación, sin selector de idioma,
// sin buscador y sin barra lateral. En orden: la marca (logo horizontal a 180 px, o el símbolo solo donde no cabe;
// lleva a la portada) y
// las revisiones en curso (lleva a la pestaña Live del Overview). Se busca en cada vista: el Overview busca sus
// revisiones por link y Corridas, sus tandas. A Reviews y Batches se llega por los atajos g o / g c y los enlaces de
// las pantallas; al español, con `?idioma=es`. Se redibuja al cambiar de idioma.

import { pedirRevisiones } from "./datos.js";
import { conservarFoco, el, reemplazar } from "./dom.js";
import { EVENTO_IDIOMA, t } from "./i18n.js";
import { hashDe } from "./rutas.js";

// La marca (copias sin cambios de docs/marca/chameleonmode-v1/assets): la firma horizontal nunca baja de su mínimo
// (180 px de ancho); donde no cabe junto a la píldora (bajo 370 px, con margen para "12 en curso"), el
// símbolo a color solo. El mismo corte está en estilos/shell.css.
export const MARCA = Object.freeze({
  logo: { src: "marca/logo.svg", ancho: 492, alto: 128 },
  simbolo: { src: "marca/simbolo.svg", ancho: 128, alto: 128 },
  soloSimbolo: "(max-width: 369px)",
});
/** La marca lleva a la portada pública (la raíz del sitio, servidor.js); al Overview se llega con g o. */
export const ENLACE_MARCA = "/";
/** La píldora de revisiones en curso lleva a la pestaña Live del Overview. */
export const ENLACE_EN_CURSO = hashDe({ tipo: "overview", parametros: { pestana: "live" } });
// Las revisiones en curso se vuelven a contar cada 10 s, solo con la pestaña visible.
const INTERVALO_EN_CURSO = 10_000;

/** Cuántas revisiones tienen estado `running` en la tabla (las detenidas incluidas); null sin tabla. Puro. */
export function revisionesEnCurso(datos) {
  if (!datos?.disponible || !Array.isArray(datos.revisiones)) return null;
  return datos.revisiones.filter((revision) => revision?.estado === "running").length;
}

let barra = null;
/** Revisiones en curso; null sin tabla (o mientras no se sabe). Con 0 o null la píldora se oculta. */
let enCurso = null;
let relojEnCurso = 0;

function marca() {
  return el(
    "a",
    { class: "marca", href: ENLACE_MARCA, "aria-label": t("comun.marca.inicio"), "data-foco": "shell:marca" },
    el(
      "picture",
      {},
      el("source", { media: MARCA.soloSimbolo, srcset: MARCA.simbolo.src, width: MARCA.simbolo.ancho, height: MARCA.simbolo.alto }),
      el("img", { class: "marca-logo", src: MARCA.logo.src, alt: t("comun.marca.nombre"), width: MARCA.logo.ancho, height: MARCA.logo.alto }),
    ),
  );
}

function pildoraEnCurso() {
  return el(
    "a",
    { class: "barra-en-curso", href: ENLACE_EN_CURSO, "data-foco": "shell:en-curso", hidden: !enCurso },
    el("span", { class: "punto-vivo", "aria-hidden": "true" }),
    el("span", { class: "barra-en-curso-texto", texto: enCurso ? t("comun.shell.enCurso", { n: enCurso }) : "" }),
  );
}

/** Pone la cifra en la píldora sin redibujar la barra (no mueve el foco). Con 0 o sin tabla, se oculta. */
function pintarEnCurso() {
  for (const pildora of barra?.querySelectorAll(".barra-en-curso") ?? []) {
    pildora.hidden = !enCurso;
    const texto = enCurso ? t("comun.shell.enCurso", { n: enCurso }) : "";
    const nodo = pildora.querySelector(".barra-en-curso-texto");
    if (nodo && nodo.textContent !== texto) nodo.textContent = texto;
  }
}

async function contarEnCurso() {
  try {
    enCurso = revisionesEnCurso(await pedirRevisiones());
  } catch {
    // Un tropiezo de la red no esconde la píldora: queda la última cifra conocida y se reintenta en el próximo turno.
  }
  pintarEnCurso();
}

function programarEnCurso() {
  clearTimeout(relojEnCurso);
  relojEnCurso = setTimeout(async () => {
    if (!document.hidden) await contarEnCurso();
    programarEnCurso();
  }, INTERVALO_EN_CURSO);
}

function dibujar() {
  const saltar = document.querySelector(".saltar");
  if (saltar) saltar.textContent = t("comun.shell.saltar");
  conservarFoco(barra, () =>
    reemplazar(barra, marca(), el("div", { class: "barra-acciones" }, pildoraEnCurso())),
  );
}

/** Arma el armazón sobre #barra-superior de index.html. */
export function iniciarShell() {
  barra = document.getElementById("barra-superior");

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

  addEventListener(EVENTO_IDIOMA, dibujar);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    contarEnCurso();
    programarEnCurso();
  });

  dibujar();
  contarEnCurso();
  programarEnCurso();
}
