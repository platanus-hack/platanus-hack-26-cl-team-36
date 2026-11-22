// Por qué terminó así (el pie plegado del panel de pasos del Replay): el resultado del intento y su razón, qué
// esperaba en el último paso y dónde quedó, dentro o fuera de la ruta. La ruta es la de la Guía (tanda.rutaGuia:
// contra la que se mide el resultado) o, si la tanda no la trae, la de la telaraña. Un intento con error de la
// herramienta muestra el error, nunca su texto como si fuera el veredicto.

import { nombreDePagina, textoDeError, textoDeMotivo } from "../datos/textos.js";
import { el } from "../nucleo/dom.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { insignia } from "../nucleo/iconos.js";

/** La ruta que se sigue: la de la Guía o la de la telaraña, como lista de páginas ({ id, …para nombrarla }). */
function rutaDeLaTanda(tanda) {
  const guia = tanda?.rutaGuia?.paginas ?? [];
  if (guia.length >= 2) return { deLaGuia: true, paginas: guia };
  const telarana = tanda?.telarana?.ruta?.paginas ?? [];
  if (telarana.length >= 2) return { deLaGuia: false, paginas: telarana.map((id) => ({ id })) };
  return null;
}

/** Nombre de una página por id (la de la telaraña) o, si no está en la telaraña, con lo que trae la ruta. */
function nombrador(tanda, t) {
  const porId = new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  return (pagina) => {
    if (!pagina) return "";
    if (typeof pagina === "string") return nombreDePagina(porId.get(pagina) ?? { id: pagina }, t);
    return nombreDePagina((pagina.id && porId.get(pagina.id)) || pagina, t);
  };
}

function razonDelIntento(intento, t, nombre) {
  if (intento.resultado === "error") return textoDeError(intento.error, t)?.titulo ?? "";
  if (intento.logro === "declaro_sin_llegar") {
    const final = nombre(intento.pasos?.at(-1)?.pagina ?? null);
    return final ? t("replay.analisis.declaroEn", { pagina: final }) : t("comun.logro.declaro_sin_llegar");
  }
  if (intento.logro) return t(`comun.logro.${intento.logro}`);
  if (intento.justificacion) return intento.justificacion;
  if (intento.fuente === "ruta") return t("replay.analisis.sinJuez");
  return t(intento.resultado === "sin_medir" ? "replay.analisis.sinMedir" : "replay.analisis.sinNota");
}

/**
 * Por qué terminó así (el pie del panel de pasos): el resultado y su razón, qué esperaba en el último paso y dónde
 * quedó, dentro o fuera de la ruta.
 * @param {{ intento: object, tanda: object, t: Function }} datos
 */
export function porQueTermino({ intento, tanda, t }) {
  const nombre = nombrador(tanda, t);
  const ultimo = intento.pasos?.at(-1) ?? null;
  const razon = razonDelIntento(intento, t, nombre);
  const ruta = rutaDeLaTanda(tanda);
  const pagina = ultimo ? nombre(ultimo.pagina) || ultimo.titulo : "";
  const enRuta = !ruta || ruta.paginas.some((cada) => cada.id === ultimo?.pagina);
  const error = intento.resultado === "error" ? textoDeError(intento.error, t) : null;
  return [
    el("div", { class: "replay-fin-intento" }, insignia(intento.resultado), razon ? el("span", { class: "replay-fin-razon", texto: razon }) : null),
    el(
      "dl",
      { class: "replay-fin-lineas" },
      el("dt", { texto: t("replay.analisis.esperaba") }),
      el("dd", { texto: ultimo?.expectativa || t("replay.analisis.noLoDijo") }),
      el("dt", { texto: t("replay.analisis.quedo") }),
      el("dd", { texto: pagina ? t(enRuta ? "replay.fin.enRuta" : "replay.fin.fueraDeRuta", { pagina }) : t("replay.analisis.sinPagina") }),
    ),
    error ? avisoEnLinea(error.titulo, "atencion") : intento.motivoDeFin ? el("p", { class: "texto-3", texto: t("replay.analisis.fin", { motivo: textoDeMotivo(intento.motivoDeFin, t) }) }) : null,
  ];
}
