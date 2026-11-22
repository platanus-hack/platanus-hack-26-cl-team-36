// Marco de una hoja (diseño del modal, nov. 2026): arriba una fila con el título, el sitio ↗ y la pastilla de estado,
// y el ✕ que cierra a la derecha; debajo, las pestañas en su propia fila, como segmentos grandes dentro de una caja,
// cada una con su ícono, su nombre y un dato corto (Path map: páginas; Replay: intentos; Proposal: lista o en curso).
// Debajo, el panel de la pestaña. Las pestañas son enlaces (no pestañas ARIA): la actual lleva aria-current.
//
// Tres marcos comparten la cabecera:
//   - montarMarco: una tanda. Se arma al instante con lo que dice el id (la tarea y el sitio) y un esqueleto;
//     ponerTanda() completa el título, la pastilla y los datos de las pestañas.
//   - montarMarcoEnVivo: un goal de una revisión que todavía corre (#/revisiones/<revision>/<goal>). Path map es la
//     telaraña en vivo (pantallas/vivo.js); Replay y Proposal se ven apagadas hasta que haya tanda y propuesta.
//   - montarMarcoDeFallo: una revisión que falló antes de tener tanda. Las tres pestañas se ven apagadas (con un globo
//     que dice qué falta) y el panel muestra la cadena de etapas (pantallas/fallo.js).
// Los atajos (1–3, Esc) van en el globo de cada botón.

import { kbd, registrarAtajos } from "./atajos.js";
import { partesDeTanda } from "./almacen.js";
import { EVENTO_PROPUESTA, pedirPropuesta } from "./datos.js";
import { el, esUrlWeb, reemplazar } from "./dom.js";
import { esqueleto } from "./estados.js";
import { conGlobo, ocultarGlobo } from "./globo.js";
import { fmt, t } from "./i18n.js";
import { icono, icono24 } from "./iconos.js";
import { NOMBRES_DE_PESTANA, PESTANAS, enlaceATanda, enlaceAVivo, parametrosQueSiguen } from "./rutas.js";
import { limpiarTitulos } from "../tanda/titulos.js";

/** El ícono de cada pestaña: el camino (como la Guía), reproducir y la paleta del Diseñador (como en el Overview). */
const ICONO_DE_PESTANA = {
  telarana: () => icono24("ruta", { tamano: 16 }),
  replay: () => icono("reproducir"),
  propuesta: () => icono24("tema", { tamano: 16 }),
};

/** Cifras de la tanda con respaldo para la forma anterior de la API. */
function cifras(tanda) {
  const kpis = tanda.kpis ?? {};
  const intentos = kpis.intentos ?? tanda.intentos?.length ?? 0;
  const validos = kpis.validos ?? intentos - (kpis.errores ?? 0);
  // Los «sin medir» son válidos pero no cuentan en «llegan n de m».
  const medidos = kpis.medidos ?? validos;
  const logrados = kpis.logrados ?? kpis.exitos ?? 0;
  return { intentos, validos, medidos, logrados };
}

function insigniaDeLlegan({ logrados, validos, medidos }) {
  if (!validos) return el("span", { class: "insignia insignia-neutro" }, icono("abandonado"), el("span", { texto: t("comun.marco.ningunoValido") }));
  if (!medidos) return el("span", { class: "insignia insignia-sin_medir" }, icono("sin-medir"), el("span", { texto: t("comun.marco.sinMedir") }));
  const todos = logrados === medidos;
  return el(
    "span",
    {
      class: `insignia ${todos ? "insignia-logrado" : "insignia-fallido"}`,
      title: medidos < validos ? t("comun.marco.algunosSinMedir", { n: validos - medidos }) : null,
    },
    icono(todos ? "logrado" : "fallido"),
    el("span", { texto: t("comun.marco.llegan", { n: logrados, de: medidos }) }),
  );
}

/** Contenido de un globo: descripción + tecla. */
const globoConTecla = (descripcion, tecla) => () => el("span", { class: "globo-con-tecla" }, el("span", { texto: descripcion }), kbd(tecla));

/** El sitio: el host como enlace ↗ si hay una URL web; si no, el host solo. */
export function sitioDe({ url, host }) {
  if (!url || !esUrlWeb(url)) return host ? el("span", { class: "marco-sitio", texto: host }) : null;
  return el(
    "a",
    { class: "marco-sitio", href: url, target: "_blank", rel: "noreferrer noopener", title: t("comun.marco.abrirSitio", { host: host ?? url }) },
    el("span", { texto: host ?? url }),
    icono("enlace-externo"),
  );
}

