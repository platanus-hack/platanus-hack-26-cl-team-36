// Marco de una tanda (diseño §5.11, §10.3): una cabecera corta con lo que importa (tarea, sitio y fecha con
// anterior/siguiente y copiar enlace; el titular de quién no llega; las cifras clave; hasta 3 hallazgos que abren
// Replay en su paso; la instrucción tras «Ver instrucción»), las pestañas y el panel donde se montan. Las pestañas
// son enlaces (cambian la URL), no pestañas ARIA. Registra los atajos [ ] 1–2 c y las opciones de la tanda en la
// paleta.

import { kbd, registrarAtajos } from "./atajos.js";
import { copiarEnlace } from "./avisos.js";
import { nombreDePagina as nombreDePaginaConT, textoDeHallazgo, textoDeTitular } from "../datos/textos.js";
import { el, esUrlWeb } from "./dom.js";
import { conGlobo } from "./globo.js";
import { fmt, t } from "./i18n.js";
import { icono } from "./iconos.js";
import { registrarFuenteDePaleta } from "./paleta.js";
import { NOMBRES_DE_PESTANA, PESTANAS, enlaceATanda } from "./rutas.js";

const ICONO_DE_RESULTADO = { logrado: "logrado", fallido: "fallido", abandonado: "abandonado", error: "error-herramienta" };

/** Nombre visible de una página: nombreDePagina de datos/textos.js con el idioma actual (§2.3). */
export function nombreDePagina(pagina) {
  return nombreDePaginaConT(pagina, t);
}

/** Cifras de la tanda con respaldo para la forma anterior de la API. */
function cifras(tanda) {
  const kpis = tanda.kpis ?? {};
  const intentos = kpis.intentos ?? tanda.intentos?.length ?? 0;
  const errores = kpis.errores ?? 0;
  const validos = kpis.validos ?? intentos - errores;
  const logrados = kpis.logrados ?? kpis.exitos ?? 0;
  return { errores, validos, logrados };
}

function insigniaDeLlegan({ logrados, validos }) {
  if (!validos) return el("span", { class: "insignia insignia-neutro" }, icono("abandonado"), el("span", { texto: t("comun.marco.ningunoValido") }));
  const todos = logrados === validos;
  return el(
    "span",
    { class: `insignia ${todos ? "insignia-logrado" : "insignia-fallido"}` },
    icono(todos ? "logrado" : "fallido"),
    el("span", { texto: t("comun.marco.llegan", { n: logrados, de: validos }) }),
  );
}

const HALLAZGOS_VISIBLES = 3;
// Qué hallazgo va primero: quien no llega, los errores, los pasos perdidos, quien deja la ruta y no vuelve, las
// demoras; los desvíos de los que vuelven a la ruta, al final. El titular ya cuenta el resultado.
const PRIORIDAD_DE_HALLAZGO = { detenido: 0, errores: 1, tropiezos: 2, desvio: 3, demora: 4 };

/** El intento y el paso de Replay donde se ve un hallazgo, o null si no apunta a un paso. */
function pasoDeHallazgo(hallazgo) {
  const caso = hallazgo.id.startsWith("tropiezos") ? hallazgo.vars?.casos?.[0] : null;
  if (caso?.intento && caso.paso != null) return { intento: caso.intento, paso: caso.paso };
  if (hallazgo.intento && hallazgo.paso != null) return { intento: hallazgo.intento, paso: hallazgo.paso };
  return null;
}

/**
 * Los hallazgos que más dicen y se pueden abrir en un paso de Replay (máximo HALLAZGOS_VISIBLES). Primero uno de
 * cada tipo (el titular ya nombra a quien no llega: tres «termina en…» seguidos dirían poco más), después el resto.
 */
