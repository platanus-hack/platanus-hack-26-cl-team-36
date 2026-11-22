// Sección Reviews del Overview (spec §3.5): "Reviews" con sus pestañas (Recent, Live, Delivered, Failed), la grilla
// de tarjetas, el enlace a la lista completa, la pista de arranque vacío y la franja "Up next". Se arma una vez; al
// refrescar o al cambiar de pestaña o dispositivo se reconcilia la grilla por tarjeta (key = revisión + dispositivo):
// las que siguen se actualizan por partes, las que salen sueltan sus <img> y las nuevas los toman.

import { urlDeArchivo } from "../nucleo/datos.js";
import { conservarFoco, el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { icono24 } from "../nucleo/iconos.js";
import * as rutas from "../nucleo/rutas.js";
import { colorDeCaptura } from "./capturas.js";
import { activarPestanas, marcarPestana } from "./dom-pestanas.js";
import { ponerTexto } from "./dom-agentes.js";
import { crearTarjeta } from "./dom-tarjeta.js";
import { colorDeRespaldo, textoSobre } from "./marca.js";
import {
  ETAPAS,
  PESTANAS,
  colaDeOverview,
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

// Los enlaces salen de nucleo/rutas.js; con un respaldo por si una versión vieja no exporta enlaceARevisiones.
const enlaceARevision = (revision) => rutas.enlaceARevision(revision);
const enlaceARevisiones = (estado) =>
  typeof rutas.enlaceARevisiones === "function" ? rutas.enlaceARevisiones(estado) : `#/revisiones${estado ? `?estado=${encodeURIComponent(estado)}` : ""}`;

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
  return { color, texto: textoSobre(color) };
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

/** Un ítem de "Up next": miniatura (escritorio 40×24, o móvil 16×28 con el filtro Mobile), nombre y ruta. */
function crearItemDeCola(tarjeta, dispositivo, { imagenes }) {
  const captura = dispositivo === "mobile" ? tarjeta.capturas?.mobile : tarjeta.capturas?.desktop;
  const ruta = src(captura ?? null);
  const img = ruta ? imagenes.tomar(ruta) : null;
  img?.setAttribute("class", "ov-cola-miniatura");
  const a = el(
    "a",
    { class: "ov-cola-item", href: enlaceARevision(tarjeta.revision), "data-foco": `overview:cola:${tarjeta.revision}` },
    img ?? el("span", { class: "ov-cola-miniatura ov-marcador", "aria-hidden": "true" }),
    el("span", { class: "ov-cola-nombre", texto: tarjeta.sitio || tarjeta.host || tarjeta.revision }),
    el("span", { class: "ov-cola-ruta", texto: tarjeta.ruta ?? "/" }),
  );
  const marca = colorDeCaptura(src(tarjeta.capturas?.desktop ?? null)) ?? colorDeRespaldo(tarjeta.host);
  a.style.setProperty("--marca", marca);
  return { li: el("li", {}, a), img, firma: JSON.stringify([tarjeta.sitio, tarjeta.host, tarjeta.ruta, ruta]) };
}

/**
 * Arma la sección. `imagenes`: el banco de <img> de capturas.js; `alElegirPestana(valor)` al elegir una pestaña.
 * → { nodo, actualizar({ overview, dispositivo, pestana, error }), soltar() }
 */
export function crearSeccionDeRevisiones(ctx, { imagenes, alElegirPestana }) {
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
  const mas = el("a", { class: "ov-mas", hidden: true });
  const panel = el("div", { id: "ov-panel", class: "ov-panel", role: "tabpanel" }, grilla, vacio, mas);
  const colaLista = el("ul", { class: "ov-cola-lista" });
  const colaMas = el("span", { class: "ov-cola-mas", hidden: true });
  const cola = el("div", { class: "ov-cola", hidden: true }, el("span", { class: "ov-cola-titulo", texto: t("overview.cola.titulo") }), colaLista, colaMas);
  const noDisponible = el("div", { class: "ov-no-disponible", hidden: true }, avisoEnLinea(t("overview.noDisponible")));

  const nodo = el(
    "section",
    { class: "ov-revisiones", "aria-labelledby": "ov-revisiones-titulo" },
    el("div", { class: "ov-cabecera" }, el("h2", { id: "ov-revisiones-titulo", class: "ov-titulo", texto: t("comun.shell.revisiones") }), lista),
    aviso,
    noDisponible,
    panel,
    cola,
  );

  const deps = { t, fmt, imagenes, src, enlace: enlaceARevision, marcaDe };
  /** key → registro de crearTarjeta */
  const tarjetas = new Map();
  /** key → { li, img, firma } */
  const itemsDeCola = new Map();
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

    // Solo se mueve lo que no está en su lugar (mover un nodo enfocado le quita el foco; conservarFoco lo devuelve).
    nodos.forEach((nodoDeCelda, indice) => {
      if (grilla.children[indice] !== nodoDeCelda) grilla.insertBefore(nodoDeCelda, grilla.children[indice] ?? null);
    });
    while (grilla.children.length > nodos.length) grilla.lastElementChild.remove();
    vacio.hidden = nodos.length > 0;
    grilla.hidden = nodos.length === 0;

    const todas = masDePestana(overview, pestana);
    mas.hidden = !todas;
    if (todas) {
      const href = enlaceARevisiones(todas.estado);
      if (mas.getAttribute("href") !== href) mas.setAttribute("href", href);
      ponerTexto(mas, t("overview.verTodas", { n: todas.total, cifra: cifra(todas.total, fmt) }));
    }
  }

  function ponerCola(overview, dispositivo) {
    const { tarjetas: enCola, mas: fuera } = colaDeOverview(overview);
    const claves = new Set(enCola.map((tarjeta) => `${tarjeta.revision}:${dispositivo}`));
    for (const [key, item] of itemsDeCola) {
      if (!claves.has(key)) {
        imagenes.soltar(item.img);
        item.li.remove();
        itemsDeCola.delete(key);
      }
    }
    const nodos = enCola.map((tarjeta) => {
      const key = `${tarjeta.revision}:${dispositivo}`;
      let item = itemsDeCola.get(key);
      const nuevo = () => crearItemDeCola(tarjeta, dispositivo, { imagenes });
      if (!item) {
        item = nuevo();
        itemsDeCola.set(key, item);
      } else {
        const firma = JSON.stringify([tarjeta.sitio, tarjeta.host, tarjeta.ruta, src((dispositivo === "mobile" ? tarjeta.capturas?.mobile : tarjeta.capturas?.desktop) ?? null)]);
        if (firma !== item.firma) {
          imagenes.soltar(item.img);
          const reemplazo = nuevo();
          item.li.replaceWith(reemplazo.li);
          item = reemplazo;
          itemsDeCola.set(key, item);
        }
      }
      return item.li;
    });
    nodos.forEach((li, indice) => {
      if (colaLista.children[indice] !== li) colaLista.insertBefore(li, colaLista.children[indice] ?? null);
    });
    while (colaLista.children.length > nodos.length) colaLista.lastElementChild.remove();
    cola.hidden = nodos.length === 0;
    cola.dataset.dispositivo = dispositivo;
    colaMas.hidden = !fuera;
    if (fuera) ponerTexto(colaMas, t("overview.cola.mas", { n: cifra(fuera, fmt) }));
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
      cola.hidden = true;
      return;
    }
    ponerPestanas(overview, pestana);
    conservarFoco(panel, () => ponerGrilla(overview, dispositivo, pestana));
    conservarFoco(cola, () => ponerCola(overview, dispositivo));
  }

  /** Al desmontar: devuelve todos los <img> al banco (ver capturas.js). */
  function soltar() {
    for (const registro of tarjetas.values()) registro.soltar();
    tarjetas.clear();
    for (const item of itemsDeCola.values()) {
      imagenes.soltar(item.img);
      item.li.remove();
    }
    itemsDeCola.clear();
  }

  return { nodo, actualizar, soltar };
}
