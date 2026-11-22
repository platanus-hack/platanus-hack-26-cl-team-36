// Propuesta: el tema que propone el Diseñador para el sitio, por qué y cómo se ve. A la izquierda el riel de páginas,
// primero donde más visitantes se quedaron; al centro la página elegida antes y después del tema, con un divisor
// que se arrastra y las notas marcadas con su número sobre la página; a la derecha por qué este cambio (la evidencia
// de los visitantes y cada cambio con una muestra), la paleta con tema.css y, plegadas, las decisiones del Diseñador.
//
// Mientras el Diseñador diseña, el «después» es un esqueleto con un barrido y las notas de los cambios esperan; la
// pantalla vuelve a pedir la propuesta cada pocos segundos hasta que termina.
//
// Estado en la URL: ?vista= &dispositivo=. La posición del divisor no se guarda.

import { nombreDePagina } from "../datos/textos.js";
import { EVENTO_PROPUESTA, pedirPropuesta, urlDePropuesta, urlDeResultado } from "../nucleo/datos.js";
import { conservarFoco, el, reemplazar } from "../nucleo/dom.js";
import { errorDePantalla, esqueleto, vacio } from "../nucleo/estados.js";
import { icono } from "../nucleo/iconos.js";
import { DISPOSITIVOS, evidenciaDeLaTanda, notasDeLaPropuesta, ordenarPorParadas, vistasDeLaPropuesta } from "../propuesta/vistas.js";
import { crearRiel } from "../tanda/riel.js";

const MS_ENTRE_PEDIDOS = 5000;
const PROPORCION = { desktop: 1024 / 768, mobile: 390 / 844 };

let ctx = null;
let estado = null;
let partes = null;

// ── Datos ─────────────────────────────────────────────────────────────────

function nombreDeVista(vista) {
  if (!vista) return "";
  const pagina = vista.pagina ? (ctx.tanda?.telarana?.paginas ?? []).find((cada) => cada.id === vista.pagina) : null;
  return nombreDePagina(pagina ?? vista.datos, ctx.t);
}

function urlDeCaptura(captura) {
  if (!captura) return "";
  return captura.tipo === "propuesta" ? urlDePropuesta(captura.clave) : ctx.urlDeArchivo(captura.intento, captura.archivo);
}

/** El modelo como lo nombra la pantalla: «us.anthropic.claude-sonnet-4-6» → «Sonnet 4.6». */
const nombreDelModelo = (id) => ctx.fmt.modelo(String(id ?? "").replace(/^(?:[a-z]{2,4}\.)?anthropic\./, ""));

const segundosEntre = (desde, hasta = Date.now()) => {
  const inicio = Date.parse(desde ?? "");
  const fin = typeof hasta === "number" ? hasta : Date.parse(hasta ?? "");
  return Number.isFinite(inicio) && Number.isFinite(fin) ? Math.max(0, (fin - inicio) / 1000) : null;
};

/** «0:42», «12:05»: el tiempo que lleva diseñando. */
function reloj(segundos) {
  const total = Math.floor(segundos ?? 0);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = String(total % 60).padStart(2, "0");
  return horas ? `${horas}:${String(minutos).padStart(2, "0")}:${resto}` : `${minutos}:${resto}`;
}

/** Lo que se muestra, a partir de la tanda y la propuesta; elige vista y dispositivo válidos. */
function derivar() {
  const { propuesta } = estado;
  const vistas = vistasDeLaPropuesta(ctx.tanda, propuesta);
  const evidencia = evidenciaDeLaTanda(ctx.tanda, vistas);
  const notas = notasDeLaPropuesta(propuesta, evidencia);
  return { vistas, evidencia, notas };
}

function elegidas(derivado) {
  const { vistas, evidencia } = derivado;
  const vista = vistas.find((cada) => cada.id === estado.vista) ?? vistas.find((cada) => cada.id === evidencia?.vista) ?? vistas[0] ?? null;
  const hay = (dispositivo) => vista && (vista.capturas[dispositivo].antes || vista.capturas[dispositivo].despues);
  const dispositivo = DISPOSITIVOS.includes(estado.dispositivo) && hay(estado.dispositivo) ? estado.dispositivo : (DISPOSITIVOS.find(hay) ?? "desktop");
  return { vista, dispositivo };
}

