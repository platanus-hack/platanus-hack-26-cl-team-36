// Perfiles: los tres gráficos (diseño §10.7). Sin radares: un gráfico de unidades (un punto por intento), un mapa
// perfiles × hitos de la ruta y un gráfico de puntos por métrica, cada columna con su propia escala. Todo es DOM y
// SVG armados con el()/svg(); cada marca, celda y punto es un enlace al Replay en un paso con sentido.

import { el, svg } from "../nucleo/dom.js";
import { conGlobo } from "../nucleo/globo.js";
import { icono, marcaDeSenal, textoDeResultado } from "../nucleo/iconos.js";
import { nombreDePagina } from "../datos/textos.js";
import { destinoDeCelda, destinoDeIntento, escalaLineal, fraccionDeCelda, puntosDeMetrica } from "./escalas.js";
import { etiquetasDePerfiles, textoDeNivel } from "./nombres.js";

/** Etiquetas cortas de los perfiles de la tanda (nombre completo → { completo, base, nivel }). */
const etiquetasDe = (tanda) => etiquetasDePerfiles((tanda.perfiles ?? []).map((perfil) => perfil.nombre ?? perfil.perfil));

/**
 * El nombre de un perfil en un gráfico: la base (que se corta si no cabe) y debajo el nivel, que nunca se corta en su
 * lugar. El nombre completo va en el title y, para los lectores de pantalla, como texto oculto.
 */
function etiquetaDePerfil(etiqueta, ctx, clase = "") {
  const nivel = etiqueta.nivel ? textoDeNivel(etiqueta.nivel, ctx.t) : null;
  return el(
    "span",
    { class: `perfil-etiqueta ${clase}`.trim(), title: etiqueta.completo },
    el("span", { class: "visualmente-oculto", texto: nivel ? `${etiqueta.base} (${nivel})` : etiqueta.completo }),
    el("span", { class: "perfil-etiqueta-base truncar", "aria-hidden": "true", texto: etiqueta.base }),
    nivel ? el("span", { class: "perfil-etiqueta-nivel truncar", "aria-hidden": "true", texto: nivel }) : null,
  );
}

/** Ícono y clase de una marca según el resultado del intento. */
export function formaDeResultado(resultado, logro) {
  if (resultado === "logrado") return logro === "indirecto" ? { icono: "indirecto", clase: "indirecto" } : { icono: "logrado", clase: "directo" };
  if (resultado === "fallido") return { icono: "fallido", clase: "fallido" };
  if (resultado === "error") return { icono: "error-herramienta", clase: "error" };
  return { icono: "abandonado", clase: "abandonado" };
}

/** Enlace (hash) al Replay para un destino { intento, paso, modo? }. */
export const enlaceAReplay = (ctx, destino) =>
  ctx.enlace("replay", { intento: destino.intento, paso: destino.paso, modo: destino.modo ?? null });

const conTexto = (nodo, texto, ctx) => conGlobo(nodo, texto, { senal: ctx.senal });

// ── 1. Resultado: gráfico de unidades ──────────────────────────────────

function leyendaDeResultados(ctx) {
  const { t } = ctx;
  const piezas = [
    ["logrado", "directo", "unidades.directo"],
    ["logrado", "indirecto", "unidades.indirecto"],
    ["fallido", null, "unidades.fallido"],
    ["abandonado", null, "unidades.abandonado"],
    ["error", null, "unidades.error"],
  ];
  return el(
    "ul",
    { class: "perfiles-leyenda", "aria-label": t("perfiles.unidades.leyenda") },
    piezas.map(([resultado, logro, clave]) => {
      const forma = formaDeResultado(resultado, logro);
      return el("li", {}, el("span", { class: `unidad unidad-${forma.clase} unidad-muestra` }, icono(forma.icono)), el("span", { texto: t(`perfiles.${clave}`) }));
    }),
  );
}

