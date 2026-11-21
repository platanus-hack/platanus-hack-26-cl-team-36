// Marco de una tanda (diseño §5.11, §10.3): migas, anterior/siguiente, copiar enlace, h1, instrucción, línea de
// datos, resumen del veredicto, pestañas y el panel donde se montan las pestañas. Las pestañas son enlaces (cambian
// la URL), no pestañas ARIA. Registra los atajos [ ] 1–4 c y las opciones de la tanda en la paleta.

import { kbd, registrarAtajos } from "./atajos.js";
import { copiarEnlace } from "./avisos.js";
import { el } from "./dom.js";
import { conGlobo } from "./globo.js";
import { fmt, t } from "./i18n.js";
import { icono, insignia } from "./iconos.js";
import { registrarFuenteDePaleta } from "./paleta.js";
import { NOMBRES_DE_PESTANA, PESTANAS, enlaceATanda } from "./rutas.js";

const ICONO_DE_RESULTADO = { logrado: "logrado", fallido: "fallido", abandonado: "abandonado", error: "error-herramienta" };

/** Nombre visible de una página (igual que nombreDePagina de datos/textos.js, §2.3). */
export function nombreDePagina(pagina) {
  if (!pagina) return "";
  if (pagina.tituloTipo === "inicio") return t("datos.pagina.inicio");
  return pagina.tituloCorto ?? pagina.titulo ?? pagina.url ?? pagina.id;
}

/** Cifras de la tanda con respaldo para la forma anterior de la API. */
function cifras(tanda) {
  const kpis = tanda.kpis ?? {};
  const intentos = kpis.intentos ?? tanda.intentos?.length ?? 0;
  const errores = kpis.errores ?? 0;
  const validos = kpis.validos ?? intentos - errores;
  const logrados = kpis.logrados ?? kpis.exitos ?? 0;
  return { intentos, errores, validos, logrados };
}

function resumenDelVeredicto({ logrados, validos }) {
  if (!validos) return el("span", { class: "insignia insignia-neutro" }, icono("abandonado"), el("span", { texto: t("comun.marco.ningunoValido") }));
  const todos = logrados === validos;
  return el(
    "span",
    { class: `insignia ${todos ? "insignia-logrado" : "insignia-fallido"}` },
    icono(todos ? "logrado" : "fallido"),
    el("span", { texto: t("comun.marco.llegan", { n: logrados, de: validos }) }),
  );
}

/** Contenido de un globo: descripción + tecla. */
const globoConTecla = (descripcion, tecla) => () => el("span", { class: "globo-con-tecla" }, el("span", { texto: descripcion }), kbd(tecla));

function botonVecina({ id, pestana, tipo, senal }) {
  const anterior = tipo === "anterior";
  const etiqueta = t(anterior ? "comun.marco.anterior" : "comun.marco.siguiente");
  const descripcion = t(anterior ? "comun.marco.anteriorDescripcion" : "comun.marco.siguienteDescripcion");
  const contenido = [
    anterior ? icono("anterior") : null,
    el("span", { class: "marco-etiqueta-boton", texto: etiqueta }),
    !anterior ? icono("siguiente") : null,
    el("span", { class: "marco-pista", "aria-hidden": "true" }, kbd(anterior ? "[" : "]")),
  ];
  if (!id) {
    const sin = t(anterior ? "comun.marco.sinAnterior" : "comun.marco.sinSiguiente");
    const deshabilitado = el("span", { class: "boton boton-secundario marco-vecina", "aria-disabled": "true", "aria-label": sin }, contenido);
    return conGlobo(deshabilitado, sin, { senal });
  }
  const enlace = el(
    "a",
    {
      class: "boton boton-secundario marco-vecina",
      href: enlaceATanda(id, pestana),
      rel: anterior ? "prev" : "next",
      "aria-label": descripcion,
      "data-foco": `marco:${tipo}`,
      "aria-keyshortcuts": anterior ? "[" : "]",
    },
    contenido,
  );
  return conGlobo(enlace, globoConTecla(descripcion, anterior ? "[" : "]"), { senal });
}

/**
 * Arma el marco. → { raiz, panel, actualizar(ruta), desmontar() }.
 * @param {{ tanda: object, ruta: object, navegar: (hash: string) => void }} opciones
 */