/**
 * La cabecera compartida. `pestanas`: [{ id, href | null, tecla, porque? }] (sin href: apagada, con el globo
 * `porque`). → { nodo, titulo, sitio, insignia, enlaces: Map<id, a>, ponerMeta(id, nodo | texto) }.
 */
function armarCabecera({ textoDelTitulo, pestanas, alCerrar, senal }) {
  const titulo = el("h1", { id: "marco-titulo", class: "marco-titulo truncar", tabindex: "-1", texto: textoDelTitulo });
  const sitio = el("span", { class: "marco-hueco" });
  const insignia = el("span", { class: "marco-hueco" }, el("span", { class: "esqueleto marco-insignia-esqueleto", "aria-hidden": "true" }));

  const cerrar = el(
    "button",
    { type: "button", class: "boton boton-icono marco-cerrar", "aria-label": t("comun.marco.cerrar"), "aria-keyshortcuts": "Escape", "data-foco": "marco:cerrar" },
    icono("cerrar"),
  );
  cerrar.addEventListener("click", () => alCerrar(), { signal: senal });
  conGlobo(cerrar, globoConTecla(t("comun.marco.cerrar"), "Escape"), { senal });

  const metas = new Map();
  const enlaces = new Map(
    pestanas.map(({ id, href, tecla, porque }) => {
      const meta = el("span", { class: "pestana-meta", texto: "—" });
      metas.set(id, meta);
      const nombre = t(NOMBRES_DE_PESTANA[id]);
      const enlace = el(
        "a",
        {
          class: "pestana",
          href: href ?? null,
          role: href ? null : "link",
          "aria-disabled": href ? null : "true",
          tabindex: href ? null : "0",
          "data-valor": id,
          "data-foco": `marco:pestana:${id}`,
          "aria-keyshortcuts": href ? tecla : null,
        },
        el("span", { class: "pestana-icono", "aria-hidden": "true" }, ICONO_DE_PESTANA[id]()),
        el("span", { class: "pestana-nombre", texto: nombre }),
        meta,
      );
      conGlobo(enlace, href ? globoConTecla(nombre, tecla) : () => el("span", { texto: porque ?? nombre }), { senal });
      return [id, enlace];
    }),
  );
  const nav = el("nav", { class: "pestanas", "aria-label": t("comun.marco.vistas") }, el("ul", {}, [...enlaces.values()].map((enlace) => el("li", {}, enlace))));

  const nodo = el(
    "header",
    { class: "marco-cabecera" },
    el("div", { class: "marco-fila" }, el("div", { class: "marco-identidad" }, titulo, sitio, insignia), cerrar),
    nav,
  );
  return {
    nodo,
    titulo,
    sitio,
    insignia,
    enlaces,
    ponerMeta(id, contenido) {
      const meta = metas.get(id);
      if (meta) reemplazar(meta, contenido ?? "—");
    },
  };
}

/** El dato de Proposal: «● Ready», «● Designing» (late) o nada. */
function metaDePropuesta(estado) {
  if (estado === "succeeded") return [el("span", { class: "pestana-punto", "aria-hidden": "true" }), el("span", { texto: t("comun.marco.meta.propuestaLista") })];
  if (estado === "running") return [el("span", { class: "pestana-punto pestana-punto-vivo", "aria-hidden": "true" }), el("span", { texto: t("comun.marco.meta.propuestaEnCurso") })];
  return null;
}

/**
 * Arma el marco de una tanda. → { raiz, panel, titulo, ponerTanda(tanda), actualizar(ruta), desmontar() }.
 * @param {{ tandaId: string, ruta: object, navegar: (hash: string) => void,
 *           volver: { clave: string, hash: string }, alVolver?: () => void, escapar: () => boolean }} opciones
 *   alVolver: cierra la hoja (✕ y Esc); escapar: lo que hace Esc antes de cerrarla (la pantalla suelta su selección);
 *   true si lo usó.
 */