// ── Páginas (riel de la izquierda) ────────────────────────────────────────

/** El riel se arma una vez por juego de páginas; al elegir solo cambia la marcada. */
function pintarRiel(derivado, vista) {
  const { t } = ctx;
  const ordenadas = ordenarPorParadas(derivado.vistas);
  const firma = ordenadas.map((cada) => `${cada.id}:${cada.paradas}`).join("|");
  if (firma !== partes.firmaDelRiel) {
    partes.firmaDelRiel = firma;
    const de = (ctx.tanda?.intentos ?? []).filter((intento) => intento.resultado !== "error").length;
    partes.riel = crearRiel({
      titulo: t("propuesta.vistas.titulo"),
      orden: t("propuesta.vistas.orden"),
      etiqueta: t("propuesta.vistas.etiqueta"),
      senal: ctx.senal,
      alElegir: (id) => elegir({ vista: id }),
      filas: ordenadas.map((cada) => ({
        id: cada.id,
        nombre: nombreDeVista(cada),
        cifra: t("propuesta.vistas.paradas", { n: cada.paradas, de }),
        cifraAviso: cada.paradas > 0,
        detalle: cada.paradas ? t("propuesta.vistas.detalle", { n: cada.paradas }) : cada.fueraDeRuta ? t("propuesta.vistas.fueraDeRuta") : null,
        titulo: cada.paradas ? t("propuesta.vistas.paradasAyuda", { n: cada.paradas, de }) : cada.url,
      })),
    });
    conservarFoco(partes.rielSlot, () => reemplazar(partes.rielSlot, partes.riel.nodo));
  }
  partes.ordenadas = ordenadas;
  partes.riel.marcar(vista?.id ?? null);
}

/** ↑ ↓: la página siguiente o anterior del riel, con el foco en su fila. */
function moverEnElRiel(delta) {
  const ordenadas = partes?.ordenadas ?? [];
  if (!ordenadas.length) return;
  const actual = ordenadas.findIndex((cada) => cada.id === partes.vistaElegida);
  const destino = ordenadas[actual === -1 ? 0 : Math.min(ordenadas.length - 1, Math.max(0, actual + delta))];
  if (destino.id === partes.vistaElegida) return;
  elegir({ vista: destino.id });
  partes.riel.marcar(destino.id, { enfocar: true });
}

// ── Escenario (centro) ────────────────────────────────────────────────────

function selectorDeDispositivo(vista, dispositivo) {
  const { t } = ctx;
  return el(
    "div",
    { class: "propuesta-dispositivos", role: "group", "aria-label": t("propuesta.dispositivo.etiqueta") },
    DISPOSITIVOS.map((cada) => {
      const hay = vista && (vista.capturas[cada].antes || vista.capturas[cada].despues);
      return el(
        "button",
        {
          type: "button",
          class: "propuesta-dispositivo",
          "aria-pressed": String(cada === dispositivo),
          "aria-label": t(`propuesta.dispositivo.${cada}`),
          title: t(`propuesta.dispositivo.${cada}`),
          disabled: !hay,
          "data-foco": `propuesta:dispositivo:${cada}`,
          onclick: () => elegir({ dispositivo: cada }),
        },
        icono(cada === "mobile" ? "movil" : "escritorio"),
      );
    }),
  );
}

