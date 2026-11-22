// Resumen de una tanda (diseño §10.4): la pestaña por defecto al abrir una tanda, pensada para leerse de un vistazo
// en una pantalla. Dice cuántos llegan (titular y cifras), dónde se pierden o gastan pasos (los hallazgos más
// importantes, cada uno con su enlace al paso exacto en Replay y en la telaraña), por qué camino (la ruta
// recomendada) y cómo les va a los dos niveles de conocimiento. El detalle vive en Telaraña y Replay.

import { el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea } from "../nucleo/estados.js";
import { icono } from "../nucleo/iconos.js";
import { nombreDePagina, textoDeAccion, textoDeHallazgo, textoDeTitular } from "../datos/textos.js";
import { nombreConNivel } from "../datos/nombres.js";

const ICONO_DE_SENAL = { no_effect: "sin-efecto", went_back: "volvio", visible_error: "error-visible", security_block: "bloqueo" };
const ACCIONES_VISIBLES = 2;
const HALLAZGOS_VISIBLES = 3;
// Qué hallazgo va primero: quien no llega, los errores, los pasos perdidos, quien deja la ruta y no vuelve, las
// demoras; los desvíos de los que vuelven y el costo, solo si sobra lugar.
const PRIORIDAD_DE_HALLAZGO = { detenido: 0, errores: 1, tropiezos: 2, desvio: 3, demora: 4, costo: 6 };

let estado = null;

// ── Ayudas ──────────────────────────────────────────────────────────────────

const esValido = (intento) => intento?.resultado !== "error";