export function montarMarco({ tandaId, ruta, navegar, volver, alVolver = () => navegar(volver.hash), escapar = () => false }) {
  const partes = partesDeTanda(tandaId) ?? { host: null, objetivo: tandaId };
  const controlador = new AbortController();
  const senal = controlador.signal;
  let rutaActual = ruta;

  const cabecera = armarCabecera({
    textoDelTitulo: partes.objetivo,
    pestanas: PESTANAS.map((id, indice) => ({ id, href: enlaceATanda(tandaId, id), tecla: String(indice + 1) })),
    alCerrar: alVolver,
    senal,
  });
  const { titulo, enlaces } = cabecera;
  reemplazar(cabecera.sitio, sitioDe({ host: partes.host }));

  const panel = el("section", { id: "panel-tanda", class: "panel-tanda", tabindex: "-1" }, esqueleto("hoja"));
  const raiz = el("div", { class: "marco-tanda" }, cabecera.nodo, panel);

  // La pestaña Propuesta dice si está lista o si el Diseñador diseña: lo dice el primer pedido y, después, la pantalla.
  const ponerEstadoDePropuesta = (estado) => {
    enlaces.get("propuesta")?.classList.toggle("pestana-en-curso", estado === "running");
    cabecera.ponerMeta("propuesta", metaDePropuesta(estado));
  };
  document.addEventListener(EVENTO_PROPUESTA, (evento) => evento.detail?.tandaId === tandaId && ponerEstadoDePropuesta(evento.detail.estado), { signal: senal });

  function actualizar(nuevaRuta) {
    const enfocada = document.activeElement?.classList?.contains("pestana") && raiz.contains(document.activeElement);
    rutaActual = nuevaRuta;
    const siguen = parametrosQueSiguen(nuevaRuta.parametros);
    for (const [pestana, enlace] of enlaces) {
      enlace.setAttribute("href", enlaceATanda(tandaId, pestana, siguen));
      if (pestana === nuevaRuta.pestana) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
    }
    panel.setAttribute("aria-label", t(NOMBRES_DE_PESTANA[nuevaRuta.pestana]));
    if (enfocada) enlaces.get(nuevaRuta.pestana)?.focus({ preventScroll: true });
  }
  actualizar(ruta);

  function ponerTanda(datos) {
    const tanda = limpiarTitulos(datos);
    titulo.textContent = tanda.tarea ?? tanda.host ?? partes.objetivo;
    titulo.title = tanda.instruccion || titulo.textContent;
    reemplazar(cabecera.sitio, sitioDe(tanda));
    const numeros = cifras(tanda);
    reemplazar(cabecera.insignia, insigniaDeLlegan(numeros));
    const paginas = tanda.telarana?.paginas?.length ?? 0;
    cabecera.ponerMeta("telarana", paginas ? t("comun.marco.meta.paginas", { n: paginas, cifra: fmt.numero(paginas) }) : null);
    cabecera.ponerMeta("replay", numeros.intentos ? t("comun.marco.meta.intentos", { n: numeros.intentos, cifra: fmt.numero(numeros.intentos) }) : null);
    pedirPropuesta(tanda.id)
      .then((propuesta) => !senal.aborted && ponerEstadoDePropuesta(propuesta?.estado))
      .catch(() => {});
  }

  const atajos = {
    Escape: {
      descripcion: t("comun.atajos.desc.cerrarTanda"),
      accion: () => {
        if (ocultarGlobo() || escapar()) return;
        alVolver();
      },
    },
  };
  // Una fila en la hoja de atajos con los nombres de las pestañas («1 / 2 / 3: Path map · Replay · Proposal»).
  const nombresDePestanas = () => PESTANAS.map((pestana) => t(NOMBRES_DE_PESTANA[pestana])).join(" · ");
  PESTANAS.forEach((pestana, indice) => {
    atajos[String(indice + 1)] = { descripcion: nombresDePestanas, accion: () => navegar(enlaceATanda(tandaId, pestana, parametrosQueSiguen(rutaActual.parametros))) };
  });
  const quitarAtajos = registrarAtajos(atajos, { ambito: "pantalla", grupo: "tanda" });

  return {
    raiz,
    panel,
    titulo,
    ponerTanda,
    actualizar,
    desmontar() {
      controlador.abort();
      quitarAtajos();
    },
  };
}

/** Qué necesita cada pestaña para tener datos: la etapa de la que depende (el globo de la pestaña apagada). */
const NECESITA = { telarana: "guide", replay: "visitor", propuesta: "improver" };

/**
 * Arma el marco de una revisión fallida: la misma cabecera, con las pestañas apagadas.
 * → { raiz, panel, titulo, ponerRevision({ sitio, host, url, etapa }), desmontar() }.
 * @param {{ revision: string, alVolver: () => void, escapar?: () => boolean }} opciones
 */
