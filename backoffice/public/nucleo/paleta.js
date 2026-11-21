// Paleta de comandos ⌘K (diseño §5.6): <dialog> con un combobox y un listbox. El foco del DOM queda en el campo;
// la opción activa va en aria-activedescendant. ↑/↓ mueven, Enter abre, Mod+Enter abre en otra pestaña, Esc
// cierra. Sin animación al abrir (se usa muchas veces).
//
// Grupos: "tanda" (En esta tanda, lo registra el marco), "tandas" y "acciones". Consulta vacía: lo de la tanda
// actual, las 5 tandas más nuevas y las acciones.

import { esMac, kbd } from "./atajos.js";
import { filtrarOpciones } from "./buscar.js";
import { el } from "./dom.js";
import { t } from "./i18n.js";
import { icono } from "./iconos.js";

const ORDEN_DE_GRUPOS = ["tanda", "tandas", "acciones"];
const RECIENTES = 5;

/** @typedef {{ id: string, grupo: string, titulo: string, subtitulo?: string, palabras?: string,
 *              href?: string, accion?: () => void, icono?: string }} Opcion */

const fuentes = new Set();
let dialogo = null;
let entrada = null;
let lista = null;
let estado = null;
let opciones = [];
let visibles = [];
let activa = 0;
let irA = (href) => {
  location.hash = href;
};

/** Agrega una fuente de opciones (() => Opcion[]). → quitar(). */
export function registrarFuenteDePaleta(fuente) {
  fuentes.add(fuente);
  return () => fuentes.delete(fuente);
}

/** Configura cómo navega la paleta (el enrutador). */
export function iniciarPaleta({ navegar } = {}) {
  if (navegar) irA = navegar;
}

function recolectar() {
  const todas = [];
  for (const fuente of fuentes) {
    try {
      todas.push(...(fuente() ?? []));
    } catch (error) {
      console.error("paleta: una fuente falló", error);
    }
  }
  return todas;
}

function elegirVisibles(consulta) {
  if (consulta.trim()) return filtrarOpciones(opciones, consulta, 50);
  const tanda = opciones.filter((opcion) => opcion.grupo === "tanda");
  const tandas = opciones.filter((opcion) => opcion.grupo === "tandas").slice(0, RECIENTES);
  const resto = opciones.filter((opcion) => !["tanda", "tandas"].includes(opcion.grupo));
  return [...tanda, ...tandas, ...resto];
}

function agrupar(lista) {
  const grupos = new Map();
  for (const opcion of lista) {
    if (!grupos.has(opcion.grupo)) grupos.set(opcion.grupo, []);
    grupos.get(opcion.grupo).push(opcion);
  }
  // Sin consulta, el orden fijo; con consulta, los grupos en el orden de su mejor resultado.
  return [...grupos.entries()];
}

const idDeOpcion = (indice) => `paleta-opcion-${indice}`;

function marcarActiva(indice, { desplazar = true } = {}) {
  if (!visibles.length) {
    entrada.removeAttribute("aria-activedescendant");
    return;
  }
  activa = (indice + visibles.length) % visibles.length;
  for (const nodo of lista.querySelectorAll('[role="option"]')) {
    nodo.setAttribute("aria-selected", nodo.id === idDeOpcion(activa) ? "true" : "false");
  }
  entrada.setAttribute("aria-activedescendant", idDeOpcion(activa));
  if (desplazar) document.getElementById(idDeOpcion(activa))?.scrollIntoView({ block: "nearest" });
}

