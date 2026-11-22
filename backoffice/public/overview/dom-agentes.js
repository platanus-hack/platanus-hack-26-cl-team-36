// Bloque de agentes del Overview (spec §3.3, §3.4): el total, las fichas de dispositivo, una fila por rol con su
// matriz de cuadritos y la leyenda. Se arma una vez al montar; `actualizar(modelo)` solo cambia lo que cambió (los
// cuadritos de una fila se rehacen si cambian sus cuentas), así refrescar no parpadea ni mueve el foco.

import { el, reemplazar } from "../nucleo/dom.js";
import { icono24 } from "../nucleo/iconos.js";
import { DISPOSITIVOS, ROLES } from "./agentes.js";
import { activarPestanas, marcarPestana } from "./dom-pestanas.js";
import { cifra, nombreDeEstado, resumenDeFila, textoDeExito } from "./textos.js";

const ICONO_DE_ROL = { cataloger: "catalogo", guide: "ruta", visitor: "visitantes", improver: "tema" };
const ICONO_DE_DISPOSITIVO = { all: "dispositivos", desktop: "escritorio", mobile: "movil" };
const TONOS = ["logrado", "aviso", "fallido", "neutro"];

/** Cambia el texto de un nodo solo si es otro (no toca el DOM de más). */
export function ponerTexto(nodo, texto) {
  if (nodo.textContent !== texto) nodo.textContent = texto;
}

/** Deja en `nodo` una sola clase `ov-tono-<tono>` de las conocidas. */
export function ponerTono(nodo, tono) {
  for (const otro of TONOS) nodo.classList.toggle(`ov-tono-${otro}`, otro === tono);
}

/** Los cuadritos de una fila: un <span> por cuadrito, en el orden de dibujo (los grupos ya vienen ordenados). */
function cuadritos(grupos) {
  const fragmento = document.createDocumentFragment();
  for (const { estado, n } of grupos) {
    for (let i = 0; i < n; i++) fragmento.append(el("span", { class: `ov-q ov-q-${estado}` }));
  }
  return fragmento;
}

/**
 * Arma el bloque. `alElegirDispositivo(valor)` al elegir una ficha (la pantalla escribe el hash y redibuja).
 * → { nodo, actualizar(modelo de modeloDeAgentes) }
 */
export function crearBloqueDeAgentes(ctx, { alElegirDispositivo }) {
  const { t, fmt } = ctx;

  // El total rotula la sección de agentes (aria-labelledby), pero no es un encabezado: el h1 es el título de la página.
  const totalCifra = el("span", { class: "ov-total-cifra" });
  const totalUnidad = el("span", { class: "ov-total-unidad" });
  const titulo = el("p", { id: "ov-agentes-titulo", class: "ov-total" }, totalCifra, " ", totalUnidad);

  const fichas = DISPOSITIVOS.map((id) => {
    const cuenta = el("span", { class: "ov-dispositivo-cifra" });
    const boton = el(
      "button",
      {
        type: "button",
        role: "tab",
        id: `ov-dispositivo-${id}`,
        class: "ov-dispositivo",
        "data-valor": id,
        "data-foco": `overview:dispositivo:${id}`,
        "aria-selected": "false",
        "aria-controls": "ov-roles",
        tabindex: "-1",
      },
      icono24(ICONO_DE_DISPOSITIVO[id]),
      el("span", { class: "ov-dispositivo-texto" }, cuenta, el("span", { class: "ov-dispositivo-nombre", texto: t(`overview.dispositivo.${id}`) })),
    );
    return { id, boton, cuenta };
  });
  const listaDeFichas = el(
    "div",
    { class: "ov-dispositivos", role: "tablist", "aria-label": t("overview.dispositivo.etiqueta") },
    fichas.map((ficha) => ficha.boton),
  );
  activarPestanas(listaDeFichas, { alElegir: alElegirDispositivo, senal: ctx.senal });

  const filas = ROLES.map((rol, indice) => {
    const resumen = el("span", { class: "visualmente-oculto" });
    const cuenta = el("span", { class: "ov-rol-cifra", "aria-hidden": "true" });
    const matriz = el("span", { class: "ov-cuadritos", "aria-hidden": "true" });
    const exito = el("span", { class: "ov-rol-exito", "aria-hidden": "true", title: t("comun.resultado.logrado") });
    const nodo = el(
      "li",
      { class: `ov-rol ov-rol-${rol}` },
      resumen,
      el(
        "span",
        { class: "ov-rol-icono", "aria-hidden": "true" },
        el("span", { class: "ov-rol-baldosa" }, icono24(ICONO_DE_ROL[rol])),
        indice < ROLES.length - 1 ? el("span", { class: "ov-rol-conector" }) : null,
      ),
      el("span", { class: "ov-rol-nombre", "aria-hidden": "true", texto: t(`overview.rol.${rol}`) }),
      cuenta,
      matriz,
      exito,
    );
    return { rol, nodo, resumen, cuenta, matriz, exito, firma: null };
  });
  const porRol = new Map(filas.map((fila) => [fila.rol, fila]));

  const leyenda = el("ul", { class: "ov-leyenda", "aria-hidden": "true" });
  let firmaDeLeyenda = null;

  const nodo = el(
    "section",
    { class: "ov-agentes", "aria-labelledby": "ov-agentes-titulo" },
    el("div", { class: "ov-agentes-cabecera" }, titulo, listaDeFichas),
    el("ul", { id: "ov-roles", class: "ov-roles", "aria-label": t("overview.agentes.etiqueta") }, filas.map((fila) => fila.nodo)),
    leyenda,
  );

  function actualizar(modelo) {
    ponerTexto(totalCifra, cifra(modelo.total, fmt));
    ponerTexto(totalUnidad, t("overview.agentes.unidad", { n: modelo.total }));

    for (const { id, n } of modelo.dispositivos) {
      const ficha = fichas.find((cada) => cada.id === id);
      ponerTexto(ficha.cuenta, cifra(n, fmt));
      const titulo = t("overview.dispositivo.visitantes", { n, cifra: cifra(n, fmt) });
      if (ficha.boton.title !== titulo) ficha.boton.title = titulo;
    }
    marcarPestana(listaDeFichas, modelo.dispositivo);

    for (const fila of modelo.filas) {
      const nodos = porRol.get(fila.rol);
      ponerTexto(nodos.cuenta, cifra(fila.n, fmt));
      ponerTexto(nodos.exito, textoDeExito(fila.exito, fmt));
      ponerTono(nodos.exito, fila.exito.tono);
      ponerTexto(nodos.resumen, resumenDeFila(fila, { t, fmt }));
      const firma = JSON.stringify(fila.cuadritos);
      if (firma !== nodos.firma) {
        nodos.firma = firma;
        reemplazar(nodos.matriz, cuadritos(fila.cuadritos));
      }
    }

    const firma = JSON.stringify([modelo.leyenda, modelo.k]);
    if (firma !== firmaDeLeyenda) {
      firmaDeLeyenda = firma;
      reemplazar(
        leyenda,
        modelo.leyenda.map((estado) =>
          el("li", { class: "ov-leyenda-item" }, el("span", { class: `ov-muestra ov-m-${estado}` }), nombreDeEstado(estado, t)),
        ),
        modelo.k > 1 ? el("li", { class: "ov-leyenda-item ov-leyenda-escala", texto: t("overview.leyenda.escala", { k: modelo.k, cifra: cifra(modelo.k, fmt) }) }) : null,
      );
    }
  }

  return { nodo, actualizar };
}