export function hallazgosPrincipales(lista) {
  const tipoDe = (hallazgo) => hallazgo.id.split(":")[0];
  const prioridad = (hallazgo) => (tipoDe(hallazgo) === "desvio" && hallazgo.nivel === "info" ? 5 : (PRIORIDAD_DE_HALLAZGO[tipoDe(hallazgo)] ?? 6));
  const ordenados = (lista ?? [])
    .filter((hallazgo) => hallazgo.id !== "resultado" && pasoDeHallazgo(hallazgo))
    .map((hallazgo, indice) => ({ hallazgo, indice }))
    .sort((a, b) => prioridad(a.hallazgo) - prioridad(b.hallazgo) || a.indice - b.indice)
    .map(({ hallazgo }) => hallazgo);
  const vistos = new Set();
  const primeros = ordenados.filter((hallazgo) => !vistos.has(tipoDe(hallazgo)) && vistos.add(tipoDe(hallazgo)));
  const resto = ordenados.filter((hallazgo) => !primeros.includes(hallazgo));
  return [...primeros, ...resto]
    .slice(0, HALLAZGOS_VISIBLES)
    .sort((a, b) => ordenados.indexOf(a) - ordenados.indexOf(b));
}

/** La frase que abre la tanda (quién no llega), con el ícono de su nivel. */
function titular(tanda, { validos }) {
  const texto = tanda.titulares?.tanda ? textoDeTitular(tanda.titulares.tanda, tanda, t) : "";
  if (!texto) return null;
  // "dificultad": todos llegan, pero alguien tarda o tropieza; no es un check verde.
  const nivel = !validos ? "error" : tanda.titulares.tanda.nivel ?? "atencion";
  const nombreIcono = { error: "error-herramienta", bien: "logrado", dificultad: "dificultad" }[nivel] ?? "fallido";
  return el("p", { class: `marco-titular marco-nivel-${nivel}` }, icono(nombreIcono), el("span", { texto }));
}

/** Llegan, pasos contra la ruta, los dos niveles de conocimiento y los errores de la herramienta, en una fila. */
function cifrasClave(tanda, c) {
  const kpis = tanda.kpis ?? {};
  const niveles = tanda.porConocimiento;
  return el(
    "p",
    { class: "marco-cifras" },
    el("span", {}, insigniaDeLlegan(c)),
    typeof kpis.pasosMediana === "number"
      ? el("span", { texto: t("comun.marco.pasos", { mediana: fmt.numero(kpis.pasosMediana), ruta: typeof kpis.pasosIdeales === "number" ? kpis.pasosIdeales : null }) })
      : null,
    niveles?.length
      ? el(
          "span",
          { class: "marco-niveles", title: t("comun.marco.niveles") },
          niveles.map((fila, indice) => [
            indice ? el("span", { class: "texto-4", "aria-hidden": "true", texto: "·" }) : null,
            el("span", {}, t(`comun.marco.nivel.${fila.nivel}`), " ", el("span", { class: "num texto-1", texto: fmt.conteo({ n: fila.logrados, de: fila.intentos }) })),
          ]),
        )
      : null,
    c.errores ? el("span", {}, el("span", { class: "insignia insignia-error" }, icono("error-herramienta"), el("span", { texto: t("comun.marco.errores", { n: c.errores }) }))) : null,
  );
}