/** Un punto por intento por perfil, con el conteo "n/de" y los errores aparte ("0/0 · 1 con error"). */
export function graficoDeUnidades(tanda, ctx) {
  const { t, fmt } = ctx;
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [intento.id, intento]));
  const etiquetas = etiquetasDe(tanda);
  const filas = (tanda.perfiles ?? []).map((perfil) => {
    const nombre = perfil.nombre ?? perfil.perfil;
    const propios = (perfil.intentos ?? []).map((id) => intentos.get(id)).filter(Boolean);
    const marcas = propios.map((intento) => {
      const forma = formaDeResultado(intento.resultado, intento.logro);
      const etiqueta = t("perfiles.unidades.marca", { nombre, resultado: textoDeResultado(intento.resultado, intento.logro) });
      const marca = el(
        "a",
        {
          class: `unidad unidad-${forma.clase}`,
          href: enlaceAReplay(ctx, destinoDeIntento(intento)),
          "aria-label": etiqueta,
          "data-foco": `perfiles:unidad:${intento.id}`,
        },
        icono(forma.icono),
      );
      return el("li", {}, conTexto(marca, etiqueta, ctx));
    });
    const errores = perfil.errores ?? propios.filter((intento) => intento.resultado === "error").length;
    return el(
      "li",
      { class: "unidades-fila" },
      etiquetaDePerfil(etiquetas.get(nombre), ctx, "unidades-nombre"),
      el("ul", { class: "unidades-marcas", "aria-label": t("perfiles.unidades.lista", { nombre }) }, marcas),
      el(
        "span",
        { class: "unidades-conteo" },
        el("span", { class: "num texto-1", texto: fmt.conteo({ n: perfil.logrados ?? 0, de: perfil.validos ?? 0 }) }),
        errores ? el("span", { class: "unidades-errores" }, " · ", t("perfiles.unidades.conError", { n: errores })) : null,
      ),
    );
  });
  return el("div", { class: "unidades" }, el("ul", { class: "unidades-filas" }, filas), leyendaDeResultados(ctx));
}

// ── 2. Dónde avanza cada perfil: mapa perfiles × hitos ─────────────────

function cabeceraDeHito(pagina, k, ctx) {
  const nombre = nombreDePagina(pagina, ctx.t);
  const th = el(
    "th",
    { scope: "col", class: `calor-hito${pagina?.tituloTipo === "url" ? " calor-hito-url" : ""}` },
    el("span", { class: "calor-numero", "aria-hidden": "true", texto: String(k + 1) }),
    el("span", { class: "visualmente-oculto", texto: `${ctx.t("perfiles.calor.hito", { n: k + 1 })}: ` }),
    el("span", { class: "calor-pagina", texto: nombre }),
  );
  return conTexto(th, () => el("span", {}, el("span", { class: "texto-1", texto: pagina?.titulo || nombre }), pagina?.url ? el("span", { class: "mono calor-url", texto: ` ${pagina.url}` }) : null), ctx);
}

function celdaDeHito(perfil, k, pagina, tanda, ctx) {
  const { t, fmt } = ctx;
  const nombre = perfil.nombre ?? perfil.perfil;
  const hito = perfil.hitos?.[k];
  const destino = destinoDeCelda(perfil, k, tanda);
  const fraccion = fraccionDeCelda(hito);
  const href = destino ? enlaceAReplay(ctx, destino) : null;

  if (fraccion === null) {
    // Perfil sin intentos válidos: la fila está, la celda dice por qué no cuenta.
    const texto = t("perfiles.calor.sinValidos");
    const etiqueta = destino ? `${nombre}: ${texto}. ${t("perfiles.calor.abrir", { paso: destino.paso })}` : `${nombre}: ${texto}`;
    const contenido = [el("span", { "aria-hidden": "true", texto: "—" })];
    const nodo = href
      ? el("a", { class: "calor-celda calor-sin-validos", href, "aria-label": etiqueta, "data-foco": `perfiles:celda:${perfil.perfil}:${k}` }, contenido)
      : el("span", { class: "calor-celda calor-sin-validos", role: "img", "aria-label": etiqueta }, contenido);
    return el("td", {}, conTexto(nodo, texto, ctx));
  }

  const salen = hito.salen?.length ?? 0;
  const partes = [t("perfiles.calor.celda", { nombre, pagina: nombreDePagina(pagina, t), n: hito.alcanzados, de: hito.de })];
  if (salen) partes.push(t("perfiles.calor.salen", { n: salen }));
  if (hito.senalDominante) partes.push(t("perfiles.calor.senal", { senal: t(`comun.senal.${hito.senalDominante}`) }));
  const descripcion = partes.join(" · ");
  const etiqueta = destino ? `${descripcion}. ${t("perfiles.calor.abrir", { paso: destino.paso })}` : descripcion;

  const contenido = [
    el("span", { class: "calor-conteo num", texto: fmt.conteo({ n: hito.alcanzados, de: hito.de }) }),
    salen ? el("span", { class: "calor-sale", "aria-hidden": "true", texto: "↗" }) : null,
    hito.senalDominante ? marcaDeSenal(hito.senalDominante) : null,
  ];
  const atributos = {
    class: `calor-celda${hito.alcanzados === 0 ? " calor-cero" : ""}`,
    estilo: { "--v": fraccion.toFixed(3) },
    "aria-label": etiqueta,
  };
  const nodo = href
    ? el("a", { ...atributos, href, "data-foco": `perfiles:celda:${perfil.perfil}:${k}` }, contenido)
    : el("span", { ...atributos, role: "img" }, contenido);
  // Dentro del enlace, la marca de la señal es decorativa (el texto ya está en aria-label).
  nodo.querySelector(".insignia")?.setAttribute("aria-hidden", "true");
  return el("td", {}, conTexto(nodo, descripcion, ctx));
}

