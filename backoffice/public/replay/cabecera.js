// Cabecera del Replay (diseño §8 WP4-P0, §10.6): selector de intento (píldoras: ícono + nombre), cifras del intento
// ("12 pasos (ruta 8) · 39 s · 390×844") y el veredicto fijo arriba: insignia + primera frase de la justificación,
// con el detalle (justificación completa, respuesta, cómo terminó, criterio y evidencias) plegado.
// Un intento con error de la herramienta muestra el error y su detalle técnico, nunca el texto del error como si
// fuera la respuesta del usuario o el veredicto.

import { textoDeError, textoDeMotivo } from "../datos/textos.js";
import { kbd } from "../nucleo/atajos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { conGlobo } from "../nucleo/globo.js";
import { icono, insignia, textoDeResultado } from "../nucleo/iconos.js";

/**
 * @param {{ t: Function, fmt: object, tanda: object, senal: AbortSignal }} opciones
 */
export function crearCabecera({ t, fmt, tanda, senal }) {
  let abierto = false;
  const titulo = el("h2", { class: "visualmente-oculto", tabindex: "-1" });

  const pildoras = new Map(
    (tanda.intentos ?? []).map((intento) => {
      const resultado = textoDeResultado(intento.resultado, intento.logro);
      const enlace = el(
        "a",
        {
          class: `chip replay-pildora pildora-${intento.resultado}`,
          href: "#",
          "data-foco": `replay:intento:${intento.id}`,
          "aria-label": t("replay.cabecera.intento", { nombre: intento.nombrePerfil ?? intento.id, resultado }),
        },
        insignia(intento.resultado, { logro: intento.logro, compacta: true }),
        el("span", { texto: intento.nombrePerfil ?? intento.id }),
      );
      return [intento.id, enlace];
    }),
  );
  const navegacion = el(
    "nav",
    { class: "replay-intentos", "aria-label": t("replay.cabecera.intentos") },
    el("ul", {}, [...pildoras.values()].map((pildora) => el("li", {}, pildora))),
  );

  const meta = el("p", { class: "replay-meta texto-3" });
  const veredicto = el("div", { class: "replay-veredicto" });
  const panel = el("div", { class: "replay-panel tarjeta", id: "replay-panel-veredicto", hidden: true });
  const alternador = el(
    "button",
    {
      type: "button",
      class: "boton boton-fantasma replay-alternar-veredicto",
      "aria-expanded": "false",
      "aria-controls": "replay-panel-veredicto",
      "aria-keyshortcuts": "e",
      "data-foco": "replay:veredicto",
    },
    icono("siguiente", { clase: "replay-flecha" }),
    el("span", { texto: t("replay.veredicto.mostrar") }),
  );
  alternador.addEventListener("click", () => alternar(), { signal: senal });
  conGlobo(alternador, () => el("span", { class: "globo-con-tecla" }, el("span", { texto: t("comun.atajos.desc.veredicto") }), kbd("e")), { senal });

  const nodo = el(
    "header",
    { class: "replay-cabecera" },
    titulo,
    el("div", { class: "replay-cabecera-fila" }, navegacion, meta),
    el("div", { class: "replay-cabecera-fila replay-cabecera-veredicto" }, veredicto, alternador),
    panel,
  );

  function alternar(forzar) {
    abierto = typeof forzar === "boolean" ? forzar : !abierto;
    panel.hidden = !abierto;
    alternador.setAttribute("aria-expanded", abierto ? "true" : "false");
    nodo.classList.toggle("abierta", abierto);
  }

  function seccion(etiqueta, ...contenido) {
    return el("section", { class: "replay-panel-seccion" }, el("h3", { class: "etiqueta-micro", texto: etiqueta }), contenido);
  }

  function pintar(intento) {
    const nombre = intento.nombrePerfil ?? intento.id;
    titulo.textContent = t("replay.titulo", { nombre });
    for (const [id, pildora] of pildoras) {
      if (id === intento.id) pildora.setAttribute("aria-current", "true");
      else pildora.removeAttribute("aria-current");
    }

    const ruta = tanda.telarana?.ruta?.pasosIdeales ?? null;
    const viewport = intento.viewport;
    reemplazar(
      meta,
      el("span", { title: t("replay.cabecera.pasosAyuda"), texto: t("replay.cabecera.pasos", { n: intento.pasos?.length ?? 0, ruta }) }),
      typeof intento.duracion === "number" ? el("span", { title: t("replay.cabecera.duracionAyuda"), texto: fmt.duracion(intento.duracion) }) : null,
      viewport ? el("span", { title: t("replay.cabecera.viewportAyuda"), texto: t("replay.cabecera.viewport", { ancho: viewport.ancho, alto: viewport.alto }) }) : null,
    );

    const error = intento.resultado === "error" ? textoDeError(intento.error, t) : null;
    if (error) {
      reemplazar(
        veredicto,
        insignia("error"),
        el(
          "div",
          { class: "replay-veredicto-error" },
          el("p", { class: "replay-veredicto-texto" }, el("strong", { class: "texto-1", texto: error.titulo }), el("span", { class: "texto-3", texto: ` ${t("replay.error.explicacion")}` })),
          el(
            "details",
            { class: "detalle-tecnico", "data-foco": "replay:detalle-tecnico" },
            el("summary", { texto: t("comun.estado.detalleTecnico") }),
            el("pre", { class: "mono", texto: error.detalle || error.resumen }),
          ),
        ),
      );
    } else {
      reemplazar(
        veredicto,
        insignia(intento.resultado, { logro: intento.logro }),
        el("p", { class: "replay-veredicto-texto prosa", title: intento.justificacion ?? null, texto: fmt.primeraFrase(intento.justificacion ?? "", 200) }),
      );
    }

    const criterio = tanda.criterio;
    reemplazar(
      panel,
      error
        ? null
        : [
            seccion(t("replay.veredicto.justificacion"), el("p", { class: "prosa", texto: intento.justificacion ?? "" })),
            seccion(
              t("replay.veredicto.respuesta"),
              intento.respuesta ? el("blockquote", { class: "prosa replay-respuesta", texto: intento.respuesta }) : el("p", { class: "texto-3", texto: t("replay.veredicto.sinRespuesta") }),
            ),
            intento.motivoDeFin ? seccion(t("replay.veredicto.motivo"), el("p", { texto: textoDeMotivo(intento.motivoDeFin, t) })) : null,
          ],
      criterio
        ? seccion(
            t("replay.veredicto.criterio"),
            el("p", { class: "prosa", texto: criterio.texto ?? "" }),
            criterio.evidencias?.length
              ? [
                  el("h4", { class: "etiqueta-micro replay-evidencias-titulo", texto: t("replay.veredicto.evidencias") }),
                  el("ul", { class: "replay-evidencias" }, criterio.evidencias.map((evidencia) => el("li", { texto: evidencia }))),
                  el("p", { class: "texto-3 t-pequeno", texto: t("replay.veredicto.notaEvidencias") }),
                ]
              : null,
          )
        : el("p", { class: "texto-3", texto: t("replay.veredicto.sinCriterio") }),
    );
  }

  /** Pone en cada píldora el enlace a su intento conservando los parámetros de la vista. */
  function enlazar(enlaceDeIntento) {
    for (const [id, pildora] of pildoras) pildora.setAttribute("href", enlaceDeIntento(id));
  }

  return { nodo, titulo, pintar, enlazar, alternar, abierto: () => abierto };
}