export function montarMarcoDeFallo({ revision, alVolver, escapar = () => false }) {
  const controlador = new AbortController();
  const senal = controlador.signal;
  const cabecera = armarCabecera({
    textoDelTitulo: revision,
    pestanas: PESTANAS.map((id) => ({
      id,
      href: null,
      porque: t("comun.marco.necesita", { etapa: t(`comun.etapa.${NECESITA[id]}`) }),
    })),
    alCerrar: alVolver,
    senal,
  });
  const panel = el("section", { id: "panel-tanda", class: "panel-tanda panel-fallo", tabindex: "-1" }, esqueleto("hoja"));
  const raiz = el("div", { class: "marco-tanda marco-fallo" }, cabecera.nodo, panel);
  panel.setAttribute("aria-label", t("comun.marco.etapas"));

  const quitarAtajos = registrarAtajos(
    {
      Escape: {
        descripcion: t("comun.atajos.desc.cerrarTanda"),
        accion: () => {
          if (ocultarGlobo() || escapar()) return;
          alVolver();
        },
      },
    },
    { ambito: "pantalla", grupo: "tanda" },
  );

  return {
    raiz,
    panel,
    titulo: cabecera.titulo,
    /** El nombre del sitio, su host ↗ y la pastilla «✕ Stopped at <Etapa>» (sin etapa conocida, «✕ Failed»). */
    ponerRevision({ sitio, host, url, etapa }) {
      cabecera.titulo.textContent = sitio || host || revision;
      reemplazar(cabecera.sitio, sitioDe({ url, host }));
      const texto = etapa ? t("comun.marco.detenidaEn", { etapa: t(`comun.etapa.${etapa}`) }) : t("comun.marco.fallida");
      reemplazar(cabecera.insignia, el("span", { class: "insignia insignia-fallido" }, icono("fallido"), el("span", { texto })));
    },
    desmontar() {
      controlador.abort();
      quitarAtajos();
    },
  };
}

/**
 * Arma el marco de un goal en vivo: la misma cabecera, con Path map elegida («● Live») y las otras dos apagadas.
 * → { raiz, panel, titulo, ponerRevision({ host, url }), ponerEstado({ tono, icono, texto, latiendo }), desmontar() }.
 * @param {{ revision: string, goal: string, alVolver: () => void, escapar?: () => boolean }} opciones
 */
export function montarMarcoEnVivo({ revision, goal, alVolver, escapar = () => false }) {
  const controlador = new AbortController();
  const senal = controlador.signal;
  const cabecera = armarCabecera({
    textoDelTitulo: goal,
    pestanas: PESTANAS.map((id, indice) =>
      id === "telarana"
        ? { id, href: enlaceAVivo(revision, goal), tecla: String(indice + 1) }
        : { id, href: null, porque: t(`comun.marco.alTerminar.${id}`) },
    ),
    alCerrar: alVolver,
    senal,
  });
  const telarana = cabecera.enlaces.get("telarana");
  telarana.setAttribute("aria-current", "page");
  cabecera.ponerMeta("telarana", [el("span", { class: "pestana-punto pestana-punto-vivo", "aria-hidden": "true" }), el("span", { texto: t("comun.marco.meta.enVivo") })]);

  const panel = el("section", { id: "panel-tanda", class: "panel-tanda", tabindex: "-1", "aria-label": t(NOMBRES_DE_PESTANA.telarana) }, esqueleto("hoja"));
  const raiz = el("div", { class: "marco-tanda marco-vivo" }, cabecera.nodo, panel);

  const quitarAtajos = registrarAtajos(
    {
      Escape: {
        descripcion: t("comun.atajos.desc.cerrarTanda"),
        accion: () => {
          if (ocultarGlobo() || escapar()) return;
          alVolver();
        },
      },
    },
    { ambito: "pantalla", grupo: "tanda" },
  );

  return {
    raiz,
    panel,
    titulo: cabecera.titulo,
    /** El host ↗ de la página revisada. */
    ponerRevision({ host, url }) {
      reemplazar(cabecera.sitio, sitioDe({ url, host }));
    },
    /** La pastilla de la transmisión (Live, Reconnecting…, Finished…); al terminar, Path map deja de latir. */
    ponerEstado({ tono, icono: nombre, texto, latiendo }) {
      reemplazar(cabecera.insignia, el("span", { class: `insignia insignia-${tono}${latiendo ? " vivo-latiendo" : ""}` }, icono(nombre), el("span", { texto })));
      if (tono === "logrado") cabecera.ponerMeta("telarana", null);
    },
    /** Otros parámetros en el mismo goal: no hay nada que cambiar en la cabecera. */
    actualizar() {},
    desmontar() {
      controlador.abort();
      quitarAtajos();
    },
  };
}
