// Resumen de una tanda (diseño §10.4): la pestaña por defecto al abrir una tanda. Empieza por el hallazgo
// (titulares.tanda) y lo que lo sostiene (cifras y los demás hallazgos, cada uno con su enlace al paso exacto en
// Replay y en la telaraña), y después la ruta recomendada, los intentos, los errores de la herramienta, dónde se
// separan de la ruta y el criterio del juez. Es la puerta de entrada a Telaraña, Replay y Perfiles.

import { el, reemplazar } from "../nucleo/dom.js";
import { icono, insignia } from "../nucleo/iconos.js";
import { nombreDePagina, textoDeError, textoDeHallazgo, textoDeTitular } from "../datos/textos.js";

const ICONO_DE_SENAL = { no_effect: "sin-efecto", went_back: "volvio", visible_error: "error-visible", security_block: "bloqueo" };
const ACCIONES_VISIBLES = 2;

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
  const sinValidos = !validos;
  const noAplica = ctx.t("resumen.cifra.sinValidos");
  const sinEfecto = kpis.sinEfecto ?? 0;
  const noCumplidas = kpis.noCumplidas ?? 0;
  const tropiezos = sinEfecto + noCumplidas;
  const partesTropiezos = [
    sinEfecto ? ctx.t("resumen.cifra.sinEfecto", { n: sinEfecto }) : null,
    noCumplidas ? ctx.t("resumen.cifra.noCumplidas", { n: noCumplidas }) : null,
  ].filter(Boolean);
  const hayRuta = !!c.tanda.telarana?.ruta;
  return el(
    "dl",
    { class: "fila-cifras resumen-cifras" },
    cifra(ctx.t("resumen.cifra.llegan"), sinValidos ? "—" : ctx.fmt.conteo({ n: kpis.logrados ?? 0, de: validos }), null, { titulo: sinValidos ? noAplica : null }),
    cifra(
      ctx.t("resumen.cifra.siguen"),
      sinValidos || !hayRuta ? "—" : ctx.fmt.conteo({ n: kpis.siguenLaRuta ?? 0, de: validos }),
      hayRuta ? null : ctx.t("resumen.cifra.sinRuta"),
      { titulo: sinValidos ? noAplica : !hayRuta ? ctx.t("resumen.cifra.sinRuta") : null },
    ),
    cifra(
      ctx.t("resumen.cifra.pasos"),
      typeof kpis.pasosMediana === "number" ? ctx.fmt.numero(kpis.pasosMediana) : "—",
      typeof kpis.pasosIdeales === "number" ? ctx.t("resumen.cifra.rutaPasos", { n: kpis.pasosIdeales }) : null,
      { titulo: typeof kpis.pasosMediana === "number" ? null : noAplica },
    ),
    cifra(
      ctx.t("resumen.cifra.tropiezos"),
      sinValidos ? "—" : ctx.fmt.numero(tropiezos),
      sinValidos ? null : partesTropiezos.length ? partesTropiezos.join(" · ") : ctx.t("resumen.cifra.ninguno"),
      { titulo: sinValidos ? noAplica : null },
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

  if (casos.length > 1) {
    casos.forEach((caso, indice) => {
      const nombre = c.nombreIntento(caso.intento);
      enlaces.push(
        enlaceConFlecha({
          href: ctx.enlace("replay", { intento: caso.intento, paso: caso.paso }),
          texto: ctx.t("resumen.hallazgo.casoPaso", { nombre, paso: caso.paso }),
          etiqueta: ctx.t("resumen.hallazgo.verPasoEtiqueta", { nombre, paso: caso.paso }),
          clase: indice === 0 ? "resumen-hallazgo-principal" : "",
          foco: `resumen:hallazgo:${hallazgo.id}:${indice}`,
          extra: indice === 0 ? { "data-hallazgo": "" } : {},
        }),
      );
    });
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

  if (tipo === "costo") {
    enlaces.push(
      enlaceConFlecha({
        href: ctx.enlace("perfiles"),
        texto: ctx.t("resumen.hallazgo.verPerfiles"),
        etiqueta: ctx.t("resumen.hallazgo.verPerfilesEtiqueta"),
        clase: "resumen-hallazgo-principal",
        foco: `resumen:hallazgo:${hallazgo.id}`,
        extra: { "data-hallazgo": "" },
      }),
    );
  }
  return enlaces;
}

function hallazgos(ctx, c) {
  const lista = (c.tanda.hallazgos ?? []).filter((hallazgo) => hallazgo.id !== "resultado");
  const cuerpo = lista.length
    ? el(
        "ul",
        { class: "resumen-hallazgos" },
        lista.map((hallazgo) => {
          const tipo = hallazgo.id.split(":")[0];
          const nivel = tipo === "detenido" ? "peligro" : tipo === "errores" ? "error" : hallazgo.nivel;
          return el(
            "li",
            { class: `resumen-hallazgo resumen-nivel-${nivel}` },
            icono(iconoDeHallazgo(hallazgo), { clase: "resumen-hallazgo-icono" }),
            el("p", { class: "resumen-hallazgo-texto", texto: textoDeHallazgo(hallazgo, c.tanda, ctx.t) }),
            el("div", { class: "resumen-hallazgo-enlaces" }, enlacesDeHallazgo(ctx, c, hallazgo)),
          );
        }),
      )
    : el("p", { class: "resumen-nada texto-3", texto: ctx.t("resumen.hallazgo.ninguno") });
  return seccion({ id: "resumen-titulo-hallazgos", titulo: ctx.t("resumen.hallazgo.titulo"), clase: "resumen-seccion-hallazgos" }, cuerpo);
}

// ── Ruta recomendada ────────────────────────────────────────────────────────

function accionesDelTramo(ctx, c, tramo) {
  const rama = (c.tanda.telarana?.ramas ?? []).find((r) => r.origen === tramo.origen && r.destino === tramo.destino);
  // Cuántos intentos válidos hicieron cada acción: los con error de la herramienta no cuentan (como en las cifras).
  const validos = new Set((c.tanda.intentos ?? []).filter(esValido).map((intento) => intento.perfil ?? intento.id));
  const acciones = rama?.acciones?.length
    ? rama.acciones.map((accion) => ({ accion: accion.accion, n: (accion.perfiles ?? []).filter((perfil) => validos.has(perfil)).length }))
    : [{ accion: tramo.accion, n: 0 }];
  const texto = (accion) => (accion.n ? ctx.t("resumen.ruta.accionVeces", { accion: accion.accion, n: accion.n }) : accion.accion);
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
  const meta = [
    typeof datos.segundos === "number" ? ctx.t("resumen.ruta.segundos", { duracion: ctx.fmt.duracion(datos.segundos) }) : null,
    typeof datos.probabilidad === "number"
      ? el("span", { title: ctx.t("resumen.ruta.probabilidadTitulo"), texto: ctx.t("resumen.ruta.probabilidad", { p: ctx.fmt.numero(datos.probabilidad, { style: "percent", maximumFractionDigits: 0 }) }) })
      : null,
  ].filter(Boolean);

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
            title: llegan.length ? ctx.t("resumen.ruta.lleganTitulo", { nombres: ctx.fmt.lista(llegan.map((i) => i.nombrePerfil ?? i.id)) }) : ctx.t("resumen.ruta.nadieLlega"),
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
    el(
      "p",
      { class: "resumen-subtitular" },
      el("span", { class: "texto-2", texto: tanda.titulares?.telarana ? textoDeTitular(tanda.titulares.telarana, tanda, ctx.t) : "" }),
      meta.length ? el("span", { class: "resumen-ruta-meta texto-3" }, meta.map((pieza, i) => [i ? " · " : "", pieza])) : null,
    ),
    el("ol", { class: "resumen-hitos", "aria-label": ctx.t("resumen.ruta.hitos") }, hitos),
  );
}

// ── Intentos ────────────────────────────────────────────────────────────────

function intentos(ctx, c) {
  const { tanda } = c;
  const columnas = ["perfil", "resultado", "pasos", "hitos", "tiempo"].map((clave) => ctx.t(`resumen.intentos.columna.${clave}`));
  const filas = (tanda.intentos ?? []).map((intento) => {
    const valido = esValido(intento);
    const nombre = intento.nombrePerfil ?? intento.perfil ?? intento.id;
    const totalHitos = intento.hitos?.length ?? 0;
    return el(
      "tr",
      { class: valido ? null : "resumen-intento-error" },
      el(
        "th",
        { scope: "row", "data-etiqueta": columnas[0] },
        el("span", { class: "resumen-intento-nombre", texto: nombre }),
        intento.viewport?.ancho ? el("span", { class: "resumen-intento-viewport texto-3", texto: `${intento.viewport.ancho}×${intento.viewport.alto}` }) : null,
      ),
      el("td", { "data-etiqueta": columnas[1] }, insignia(intento.resultado, { logro: intento.logro })),
      el("td", { class: "num", "data-etiqueta": columnas[2], texto: ctx.fmt.numero(intento.pasos?.length ?? 0) }),
      el(
        "td",
        { class: "num", "data-etiqueta": columnas[3], title: valido ? null : ctx.t("resumen.intentos.noCuenta") },
        valido && totalHitos ? ctx.fmt.conteo({ n: intento.hitosAlcanzados ?? 0, de: totalHitos }) : "—",
      ),
      el("td", { class: "num", "data-etiqueta": columnas[4], texto: ctx.fmt.duracion(intento.duracion) || "—" }),
      el(
        "td",
        { class: "resumen-intento-enlaces" },
        enlaceConFlecha({
          href: ctx.enlace("replay", { intento: intento.id }),
          texto: ctx.t("resumen.intentos.replay"),
          etiqueta: ctx.t("resumen.intentos.replayEtiqueta", { nombre }),
          foco: `resumen:intento:${intento.id}:replay`,
        }),
        enlaceConFlecha({
          href: ctx.enlace("telarana", { historia: intento.id }),
          texto: ctx.t("resumen.intentos.historia"),
          etiqueta: ctx.t("resumen.intentos.historiaEtiqueta", { nombre }),
          foco: `resumen:intento:${intento.id}:historia`,
        }),
      ),
    );
  });
  const titularPerfiles = tanda.titulares?.perfiles ? textoDeTitular(tanda.titulares.perfiles, tanda, ctx.t) : null;
  return seccion(
    {
      id: "resumen-titulo-intentos",
      titulo: ctx.t("resumen.intentos.titulo"),
      extra: enlaceConFlecha({ href: ctx.enlace("perfiles"), texto: ctx.t("resumen.intentos.compararPerfiles"), foco: "resumen:perfiles" }),
      clase: "resumen-seccion-intentos",
    },
    titularPerfiles ? el("p", { class: "resumen-subtitular texto-2", texto: titularPerfiles }) : null,
    el(
      "div",
      { class: "resumen-tabla-caja" },
      el(
        "table",
        { class: "tabla resumen-tabla" },
        el("caption", { class: "visualmente-oculto", texto: ctx.t("resumen.intentos.titulo") }),
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            columnas.map((texto, indice) => el("th", { scope: "col", class: indice >= 2 ? "num" : null, texto })),
            el("th", { scope: "col" }, el("span", { class: "visualmente-oculto", texto: ctx.t("resumen.intentos.columna.abrir") })),
          ),
        ),
        el("tbody", {}, filas),
      ),
    ),
  );
}