export function montarMarco({ tanda, ruta, navegar }) {
  const titulo = tanda.tarea ?? tanda.host ?? tanda.id;
  const fecha = tanda.fechaIso ?? tanda.fecha;
  const { intentos, errores, validos, logrados } = cifras(tanda);
  const vecinas = tanda.vecinas ?? {};
  let pestanaActual = ruta.pestana;
  const controlador = new AbortController();
  const senal = controlador.signal;

  const anterior = el("span", { class: "marco-hueco" });
  const siguiente = el("span", { class: "marco-hueco" });
  const ponerVecinas = () => {
    anterior.replaceChildren(botonVecina({ id: vecinas.anterior, pestana: pestanaActual, tipo: "anterior", senal }));
    siguiente.replaceChildren(botonVecina({ id: vecinas.siguiente, pestana: pestanaActual, tipo: "siguiente", senal }));
  };
  ponerVecinas();

  const instruccion = tanda.instruccion
    ? el("p", { class: "prosa marco-instruccion", texto: tanda.instruccion, title: t("comun.marco.verInstruccion") })
    : null;
  instruccion?.addEventListener("click", () => instruccion.classList.toggle("expandida"));

  const enlacesDePestana = new Map(
    PESTANAS.map((pestana, indice) => [
      pestana,
      el(
        "a",
        { class: "pestana", href: enlaceATanda(tanda.id, pestana), "data-foco": `marco:pestana:${pestana}`, "aria-keyshortcuts": String(indice + 1) },
        el("span", { texto: t(NOMBRES_DE_PESTANA[pestana]) }),
        el("span", { class: "marco-pista", "aria-hidden": "true" }, kbd(String(indice + 1))),
      ),
    ]),
  );

  const panel = el("section", { id: "panel-tanda", class: "panel-tanda", tabindex: "-1" });

  const meta = el(
    "p",
    { class: "marco-meta" },
    tanda.url
      ? el(
          "a",
          { class: "marco-sitio", href: tanda.url, target: "_blank", rel: "noreferrer noopener", title: t("comun.marco.abrirSitio", { host: tanda.host ?? tanda.url }) },
          el("span", { texto: tanda.host ?? tanda.url }),
          icono("enlace-externo"),
        )
      : null,
    fecha ? el("time", { class: "marco-fecha", datetime: tanda.fechaIso ?? null, texto: fmt.fechaLegible(fecha) }) : null,
    fecha ? el("span", { class: "marco-relativo", title: fmt.fechaLegible(fecha), texto: fmt.tiempoRelativo(fecha) }) : null,
    el("span", { class: "marco-intentos", texto: t("comun.marco.intentos", { n: intentos }) }),
    el("span", { class: "marco-veredicto" }, resumenDelVeredicto({ logrados, validos })),
    errores ? el("span", { class: "marco-errores" }, el("span", { class: "insignia insignia-error" }, icono("error-herramienta"), el("span", { texto: t("comun.marco.errores", { n: errores }) }))) : null,
    tanda.modeloUsuarios ? el("span", { class: "marco-modelo", title: tanda.modeloUsuarios, texto: t("comun.marco.usuarios", { modelo: fmt.modelo(tanda.modeloUsuarios) }) }) : null,
    tanda.modeloJuez ? el("span", { class: "marco-modelo", title: tanda.modeloJuez, texto: t("comun.marco.juez", { modelo: fmt.modelo(tanda.modeloJuez) }) }) : null,
  );

  const copiar = el(
    "button",
    { type: "button", class: "boton boton-secundario marco-copiar", "data-foco": "marco:copiar", "aria-label": t("comun.marco.copiarEnlace"), "aria-keyshortcuts": "c", onclick: () => copiarEnlace() },
    icono("copiar"),
    el("span", { class: "marco-etiqueta-boton", texto: t("comun.marco.copiarEnlace") }),
    el("span", { class: "marco-pista", "aria-hidden": "true" }, kbd("c")),
  );
  conGlobo(copiar, globoConTecla(t("comun.atajos.desc.copiarEnlace"), "c"), { senal });

  const raiz = el(
    "div",
    { class: "marco-tanda" },
    el(
      "header",
      { class: "marco-cabecera" },
      el(
        "div",
        { class: "marco-barra" },
        el(
          "nav",
          { class: "migas", "aria-label": t("comun.marco.migas") },
          el(
            "ol",
            {},
            el("li", { class: "migas-corridas" }, el("a", { href: "#/", "data-foco": "marco:migas:corridas" }, icono("anterior", { clase: "migas-volver" }), el("span", { texto: t("comun.shell.corridas") }))),
            el("li", { class: "migas-tarea truncar", texto: titulo }),
            fecha ? el("li", { class: "migas-fecha" }, el("span", { "aria-current": "page", texto: fmt.fechaCorta(fecha) })) : null,
          ),
        ),
        el(
          "div",
          { class: "marco-acciones" },
          anterior,
          siguiente,
          copiar,
        ),
      ),
      el("h1", { class: "marco-titulo", tabindex: "-1", texto: titulo }),
      instruccion,
      meta,
    ),
    el("nav", { class: "pestanas", "aria-label": t("comun.marco.vistas") }, el("ul", {}, [...enlacesDePestana.values()].map((enlace) => el("li", {}, enlace)))),
    panel,
  );

  function actualizar(nuevaRuta) {
    const enfocada = document.activeElement?.classList?.contains("pestana") && raiz.contains(document.activeElement);
    pestanaActual = nuevaRuta.pestana;
    for (const [pestana, enlace] of enlacesDePestana) {
      if (pestana === pestanaActual) enlace.setAttribute("aria-current", "page");
      else enlace.removeAttribute("aria-current");
    }
    panel.setAttribute("aria-label", t(NOMBRES_DE_PESTANA[pestanaActual]));
    // Si el foco estaba en una pestaña (p. ej. se cambió con 1–4), pasa a la pestaña elegida.
    if (enfocada) enlacesDePestana.get(pestanaActual)?.focus({ preventScroll: true });
    // Anterior/siguiente conservan la pestaña (sin sus parámetros): se cambia el href en el lugar, sin perder foco.
    for (const [contenedor, id] of [[anterior, vecinas.anterior], [siguiente, vecinas.siguiente]]) {
      const enlace = contenedor.querySelector("a");
      if (enlace && id) enlace.setAttribute("href", enlaceATanda(id, pestanaActual));
    }
  }
  actualizar(ruta);

  const atajos = {
    "[": { descripcion: t("comun.marco.anteriorDescripcion"), accion: () => vecinas.anterior && navegar(enlaceATanda(vecinas.anterior, pestanaActual)) },
    "]": { descripcion: t("comun.marco.siguienteDescripcion"), accion: () => vecinas.siguiente && navegar(enlaceATanda(vecinas.siguiente, pestanaActual)) },
    c: { descripcion: t("comun.atajos.desc.copiarEnlace"), accion: () => copiarEnlace() },
  };
  PESTANAS.forEach((pestana, indice) => {
    atajos[String(indice + 1)] = { descripcion: t(NOMBRES_DE_PESTANA[pestana]), accion: () => navegar(enlaceATanda(tanda.id, pestana)) };
  });
  const quitarAtajos = registrarAtajos(atajos, { ambito: "pantalla", grupo: "tanda" });

  const quitarFuente = registrarFuenteDePaleta(() => [
    ...PESTANAS.map((pestana) => ({
      id: `tanda:pestana:${pestana}`,
      grupo: "tanda",
      titulo: t(NOMBRES_DE_PESTANA[pestana]),
      subtitulo: titulo,
      href: enlaceATanda(tanda.id, pestana),
      icono: "siguiente",
    })),
    ...(tanda.intentos ?? []).map((intento) => ({
      id: `tanda:intento:${intento.id}`,
      grupo: "tanda",
      titulo: intento.nombrePerfil ?? intento.perfil ?? intento.id,
      subtitulo: t("comun.paleta.intento", { resultado: t(`comun.resultado.${intento.resultado}`) }),
      palabras: `${intento.id} ${intento.perfil ?? ""}`,
      href: enlaceATanda(tanda.id, "replay", { intento: intento.id }),
      icono: ICONO_DE_RESULTADO[intento.resultado] ?? "info",
    })),
    ...(tanda.telarana?.paginas ?? []).map((pagina) => ({
      id: `tanda:pagina:${pagina.id}`,
      grupo: "tanda",
      titulo: nombreDePagina(pagina),
      subtitulo: t("comun.paleta.pagina", { url: pagina.url ?? "" }),
      palabras: `${pagina.titulo ?? ""} ${pagina.url ?? ""}`,
      href: enlaceATanda(tanda.id, "telarana", { pagina: pagina.id }),
      icono: pagina.enRuta ? "en-ruta" : "fuera-de-ruta",
    })),
    ...(tanda.perfiles ?? []).map((perfil) => ({
      id: `tanda:perfil:${perfil.perfil}`,
      grupo: "tanda",
      titulo: perfil.nombre ?? perfil.perfil,
      subtitulo: t("comun.paleta.perfil", { n: fmt.conteo(perfil.metricas?.exito ?? null) }),
      palabras: perfil.perfil,
      href: enlaceATanda(tanda.id, "perfiles"),
      icono: "corridas",
    })),
  ]);

  return {
    raiz,
    panel,
    actualizar,
    desmontar() {
      controlador.abort();
      quitarAtajos();
      quitarFuente();
    },
  };
}
