// Análisis del paso (columna derecha del Replay), en palabras simples: la acción, las señales explicadas, qué
// esperaba el usuario, qué pasó, en qué página quedó y, al final, la nota del juez sobre el intento.
// Un intento con error de la herramienta muestra el error, nunca su texto como si fuera el veredicto.

import { nombreDePagina, textoDeError, textoDeFirma, textoDeLoQuePaso, textoDeMotivo } from "../datos/textos.js";
import { el, recortarAlMedio } from "../nucleo/dom.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { insignia, marcaDeSenal } from "../nucleo/iconos.js";

const seccion = (titulo, ...contenido) =>
  el("section", { class: "replay-analisis-seccion" }, el("h4", { class: "etiqueta-micro", texto: titulo }), contenido);

function senales(paso, t) {
  const lista = paso.senales ?? [];
  const fuera = paso.carril === "fuera-de-ruta";
  if (!lista.length && !fuera) return el("p", { class: "texto-3", texto: t("replay.analisis.sinSenales") });
  return el(
    "ul",
    { class: "replay-senales" },
    lista.map((senal) => el("li", {}, marcaDeSenal(senal, { compacta: false }), el("span", { class: "texto-2", texto: t(`replay.analisis.senal.${senal}`) }))),
    fuera ? el("li", { class: "texto-2", texto: t("replay.analisis.fueraDeRuta") }) : null,
  );
}

function notaDelJuez(intento, t) {
  const error = intento.resultado === "error" ? textoDeError(intento.error, t) : null;
  if (error) {
    return seccion(
      t("replay.analisis.juez"),
      el("p", {}, insignia("error")),
      el("p", { class: "prosa" }, el("strong", { texto: error.titulo }), el("span", { class: "texto-3", texto: ` ${t("replay.analisis.errorIntento")}` })),
    );
  }
  return seccion(
    t("replay.analisis.juez"),
    el("p", {}, insignia(intento.resultado, { logro: intento.logro })),
    intento.justificacion ? el("p", { class: "prosa", texto: intento.justificacion }) : el("p", { class: "texto-3", texto: t("replay.analisis.sinNota") }),
  );
}

/**
 * Contenido del análisis del paso `indice`.
 * @param {{ intento: object, indice: number, tanda: object, t: Function }} datos
 */
export function contenidoDeAnalisis({ intento, indice, tanda, t }) {
  const paso = intento.pasos?.[indice];
  if (!paso) {
    const error = intento.resultado === "error";
    return [el("p", { class: "texto-3", texto: t(error ? "replay.analisis.cortadoAntes" : "replay.analisis.sinPasos") }), notaDelJuez(intento, t)];
  }
  const firma = textoDeFirma(paso.firma, t) || paso.descripcion || "";
  const pagina = (tanda?.telarana?.paginas ?? []).find((cada) => cada.id === paso.pagina) ?? null;
  const ultimo = indice === intento.pasos.length - 1;
  const error = ultimo && intento.resultado === "error" ? textoDeError(intento.error, t) : null;

  return [
    el(
      "h3",
      { class: "replay-analisis-titulo" },
      el("span", { class: "replay-analisis-numero", texto: t("replay.analisis.paso", { n: paso.numero }) }),
      el("span", { texto: firma }),
    ),
    seccion(t("replay.analisis.senales"), senales(paso, t)),
    seccion(t("replay.analisis.esperaba"), el("p", { class: "prosa", texto: paso.expectativa || t("replay.analisis.noLoDijo") })),
    seccion(t("replay.analisis.loQuePaso"), el("p", { class: "prosa", texto: textoDeLoQuePaso(paso.loQuePaso, t) })),
    pagina || paso.url
      ? seccion(
          t("replay.analisis.pagina"),
          pagina ? el("p", { texto: nombreDePagina(pagina, t) }) : null,
          paso.url ? el("p", { class: "mono replay-url texto-3", title: paso.url, texto: recortarAlMedio(paso.url, 56) }) : null,
        )
      : null,
    error ? avisoEnLinea(t("replay.analisis.corte", { titulo: error.titulo }), "atencion") : null,
    ultimo && !error && intento.motivoDeFin ? el("p", { class: "texto-3", texto: t("replay.analisis.fin", { motivo: textoDeMotivo(intento.motivoDeFin, t) }) }) : null,
    notaDelJuez(intento, t),
  ];
}
