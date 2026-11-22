// Las trazas de una tanda tal como las muestran el Mapa y el Replay: las filas del riel y el detalle de la elegida.

import { nombreConNivel } from "../datos/nombres.js";
import { nombreDePagina } from "../datos/textos.js";
import { el } from "../nucleo/dom.js";
import { icono, insignia } from "../nucleo/iconos.js";
import { motivoATexto, priorizar } from "./priorizar.js";

const MOTIVOS_EN_LA_FILA = 2;

/** Dónde dejó la ruta un intento: { desde, hacia, paso } (ids de página), o null si no la dejó. Puro. */
export function salidaDeLaRuta(intento) {
  const separa = intento?.seSepara;
  if (!separa || separa.seDetuvo || !separa.pagina) return null;
  return { desde: intento.camino?.[separa.tramo - 1] ?? null, hacia: separa.pagina, paso: separa.paso ?? null };
}

/** Lo que necesitan el riel y el panel: los grupos y cómo nombrar páginas y perfiles. */
export function trazasDeLaTanda(tanda, t) {
  const paginas = new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const nombrePagina = (id) => (paginas.has(id) ? nombreDePagina(paginas.get(id), t) : id);
  const nombrePerfil = (intento) => nombreConNivel(intento.nombrePerfil ?? intento.id, t);
  const grupos = priorizar(tanda?.intentos ?? [], tanda?.telarana?.ruta ?? null);
  const motivos = (grupo, max = Infinity) => grupo.motivos.slice(0, max).map((motivo) => motivoATexto(motivo, { t, nombre: nombrePagina }));
  const nombreDeGrupo = (grupo) =>
    grupo.n > 1 ? t("comun.traza.grupo", { n: grupo.n, nombres: grupo.intentos.map(nombrePerfil).join(", ") }) : nombrePerfil(grupo.intentos[0]);
  return { grupos, nombrePagina, nombrePerfil, motivos, nombreDeGrupo };
}

/** Las filas del riel de trazas. */
export function filasDeTrazas(trazas, t) {
  return trazas.grupos.map((grupo) => {
    const detalle = trazas.motivos(grupo, MOTIVOS_EN_LA_FILA).join(" · ");
    const nombre = trazas.nombreDeGrupo(grupo);
    return {
      id: grupo.representante,
      punto: grupo.resultado,
      nombre,
      cifra: t("comun.traza.pasos", { n: grupo.intentos[0].pasos?.length ?? 0 }),
      detalle,
      titulo: `${nombre} · ${t(`comun.resultado.${grupo.resultado}`)}\n${detalle}`,
    };
  });
}

/**
 * El panel de la traza elegida en el Mapa: perfil, resultado, motivos, dónde salió de la ruta y el enlace al Replay.
 * @param {{ grupo: object, intento: object }} eleccion
 */
export function detalleDeTraza({ grupo, intento }, trazas, { t, enlaceAReplay, alQuitar }) {
  const salida = salidaDeLaRuta(intento);
  const nombre = grupo.n > 1 ? trazas.nombreDeGrupo(grupo) : trazas.nombrePerfil(intento);
  return el(
    "div",
    { class: "traza-detalle" },
    el(
      "div",
      { class: "traza-cabecera" },
      el("h3", { class: "traza-nombre", texto: nombre }),
      el("button", { type: "button", class: "boton boton-icono", "aria-label": t("comun.traza.quitar"), title: t("comun.traza.quitar"), onclick: alQuitar }, icono("cerrar")),
    ),
    insignia(intento.resultado),
    el("p", { class: "traza-motivos", texto: trazas.motivos(grupo).join(" · ") }),
    el("p", {
      class: "traza-salida",
      texto: salida ? t("comun.traza.salioEn", { desde: trazas.nombrePagina(salida.desde), hacia: trazas.nombrePagina(salida.hacia) }) : t("comun.traza.noSalio"),
    }),
    el("a", { class: "boton boton-secundario traza-replay", href: enlaceAReplay(intento.id), "data-foco": "traza:replay" }, el("span", { texto: t("comun.traza.verEnReplay") })),
  );
}

/** «3/4» de otra tanda, con la lista de tandas si ya llegó. */
export function resumenDeOtra(tandas) {
  const porId = new Map((tandas ?? []).map((tanda) => [tanda.id, tanda]));
  return (id) => {
    const tanda = porId.get(id);
    if (!tanda) return null;
    const medidos = tanda.medidos ?? tanda.validos ?? tanda.intentos;
    return typeof medidos === "number" ? `${tanda.logrados ?? 0}/${medidos}` : null;
  };
}
