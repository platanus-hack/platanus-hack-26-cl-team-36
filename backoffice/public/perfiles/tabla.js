// Perfiles: tabla de intentos (diseño §10.7, bloque "Intentos"). Una fila por intento, ordenable con ?orden=,
// con Δ ruta y tropiezos teñidos, la tira de las primeras capturas y cada fila como enlace al Replay. Los "no aplica"
// (null) se ven como "—" con el motivo en el globo y en texto oculto; nunca como 0. Bajo 720 px las filas son
// tarjetas (las etiquetas salen de data-etiqueta).

import { el } from "../nucleo/dom.js";
import { conGlobo } from "../nucleo/globo.js";
import { icono, insignia } from "../nucleo/iconos.js";
import { COLUMNAS_ORDENABLES, filasDeIntentos, ordenarFilas } from "./escalas.js";
import { enlaceAReplay } from "./graficos.js";

const CAPTURAS_EN_LA_TIRA = 6;

const COLUMNAS = [...COLUMNAS_ORDENABLES, "recorrido"];
const NUMERICAS = new Set(["pasos", "delta", "hitos", "tropiezos", "tiempo", "costo"]);

function noAplica(motivo, ctx) {
  const texto = ctx.t("perfiles.tabla.noAplica", { motivo: ctx.t(`perfiles.tabla.motivo.${motivo}`) });
  const nodo = el("span", { class: "no-aplica" }, el("span", { "aria-hidden": "true", texto: "—" }), el("span", { class: "visualmente-oculto", texto }));
  return conGlobo(nodo, texto, { senal: ctx.senal });
}

function tiraDeCapturas(intento, ctx) {
  const capturas = (intento?.pasos ?? []).map((paso) => paso.captura).filter(Boolean).slice(0, CAPTURAS_EN_LA_TIRA);
  if (!capturas.length) return null;
  return el(
    "span",
    { class: "tira", "aria-hidden": "true" },
    capturas.map((archivo) =>
      el("img", { src: ctx.urlDeArchivo(intento.id, archivo), alt: "", loading: "lazy", decoding: "async", width: 44, height: 28 }),
    ),
  );
}

