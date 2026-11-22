// Análisis del paso (columna derecha del Replay): el seguimiento de la ruta. Arriba la acción del paso; al centro la
// ruta de la Guía como una lista vertical de páginas, con dónde está el usuario en este paso y los desvíos agrupados
// bajo la página de la que salió; debajo, en dos líneas, qué esperaba y dónde quedó. El resultado del intento va
// aparte, al pie: es del intento entero, no del paso.
//
// La ruta es la de la Guía (tanda.rutaGuia: contra la que se mide el resultado) o, si la tanda no la trae, la de la
// telaraña (los intentos que llegaron). Un intento con error de la herramienta muestra el error, nunca su texto como
// si fuera el veredicto.

import { nombreDePagina, textoDeError, textoDeFirma, textoDeMotivo } from "../datos/textos.js";
import { el, recortarAlMedio } from "../nucleo/dom.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { icono, insignia, marcaDeSenal } from "../nucleo/iconos.js";
import { posicionEnLaRuta } from "./ruta.js";

const ICONO_DE_ACCION = {
  clic: "cursor",
  clic_coordenadas: "cursor",
  doble_clic: "cursor",
  triple_clic: "cursor",
  escribir: "teclado",
  tecla: "teclado",
  atras: "volvio",
  volver: "volvio",
};
const MAX_PAGINAS_DE_DESVIO = 3;

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

function iconoDeAccion(firma) {
  if (firma?.tipo === "desplazar") return firma.direccion === "arriba" ? "orden-asc" : "orden-desc";
  return ICONO_DE_ACCION[firma?.tipo] ?? "marca";
}

// ── Cabecera de la columna: paso n / total y su duración ────────────────

/**
 * La cabecera de la columna para el paso `indice`: «Paso 11 / 13» y cuánto duró.
 * @param {{ intento: object, indice: number, t: Function, fmt: object }} datos
 */
export function cabeceraDeAnalisis({ intento, indice, t, fmt }) {
  const paso = intento?.pasos?.[indice];
  const total = intento?.pasos?.length ?? 0;
  return [
    el(
      "h3",
      { class: "etiqueta-micro riel-cabecera-paso" },
      paso ? [t("replay.analisis.paso", { n: paso.numero }), el("span", { class: "riel-de", texto: ` / ${total}` })] : t("replay.analisis.titulo"),
    ),
    paso && paso.duracion !== null && paso.duracion !== undefined
      ? el("span", { class: "riel-duracion", title: t("replay.analisis.duracion") }, icono("proximamente"), el("span", { texto: fmt.duracion(paso.duracion) }))
      : null,
  ];
}

// ── La ruta ─────────────────────────────────────────────────────────────

function filaDeHito(hito, pagina, { siguienteAlcanzado, numero, nombre, t }) {
  const estado = hito.aqui ? "aqui" : hito.alcanzado ? "alcanzado" : "pendiente";
  return el(
    "li",
    { class: `riel-fila riel-hito riel-${estado}${hito.meta ? " riel-meta" : ""}${siguienteAlcanzado ? " riel-sigue" : ""}`, "aria-current": hito.aqui ? "step" : null },
    el("span", { class: "riel-eje", "aria-hidden": "true" }, el("span", { class: "riel-punto" }), hito.meta ? null : el("span", { class: "riel-linea" })),
    el(
      "span",
      { class: "riel-texto" },
      el("span", { class: "riel-nombre", title: pagina.url ?? null, texto: nombre(pagina) }),
      hito.aqui ? el("span", { class: "riel-chip riel-chip-aqui", texto: t("replay.analisis.pasoCorto", { n: numero }) }) : null,
      hito.meta ? icono("meta", { etiqueta: t("replay.analisis.paginaFinal"), clase: "riel-bandera" }) : null,
      hito.meta && !hito.alcanzado ? el("span", { class: "visualmente-oculto", texto: t("replay.analisis.sinLlegar") }) : null,
    ),
  );
}

function filaDeDesvios(desvios, { siguienteAlcanzado, numero, actual, nombre, t }) {
  const nombres = desvios.paginas.map((id) => nombre(id)).filter(Boolean);
  const visibles = nombres.slice(0, MAX_PAGINAS_DE_DESVIO);
  const resto = nombres.length - visibles.length;
  return el(
    "li",
    { class: `riel-fila riel-desvios${desvios.aqui ? " riel-aqui" : ""}${siguienteAlcanzado ? " riel-sigue" : ""}`, "aria-current": desvios.aqui ? "step" : null },
    el("span", { class: "riel-eje", "aria-hidden": "true" }, icono("desvio", { clase: "riel-icono-desvio" }), el("span", { class: "riel-linea" })),
    el(
      "span",
      { class: "riel-texto" },
      el("span", { class: "riel-cuantos", texto: t("replay.analisis.desvios", { n: desvios.pasos.length }) }),
      nombres.length
        ? el("span", { class: "riel-paginas", title: nombres.join(" · "), texto: [...visibles, resto > 0 ? t("replay.analisis.yMas", { n: resto }) : null].filter(Boolean).join(" · ") })
        : null,
      desvios.aqui ? el("span", { class: "riel-chip riel-chip-desvio", texto: t("replay.analisis.pasoEn", { n: numero, pagina: nombre(actual?.pagina) || t("replay.analisis.fuera") }) }) : null,
    ),
  );
}