// ── Errores de la herramienta ───────────────────────────────────────────────

function errores(ctx, c) {
  const conError = (c.tanda.intentos ?? []).filter((intento) => !esValido(intento));
  if (!conError.length) return null;
  return seccion(
    { id: "resumen-titulo-errores", titulo: ctx.t("resumen.errores.titulo"), clase: "resumen-seccion-errores" },
    el(
      "ul",
      { class: "resumen-errores" },
      conError.map((intento) => {
        const nombre = intento.nombrePerfil ?? intento.perfil ?? intento.id;
        const error = textoDeError(intento.error, ctx.t) ?? { titulo: ctx.t("comun.resultado.error"), resumen: "", detalle: "" };
        const n = intento.pasos?.length ?? 0;
        return el(
          "li",
          { class: "tarjeta resumen-error" },
          el(
            "h4",
            { class: "resumen-error-titulo" },
            icono("error-herramienta"),
            el("span", { texto: ctx.t("resumen.errores.encabezado", { nombre, error: error.titulo }) }),
          ),
          error.resumen ? el("p", { class: "mono resumen-error-resumen truncar", title: error.resumen, texto: error.resumen }) : null,
          error.detalle
            ? el(
                "details",
                { class: "detalle-tecnico" },
                el("summary", { texto: ctx.t("comun.estado.detalleTecnico") }),
                el("pre", { class: "mono", texto: error.detalle }),
              )
            : null,
          el(
            "p",
            { class: "resumen-error-pie" },
            el("span", { class: "texto-3", texto: ctx.t("resumen.errores.noCuenta") }),
            n
              ? enlaceConFlecha({
                  href: ctx.enlace("replay", { intento: intento.id }),
                  texto: ctx.t("resumen.errores.verPasos", { n }),
                  etiqueta: ctx.t("resumen.hallazgo.verIntentoEtiqueta", { nombre, n }),
                  foco: `resumen:error:${intento.id}`,
                })
              : null,
          ),
        );
      }),
    ),
  );
}