/** Hasta 3 hallazgos, una línea cada uno, que abren Replay en su paso. */
function hallazgos(tanda) {
  const lista = hallazgosPrincipales(tanda.hallazgos);
  if (!lista.length) return null;
  return el(
    "ul",
    { class: "marco-hallazgos", "aria-label": t("comun.marco.hallazgos") },
    lista.map((hallazgo) => {
      const { intento, paso } = pasoDeHallazgo(hallazgo);
      const texto = textoDeHallazgo(hallazgo, tanda, t);
      return el(
        "li",
        {},
        el(
          "a",
          {
            class: "marco-hallazgo",
            href: enlaceATanda(tanda.id, "replay", { intento, paso }),
            title: texto,
            "aria-label": t("comun.marco.verPasoEtiqueta", { texto, paso }),
            "data-foco": `marco:hallazgo:${hallazgo.id}`,
          },
          el("span", { class: "marco-hallazgo-texto truncar", texto }),
          el("span", { class: "marco-hallazgo-paso", texto: t("comun.marco.verPaso", { paso }) }),
          icono("siguiente"),
        ),
      );
    }),
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
    // role="link" para que el lector de pantalla anuncie la etiqueta y que está deshabilitado.
    const deshabilitado = el("span", { class: "boton boton-secundario marco-vecina", role: "link", "aria-disabled": "true", "aria-label": sin }, contenido);
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
  const c = cifras(tanda);
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

  // La instrucción (y la versión que leen los exploradores «sin contexto») queda cerrada tras «Ver instrucción».
  const instruccion = tanda.instruccion
    ? el(
        "div",
        { id: "marco-instruccion", class: "prosa marco-instruccion", hidden: "" },
        el("p", { texto: tanda.instruccion }),
        tanda.instruccionSinContexto
          ? el("p", {}, el("span", { class: "texto-3", texto: `${t("comun.marco.versionSinContexto")} ` }), tanda.instruccionSinContexto)
          : null,
      )
    : null;
  const verInstruccion = instruccion
    ? el("button", { type: "button", class: "boton boton-fantasma marco-ver-instruccion", "aria-expanded": "false", "aria-controls": "marco-instruccion", texto: t("comun.marco.verInstruccion") })
    : null;
  verInstruccion?.addEventListener("click", () => {
    const abierta = instruccion.hidden;
    instruccion.hidden = !abierta;
    verInstruccion.setAttribute("aria-expanded", String(abierta));
    verInstruccion.textContent = t(abierta ? "comun.marco.ocultarInstruccion" : "comun.marco.verInstruccion");
  });

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

  const sitio = !tanda.url
    ? null
    : esUrlWeb(tanda.url)
      ? el(
          "a",
          { class: "marco-sitio", href: tanda.url, target: "_blank", rel: "noreferrer noopener", title: t("comun.marco.abrirSitio", { host: tanda.host ?? tanda.url }) },
          el("span", { texto: tanda.host ?? tanda.url }),
          icono("enlace-externo"),
        )
      : el("span", { class: "marco-sitio", texto: tanda.host || tanda.url });

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
          "div",
          { class: "marco-identidad" },
          el("a", { class: "marco-volver", href: "#/", "data-foco": "marco:migas:corridas", "aria-label": t("comun.shell.corridas") }, icono("anterior"), el("span", { class: "marco-etiqueta-boton", texto: t("comun.shell.corridas") })),
          el("h1", { class: "marco-titulo truncar", tabindex: "-1", title: tanda.instruccion || null, texto: titulo }),
          sitio,
          fecha ? el("time", { class: "marco-fecha", datetime: tanda.fechaIso ?? null, title: fmt.fechaLegible(fecha), texto: fmt.fechaCorta(fecha) }) : null,
        ),
        el("div", { class: "marco-acciones" }, anterior, siguiente, copiar),
      ),
      el("div", { class: "marco-resumen" }, titular(tanda, c), verInstruccion),
      instruccion,
      cifrasClave(tanda, c),
      hallazgos(tanda),
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
    // Si el foco estaba en una pestaña (p. ej. se cambió con 1–2), pasa a la pestaña elegida.
    if (enfocada) enlacesDePestana.get(pestanaActual)?.focus({ preventScroll: true });
    // Anterior/siguiente conservan la pestaña (sin sus parámetros): se cambia el href en el lugar, sin perder foco.
    for (const [contenedor, id] of [[anterior, vecinas.anterior], [siguiente, vecinas.siguiente]]) {
      const enlace = contenedor.querySelector("a");
      if (enlace && id) enlace.setAttribute("href", enlaceATanda(id, pestanaActual));
    }
  }
  actualizar(ruta);

  const atajos = {
    "[": { descripcion: t("comun.atajos.desc.vecinas"), accion: () => vecinas.anterior && navegar(enlaceATanda(vecinas.anterior, pestanaActual)) },
    "]": { descripcion: t("comun.atajos.desc.vecinas"), accion: () => vecinas.siguiente && navegar(enlaceATanda(vecinas.siguiente, pestanaActual)) },
    c: { descripcion: t("comun.atajos.desc.copiarEnlace"), accion: () => copiarEnlace() },
  };
  // Una fila en la hoja de atajos con los nombres de las pestañas, tal como dicen hoy («1 / 2: Mapa · Replay»).
  const nombresDePestanas = () => PESTANAS.map((pestana) => t(NOMBRES_DE_PESTANA[pestana])).join(" · ");
  PESTANAS.forEach((pestana, indice) => {
    atajos[String(indice + 1)] = { descripcion: nombresDePestanas, accion: () => navegar(enlaceATanda(tanda.id, pestana)) };
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
