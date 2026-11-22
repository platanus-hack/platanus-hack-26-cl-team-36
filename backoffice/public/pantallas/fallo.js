// La hoja de una revisión fallida (#/f/<revision>): el panel debajo de la cabecera compartida (nucleo/marco-tanda.js,
// montarMarcoDeFallo). A la izquierda la página revisada, en gris; a la derecha la cadena de los cuatro agentes: los
// que terminaron, el que falló (en rojo, con el motivo, cuánto duró, hace cuánto, el id y su manifest.json) y los que
// no corrieron, en gris. El modelo está en fallo/modelo.js.

import { pedirRevision, pedirTarjeta, urlDeArchivo, urlDeResultado } from "../nucleo/datos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { icono, icono24 } from "../nucleo/iconos.js";
import { enlaceARevisiones } from "../nucleo/rutas.js";
import { modeloDeFalla } from "../fallo/modelo.js";

const ICONO_DE_ETAPA = { catalog: "catalogo", guide: "ruta", visitor: "visitantes", improver: "tema" };

function captura(modelo, t) {
  const caja = el("div", { class: "fallo-captura" });
  const barra = el(
    "div",
    { class: "fallo-cromo", "aria-hidden": "true" },
    el("span", { class: "fallo-cromo-puntos" }, el("i"), el("i"), el("i")),
    el("span", { class: "fallo-cromo-url", texto: modelo.host }),
  );
  if (!modelo.captura) {
    caja.append(barra, el("div", { class: "fallo-captura-vacia" }, el("span", { texto: (modelo.sitio || modelo.host || "?").slice(0, 1).toUpperCase() })));
    return caja;
  }
  const { tanda, carpeta, archivo } = modelo.captura;
  const img = el("img", { src: urlDeArchivo(tanda, carpeta, archivo), alt: t("fallo.captura", { sitio: modelo.sitio || modelo.host }), loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(el("div", { class: "fallo-captura-vacia" })), { once: true });
  caja.append(barra, el("div", { class: "fallo-captura-imagen" }, img));
  return caja;
}

function cajaDelError(modelo, ctx) {
  const { t, fmt } = ctx;
  const meta = [
    modelo.segundos !== null ? el("span", { texto: t("fallo.duro", { duracion: fmt.duracion(modelo.segundos) }) }) : null,
    modelo.actualizada ? el("time", { datetime: modelo.actualizada, title: fmt.fechaLegible(modelo.actualizada), texto: fmt.tiempoRelativo(modelo.actualizada, ctx.ahora) }) : null,
    el("code", { class: "fallo-id", texto: modelo.revision }),
  ];
  const acciones = [
    modelo.manifiesto
      ? el("a", { class: "boton boton-secundario fallo-boton", href: urlDeResultado(modelo.manifiesto), target: "_blank", rel: "noreferrer noopener" }, icono("documento"), el("span", { texto: t("fallo.manifiesto") }))
      : null,
    modelo.anteriores
      ? el("a", { class: "boton boton-secundario fallo-boton", href: enlaceARevisiones("historial") }, el("span", { texto: t("fallo.anteriores", { n: modelo.anteriores }) }))
      : null,
  ].filter(Boolean);
  return el(
    "div",
    { class: "fallo-error" },
    el("p", { class: "fallo-motivo" }, icono24("alerta", { tamano: 15, trazo: 2 }), el("span", { texto: t(`fallo.motivo.${modelo.motivo.tipo}`) })),
    modelo.motivo.detalle ? el("p", { class: "fallo-detalle", texto: modelo.motivo.detalle }) : null,
    el("p", { class: "fallo-meta" }, meta),
    acciones.length ? el("div", { class: "fallo-acciones" }, acciones) : null,
  );
}

function cadena(modelo, ctx) {
  const { t } = ctx;
  return el(
    "ol",
    { class: "fallo-cadena", "aria-label": t("fallo.cadena") },
    modelo.etapas.map(({ fase, estado }) =>
      el(
        "li",
        { class: `fallo-paso fallo-paso-${estado}` },
        el(
          "span",
          { class: "fallo-circulo", "aria-hidden": "true" },
          estado === "fallido" ? icono24("cruz", { tamano: 16, trazo: 2.2 }) : estado === "hecho" ? icono("check") : icono24(ICONO_DE_ETAPA[fase], { tamano: 16 }),
        ),
        el(
          "div",
          { class: "fallo-paso-cuerpo" },
          el(
            "p",
            { class: "fallo-paso-titulo" },
            el("span", { class: "fallo-paso-nombre", texto: t(`fallo.etapa.${fase}`) }),
            estado === "fallido" ? null : el("span", { class: `fallo-chip fallo-chip-${estado}`, texto: t(`fallo.estado.${estado}`) }),
          ),
          estado === "fallido" ? cajaDelError(modelo, ctx) : null,
        ),
      ),
    ),
  );
}

export default {
  titulo(ctx) {
    return ctx.t("fallo.titulo");
  },

  /** La tarjeta y el avance de la revisión, y la hoja de estilos. → { modelo, ahora, cabecera } */
  async cargar(ctx) {
    const revision = ctx.ruta.revision;
    const [respuesta, avance] = await Promise.all([
      pedirTarjeta(revision).catch(() => null),
      pedirRevision(revision).catch(() => null),
      ctx.cargarEstilos("estilos/fallo.css"),
    ]);
    if (!respuesta?.tarjeta && !avance) throw new Error(`No existe la revisión ${revision}`);
    const modelo = modeloDeFalla({ tarjeta: respuesta?.tarjeta ?? null, avance, revision });
    return { modelo, ahora: respuesta?.ahora ?? null, cabecera: { sitio: modelo.sitio, host: modelo.host, url: modelo.url, etapa: modelo.etapa } };
  },

  async montar(contenedor, ctx, cargado) {
    cargado ??= await this.cargar(ctx);
    if (ctx.senal.aborted) return;
    const { modelo } = cargado;
    const ahora = cargado.ahora ? Date.parse(cargado.ahora) : Date.now();
    contenedor.classList.add("p-fallo");
    reemplazar(contenedor, el("div", { class: "fallo" }, captura(modelo, ctx.t), cadena(modelo, { ...ctx, ahora })));
  },
};