function celdaDe(columna, fila, intento, maximos, ctx) {
  const { t, fmt } = ctx;
  const etiqueta = t(`perfiles.tabla.columna.${columna}`);
  const td = (contenido, extra = {}) =>
    el("td", { class: NUMERICAS.has(columna) ? "num" : null, "data-etiqueta": etiqueta, ...extra }, contenido);
  switch (columna) {
    case "perfil": {
      const nombre = fila.variosPorPerfil ? `${fila.nombre} · ${fila.id}` : fila.nombre;
      return el(
        "th",
        { scope: "row", class: "perfiles-celda-perfil", "data-etiqueta": etiqueta },
        el("a", {
          class: "perfiles-fila-enlace",
          href: enlaceAReplay(ctx, fila.destino),
          "data-foco": `perfiles:fila:${fila.id}`,
          "aria-label": t("perfiles.tabla.abrir", { nombre }),
          texto: nombre,
        }),
      );
    }
    case "resultado":
      return td(insignia(fila.resultado, { logro: fila.logro }));
    case "pasos":
      return td(fila.pasos === null ? noAplica("error", ctx) : fmt.numero(fila.pasos));
    case "delta": {
      if (fila.delta === null) return td(noAplica(fila.motivoDelta ?? "error", ctx));
      const intensidad = fila.delta > 0 && maximos.delta > 0 ? fila.delta / maximos.delta : 0;
      return td(fmt.numero(fila.delta, { signDisplay: "exceptZero" }), { class: "num perfiles-tinte", estilo: { "--v": intensidad.toFixed(3) } });
    }
    case "hitos":
      return td(fila.hitos === null ? noAplica(fila.error ? "error" : "sinRuta", ctx) : fmt.conteo(fila.hitos));
    case "tropiezos": {
      if (fila.tropiezos === null) return td(noAplica("error", ctx));
      const intensidad = maximos.tropiezos > 0 ? fila.tropiezos / maximos.tropiezos : 0;
      return td(fmt.numero(fila.tropiezos), { class: "num perfiles-tinte", estilo: { "--v": intensidad.toFixed(3) } });
    }
    case "tiempo":
      return td(fila.segundos === null ? noAplica("error", ctx) : el("span", { texto: fmt.duracion(fila.segundos) }));
    case "costo":
      return td(
        fila.costo === null
          ? noAplica("sinCosto", ctx)
          : t("perfiles.tabla.costo", { valor: fmt.numero(fila.costo, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
      );
    case "recorrido":
      return td(tiraDeCapturas(intento, ctx), { class: "perfiles-celda-tira" });
    default:
      return td("");
  }
}

function cabecera(orden, ctx, alOrdenar) {
  const { t } = ctx;
  return el(
    "thead",
    {},
    el(
      "tr",
      {},
      COLUMNAS.map((columna) => {
        const texto = t(`perfiles.tabla.columna.${columna}`);
        const definicion = t(`perfiles.tabla.definicion.${columna}`);
        const clase = NUMERICAS.has(columna) ? "num" : null;
        if (!COLUMNAS_ORDENABLES.includes(columna)) {
          const th = el("th", { scope: "col", class: clase }, el("span", { texto }));
          return conGlobo(th, definicion, { senal: ctx.senal });
        }
        const activa = orden?.columna === columna;
        const boton = el(
          "button",
          { type: "button", class: "tabla-orden", "data-foco": `perfiles:orden:${columna}`, onclick: () => alOrdenar(columna) },
          el("span", { texto }),
          activa ? icono(orden.descendente ? "orden-desc" : "orden-asc") : null,
        );
        conGlobo(boton, () => el("span", {}, el("span", { class: "texto-1", texto: t("perfiles.tabla.ordenarPor", { columna: texto }) }), el("br"), el("span", { texto: definicion })), { senal: ctx.senal });
        return el("th", { scope: "col", class: clase, "aria-sort": activa ? (orden.descendente ? "descending" : "ascending") : null }, boton);
      }),
      el("th", { scope: "col", class: "perfiles-celda-ir" }, el("span", { class: "visualmente-oculto", texto: t("perfiles.tabla.columna.abrir") })),
    ),
  );
}

function cuerpo(tanda, orden, ctx) {
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  const filas = ordenarFilas(filasDeIntentos(tanda), orden);
  const maximos = {
    delta: Math.max(0, ...filas.map((fila) => fila.delta ?? 0)),
    tropiezos: Math.max(0, ...filas.map((fila) => fila.tropiezos ?? 0)),
  };
  return el(
    "tbody",
    {},
    filas.map((fila) => {
      const intento = intentos.get(fila.id);
      const tr = el(
        "tr",
        { class: `perfiles-fila${fila.error ? " perfiles-fila-error" : ""}`, "data-intento": fila.id },
        COLUMNAS.map((columna) => celdaDe(columna, fila, intento, maximos, ctx)),
        el("td", { class: "perfiles-celda-ir", "aria-hidden": "true" }, icono("siguiente")),
      );
      return tr;
    }),
  );
}

/**
 * Arma la tabla. → { raiz, actualizar(orden) }. Un clic en cualquier parte de una fila abre su Replay (el enlace
 * de la primera celda es el destino accesible por teclado).
 */
export function tablaDeIntentos(tanda, orden, ctx, alOrdenar) {
  const tabla = el("table", { class: "tabla perfiles-tabla" }, el("caption", { class: "visualmente-oculto", texto: ctx.t("perfiles.tabla.titulo") }));
  const poner = (nuevoOrden) => {
    const nuevo = [cabecera(nuevoOrden, ctx, alOrdenar), cuerpo(tanda, nuevoOrden, ctx)];
    tabla.querySelector("thead")?.remove();
    tabla.querySelector("tbody")?.remove();
    tabla.append(...nuevo);
  };
  poner(orden);
  tabla.addEventListener(
    "click",
    (evento) => {
      if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      const objetivo = evento.target instanceof Element ? evento.target : null;
      if (!objetivo || objetivo.closest("a, button")) return;
      if (getSelection?.()?.toString()) return; // se estaba seleccionando texto
      const enlace = objetivo.closest("tr.perfiles-fila")?.querySelector("a.perfiles-fila-enlace");
      if (enlace) ctx.navegar(enlace.getAttribute("href"));
    },
    { signal: ctx.senal },
  );
  return { raiz: el("div", { class: "perfiles-tabla-caja" }, tabla), actualizar: poner };
}