function marcasSobreLaVista(vista, dispositivo, notas) {
  const numeroDe = new Map(notas.map((nota) => [nota.marca, nota.n]));
  const marcas = (vista?.marcas ?? []).filter((marca) => marca.dispositivo === dispositivo && numeroDe.has(marca.tipo));
  // Sin el Diseñador todavía no se sabe qué va a cambiar: solo la marca de la evidencia.
  const visibles = estado.propuesta.estado === "succeeded" ? marcas : marcas.filter((marca) => marca.tipo === "siguiente");
  if (!visibles.length) return null;
  return el(
    "div",
    { class: "propuesta-marcas" },
    visibles.map(({ tipo, caja: [x0, y0, x1, y1] }) => {
      const n = numeroDe.get(tipo);
      return el(
        "span",
        {
          class: `propuesta-marca${n === 1 && notas[0]?.tipo === "evidencia" ? " propuesta-marca-evidencia" : ""}`,
          estilo: { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` },
        },
        el("span", { class: "propuesta-marca-numero", role: "img", "aria-label": ctx.t("propuesta.escenario.marca", { n }), texto: String(n) }),
      );
    }),
  );
}

function escenario(vista, dispositivo, notas) {
  const { t } = ctx;
  const { propuesta } = estado;
  const nombre = nombreDeVista(vista);
  const textoDispositivo = t(`propuesta.dispositivo.${dispositivo}`);
  const capturas = vista?.capturas[dispositivo] ?? { antes: null, despues: null };
  const enCurso = propuesta.estado === "running";
  const conDespues = Boolean(capturas.despues) || enCurso;

  const etiquetaDespues = enCurso
    ? el("span", { class: "propuesta-disenando" }, el("span", { class: "propuesta-vivo", "aria-hidden": "true" }), el("span", { class: "propuesta-reloj-escenario" }))
    : el("span", { texto: t(capturas.despues ? "propuesta.escenario.despues" : "propuesta.escenario.sinDespues") });

  const lienzo = el("div", {
    class: `propuesta-lienzo propuesta-lienzo-${dispositivo}${conDespues ? "" : " propuesta-sin-despues"}`,
    estilo: { "--proporcion": String(PROPORCION[dispositivo]), "--corte": `${estado.corte}%` },
  });
  const antes = capturas.antes
    ? el("img", { class: "propuesta-imagen", src: urlDeCaptura(capturas.antes), alt: t("propuesta.escenario.altAntes", { pagina: nombre, dispositivo: textoDispositivo }), decoding: "async" })
    : el("p", { class: "propuesta-sin-captura texto-3", texto: t("propuesta.escenario.sinCaptura", { dispositivo: textoDispositivo }) });
  if (capturas.antes) {
    // La proporción real de la captura (las del Diseñador y las del visitante pueden medir distinto).
    antes.addEventListener("load", () => antes.naturalWidth && lienzo.style.setProperty("--proporcion", String(antes.naturalWidth / antes.naturalHeight)), { once: true });
  }
  const despues = !conDespues
    ? null
    : el(
        "div",
        { class: "propuesta-despues" },
        capturas.despues
          ? el("img", { class: "propuesta-imagen", src: urlDeCaptura(capturas.despues), alt: t("propuesta.escenario.altDespues", { pagina: nombre, dispositivo: textoDispositivo }), decoding: "async" })
          : el("div", { class: "propuesta-esqueleto", "aria-hidden": "true" }, el("span", { class: "propuesta-esqueleto-cabecera" }), el("span"), el("span"), el("span"), el("span", { class: "propuesta-escaneo" })),
      );
  const corte = conDespues
    ? el("input", {
        type: "range",
        class: "propuesta-corte",
        min: "2",
        max: "98",
        value: String(estado.corte),
        "aria-label": t("propuesta.escenario.corte"),
        "data-foco": "propuesta:corte",
      })
    : null;
  corte?.addEventListener(
    "input",
    () => {
      estado.corte = Number(corte.value);
      lienzo.style.setProperty("--corte", `${estado.corte}%`);
    },
    { signal: ctx.senal },
  );
  reemplazar(
    lienzo,
    antes,
    despues,
    marcasSobreLaVista(vista, dispositivo, notas),
    conDespues ? el("span", { class: "propuesta-divisor", "aria-hidden": "true" }, el("span", { class: "propuesta-asa" }, icono("anterior"), icono("siguiente"))) : null,
    corte,
  );

  return el(
    "section",
    { class: "propuesta-escenario", "aria-label": t("propuesta.escenario.etiqueta") },
    selectorDeDispositivo(vista, dispositivo),
    el(
      "div",
      { class: "propuesta-marco-lienzo" },
      el(
        "div",
        { class: "propuesta-escenario-cabecera" },
        el("span", { class: "etiqueta-micro", texto: t("propuesta.escenario.antes") }),
        el("span", { class: "etiqueta-micro propuesta-etiqueta-despues" }, etiquetaDespues),
      ),
      lienzo,
    ),
  );
}

// ── Relato (columna derecha) ──────────────────────────────────────────────

function tarjetaDelDisenador() {
  const { t } = ctx;
  const { propuesta } = estado;
  const enCurso = propuesta.estado === "running";
  const duracion = segundosEntre(propuesta.inicio, propuesta.fin ?? Date.now());
  const detalle = [propuesta.modelo ? nombreDelModelo(propuesta.modelo) : null, !enCurso && duracion !== null ? ctx.fmt.duracion(duracion) : null].filter(Boolean).join(" · ");
  let cuerpo;
  if (enCurso) cuerpo = [el("span", { class: "propuesta-brillo" }), el("span", { class: "propuesta-brillo propuesta-brillo-corto" })];
  else if (propuesta.estado === "failed") cuerpo = el("p", { class: "propuesta-frase propuesta-fallo" }, el("strong", { texto: t("propuesta.disenador.fallo") }), propuesta.error ? el("span", { class: "mono texto-3", texto: ` ${propuesta.error}` }) : null);
  else cuerpo = el("p", { class: "propuesta-frase", texto: propuesta.resumen || propuesta.decisiones[0] || t("propuesta.disenador.sinResumen") });
  // La propuesta es de la revisión entera: si el Diseñador la pensó para otra tarea, se dice cuál.
  const otraTarea = propuesta.tarea && propuesta.tarea.id !== ctx.tanda?.tarea ? propuesta.tarea : null;
  return el(
    "div",
    { class: `propuesta-disenador${enCurso ? " propuesta-disenador-en-curso" : ""}` },
    el(
      "div",
      { class: "propuesta-disenador-cabecera" },
      el("span", { class: "propuesta-disenador-icono" }, icono("disenador")),
      el("span", { class: "propuesta-disenador-nombre", texto: t("propuesta.disenador.titulo") }),
      enCurso
        ? el("span", { class: "propuesta-disenando" }, el("span", { class: "propuesta-vivo", "aria-hidden": "true" }), el("span", { class: "propuesta-reloj-disenador" }))
        : detalle
          ? el("span", { class: "propuesta-disenador-detalle", texto: detalle })
          : null,
    ),
    cuerpo,
    otraTarea
      ? el("p", { class: "propuesta-otra-tarea texto-3", title: otraTarea.descripcion || otraTarea.id }, icono("meta"), el("span", { texto: t("propuesta.disenador.paraTarea", { tarea: otraTarea.descripcion || otraTarea.id }) }))
      : null,
  );
}

function muestraDeEnlace(paleta) {
  const acento = paleta.find((color) => color.rol === "acento")?.color ?? null;
  return el(
    "div",
    { class: "propuesta-muestra propuesta-muestra-enlace", "aria-hidden": "true" },
    el("span", { class: "propuesta-enlace-antes" }),
    icono("siguiente"),
    el("span", { class: "propuesta-enlace-despues", estilo: acento ? { "--acento-tema": acento } : null }),
  );
}

function chip(texto) {
  return el("span", { class: "propuesta-chip", texto });
}

function textoDeCambio(cambio) {
  const { t } = ctx;
  if (cambio.tipo === "texto") return t("propuesta.notas.texto", { n: cambio.porcentaje });
  if (cambio.tipo === "interlineado") return t("propuesta.notas.interlineado", { valor: ctx.fmt.numero(cambio.valor) });
  if (cambio.tipo === "objetivos") return t("propuesta.notas.objetivos", { n: cambio.px });
  return t("propuesta.notas.enlaces");
}

function nota(notaDatos, evidencia, entregada) {
  const { t } = ctx;
  const { propuesta } = estado;
  const numero = el("span", { class: `propuesta-nota-numero${notaDatos.tipo === "evidencia" ? " propuesta-nota-numero-evidencia" : ""}`, "aria-hidden": "true", texto: String(notaDatos.n) });
  if (notaDatos.tipo === "evidencia") {
    const siguiente = evidencia.siguiente;
    const textoSiguiente = siguiente ? (siguiente.texto ?? nombreDePagina(siguiente.pagina, t)) : null;
    return el(
      "li",
      { class: "propuesta-nota" },
      el(
        "div",
        { class: "propuesta-nota-cabecera" },
        numero,
        el("span", { class: "insignia insignia-fallido" }, icono("fallido"), el("span", { texto: t("propuesta.notas.paradas", { n: evidencia.paradas, de: evidencia.de }) })),
        textoSiguiente ? el("span", { class: "propuesta-nota-detalle", texto: t("propuesta.notas.clics", { texto: textoSiguiente, n: siguiente.clics }) }) : null,
      ),
      entregada && notaDatos.cambios.length ? [muestraDeEnlace(propuesta.paleta), el("div", { class: "propuesta-chips" }, notaDatos.cambios.map((cambio) => chip(textoDeCambio(cambio))))] : null,
    );
  }
  const muestra =
    notaDatos.tipo === "texto"
      ? el(
          "div",
          { class: "propuesta-muestra propuesta-muestra-texto", "aria-hidden": "true" },
          el("span", { class: "propuesta-aa" }, t("propuesta.notas.muestraTexto"), el("span", { class: "propuesta-lineas" }, el("span"), el("span"))),
          icono("siguiente"),
          el("span", { class: "propuesta-aa propuesta-aa-despues" }, t("propuesta.notas.muestraTexto"), el("span", { class: "propuesta-lineas" }, el("span"), el("span"))),
        )
      : notaDatos.tipo === "objetivos"
        ? el(
            "div",
            { class: "propuesta-muestra propuesta-muestra-objetivos", "aria-hidden": "true" },
            el("span", { class: "propuesta-barra" }),
            icono("siguiente"),
            el("span", { class: "propuesta-barra propuesta-barra-despues" }, el("span", { class: "mono", texto: String(notaDatos.cambios[0]?.px ?? "") })),
          )
        : muestraDeEnlace(propuesta.paleta);
  return el(
    "li",
    { class: "propuesta-nota" },
    el("div", { class: "propuesta-nota-cabecera" }, numero, el("div", { class: "propuesta-chips" }, notaDatos.cambios.map((cambio) => chip(textoDeCambio(cambio))))),
    muestra,
  );
}

function notaPendiente(n) {
  return el(
    "li",
    { class: "propuesta-nota propuesta-nota-pendiente", title: ctx.t("propuesta.notas.pendiente") },
    el("div", { class: "propuesta-nota-cabecera" }, el("span", { class: "propuesta-nota-numero", "aria-hidden": "true", texto: String(n) }), el("span", { class: "propuesta-brillo propuesta-brillo-chip" })),
    el("span", { class: "visualmente-oculto", texto: ctx.t("propuesta.notas.pendiente") }),
  );
}

function relato(derivado) {
  const { t } = ctx;
  const { propuesta } = estado;
  const entregada = propuesta.estado === "succeeded";
  const enCurso = propuesta.estado === "running";
  const notas = derivado.notas.map((cada) => nota(cada, derivado.evidencia, entregada));
  // Mientras diseña, los cambios todavía no existen: dos notas esperando después de la evidencia.
  if (enCurso) for (let i = 0; i < 2; i += 1) notas.push(notaPendiente(notas.length + 1));
  const colores = propuesta.paleta.map(({ rol, color }) => t(`propuesta.paleta.${rol}`, { color }));
  const decisiones = entregada ? [propuesta.resumen, ...propuesta.decisiones].filter(Boolean) : [];
  const otraTarea = propuesta.tarea && propuesta.tarea.id !== ctx.tanda?.tarea ? propuesta.tarea : null;
  const seccion = (titulo, ...hijos) => el("section", { class: "propuesta-seccion" }, el("h3", { class: "tanda-etiqueta", texto: titulo }), ...hijos);
  return el(
    "aside",
    { class: "tanda-lado propuesta-relato", "aria-label": t("propuesta.notas.etiqueta") },
    // El Diseñador se nombra solo mientras diseña o si falló; entregada, habla su propuesta.
    entregada ? null : tarjetaDelDisenador(),
    notas.length ? seccion(t("propuesta.notas.etiqueta"), el("ol", { class: "propuesta-notas" }, notas)) : null,
    entregada && (propuesta.paleta.length || propuesta.tema)
      ? seccion(
          t("propuesta.tema"),
          propuesta.paleta.length
            ? el(
                "span",
                { class: "propuesta-paleta", role: "img", "aria-label": t("propuesta.paleta.etiqueta", { colores: colores.join(", ") }) },
                propuesta.paleta.map(({ color }, i) => el("span", { class: "propuesta-color", title: colores[i], estilo: { "--color": color } })),
              )
            : null,
          propuesta.tema
            ? el("a", { class: "propuesta-tema", href: urlDeResultado(propuesta.tema), target: "_blank", rel: "noreferrer noopener" }, el("span", { texto: t("propuesta.verTema") }))
            : null,
        )
      : null,
    decisiones.length
      ? el(
          "details",
          { class: "propuesta-decisiones" },
          el("summary", { texto: t("propuesta.decisiones", { n: propuesta.decisiones.length }) }),
          propuesta.resumen ? el("p", { class: "propuesta-frase", texto: propuesta.resumen }) : null,
          propuesta.decisiones.length ? el("ul", {}, propuesta.decisiones.map((decision) => el("li", { texto: decision }))) : null,
          otraTarea ? el("p", { class: "texto-3", texto: t("propuesta.disenador.paraTarea", { tarea: otraTarea.descripcion || otraTarea.id }) }) : null,
        )
      : null,
  );
}

// ── Pintar ────────────────────────────────────────────────────────────────

function pintar() {
  if (!partes) return;
  const { propuesta } = estado;
  if (!propuesta || propuesta.estado === "ninguna") {
    partes.columnas = null;
    reemplazar(partes.raiz, vacio({ titulo: ctx.t("propuesta.vacio.titulo"), texto: ctx.t("propuesta.vacio.texto"), icono: "disenador" }));
    return;
  }
  const derivado = derivar();
  const { vista, dispositivo } = elegidas(derivado);
  if (!partes.columnas) {
    partes.rielSlot = el("div", { class: "propuesta-riel" });
    partes.centro = el("div", { class: "tanda-centro propuesta-centro" });
    partes.lado = el("div", { class: "propuesta-lado" });
    partes.columnas = el("div", { class: "tanda-columnas propuesta" }, partes.rielSlot, partes.centro, partes.lado);
    reemplazar(partes.raiz, partes.columnas);
  }
  partes.columnas.className = `tanda-columnas propuesta propuesta-${propuesta.estado}`;
  partes.vistaElegida = vista?.id ?? null;
  pintarRiel(derivado, vista);
  conservarFoco(partes.centro, () => reemplazar(partes.centro, escenario(vista, dispositivo, derivado.notas)));
  conservarFoco(partes.lado, () => reemplazar(partes.lado, relato(derivado)));
  tic();
}

/** El reloj de «Diseñando · 0:42», cada segundo mientras diseña. */
function tic() {
  if (!partes || estado.propuesta?.estado !== "running") return;
  const texto = ctx.t("propuesta.disenador.disenando", { tiempo: reloj(segundosEntre(estado.propuesta.inicio)) });
  for (const nodo of partes.raiz.querySelectorAll(".propuesta-reloj-escenario, .propuesta-reloj-disenador")) nodo.textContent = texto;
}

function avisarEstado() {
  document.dispatchEvent(new CustomEvent(EVENTO_PROPUESTA, { detail: { tandaId: ctx.tanda?.id, estado: estado.propuesta?.estado ?? null } }));
}

/** Pide la propuesta otra vez mientras el Diseñador diseña; cuando cambia de estado, repinta. */
function programarPedido() {
  clearTimeout(estado.pedido);
  if (estado.propuesta?.estado !== "running") return;
  const contexto = ctx;
  estado.pedido = setTimeout(async () => {
    try {
      const nueva = await pedirPropuesta(contexto.tanda.id);
      if (contexto.senal.aborted || ctx !== contexto || !nueva) return;
      const cambio = nueva.estado !== estado.propuesta.estado;
      estado.propuesta = nueva;
      if (cambio) {
        pintar();
        avisarEstado();
      }
    } catch {
      // Un pedido que falla no corta la espera: se reintenta en el siguiente turno.
    }
    if (!contexto.senal.aborted && ctx === contexto) programarPedido();
  }, MS_ENTRE_PEDIDOS);
}

// ── Elegir (URL) ──────────────────────────────────────────────────────────

function elegir(cambios) {
  if (cambios.vista !== undefined) estado.vista = cambios.vista;
  if (cambios.dispositivo !== undefined) estado.dispositivo = cambios.dispositivo;
  pintar();
  ctx.actualizarParametros({ vista: estado.vista, dispositivo: estado.dispositivo === "desktop" ? null : estado.dispositivo });
}

function aplicar(parametros) {
  const vista = parametros.vista ?? null;
  const dispositivo = parametros.dispositivo ?? "desktop";
  if (vista === estado.vista && dispositivo === estado.dispositivo) return;
  estado.vista = vista;
  estado.dispositivo = dispositivo;
  pintar();
}

/**
 * La propuesta de la tanda y la hoja de estilos. El enrutador lo llama antes de la transición, con el esqueleto de la
 * pestaña mientras tanto. Un error no tumba la tanda: vuelve como { error } y la pestaña lo muestra en su panel.
 * → { propuesta } | { error }
 */
async function cargar(contexto) {
  try {
    const [propuesta] = await Promise.all([pedirPropuesta(contexto.tanda.id), contexto.cargarEstilos("estilos/propuesta.css")]);
    return { propuesta };
  } catch (error) {
    return { error };
  }
}

export default {
  titulo(contexto) {
    return contexto.t("comun.pestana.propuesta");
  },

  cargar,

  async montar(contenedor, contexto, cargado) {
    ctx = contexto;
    contenedor.classList.add("p-propuesta");
    const raiz = el("div", { class: "propuesta-raiz" });
    contenedor.append(raiz);
    estado = { propuesta: null, vista: contexto.parametros.vista ?? null, dispositivo: contexto.parametros.dispositivo ?? "desktop", corte: 50, pedido: 0, reloj: 0 };
    if (!cargado) {
      // Remontada sin pasar por el enrutador: pide ella, con el mismo esqueleto.
      reemplazar(raiz, esqueleto("propuesta"));
      cargado = await cargar(contexto);
    }
    // Si otra navegación reemplazó la vista mientras cargaba, no se arma nada.
    if (contexto.senal.aborted || ctx !== contexto) return;
    if (cargado.error) {
      const { error } = cargado;
      reemplazar(raiz, errorDePantalla({ titulo: contexto.t("propuesta.error"), detalle: error?.message ?? String(error), reintentar: () => location.reload() }));
      return;
    }
    partes = { raiz };
    contexto.atajos.registrar({
      ArrowDown: { descripcion: () => contexto.t("comun.atajos.desc.paginas"), accion: () => moverEnElRiel(1) },
      ArrowUp: { descripcion: () => contexto.t("comun.atajos.desc.paginas"), accion: () => moverEnElRiel(-1) },
    });
    estado.propuesta = cargado.propuesta ?? { estado: "ninguna" };
    pintar();
    avisarEstado();
    programarPedido();
    estado.reloj = setInterval(tic, 1000);
    contexto.senal.addEventListener("abort", () => {
      clearTimeout(estado?.pedido);
      clearInterval(estado?.reloj);
    }, { once: true });
  },

  actualizar(contexto) {
    ctx = contexto;
    if (!partes) return false;
    aplicar(contexto.parametros);
    return true;
  },

  desmontar() {
    if (estado) {
      clearTimeout(estado.pedido);
      clearInterval(estado.reloj);
    }
    partes = null;
    estado = null;
  },
};