function seccionDeRuta({ intento, indice, tanda, t, nombre }) {
  const ruta = rutaDeLaTanda(tanda);
  const titulo = (texto, cifra = null) =>
    el("div", { class: "riel-seccion-cabecera" }, el("h4", { class: "etiqueta-micro", texto }), cifra ? el("span", { class: "riel-cifra", texto: cifra }) : null);
  if (!ruta) {
    return el("section", { class: "riel-seccion riel-ruta" }, titulo(t("replay.analisis.rutaGuia")), el("p", { class: "texto-3", texto: t("replay.analisis.sinRuta") }));
  }
  const posicion = posicionEnLaRuta(intento, indice, ruta.paginas.map((pagina) => pagina.id), { deLaTelarana: !ruta.deLaGuia });
  const actual = intento.pasos?.[indice] ?? null;
  const numero = actual?.numero ?? 0;
  const filas = [];
  posicion.hitos.forEach((hito, i) => {
    const siguienteAlcanzado = posicion.hitos[i + 1]?.alcanzado ?? false;
    filas.push(filaDeHito(hito, ruta.paginas[i], { siguienteAlcanzado, numero, nombre, t }));
    if (hito.desvios.pasos.length) filas.push(filaDeDesvios(hito.desvios, { siguienteAlcanzado, numero, actual, nombre, t }));
  });
  return el(
    "section",
    { class: "riel-seccion riel-ruta" },
    titulo(t(ruta.deLaGuia ? "replay.analisis.rutaGuia" : "replay.analisis.rutaTelarana"), t("replay.analisis.paginasAlcanzadas", { n: posicion.alcanzados, de: posicion.total })),
    el("ol", { class: "riel-lista" }, filas),
  );
}

// ── El paso, en dos líneas ──────────────────────────────────────────────

function seccionDelPaso({ intento, indice, t, nombre }) {
  const paso = intento.pasos[indice];
  const ultimo = indice === intento.pasos.length - 1;
  const error = ultimo && intento.resultado === "error" ? textoDeError(intento.error, t) : null;
  const sinEfecto = paso.senales.includes("no_effect");
  const pagina = nombre(paso.pagina) || paso.titulo;
  return el(
    "section",
    { class: "riel-seccion riel-paso" },
    paso.senales.length ? el("div", { class: "riel-senales" }, paso.senales.map((senal) => marcaDeSenal(senal, { compacta: false }))) : null,
    el(
      "dl",
      { class: "riel-lineas" },
      el("dt", {}, icono("esperaba", { etiqueta: t("replay.analisis.esperaba") })),
      el("dd", { class: "riel-esperaba", texto: paso.expectativa || t("replay.analisis.noLoDijo") }),
      el("dt", {}, icono("ojo", { etiqueta: t("replay.analisis.quedo") })),
      el(
        "dd",
        {},
        el("span", { class: "riel-quedo", texto: sinEfecto && pagina ? t("replay.analisis.seQuedo", { pagina }) : pagina || t("replay.analisis.sinPagina") }),
        paso.url ? el("span", { class: "mono riel-url", title: paso.url, texto: recortarAlMedio(paso.url.replace(/^https?:\/\/(www\.)?/, ""), 52) }) : null,
      ),
    ),
    error ? avisoEnLinea(t("replay.analisis.corte", { titulo: error.titulo }), "atencion") : null,
    ultimo && !error && intento.motivoDeFin ? el("p", { class: "texto-3 riel-fin", texto: t("replay.analisis.fin", { motivo: textoDeMotivo(intento.motivoDeFin, t) }) }) : null,
  );
}

// ── El intento, al pie ──────────────────────────────────────────────────

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

function pieDelIntento(intento, t, nombre) {
  const razon = razonDelIntento(intento, t, nombre);
  const detalle = [intento.justificacion, intento.resultado === "error" ? t("replay.analisis.errorIntento") : null].filter(Boolean).join(" ");
  return el(
    "footer",
    { class: "riel-pie", title: detalle || null },
    el("h4", { class: "etiqueta-micro", texto: t("replay.analisis.intento") }),
    insignia(intento.resultado),
    razon ? el("span", { class: "riel-razon", texto: razon }) : null,
  );
}

/**
 * Contenido del análisis del paso `indice`.
 * @param {{ intento: object, indice: number, tanda: object, t: Function }} datos
 */
export function contenidoDeAnalisis({ intento, indice, tanda, t }) {
  const nombre = nombrador(tanda, t);
  const paso = intento.pasos?.[indice];
  if (!paso) {
    const error = intento.resultado === "error";
    return [
      el("section", { class: "riel-seccion" }, el("p", { class: "texto-3", texto: t(error ? "replay.analisis.cortadoAntes" : "replay.analisis.sinPasos") })),
      pieDelIntento(intento, t, nombre),
    ];
  }
  const firma = textoDeFirma(paso.firma, t) || paso.descripcion || "";
  return [
    el(
      "div",
      { class: "riel-seccion riel-accion" },
      el("span", { class: "riel-icono-accion" }, icono(iconoDeAccion(paso.firma))),
      el("span", { class: "riel-firma", texto: firma }),
    ),
    seccionDeRuta({ intento, indice, tanda, t, nombre }),
    seccionDelPaso({ intento, indice, t, nombre }),
    pieDelIntento(intento, t, nombre),
  ];
}