// ── Dónde se separan de la ruta ─────────────────────────────────────────────

function quiebres(ctx, c) {
  const { tanda } = c;
  const datos = tanda.telarana?.ruta;
  if (!datos?.paginas?.length) return null;
  const lista = (tanda.intentos ?? [])
    .filter((intento) => esValido(intento) && intento.seSepara)
    .sort((a, b) => (a.seSepara.paso ?? 0) - (b.seSepara.paso ?? 0));
  const titulo = ctx.t("resumen.quiebres.titulo");
  if (!lista.length) {
    return seccion(
      { id: "resumen-titulo-quiebres", titulo, clase: "resumen-seccion-quiebres" },
      el("p", { class: "resumen-nada texto-3" }, icono("logrado", { clase: "resumen-nada-icono" }), el("span", { texto: ctx.t("resumen.quiebres.ninguno") })),
    );
  }
  return seccion(
    { id: "resumen-titulo-quiebres", titulo, clase: "resumen-seccion-quiebres" },
    el(
      "ul",
      { class: "resumen-quiebres" },
      lista.map((intento) => {
        const { tramo, paso, pagina, seDetuvo } = intento.seSepara;
        const nombre = intento.nombrePerfil ?? intento.perfil ?? intento.id;
        const desde = c.nombrePagina(datos.paginas[Math.max(0, (tramo ?? 1) - 1)]);
        const titular = pagina
          ? ctx.t("resumen.quiebres.deja", { desde, hacia: c.nombrePagina(pagina) })
          : seDetuvo
            ? ctx.t("resumen.quiebres.detiene", { desde })
            : ctx.t("resumen.quiebres.dejaSinDestino", { desde });
        const expectativa = (intento.pasos ?? []).find((p) => p.numero === paso)?.expectativa;
        const vuelve = intento.vuelveALaRuta && intento.vuelveEnPaso != null;
        return el(
          "li",
          { class: `tarjeta resumen-quiebre ${vuelve ? "resumen-quiebre-vuelve" : "resumen-quiebre-no-vuelve"}` },
          el("p", { class: "etiqueta-micro", texto: ctx.t("resumen.quiebres.kicker", { tramo: tramo ?? "—", paso: paso ?? "—", nombre }) }),
          el("h4", { class: "resumen-quiebre-titulo", texto: titular }),
          expectativa ? el("blockquote", { class: "prosa resumen-quiebre-cita", texto: expectativa }) : null,
          el(
            "p",
            { class: "resumen-quiebre-pie" },
            el("span", { class: vuelve ? "texto-2" : "resumen-no-vuelve", texto: vuelve ? ctx.t("resumen.quiebres.vuelve", { paso: intento.vuelveEnPaso }) : ctx.t("resumen.quiebres.noVuelve") }),
            paso != null
              ? [
                  enlaceConFlecha({
                    href: ctx.enlace("replay", { intento: intento.id, paso }),
                    texto: ctx.t("resumen.quiebres.verEnReplay"),
                    etiqueta: ctx.t("resumen.hallazgo.verPasoEtiqueta", { nombre, paso }),
                    foco: `resumen:quiebre:${intento.id}`,
                  }),
                  enlaceATelarana(ctx, {
                    href: ctx.enlace("telarana", { historia: intento.id, paso }),
                    etiqueta: ctx.t("resumen.hallazgo.enTelaranaEtiqueta", { nombre, paso }),
                    foco: `resumen:quiebre:${intento.id}:telarana`,
                  }),
                ]
              : null,
          ),
        );
      }),
    ),
  );
}

