// Sección Reviews del Overview (spec §3.5, contrato §7): "Reviews" con sus pestañas (Recent, Live, Delivered,
// Failed), la grilla de tarjetas, el botón "Show N more" y la pista de arranque vacío. Las revisiones en cola son
// tarjetas como las demás (píldora "Queued"). Se arma una vez; al refrescar, al cambiar de pestaña o dispositivo o al
// sumar más, se reconcilia la grilla por tarjeta (key = revisión + dispositivo): las que siguen se actualizan por
// partes y no se mueven, las que salen sueltan sus <img> y las nuevas se suman abajo.

import { urlDeArchivo } from "../nucleo/datos.js";
import { conservarFoco, el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { icono24 } from "../nucleo/iconos.js";
import { enlaceARevision } from "../nucleo/rutas.js";
import { colorDeCaptura } from "./capturas.js";
import { activarPestanas, marcarPestana } from "./dom-pestanas.js";
import { ponerTexto } from "./dom-agentes.js";
import { crearTarjeta } from "./dom-tarjeta.js";
import { colorDeRespaldo, textoSobre } from "./marca.js";
import {
  ETAPAS,
  PESTANAS,
  columnasDePista,
  hayPista,
  insigniaDePestana,
  masDePestana,
  modeloDeTarjeta,
  tarjetasDePestana,
  tonoDeInsignia,
} from "./tarjetas.js";
import { cifra } from "./textos.js";

const ICONO_DE_ETAPA = { catalog: "catalogo", guide: "ruta", visitor: "visitantes", improver: "tema" };

// El color del texto claro de la inicial, de tokens.css (--texto-1): contra él se decide si la inicial va clara u
// oscura. Se lee una vez, cuando ya cargaron los estilos.
let textoClaro = null;
function colorDelTextoClaro() {
  if (!textoClaro) textoClaro = getComputedStyle(document.documentElement).getPropertyValue("--texto-1").trim() || null;
  return textoClaro;
}

/** URL de una captura { tanda, carpeta, archivo } (o null). */
const src = (captura) => (captura ? urlDeArchivo(captura.tanda, captura.carpeta, captura.archivo) : null);

/**
 * Color de marca de una revisión: el leído de su captura de escritorio; si no hay captura o no se pudo leer, el de
 * respaldo del host; null mientras la captura no carga. → { color, texto: "claro" | "oscuro" } | null
 */
function marcaDe(modelo) {
  const ruta = src(modelo.capturas.desktop);
  const leido = ruta ? colorDeCaptura(ruta) : null;
  if (ruta && leido === undefined) return null;
  const color = leido ?? colorDeRespaldo(modelo.host);
  return { color, texto: textoSobre(color, colorDelTextoClaro()) };
}

function pista(t) {
  return el(
    "li",
    { class: "ov-celda ov-celda-pista" },
    el(
      "div",
      { class: "ov-pista" },
      el("span", { class: "ov-pista-baldosa", "aria-hidden": "true" }, icono24("extension", { tamano: 26 })),
      el("p", { class: "ov-pista-titulo", texto: t("overview.pista.titulo") }),
      el(
        "ol",
        { class: "ov-pista-pasos" },
        ETAPAS.map((fase, indice) =>
          el(
            "li",
            { class: "ov-pista-paso" },
            indice ? icono24("flecha", { ancho: 28, alto: 36, trazo: 1.6, clase: "ov-pista-flecha" }) : null,
            el(
              "span",
              { class: "ov-pista-etapa" },
              el("span", { class: "ov-pista-circulo", "aria-hidden": "true" }, icono24(ICONO_DE_ETAPA[fase])),
              el("span", { class: "ov-pista-nombre", texto: t(`overview.etapa.${fase}`) }),
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * Arma la sección. `imagenes`: el banco de <img> de capturas.js; `alElegirPestana(valor)` al elegir una pestaña;
 * `alPedirMas()` al presionar "Show N more". → { nodo, actualizar({ overview, dispositivo, pestana, error }),
 * cargando(boolean), enfocarTarjeta(indice), soltar() }
 */
export function crearSeccionDeRevisiones(ctx, { imagenes, alElegirPestana, alPedirMas }) {
  const { t, fmt } = ctx;

  const pestanas = PESTANAS.map((id) => {
    const insignia = el("span", { class: "ov-insignia", hidden: true });
    const boton = el(
      "button",
      {
        type: "button",
        role: "tab",
        id: `ov-pestana-${id}`,
        class: "ov-pestana",
        "data-valor": id,
        "data-foco": `overview:pestana:${id}`,
        "aria-selected": "false",
        "aria-controls": "ov-panel",
        tabindex: "-1",
      },
      el("span", { texto: t(`overview.pestana.${id}`) }),
      insignia,
    );
    return { id, boton, insignia };
  });
  const lista = el("div", { class: "ov-pestanas", role: "tablist", "aria-label": t("overview.pestanas") }, pestanas.map((p) => p.boton));
  activarPestanas(lista, { alElegir: alElegirPestana, senal: ctx.senal });

  const aviso = el("div", { class: "ov-aviso-refresco", hidden: true });
  const grilla = el("ul", { class: "ov-grilla" });
  const vacio = el("p", { class: "ov-vacio", hidden: true, texto: t("overview.vacio") });
  // Mientras pide, el botón sigue enfocable (aria-disabled, no disabled: deshabilitarlo le quitaría el foco).
  const mas = el("button", { type: "button", class: "boton boton-secundario ov-mas", "data-foco": "overview:mas", hidden: true });
  mas.addEventListener(
    "click",
    () => {
      if (mas.getAttribute("aria-disabled") !== "true") alPedirMas();
    },
    { signal: ctx.senal },
  );
  const panel = el("div", { id: "ov-panel", class: "ov-panel", role: "tabpanel" }, grilla, vacio, mas);
  const noDisponible = el("div", { class: "ov-no-disponible", hidden: true }, avisoEnLinea(t("overview.noDisponible")));

  const nodo = el(
    "section",
    { class: "ov-revisiones", "aria-labelledby": "ov-revisiones-titulo" },
    el("div", { class: "ov-cabecera" }, el("h2", { id: "ov-revisiones-titulo", class: "ov-titulo", texto: t("comun.shell.revisiones") }), lista),
    aviso,
    noDisponible,
    panel,
  );

  const deps = { t, fmt, imagenes, src, enlace: enlaceARevision, marcaDe };
  /** key → registro de crearTarjeta */
  const tarjetas = new Map();
  let nodoPista = null;
  let conError = null;

  function ponerPestanas(overview, pestana) {
    for (const { id, insignia } of pestanas) {
      const n = insigniaDePestana(id, overview?.cuentas);
      insignia.hidden = n === null;
      if (n !== null) ponerTexto(insignia, cifra(n, fmt));
      const clase = `ov-insignia ov-insignia-${tonoDeInsignia(id, id === pestana)}`;
      if (insignia.className !== clase) insignia.className = clase;
    }
    marcarPestana(lista, pestana);
    panel.setAttribute("aria-labelledby", `ov-pestana-${pestana}`);
  }

  function ponerGrilla(overview, dispositivo, pestana) {
    const modelos = tarjetasDePestana(overview, pestana).map((tarjeta) => modeloDeTarjeta(tarjeta, { dispositivo, ahora: overview.ahora }));
    const claves = new Set(modelos.map((modelo) => modelo.key));
    // Primero salen las que ya no van: así sus <img> quedan libres para las que entran.
    for (const [key, registro] of tarjetas) {
      if (!claves.has(key)) {
        registro.soltar();
        tarjetas.delete(key);
      }
    }
    const nodos = modelos.map((modelo) => {
      let registro = tarjetas.get(modelo.key);
      if (registro) registro.actualizar(modelo);
      else {
        registro = crearTarjeta(modelo, deps);
        tarjetas.set(modelo.key, registro);
      }
      return registro.li;
    });

    if (hayPista(overview, pestana)) {
      nodoPista ??= pista(t);
      // Lo que sobra de la última fila en cada grilla (3, 2 y 1 columnas): la hoja elige con @container.
      nodoPista.style.setProperty("--pista-3", String(columnasDePista(modelos.length, 3)));
      nodoPista.style.setProperty("--pista-2", String(columnasDePista(modelos.length, 2)));
      nodos.push(nodoPista);
    }

    // Solo se mueve lo que no está en su lugar: las que ya estaban se quedan y las nuevas se suman abajo (mover un
    // nodo enfocado le quita el foco; conservarFoco lo devuelve).
    nodos.forEach((nodoDeCelda, indice) => {
      if (grilla.children[indice] !== nodoDeCelda) grilla.insertBefore(nodoDeCelda, grilla.children[indice] ?? null);
    });
    while (grilla.children.length > nodos.length) grilla.lastElementChild.remove();
    vacio.hidden = nodos.length > 0;
    grilla.hidden = nodos.length === 0;

    const faltan = masDePestana(overview, pestana);
    mas.hidden = !faltan;
    if (faltan) ponerTexto(mas, t("overview.verMas", { n: faltan.siguiente, cifra: cifra(faltan.siguiente, fmt) }));
  }

  function actualizar({ overview, dispositivo, pestana, error }) {
    if (conError !== error) {
      conError = error;
      reemplazar(aviso, error ? avisoEnLinea(t("overview.errorAlRefrescar"), "atencion") : null);
      // Vacío y visible, sumaría otro hueco de la sección entre la cabecera y la grilla.
      aviso.hidden = !error;
    }
    const disponible = overview?.disponible === true;
    lista.hidden = !disponible;
    noDisponible.hidden = disponible;
    panel.hidden = !disponible;
    if (!disponible) {
      soltar();
      return;
    }
    ponerPestanas(overview, pestana);
    conservarFoco(panel, () => ponerGrilla(overview, dispositivo, pestana));
  }

  /** Mientras se piden más: el botón no responde y la grilla se marca ocupada. */
  function cargando(si) {
    if (si) mas.setAttribute("aria-disabled", "true");
    else mas.removeAttribute("aria-disabled");
    if (si) grilla.setAttribute("aria-busy", "true");
    else grilla.removeAttribute("aria-busy");
  }

  /** Enfoca el enlace principal de la tarjeta `indice` de la grilla (la primera nueva, si el botón ya no está). */
  function enfocarTarjeta(indice) {
    grilla.children[indice]?.querySelector(".ov-tarjeta-enlace")?.focus();
  }

  /** Al desmontar (o sin tabla): devuelve todos los <img> al banco (ver capturas.js). */
  function soltar() {
    for (const registro of tarjetas.values()) registro.soltar();
    tarjetas.clear();
  }

  return { nodo, actualizar, cargando, enfocarTarjeta, soltar };
}