function contexto(ctx) {
  const tanda = ctx.tanda;
  const paginas = new Map((tanda.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  return {
    tanda,
    paginas,
    intentos,
    nombrePagina: (id) => nombreDePagina(paginas.get(id) ?? (id ? { tituloCorto: String(id) } : null), ctx.t),
    nombreIntento: (id) => intentos.get(id)?.nombrePerfil ?? intentos.get(id)?.perfil ?? String(id ?? ""),
  };
}

/** Título completo de una página (para el globo nativo): título del sitio y URL. */
function tituloCompleto(pagina) {
  if (!pagina) return null;
  return [pagina.titulo, pagina.url].filter(Boolean).join(" — ") || null;
}

function seccion({ id, titulo, extra = null, clase = "" }, ...hijos) {
  return el(
    "section",
    { class: `seccion resumen-seccion ${clase}`.trim(), "aria-labelledby": id },
    el("header", { class: "resumen-seccion-cabecera" }, el("h3", { id, class: "etiqueta-micro", texto: titulo }), extra),
    hijos,
  );
}

function enlaceConFlecha({ href, texto, etiqueta = null, clase = "", foco = null, extra = {} }) {
  return el(
    "a",
    { class: `resumen-enlace ${clase}`.trim(), href, "aria-label": etiqueta, "data-foco": foco, ...extra },
    el("span", { texto }),
    icono("siguiente"),
  );
}

function enlaceATelarana(ctx, { href, etiqueta, foco = null }) {
  return el(
    "a",
    { class: "resumen-enlace-icono", href, "aria-label": etiqueta, title: etiqueta, "data-foco": foco },
    icono("historia"),
  );
}

// ── Titular y cifras ────────────────────────────────────────────────────────

function titular(ctx, c) {
  const { tanda } = c;
  const kpis = tanda.kpis ?? {};
  const resultado = (tanda.hallazgos ?? []).find((hallazgo) => hallazgo.id === "resultado");
  // "dificultad": todos llegan, pero alguien tarda o tropieza; no es un check verde.
  const nivel = tanda.titulares?.tanda?.nivel ?? resultado?.nivel ?? (kpis.validos && kpis.logrados === kpis.validos ? "bien" : "atencion");
  const nombreIcono = !kpis.validos ? "error-herramienta" : nivel === "bien" ? "logrado" : nivel === "dificultad" ? "dificultad" : "fallido";
  const texto = tanda.titulares?.tanda
    ? textoDeTitular(tanda.titulares.tanda, tanda, ctx.t)
    : resultado
      ? textoDeHallazgo(resultado, tanda, ctx.t)
      : "";
  return el(
    "header",
    { class: `resumen-titular resumen-nivel-${!kpis.validos ? "error" : nivel}` },
    icono(nombreIcono, { clase: "resumen-titular-icono" }),
    el("h2", { tabindex: "-1", "data-foco-inicial": "", texto }),
  );
}

function cifra(etiqueta, valor, contextoTexto = null, { titulo = null } = {}) {
  return el(
    "div",
    { class: "cifra" },
    el("dt", { class: "cifra-etiqueta", texto: etiqueta }),
    el("dd", { class: "cifra-valor", title: titulo, texto: valor }),
    contextoTexto ? el("dd", { class: "cifra-contexto", texto: contextoTexto }) : null,
  );
}

function cifras(ctx, c) {
  const kpis = c.tanda.kpis ?? {};
  const validos = kpis.validos ?? 0;
  const noAplica = ctx.t("resumen.cifra.sinValidos");
  return el(
    "dl",
    { class: "fila-cifras resumen-cifras" },
    cifra(ctx.t("resumen.cifra.llegan"), validos ? ctx.fmt.conteo({ n: kpis.logrados ?? 0, de: validos }) : "—", null, { titulo: validos ? null : noAplica }),
    cifra(
      ctx.t("resumen.cifra.pasos"),
      typeof kpis.pasosMediana === "number" ? ctx.fmt.numero(kpis.pasosMediana) : "—",
      typeof kpis.pasosIdeales === "number" ? ctx.t("resumen.cifra.rutaPasos", { n: kpis.pasosIdeales }) : null,
      { titulo: typeof kpis.pasosMediana === "number" ? null : noAplica },
    ),
    kpis.errores ? cifra(ctx.t("resumen.cifra.errores"), ctx.fmt.numero(kpis.errores), ctx.t("resumen.cifra.erroresContexto")) : null,
  );
}

// ── Hallazgos ───────────────────────────────────────────────────────────────

function iconoDeHallazgo(hallazgo) {
  const tipo = hallazgo.id.split(":")[0];
  if (tipo === "errores") return "error-herramienta";
  if (tipo === "desvio") return "fuera-de-ruta";
  if (tipo === "detenido") return "fallido";
  if (tipo === "demora") return "proximamente";
  if (tipo === "tropiezos") return ICONO_DE_SENAL[hallazgo.vars?.casos?.[0]?.senal] ?? "sin-efecto";
  if (tipo === "costo") return "info";
  return hallazgo.nivel === "bien" ? "logrado" : "info";
}

/** Enlaces de un hallazgo: al paso exacto en Replay (principal) y en la telaraña (historia). */
function enlacesDeHallazgo(ctx, c, hallazgo) {
  const tipo = hallazgo.id.split(":")[0];
  const enlaces = [];
  const casos = tipo === "tropiezos" ? (hallazgo.vars?.casos ?? []) : [];

  // Tropiezos en varios intentos: un solo enlace, al primero; el resto se ve en Replay.
  if (casos.length > 1) {
    const [caso] = casos;
    const nombre = c.nombreIntento(caso.intento);
    enlaces.push(
      enlaceConFlecha({
        href: ctx.enlace("replay", { intento: caso.intento, paso: caso.paso }),
        texto: ctx.t("resumen.hallazgo.verPaso", { paso: caso.paso }),
        etiqueta: ctx.t("resumen.hallazgo.verPasoEtiqueta", { nombre, paso: caso.paso }),
        clase: "resumen-hallazgo-principal",
        foco: `resumen:hallazgo:${hallazgo.id}`,
        extra: { "data-hallazgo": "" },
      }),
    );
    return enlaces;
  }

  if (hallazgo.intento && hallazgo.paso != null) {
    const nombre = c.nombreIntento(hallazgo.intento);
    enlaces.push(
      enlaceConFlecha({
        href: ctx.enlace("replay", { intento: hallazgo.intento, paso: hallazgo.paso }),
        texto: ctx.t("resumen.hallazgo.verPaso", { paso: hallazgo.paso }),
        etiqueta: ctx.t("resumen.hallazgo.verPasoEtiqueta", { nombre, paso: hallazgo.paso }),
        clase: "resumen-hallazgo-principal",
        foco: `resumen:hallazgo:${hallazgo.id}`,
        extra: { "data-hallazgo": "" },
      }),
      enlaceATelarana(ctx, {
        href: ctx.enlace("telarana", { historia: hallazgo.intento, paso: hallazgo.paso }),
        etiqueta: ctx.t("resumen.hallazgo.enTelaranaEtiqueta", { nombre, paso: hallazgo.paso }),
        foco: `resumen:hallazgo:${hallazgo.id}:telarana`,
      }),
    );
    return enlaces;
  }

  if (hallazgo.intento) {
    const intento = c.intentos.get(hallazgo.intento);
    const nombre = c.nombreIntento(hallazgo.intento);
    const n = intento?.pasos?.length ?? 0;
    enlaces.push(
      enlaceConFlecha({
        href: ctx.enlace("replay", { intento: hallazgo.intento }),
        texto: ctx.t("resumen.hallazgo.verIntento", { n }),
        etiqueta: ctx.t("resumen.hallazgo.verIntentoEtiqueta", { nombre, n }),
        clase: "resumen-hallazgo-principal",
        foco: `resumen:hallazgo:${hallazgo.id}`,
        extra: { "data-hallazgo": "" },
      }),
    );
    return enlaces;
  }

  if (hallazgo.pagina) {
    const pagina = c.nombrePagina(hallazgo.pagina);
    enlaces.push(
      enlaceConFlecha({
        href: ctx.enlace("telarana", { pagina: hallazgo.pagina }),
        texto: ctx.t("resumen.hallazgo.verPagina"),
        etiqueta: ctx.t("resumen.hallazgo.verPaginaEtiqueta", { pagina }),
        clase: "resumen-hallazgo-principal",
        foco: `resumen:hallazgo:${hallazgo.id}`,
        extra: { "data-hallazgo": "" },
      }),
    );
    return enlaces;
  }

  return enlaces;
}

/** Orden de un hallazgo en el Resumen: menor va antes (los desvíos de quien vuelve a la ruta, al final). */
function prioridad(hallazgo) {
  const tipo = hallazgo.id.split(":")[0];
  if (tipo === "desvio" && hallazgo.nivel === "info") return 5;
  return PRIORIDAD_DE_HALLAZGO[tipo] ?? 7;
}

/** Los hallazgos que más dicen (máximo HALLAZGOS_VISIBLES); el titular ya cuenta el resultado. */
export function hallazgosPrincipales(lista) {
  return (lista ?? [])
    .filter((hallazgo) => hallazgo.id !== "resultado")
    .map((hallazgo, indice) => ({ hallazgo, indice }))
    .sort((a, b) => prioridad(a.hallazgo) - prioridad(b.hallazgo) || a.indice - b.indice)
    .slice(0, HALLAZGOS_VISIBLES)
    .map(({ hallazgo }) => hallazgo);
}

function hallazgos(ctx, c) {
  const lista = hallazgosPrincipales(c.tanda.hallazgos);
  const cuerpo = lista.length
    ? el(
        "ul",
        { class: "resumen-hallazgos" },
        lista.map((hallazgo) => {
          const tipo = hallazgo.id.split(":")[0];
          const nivel = tipo === "detenido" ? "peligro" : tipo === "errores" ? "error" : hallazgo.nivel;
          const texto = textoDeHallazgo(hallazgo, c.tanda, ctx.t);
          return el(
            "li",
            { class: `resumen-hallazgo resumen-nivel-${nivel}` },
            icono(iconoDeHallazgo(hallazgo), { clase: "resumen-hallazgo-icono" }),
            el("p", { class: "resumen-hallazgo-texto", title: texto, texto }),
            el("div", { class: "resumen-hallazgo-enlaces" }, enlacesDeHallazgo(ctx, c, hallazgo)),
          );
        }),
      )
    : el("p", { class: "resumen-nada texto-3", texto: ctx.t("resumen.hallazgo.ninguno") });
  return seccion({ id: "resumen-titulo-hallazgos", titulo: ctx.t("resumen.hallazgo.titulo"), clase: "resumen-seccion-hallazgos" }, cuerpo);
}

// ── Ruta recomendada ────────────────────────────────────────────────────────

/** Las acciones con que se recorrió un tramo de la ruta (texto de la tarjeta y su globo). */
export function accionesDelTramo(ctx, c, tramo) {
  const rama = (c.tanda.telarana?.ramas ?? []).find((r) => r.origen === tramo.origen && r.destino === tramo.destino);
  // Cuántos intentos válidos hicieron cada acción: los con error de la herramienta no cuentan (como en las cifras).
  const validos = new Set((c.tanda.intentos ?? []).filter(esValido).map((intento) => intento.perfil ?? intento.id));
  // Primero, la acción de la ruta del evaluador para este tramo (la rama junta todos los caminos que terminan en la
  // misma página, y la más repetida puede ser otra). Después las demás; los «volver a …» del explorador (un salto
  // que ningún humano puede dar), al final.
  const acciones = (rama?.acciones ?? [])
    .map((accion) => ({ accion: accion.accion, salto: !!accion.salto, n: (accion.perfiles ?? []).filter((perfil) => validos.has(perfil)).length }))
    .sort((a, b) => a.salto - b.salto || (b.accion === tramo.accion) - (a.accion === tramo.accion));
  if (tramo.accion && !acciones.some((accion) => accion.accion === tramo.accion)) acciones.unshift({ accion: tramo.accion, salto: false, n: 0 });
  const texto = (accion) => {
    const legible = textoDeAccion(accion.accion, ctx.t);
    return accion.n ? ctx.t("resumen.ruta.accionVeces", { accion: legible, n: accion.n }) : legible;
  };
  const visibles = acciones.slice(0, ACCIONES_VISIBLES).map(texto);
  const resto = acciones.length - visibles.length;
  return {
    texto: [...visibles, resto > 0 ? ctx.t("resumen.ruta.masAcciones", { n: resto }) : null].filter(Boolean).join(" · "),
    completo: [ctx.t("resumen.ruta.accionVecesTitulo"), ...acciones.map(texto)].join("\n"),
  };
}

function ruta(ctx, c) {
  const { tanda } = c;
  const datos = tanda.telarana?.ruta;
  const verEnTelarana = enlaceConFlecha({ href: ctx.enlace("telarana"), texto: ctx.t("resumen.ruta.verEnTelarana"), foco: "resumen:ruta:telarana" });
  if (!datos?.paginas?.length) {
    const titularTelarana = tanda.titulares?.telarana ? textoDeTitular(tanda.titulares.telarana, tanda, ctx.t) : ctx.t("resumen.ruta.sinRuta");
    return seccion(
      { id: "resumen-titulo-ruta", titulo: ctx.t("resumen.ruta.titulo"), extra: verEnTelarana, clase: "resumen-seccion-ruta" },
      el("p", { class: "resumen-nada texto-2", texto: titularTelarana }),
    );
  }
  const validos = (tanda.intentos ?? []).filter(esValido);
  const total = datos.paginas.length;

  const hitos = datos.paginas.map((paginaId, indice) => {
    const pagina = c.paginas.get(paginaId);
    const llegan = validos.filter((intento) => intento.hitos?.[indice]?.alcanzado);
    const ultimo = indice === total - 1;
    const respuesta = ultimo && (pagina?.finales?.logrado ?? 0) > 0;
    const tramo = ultimo ? null : datos.tramos?.[indice];
    const acciones = tramo ? accionesDelTramo(ctx, c, tramo) : null;
    return el(
      "li",
      { class: `resumen-hito${ultimo ? " resumen-hito-ultimo" : ""}` },
      el(
        "div",
        { class: "resumen-hito-caja" },
        el(
          "a",
          {
            class: "resumen-hito-pagina",
            href: ctx.enlace("telarana", { pagina: paginaId }),
            title: tituloCompleto(pagina),
            "data-foco": `resumen:hito:${paginaId}`,
          },
          el("span", { class: "resumen-hito-numero", "aria-hidden": "true", texto: String(indice + 1) }),
          el("span", { class: "visualmente-oculto", texto: ctx.t("resumen.ruta.hito", { n: indice + 1 }) }),
          el("span", { class: `resumen-hito-nombre${pagina?.tituloTipo === "url" ? " resumen-pagina-url" : ""}`, texto: c.nombrePagina(paginaId) }),
        ),
        el(
          "span",
          {
            class: "resumen-hito-cuenta",
            title: llegan.length ? ctx.t("resumen.ruta.lleganTitulo", { nombres: ctx.fmt.lista(llegan.map((i) => nombreConNivel(i.nombrePerfil ?? i.id, ctx.t))) }) : ctx.t("resumen.ruta.nadieLlega"),
          },
          el("span", { class: "num", texto: validos.length ? ctx.fmt.conteo({ n: llegan.length, de: validos.length }) : "—" }),
          respuesta ? el("span", { class: "resumen-hito-respuesta", title: ctx.t("resumen.ruta.respuesta") }, icono("check", { etiqueta: ctx.t("resumen.ruta.respuesta") })) : null,
        ),
      ),
      tramo
        ? el(
            "div",
            { class: "resumen-tramo", title: acciones.completo },
            el("span", { class: "resumen-tramo-linea", "aria-hidden": "true" }),
            el("span", { class: "resumen-tramo-accion", texto: acciones.texto }),
            typeof tramo.pasos === "number" ? el("span", { class: "resumen-tramo-pasos", texto: ctx.t("resumen.ruta.tramoPasos", { n: tramo.pasos }) }) : null,
          )
        : null,
    );
  });

  return seccion(
    { id: "resumen-titulo-ruta", titulo: ctx.t("resumen.ruta.titulo"), extra: verEnTelarana, clase: "resumen-seccion-ruta" },
    tanda.titulares?.telarana ? el("p", { class: "resumen-subtitular texto-2", texto: textoDeTitular(tanda.titulares.telarana, tanda, ctx.t) }) : null,
    el("ol", { class: "resumen-hitos", "aria-label": ctx.t("resumen.ruta.hitos") }, hitos),
  );
}

// ── Por nivel de conocimiento ───────────────────────────────────────────────

/** Los dos niveles de conocimiento lado a lado (solo si la tanda tiene los dos). */
function niveles(ctx, c) {
  const filas = c.tanda.porConocimiento;
  if (!filas?.length) return null;
  const claves = ["nivel", "logrados", "pasos", "tiempo"];
  const columnas = claves.map((clave) => ctx.t(`resumen.niveles.columna.${clave}`));
  const celda = (indice, texto) => el("td", { class: "num", "data-etiqueta": columnas[indice], texto });
  return seccion(
    { id: "resumen-titulo-niveles", titulo: ctx.t("resumen.niveles.titulo"), clase: "resumen-seccion-niveles" },
    el(
      "table",
      { class: "tabla resumen-niveles" },
      el("caption", { class: "visualmente-oculto", texto: ctx.t("resumen.niveles.titulo") }),
      el("thead", {}, el("tr", {}, columnas.map((texto, indice) => el("th", { scope: "col", class: indice ? "num" : null, texto })))),
      el(
        "tbody",
        {},
        filas.map((fila) =>
          el(
            "tr",
            {},
            el("th", { scope: "row", texto: ctx.t(`resumen.niveles.nivel.${fila.nivel}`) }),
            celda(1, ctx.fmt.conteo({ n: fila.logrados, de: fila.intentos })),
            celda(2, fila.pasosMediana === null ? "—" : ctx.fmt.numero(fila.pasosMediana)),
            celda(3, ctx.fmt.duracion(fila.segundosMediana) || "—"),
          ),
        ),
      ),
    ),
  );
}

// ── Teclado ─────────────────────────────────────────────────────────────────

function moverHallazgo(delta) {
  const enlaces = [...(estado?.raiz.querySelectorAll("[data-hallazgo]") ?? [])];
  if (!enlaces.length) return;
  const activo = document.activeElement?.closest?.(".resumen-hallazgo")?.querySelector("[data-hallazgo]");
  const actual = enlaces.indexOf(activo);
  const siguiente = actual === -1 ? (delta > 0 ? 0 : enlaces.length - 1) : Math.min(enlaces.length - 1, Math.max(0, actual + delta));
  enlaces[siguiente].focus();
  enlaces[siguiente].scrollIntoView({ block: "nearest" });
}

export default {
  titulo(ctx) {
    return ctx.t("comun.pestana.resumen");
  },

  async montar(contenedor, ctx) {
    await ctx.cargarEstilos("estilos/resumen.css");
    // Si otra navegación reemplazó la vista mientras cargaba el CSS, no se arma ni se registra nada.
    if (ctx.senal.aborted) return;
    contenedor.classList.add("p-resumen");
    estado = { raiz: contenedor };
    const c = contexto(ctx);
    reemplazar(
      contenedor,
      c.tanda.arbol === "danado" || c.tanda.arbol === "falta"
        ? avisoEnLinea(ctx.t(c.tanda.arbol === "danado" ? "resumen.archivos.arbolDanado" : "resumen.archivos.arbolFalta"), "atencion")
        : null,
      el("div", { class: "resumen-cabeza" }, titular(ctx, c), el("div", { class: "resumen-indicadores" }, cifras(ctx, c), niveles(ctx, c))),
      hallazgos(ctx, c),
      ruta(ctx, c),
    );
    ctx.atajos.registrar({
      j: { descripcion: () => ctx.t("comun.atajos.desc.hallazgos"), accion: () => moverHallazgo(1) },
      k: { descripcion: () => ctx.t("comun.atajos.desc.hallazgos"), accion: () => moverHallazgo(-1) },
    });
  },

  actualizar() {
    return true;
  },

  desmontar() {
    estado = null;
  },
};
