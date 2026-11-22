// Sección Reviews del Overview (spec §3.5, contrato §7): "Reviews" con sus pestañas (Recent, Live, Delivered,
// Failed), la grilla de tarjetas (páginas de 6), el paginador y la pista de arranque vacío. Las revisiones en cola son
// tarjetas como las demás (píldora "Queued"). Se arma una vez; al refrescar o al cambiar de pestaña, dispositivo o
// página se reconcilia la grilla por tarjeta (key = revisión + dispositivo): las que siguen se actualizan por partes y
// no se mueven, las que salen sueltan sus <img> y las nuevas entran en su lugar. Mientras llega otra página, la
// grilla muestra tarjetas esqueleto.

import { urlDeArchivo, urlDePropuesta } from "../nucleo/datos.js";
import { conservarFoco, el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, tarjetaEsqueleto } from "../nucleo/estados.js";
import { icono, icono24 } from "../nucleo/iconos.js";
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
  TARJETAS_POR_PAGINA,
  insigniaDePestana,
  modeloDeTarjeta,
  numerosDePaginas,
  paginacionDePestana,
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

/** URL de una captura (o null): la «después» del Diseñador si está; si no, { tanda, carpeta, archivo } del Visitante. */
const src = (captura) => (captura?.despues ? urlDePropuesta(captura.despues) : captura ? urlDeArchivo(captura.tanda, captura.carpeta, captura.archivo) : null);

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
 * El paginador: el rango que se ve ("7–12 of 52") y ‹ 1 … 4 5 6 … 9 ›. Cada número es un enlace a su página
 * (`enlace(n)`, el hash del Overview con ?pagina=n): el enrutador lo atiende sin remontar y atrás vuelve a la anterior.
 * La página actual queda enfocable (aria-current) y es el respaldo del foco cuando ‹ o › desaparecen.
 */
function paginador({ pagina, paginas, total, desde, hasta }, enlace, { t, fmt }) {
  const flecha = (direccion, destino) => {
    const etiqueta = t(`overview.paginas.${direccion}`);
    const forma = icono(direccion === "anterior" ? "anterior" : "siguiente");
    return destino
      ? el("a", { class: "ov-pagina ov-pagina-flecha", href: enlace(destino), "aria-label": etiqueta, title: etiqueta, "data-foco": `overview:pagina:${direccion}` }, forma)
      : el("span", { class: "ov-pagina ov-pagina-flecha", "aria-hidden": "true", "data-apagada": "" }, forma);
  };
  return el(
    "nav",
    { class: "ov-paginas", "aria-label": t("overview.paginas.etiqueta") },
    el("span", { class: "ov-paginas-rango", texto: t("overview.paginas.rango", { desde: cifra(desde, fmt), hasta: cifra(hasta, fmt), total: cifra(total, fmt) }) }),
    el(
      "ol",
      { class: "ov-paginas-lista" },
      el("li", {}, flecha("anterior", pagina > 1 ? pagina - 1 : null)),
      numerosDePaginas(pagina, paginas).map((n) =>
        el(
          "li",
          {},
          n === "…"
            ? el("span", { class: "ov-pagina-hueco", "aria-hidden": "true", texto: "…" })
            : el("a", {
                class: "ov-pagina",
                href: enlace(n),
                "aria-label": t("overview.paginas.pagina", { n: cifra(n, fmt) }),
                "aria-current": n === pagina ? "page" : null,
                "data-foco": `overview:pagina:${n}`,
                "data-foco-respaldo": n === pagina ? "" : null,
                texto: cifra(n, fmt),
              }),
        ),
      ),
      el("li", {}, flecha("siguiente", pagina < paginas ? pagina + 1 : null)),
    ),
  );
}

/**
 * Arma la sección. `imagenes`: el banco de <img> de capturas.js; `alElegirPestana(valor)` al elegir una pestaña;
 * `enlaceAPagina(n)`: el hash de la página n de la pestaña activa. → { nodo, actualizar({ overview, dispositivo,
 * pestana, error, esperando }), esperarPagina({ pagina, paginas, total }), subirAlInicio(), soltar() }
 */
export function crearSeccionDeRevisiones(ctx, { imagenes, alElegirPestana, enlaceAPagina }) {
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
  const paginas = el("div", { class: "ov-paginas-caja", hidden: true });
  const panel = el("div", { id: "ov-panel", class: "ov-panel", role: "tabpanel" }, grilla, vacio, paginas);
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
    grilla.removeAttribute("aria-busy");
    vacio.hidden = nodos.length > 0;
    grilla.hidden = nodos.length === 0;
    ponerPaginador(paginacionDePestana(overview, pestana));
  }

  /** El paginador de la pestaña, o nada si cabe en una página. */
  function ponerPaginador(datos) {
    reemplazar(paginas, datos ? paginador(datos, enlaceAPagina, { t, fmt }) : null);
    paginas.hidden = !datos;
  }

  function actualizar({ overview, dispositivo, pestana, error, esperando = false }) {
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
    // Esperando otra página: la grilla y el paginador ya muestran la pedida (esperarPagina).
    if (!esperando) conservarFoco(panel, () => ponerGrilla(overview, dispositivo, pestana));
  }

  /**
   * Mientras llega otra página: las tarjetas que se ven vuelven al banco y en su lugar van tarjetas esqueleto (las de
   * esa página: 6, o las que queden en la última); el paginador ya marca la página pedida.
   */
  function esperarPagina({ pagina, paginas: cuantas, total }) {
    conservarFoco(panel, () => {
      soltar();
      const enEsta = Math.max(1, Math.min(TARJETAS_POR_PAGINA, total - (pagina - 1) * TARJETAS_POR_PAGINA));
      reemplazar(grilla, Array.from({ length: enEsta }, tarjetaEsqueleto));
      grilla.setAttribute("aria-busy", "true");
      grilla.hidden = false;
      vacio.hidden = true;
      const desde = (pagina - 1) * TARJETAS_POR_PAGINA + 1;
      ponerPaginador(cuantas > 1 ? { pagina, paginas: cuantas, total, desde, hasta: desde + enEsta - 1 } : null);
    });
  }

  /** Si la cabecera de Reviews quedó arriba de la ventana (se cambió de página desde abajo), vuelve hasta ella. */
  function subirAlInicio() {
    const arriba = nodo.getBoundingClientRect().top;
    const barra = document.getElementById("barra-superior")?.getBoundingClientRect().height ?? 0;
    if (arriba < barra) scrollTo({ top: Math.max(0, scrollY + arriba - barra - 16), behavior: "instant" });
  }

  /** Al desmontar (o sin tabla): devuelve todos los <img> al banco (ver capturas.js). */
  function soltar() {
    for (const registro of tarjetas.values()) registro.soltar();
    tarjetas.clear();
  }

  return { nodo, actualizar, esperarPagina, subirAlInicio, soltar };
}