// ── Criterio del juez y pie ─────────────────────────────────────────────────

function criterio(ctx, c) {
  const datos = c.tanda.criterio;
  if (!datos?.texto) return null;
  return el(
    "details",
    { class: "resumen-criterio", "data-foco": "resumen:criterio" },
    el("summary", {}, el("span", { class: "resumen-criterio-titulo", texto: ctx.t("resumen.criterio.titulo") })),
    el(
      "div",
      { class: "resumen-criterio-cuerpo" },
      el("p", { class: "prosa", texto: datos.texto }),
      datos.evidencias?.length
        ? [
            el("p", { class: "etiqueta-micro", texto: ctx.t("resumen.criterio.evidencias") }),
            el("ul", { class: "resumen-evidencias prosa" }, datos.evidencias.map((evidencia) => el("li", { texto: evidencia }))),
          ]
        : null,
    ),
  );
}

function pie(ctx, c) {
  const intentosN = c.tanda.kpis?.intentos ?? c.tanda.intentos?.length ?? 0;
  const perfilesN = c.tanda.perfiles?.length ?? new Set((c.tanda.intentos ?? []).map((i) => i.perfil)).size;
  return el("p", { class: "resumen-pie texto-3", texto: ctx.t("resumen.pie", { intentos: intentosN, perfiles: perfilesN }) });
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
      el("div", { class: "resumen-cabeza" }, titular(ctx, c), cifras(ctx, c)),
      hallazgos(ctx, c),
      ruta(ctx, c),
      intentos(ctx, c),
      errores(ctx, c),
      quiebres(ctx, c),
      criterio(ctx, c),
      pie(ctx, c),
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