/** Tabla perfiles × hitos de la ruta. null si la tanda no tiene ruta recomendada. */
export function mapaDeHitos(tanda, ctx) {
  const etiquetas = etiquetasDe(tanda);
  const { t } = ctx;
  const ruta = tanda.telarana?.ruta;
  if (!ruta?.paginas?.length) return null;
  const paginas = new Map((tanda.telarana.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const hitos = ruta.paginas.map((id) => paginas.get(id) ?? { id, tituloCorto: id });
  const tabla = el(
    "table",
    { class: "calor" },
    el("caption", { class: "visualmente-oculto", texto: t("perfiles.bloque.hitos.titulo") }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", class: "calor-perfil", texto: t("perfiles.calor.perfil") }), hitos.map((pagina, k) => cabeceraDeHito(pagina, k, ctx)))),
    el(
      "tbody",
      {},
      (tanda.perfiles ?? []).map((perfil) =>
        el(
          "tr",
          {},
          el("th", { scope: "row", class: "calor-perfil" }, etiquetaDePerfil(etiquetas.get(perfil.nombre ?? perfil.perfil), ctx)),
          hitos.map((pagina, k) => celdaDeHito(perfil, k, pagina, tanda, ctx)),
        ),
      ),
    ),
  );
  tabla.style.setProperty("--columnas", String(hitos.length));
  const leyenda = el(
    "ul",
    { class: "perfiles-leyenda" },
    el("li", {}, el("span", { class: "calor-rampa", "aria-hidden": "true" }), el("span", { texto: t("perfiles.calor.leyendaTono") })),
    el("li", {}, el("span", { class: "calor-sale", "aria-hidden": "true", texto: "↗" }), el("span", { texto: t("perfiles.calor.leyendaSale") })),
    el("li", {}, el("span", { class: "insignia insignia-aviso insignia-compacta", "aria-hidden": "true" }, icono("sin-efecto")), el("span", { texto: t("perfiles.calor.leyendaSenal") })),
  );
  return el("div", { class: "calor-bloque" }, el("div", { class: "calor-caja" }, tabla), leyenda);
}

// ── 3. Métricas: gráfico de puntos, una columna por métrica ────────────

const ALTO_DE_FILA = 32;

const METRICAS = ["pasos", "tiempo", "tropiezos", "hitos"];

function textoDeValor(metrica, valor, total, ctx) {
  const { t, fmt } = ctx;
  if (metrica === "tiempo") return fmt.duracion(valor);
  if (metrica === "hitos") return t("perfiles.metricas.valor.hitos", { n: valor, total });
  return t(`perfiles.metricas.valor.${metrica}`, { n: valor });
}

function textoDeEje(metrica, valor, ctx) {
  if (metrica === "tiempo") return ctx.fmt.duracion(valor);
  return ctx.fmt.numero(valor, { maximumFractionDigits: 0 });
}

function puntoDe(metrica, fila, punto, x, y, referencia, ctx) {
  const { t } = ctx;
  const forma = formaDeResultado(punto.resultado, punto.logro);
  const partes = [t("perfiles.metricas.punto", { nombre: fila.nombre, valor: textoDeValor(metrica, punto.valor, referencia, ctx) })];
  if (referencia !== null && metrica !== "hitos") {
    partes.push(t("perfiles.metricas.contraRuta", { valor: textoDeEje(metrica, referencia, ctx) }));
    if (metrica === "pasos") partes.push(t("perfiles.metricas.diferencia", { n: punto.valor - referencia }));
  }
  partes.push(textoDeResultado(punto.resultado, punto.logro));
  const descripcion = partes.join(" · ");
  const marca = icono(forma.icono);
  const enlace = svg(
    "a",
    {
      class: `punto unidad-${forma.clase}`,
      href: enlaceAReplay(ctx, punto.destino),
      "aria-label": `${descripcion}. ${t("perfiles.metricas.abrir")}`,
      "data-foco": `perfiles:punto:${metrica}:${punto.intento}`,
    },
    svg(
      "svg",
      { x: `${(x * 100).toFixed(2)}%`, y, width: 1, height: 1, overflow: "visible", class: "punto-ancla" },
      svg("g", { transform: "translate(-8 -8)" }, svg("circle", { cx: 8, cy: 8, r: 12, class: "punto-area" }), marca),
    ),
  );
  return conTexto(enlace, descripcion, ctx);
}

/** Una columna (figura) del gráfico de puntos. null si la métrica no tiene escala (ningún valor ni ruta). */
function columnaDeMetrica(tanda, metrica, ctx) {
  const { t } = ctx;
  const etiquetas = etiquetasDe(tanda);
  const { dominio, referencia, filas } = puntosDeMetrica(tanda, metrica);
  if (!dominio) return null;
  const escala = escalaLineal(dominio);
  const titulo = t(`perfiles.metricas.${metrica}`);
  const alto = filas.length * ALTO_DE_FILA;

  const lineas = filas.map((_, i) =>
    svg("line", { x1: "0%", x2: "100%", y1: (i + 0.5) * ALTO_DE_FILA, y2: (i + 0.5) * ALTO_DE_FILA, class: "metrica-guia" }),
  );
  const xRuta = referencia !== null ? escala(referencia) : null;
  const lineaRuta = xRuta !== null ? svg("line", { x1: `${(xRuta * 100).toFixed(2)}%`, x2: `${(xRuta * 100).toFixed(2)}%`, y1: 0, y2: alto, class: "metrica-ruta-linea" }) : null;
  const puntos = filas.flatMap((fila, i) => {
    const centro = (i + 0.5) * ALTO_DE_FILA;
    const cuantos = fila.puntos.length;
    return fila.puntos.map((punto, j) => puntoDe(metrica, fila, punto, escala(punto.valor), centro + (j - (cuantos - 1) / 2) * 6, referencia, ctx));
  });
  const sinValidos = filas.flatMap((fila, i) =>
    fila.puntos.length ? [] : [svg("text", { x: 0, y: (i + 0.5) * ALTO_DE_FILA + 4, class: "metrica-sin-validos", texto: t("perfiles.metricas.sinValidos") })],
  );
  const grafico = svg(
    "svg",
    {
      class: "metrica-grafico",
      width: "100%",
      height: alto,
      role: "group",
      "aria-label": t("perfiles.metricas.grafico", { metrica: titulo }),
    },
    lineas,
    lineaRuta,
    sinValidos,
    puntos,
  );

  const eje = el(
    "div",
    { class: "metrica-eje" },
    el("span", { class: "visualmente-oculto", texto: t("perfiles.metricas.escala", { minimo: textoDeEje(metrica, dominio[0], ctx), maximo: textoDeEje(metrica, dominio[1], ctx) }) }),
    el("span", { "aria-hidden": "true", texto: textoDeEje(metrica, dominio[0], ctx) }),
    el("span", { "aria-hidden": "true", texto: textoDeEje(metrica, dominio[1], ctx) }),
  );
  const marcaRuta =
    xRuta !== null
      ? el("span", { class: "metrica-ruta", estilo: { "--x": `${(xRuta * 100).toFixed(2)}%` }, texto: t("perfiles.metricas.ruta", { valor: textoDeEje(metrica, referencia, ctx) }) })
      : el("span", { class: "metrica-ruta metrica-ruta-vacia", "aria-hidden": "true", texto: " " });

  return el(
    "figure",
    { class: `metrica metrica-${metrica}` },
    el(
      "figcaption",
      { class: "metrica-cabecera" },
      el("span", { class: "metrica-titulo", texto: titulo }),
      el("span", { class: "metrica-definicion", texto: t(`perfiles.metricas.definicion.${metrica}`) }),
    ),
    el(
      "div",
      { class: "metrica-cuerpo" },
      el("ul", { class: "metrica-nombres", "aria-hidden": "true" }, filas.map((fila) => el("li", {}, etiquetaDePerfil(etiquetas.get(fila.nombre) ?? { completo: fila.nombre, base: fila.nombre, nivel: null }, ctx)))),
      el("div", { class: "metrica-lienzo" }, el("div", { class: "metrica-regla" }, marcaRuta), grafico, eje),
    ),
  );
}

/** Las columnas del gráfico de puntos (sin la de hitos si no hay ruta). */
export function graficoDePuntos(tanda, ctx) {
  const hayRuta = !!tanda.telarana?.ruta?.paginas?.length;
  const columnas = METRICAS.filter((metrica) => metrica !== "hitos" || hayRuta)
    .map((metrica) => columnaDeMetrica(tanda, metrica, ctx))
    .filter(Boolean);
  if (!columnas.length) return null;
  const raiz = el("div", { class: "metricas" }, columnas);
  raiz.style.setProperty("--filas", String((tanda.perfiles ?? []).length));
  return raiz;
}