function dibujar() {
  const consulta = entrada.value;
  visibles = elegirVisibles(consulta);
  const grupos = consulta.trim()
    ? agrupar(visibles)
    : agrupar(visibles).sort(([a], [b]) => ORDEN_DE_GRUPOS.indexOf(a) - ORDEN_DE_GRUPOS.indexOf(b));
  // El índice plano sigue el orden en que se dibujan.
  visibles = grupos.flatMap(([, lista]) => lista);
  let indice = 0;
  lista.replaceChildren(
    ...grupos.map(([grupo, delGrupo]) => {
      const idTitulo = `paleta-grupo-${grupo}`;
      return el(
        "div",
        { role: "group", "aria-labelledby": idTitulo, class: "paleta-grupo" },
        el("div", { id: idTitulo, role: "presentation", class: "paleta-grupo-titulo etiqueta-micro", texto: ORDEN_DE_GRUPOS.includes(grupo) ? t(`comun.paleta.grupo.${grupo}`) : grupo }),
        delGrupo.map((opcion) => {
          const mio = indice;
          indice += 1;
          return el(
            "div",
            {
              id: idDeOpcion(mio),
              role: "option",
              class: "paleta-opcion",
              "aria-selected": "false",
              onpointermove: () => activa !== mio && marcarActiva(mio, { desplazar: false }),
              onclick: (evento) => activar(opcion, { nuevaPestana: esMac ? evento.metaKey : evento.ctrlKey }),
            },
            el("span", { class: "paleta-opcion-icono" }, icono(opcion.icono ?? "siguiente")),
            el("span", { class: "paleta-opcion-titulo truncar", texto: opcion.titulo }),
            opcion.subtitulo ? el("span", { class: "paleta-opcion-subtitulo truncar", texto: opcion.subtitulo }) : null,
          );
        }),
      );
    }),
  );
  if (!visibles.length) {
    lista.append(el("p", { class: "paleta-vacia", role: "presentation", texto: t("comun.paleta.sinResultados", { consulta }) }));
  }
  estado.textContent = consulta.trim() ? t("comun.paleta.resultados", { n: visibles.length }) : "";
  marcarActiva(0);
}

function cerrar() {
  if (dialogo?.open) dialogo.close();
}

function activar(opcion, { nuevaPestana = false } = {}) {
  if (!opcion) return;
  if (nuevaPestana && opcion.href) {
    window.open(new URL(opcion.href, location.href).href, "_blank", "noopener");
    return;
  }
  cerrar();
  if (opcion.href) irA(opcion.href);
  else opcion.accion?.();
}

function alTeclear(evento) {
  const mod = esMac ? evento.metaKey : evento.ctrlKey;
  if (evento.key === "ArrowDown" || (evento.key === "n" && evento.ctrlKey)) {
    evento.preventDefault();
    marcarActiva(activa + 1);
  } else if (evento.key === "ArrowUp" || (evento.key === "p" && evento.ctrlKey)) {
    evento.preventDefault();
    marcarActiva(activa - 1);
  } else if (evento.key === "Enter") {
    evento.preventDefault();
    activar(visibles[activa], { nuevaPestana: mod });
  } else if (mod && evento.key.toLowerCase() === "k") {
    evento.preventDefault();
    cerrar();
  } else if (evento.key === "PageDown" || evento.key === "PageUp") {
    evento.preventDefault();
    marcarActiva(activa + (evento.key === "PageDown" ? 8 : -8));
  }
}

function construir() {
  if (dialogo?.isConnected && entrada) return;
  dialogo = document.getElementById("paleta") ?? document.body.appendChild(el("dialog", { id: "paleta", class: "paleta" }));
  entrada = el("input", {
    class: "paleta-entrada",
    type: "text",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": "paleta-lista",
    "aria-autocomplete": "list",
    autocomplete: "off",
    spellcheck: "false",
  });
  lista = el("div", { id: "paleta-lista", class: "paleta-lista", role: "listbox" });
  estado = el("p", { class: "visualmente-oculto", "aria-live": "polite" });
  entrada.addEventListener("input", dibujar);
  entrada.addEventListener("keydown", alTeclear);
  dialogo.addEventListener("click", (evento) => {
    if (evento.target === dialogo) cerrar();
  });
}

function rotular() {
  dialogo.setAttribute("aria-label", t("comun.paleta.etiqueta"));
  entrada.setAttribute("placeholder", t("comun.paleta.marcador"));
  entrada.setAttribute("aria-label", t("comun.paleta.etiqueta"));
  lista.setAttribute("aria-label", t("comun.paleta.etiqueta"));
  const pista = (tecla, clave) => el("span", { class: "paleta-pista" }, kbd(tecla), el("span", { texto: t(clave) }));
  dialogo.replaceChildren(
    el("div", { class: "paleta-cabecera" }, icono("buscar"), entrada),
    lista,
    el(
      "footer",
      { class: "paleta-pie" },
      el("span", { class: "paleta-pista" }, kbd("ArrowUp"), kbd("ArrowDown"), el("span", { texto: t("comun.paleta.navegar") })),
      pista("Enter", "comun.paleta.abrir"),
      pista("Mod+Enter", "comun.paleta.nuevaPestana"),
      pista("Escape", "comun.paleta.cerrar"),
    ),
    estado,
  );
}

/** Abre la paleta (o la deja abierta) con el campo vacío. */
export function abrirPaleta() {
  construir();
  rotular();
  opciones = recolectar();
  entrada.value = "";
  dibujar();
  if (!dialogo.open) dialogo.showModal();
  entrada.focus();
}
