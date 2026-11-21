// Tarjeta del paso (diseño §10.6.3): "Paso n · firma" con sus señales, "Esperaba | Pasó", "Coincide (estimado)" y
// qué hace la ruta recomendada desde esta página comparado con lo que hizo el usuario. Devuelve solo el contenido:
// los botones Anterior/Siguiente viven fuera, para que el foco no se pierda al cambiar de paso.

import { nombreDePagina, textoDeError, textoDeFirma, textoDeLoQuePaso, textoDeMotivo } from "../datos/textos.js";
import { el } from "../nucleo/dom.js";
import { conGlobo } from "../nucleo/globo.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { icono, marcaDeSenal } from "../nucleo/iconos.js";

const COINCIDE = {
  si: { icono: "check", tono: "exito" },
  no: { icono: "cerrar", tono: "aviso" },
  incierto: { icono: "info", tono: "neutro" },
};

function filaDeRuta(paso, tanda, t) {
  const aqui = paso.rutaAqui;
  if (!aqui) return null;
  if (!aqui.enRuta) return el("p", { class: "replay-ruta replay-ruta-fuera" }, icono("fuera-de-ruta"), el("span", { texto: t("replay.tarjeta.fueraDeRuta") }));
  if (aqui.termina) return el("p", { class: "replay-ruta replay-ruta-termina" }, icono("logrado"), el("span", { texto: t("replay.tarjeta.terminaRuta") }));
  const destino = (tanda?.telarana?.paginas ?? []).find((pagina) => pagina.id === aqui.destino) ?? null;
  const estado = aqui.coincideConUsuario === true ? "igual" : aqui.coincideConUsuario === false ? "difiere" : null;
  const usuario = textoDeFirma(paso.firma, t) || paso.descripcion || "";
  return el(
    "dl",
    { class: `replay-ruta replay-comparacion${estado ? ` ${estado}` : ""}` },
    estado ? el("span", { class: "visualmente-oculto", texto: t(`replay.tarjeta.${estado}`) }) : null,
    el(
      "div",
      { class: "replay-comparacion-fila" },
      el("dt", {}, icono("en-ruta"), el("span", { texto: t("replay.tarjeta.ruta") })),
      el(
        "dd",
        {},
        el("span", { texto: t("replay.tarjeta.rutaAccion", { accion: aqui.accion ?? "", destino: nombreDePagina(destino ?? { id: aqui.destino }, t) }) }),
        typeof aqui.hito === "number" && aqui.total
          ? el("span", { class: "replay-tramo texto-3", texto: t("replay.tarjeta.tramo", { k: aqui.hito + 1, total: aqui.total }) })
          : null,
      ),
    ),
    el(
      "div",
      { class: "replay-comparacion-fila" },
      el("dt", {}, icono(estado === "difiere" ? "fuera-de-ruta" : "en-ruta"), el("span", { texto: t("replay.tarjeta.usuario") })),
      el(
        "dd",
        {},
        el("span", { texto: usuario }),
        paso.salePagina ? null : el("span", { class: "texto-3", texto: ` ${t("replay.tarjeta.sigueEnPagina")}` }),
        estado ? icono(estado === "igual" ? "check" : "error-visible", { clase: "replay-comparacion-marca" }) : null,
      ),
    ),
  );
}

/**
 * Contenido de la tarjeta del paso `indice`.
 * @param {{ intento: object, indice: number, tanda: object, t: Function, senal: AbortSignal }} datos
 */
export function contenidoDeTarjeta({ intento, indice, tanda, t, senal }) {
  const paso = intento.pasos?.[indice];
  const error = intento.resultado === "error" ? textoDeError(intento.error, t) : null;
  if (!paso) {
    return [
      el("p", { class: "replay-tarjeta-vacia texto-3", texto: t(error ? "replay.error.sinPasos" : "replay.visor.sinPasos") }),
    ];
  }
  const firma = textoDeFirma(paso.firma, t) || paso.descripcion || "";
  const coincide = COINCIDE[paso.coincide] ?? null;
  const ayuda = el(
    "button",
    { type: "button", class: "boton boton-icono replay-ayuda", "aria-label": t("replay.tarjeta.coincideAyuda"), "data-foco": "replay:coincide-ayuda" },
    icono("info"),
  );
  conGlobo(ayuda, t("replay.tarjeta.coincideAyuda"), { senal });
  const ultimo = indice === intento.pasos.length - 1;

  return [
    el(
      "header",
      { class: "replay-tarjeta-cabecera" },
      el("h3", { class: "replay-tarjeta-titulo" }, el("span", { class: "replay-tarjeta-numero", texto: t("replay.tarjeta.titulo", { n: paso.numero }) }), el("span", { class: "replay-tarjeta-firma", texto: firma })),
      paso.senales?.length ? el("span", { class: "replay-tarjeta-senales" }, paso.senales.map((senal) => marcaDeSenal(senal, { compacta: false }))) : null,
    ),
    el(
      "div",
      { class: "replay-par" },
      el(
        "section",
        { class: "replay-caja" },
        el("h4", { class: "etiqueta-micro", texto: t("replay.tarjeta.esperaba") }),
        paso.expectativa ? el("p", { class: "prosa", texto: paso.expectativa }) : el("p", { class: "prosa texto-3", texto: t("replay.tarjeta.noLoDijo") }),
      ),
      el(
        "section",
        { class: "replay-caja" },
        el("h4", { class: "etiqueta-micro", texto: t("replay.tarjeta.loQuePaso") }),
        el("p", { class: "prosa", texto: textoDeLoQuePaso(paso.loQuePaso, t) }),
      ),
    ),
    coincide
      ? el(
          "p",
          { class: "replay-coincide" },
          el("span", { class: "texto-3", texto: t("replay.tarjeta.coincide") }),
          ayuda,
          el("span", { class: `insignia insignia-${coincide.tono}` }, icono(coincide.icono), el("span", { texto: t(`comun.coincide.${paso.coincide}`) })),
        )
      : null,
    filaDeRuta(paso, tanda, t),
    ultimo && error ? avisoEnLinea(t("replay.error.corte", { titulo: error.titulo }), "atencion") : null,
    ultimo && !error && intento.motivoDeFin
      ? el("p", { class: "replay-fin texto-3", texto: t("replay.tarjeta.fin", { motivo: textoDeMotivo(intento.motivoDeFin, t) }) })
      : null,
  ];
}
