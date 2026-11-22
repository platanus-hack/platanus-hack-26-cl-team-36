// Corridas (diseño §10.2): la lista de tandas, más nuevas primero, agrupadas por día. Cada fila es un enlace a la
// tanda (abre en Telaraña) y dice solo qué tanda es y cómo le fue: tarea y sitio, cuántos llegan (con el medidor),
// los errores de la herramienta si los hay y cuándo corrió. Búsqueda, chips de filtro, sitio, orden y lista/grilla
// viven en el hash.

import { kbd } from "../nucleo/atajos.js";
import { urlDeArchivo } from "../nucleo/datos.js";
import { conservarFoco, el, reemplazar } from "../nucleo/dom.js";
import { vacio } from "../nucleo/estados.js";
import { icono, textoDeResultado } from "../nucleo/iconos.js";
import {
  cifrasDeTanda,
  prepararLista,
  resultadosParaMedidor,
  sitiosDe,
  tieneErrores,
  tieneProblemas,
} from "../corridas/filtros.js";

const ESPERA_DE_BUSQUEDA = 180;
const COMANDOS_PARA_GATILLAR = ['just local visit <url> "<tarea>"', "just local visit-tasks wom"];

let estado = null;

// ── Piezas de una tanda ─────────────────────────────────────────────────────

function iniciales(host) {
  const nombre = String(host ?? "").replace(/^www\./, "").split(".")[0] ?? "";
  return nombre.slice(0, 2).toUpperCase() || "·";
}

/** Miniatura 72×45 (o 16:10 en la grilla); si no hay captura o no carga, las iniciales del sitio. */
function miniatura(resumen, ctx) {
  const respaldo = () => el("span", { class: "corridas-miniatura-respaldo", "aria-hidden": "true", texto: iniciales(resumen.host) });
  const caja = el("span", { class: "corridas-miniatura" });
  if (!resumen.captura?.archivo) return reemplazar(caja, respaldo());
  const imagen = el("img", {
    src: urlDeArchivo(resumen.id, resumen.captura.perfil, resumen.captura.archivo),
    alt: "",
    loading: "lazy",
    decoding: "async",
    width: 72,
    height: 45,
  });
  imagen.addEventListener("error", () => reemplazar(caja, respaldo()), { once: true, signal: ctx.senal });
  return reemplazar(caja, imagen);
}

/** Un tramo por intento: logrado (menta), fallido (bermellón), abandonado (gris), sin medir (contorno), error (rayado). */
function medidor(resumen, ctx) {
  const resultados = resultadosParaMedidor(resumen.perfiles);
  if (!resultados.length) return el("span", { class: "medidor corridas-medidor", "aria-hidden": "true" });
  return el(
    "span",
    { class: "medidor corridas-medidor", "aria-hidden": "true" },
    resultados.map((perfil) =>
      el("span", {
        class: `medidor-tramo medidor-${perfil.resultado}`,
        title: ctx.t("corridas.fila.intentoResultado", { nombre: perfil.nombre ?? perfil.perfil, resultado: textoDeResultado(perfil.resultado) }),
      }),
    ),
  );
}

function textoLlegan(resumen, ctx) {
  const { validos, medidos, logrados } = cifrasDeTanda(resumen);
  if (!validos) return ctx.t("corridas.fila.sinValidos");
  if (!medidos) return ctx.t("corridas.fila.sinMedir");
  return ctx.t("comun.marco.llegan", { n: logrados, de: medidos });
}

function insigniaDeErrores(resumen, ctx, { corta = false } = {}) {
  const { errores } = cifrasDeTanda(resumen);
  if (!errores) return null;
  const texto = ctx.t("comun.marco.errores", { n: errores });
  return el(
    "span",
    { class: `insignia insignia-error corridas-errores${corta ? " corridas-errores-corta" : ""}` },
    icono("error-herramienta"),
    el("span", { class: "corridas-errores-texto", texto }),
  );
}

/** route_tree.json dañado, o que todavía no existe (tanda incompleta). */
function insigniaDelArbol(resumen, ctx) {
  if (resumen.arbol !== "danado" && resumen.arbol !== "falta") return null;
  return el("span", { class: "insignia insignia-neutro corridas-arbol", texto: ctx.t(resumen.arbol === "danado" ? "corridas.fila.arbolDanado" : "corridas.fila.arbolFalta") });
}

function tiempo(resumen, ctx) {
  const fecha = resumen.fechaIso ?? resumen.fecha;
  if (!fecha) return el("span", { class: "corridas-tiempo" });
  return el("time", {
    class: "corridas-tiempo",
    datetime: resumen.fechaIso ?? null,
    title: ctx.fmt.fechaLegible(fecha),
    "data-relativo": fecha,
    // Con la hora: dos tandas de la misma tarea, ambas "hace 2 h", se distinguen (07:16 y 07:28).
    texto: ctx.fmt.tiempoConHora(fecha),
  });
}

function claseDeFila(resumen, base) {
  const clases = [base];
  if (tieneProblemas(resumen)) clases.push("con-problemas");
  if (tieneErrores(resumen)) clases.push("con-errores");
  return clases.join(" ");
}

function fila(resumen, ctx) {
  return el(
    "li",
    {},
    el(
      "a",
      {
        class: claseDeFila(resumen, "corridas-fila"),
        href: ctx.enlaceATanda(resumen.id),
        "data-foco": `corridas:fila:${resumen.id}`,
        "data-fila": "",
      },
      miniatura(resumen, ctx),
      el(
        "span",
        { class: "corridas-principal" },
        el(
          "span",
          { class: "corridas-linea" },
          el("span", { class: "corridas-tarea truncar", title: resumen.instruccion ?? null, texto: resumen.tarea ?? resumen.host ?? resumen.id }),
          insigniaDeErrores(resumen, ctx),
          insigniaDelArbol(resumen, ctx),
        ),
        // El sitio; en el angosto, también cuándo corrió (la columna del tiempo no cabe).
        el("span", { class: "corridas-sitio" }, el("span", { class: "truncar", texto: resumen.host ?? "" }), tiempo(resumen, ctx)),
      ),
      el("span", { class: "corridas-llegan" }, medidor(resumen, ctx), el("span", { class: "corridas-llegan-texto", texto: textoLlegan(resumen, ctx) })),
      tiempo(resumen, ctx),
    ),
  );
}

function tarjeta(resumen, ctx) {
  return el(
    "li",
    {},
    el(
      "a",
      {
        class: claseDeFila(resumen, "corridas-tarjeta"),
        href: ctx.enlaceATanda(resumen.id),
        "data-foco": `corridas:fila:${resumen.id}`,
        "data-fila": "",
      },
      el(
        "span",
        { class: "corridas-tarjeta-imagen" },
        miniatura(resumen, ctx),
        el("span", { class: "corridas-tarjeta-medidor" }, medidor(resumen, ctx), el("span", { class: "corridas-llegan-texto", texto: textoLlegan(resumen, ctx) })),
      ),
      el(
        "span",
        { class: "corridas-tarjeta-cuerpo" },
        el(
          "span",
          { class: "corridas-linea" },
          el("span", { class: "corridas-tarea truncar", texto: resumen.tarea ?? resumen.host ?? resumen.id }),
          insigniaDeErrores(resumen, ctx, { corta: true }),
        ),
        resumen.instruccion ? el("span", { class: "corridas-instruccion", texto: resumen.instruccion }) : null,
        el("span", { class: "corridas-tarjeta-meta" }, el("span", { texto: resumen.host ?? "" }), tiempo(resumen, ctx)),
      ),
    ),
  );
}

// ── Grupos por día ──────────────────────────────────────────────────────────

function nombreDelDia(grupo, ctx) {
  if (grupo.tipo === "hoy") return ctx.t("corridas.dia.hoy");
  if (grupo.tipo === "ayer") return ctx.t("corridas.dia.ayer");
  if (grupo.tipo === "sinFecha") return ctx.t("corridas.dia.sinFecha");
  const [a, m, d] = grupo.dia.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  const anio = fecha.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined;
  return new Intl.DateTimeFormat(ctx.fmt.locale, { weekday: "long", day: "numeric", month: "long", year: anio }).format(fecha);
}

function resultados(ctx, lista) {
  const { grupos, visibles, total, parametros } = lista;
  if (!total) {
    return vacio({
      titulo: ctx.t("corridas.vacio.sinTandas"),
      texto: ctx.t("corridas.vacio.sinTandasTexto", { carpeta: ctx.carpeta ?? "agents/.runs" }),
      codigo: COMANDOS_PARA_GATILLAR,
      icono: "corridas",
    });
  }
  if (!visibles.length) {
    return el(
      "div",
      { class: "corridas-sin-coincidencias", "data-foco-respaldo": "", tabindex: "-1" },
      vacio({
        titulo: ctx.t("corridas.vacio.sinCoincidencias"),
        texto: parametros.q ? ctx.t("corridas.vacio.sinCoincidenciasBusqueda", { q: parametros.q }) : ctx.t("corridas.vacio.sinCoincidenciasTexto"),
        accion: { texto: ctx.t("corridas.limpiarFiltros"), accion: () => limpiarFiltros() },
        icono: "buscar",
      }),
    );
  }
  const grilla = parametros.vista === "grilla";
  const pieza = grilla ? tarjeta : fila;
  return grupos.map((grupo, indice) => {
    const titulo = grupo.tipo === "todas" ? null : nombreDelDia(grupo, ctx);
    const id = `corridas-dia-${indice}`;
    return el(
      "section",
      { class: "corridas-grupo", "aria-labelledby": titulo ? id : null, "aria-label": titulo ? null : ctx.t("corridas.lista") },
      titulo ? el("h2", { class: "corridas-dia etiqueta-micro", id, texto: titulo }) : null,
      el("ol", { class: grilla ? "corridas-grilla" : "corridas-lista" }, grupo.tandas.map((resumen) => pieza(resumen, ctx))),
    );
  });
}

// ── Controles ───────────────────────────────────────────────────────────────

function chip({ valor, texto, cuenta, iconoNombre, ctx, activo }) {
  return el(
    "button",
    {
      type: "button",
      class: `chip corridas-chip${valor ? ` corridas-chip-${valor}` : ""}`,
      "aria-pressed": activo ? "true" : "false",
      "data-foco": `corridas:chip:${valor ?? "todas"}`,
      "data-filtro": valor ?? "",
      onclick: () => ctx.actualizarParametros({ filtro: valor }, { historial: "reemplazar" }),
    },
    iconoNombre ? icono(iconoNombre) : null,
    el("span", { texto }),
    el("span", { class: "chip-cuenta", "data-cuenta": valor ?? "todas", texto: String(cuenta) }),
  );
}

function selector({ id, etiqueta, opciones, valor, alCambiar, ctx }) {
  const select = el(
    "select",
    { id, class: "corridas-select", "data-foco": `corridas:${id}` },
    opciones.map((opcion) => el("option", { value: opcion.valor, texto: opcion.texto, selected: opcion.valor === valor ? true : null })),
  );
  select.value = valor;
  select.addEventListener("change", () => alCambiar(select.value), { signal: ctx.senal });
  return el(
    "label",
    { class: "corridas-menu" },
    el("span", { class: "visualmente-oculto", texto: etiqueta }),
    select,
  );
}

function opcionesDeSitio(ctx, sitioActual) {
  const sitios = sitiosDe(ctx.tandas);
  const opciones = [{ valor: "", texto: ctx.t("corridas.sitio.todos") }, ...sitios.map(({ host, n }) => ({ valor: host, texto: ctx.t("corridas.sitio.opcion", { host, n }) }))];
  if (sitioActual && !sitios.some((s) => s.host === sitioActual)) opciones.push({ valor: sitioActual, texto: ctx.t("corridas.sitio.opcion", { host: sitioActual, n: 0 }) });
  return opciones;
}

function controles(ctx, lista) {
  const p = lista.parametros;
  const entrada = el("input", {
    type: "search",
    id: "corridas-buscar",
    class: "corridas-buscar-entrada",
    placeholder: ctx.t("corridas.buscar.marcador"),
    autocomplete: "off",
    spellcheck: "false",
    "aria-keyshortcuts": "/",
    "data-foco": "corridas:buscar",
    value: p.q,
  });
  entrada.value = p.q;
  let reloj = 0;
  entrada.addEventListener(
    "input",
    () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => ctx.actualizarParametros({ q: entrada.value.trim() || null }), ESPERA_DE_BUSQUEDA);
    },
    { signal: ctx.senal },
  );
  entrada.addEventListener(
    "keydown",
    (evento) => {
      if (evento.key === "Escape" && entrada.value) {
        evento.preventDefault();
        evento.stopPropagation();
        entrada.value = "";
        clearTimeout(reloj);
        ctx.actualizarParametros({ q: null });
      } else if (evento.key === "ArrowDown" || evento.key === "Enter") {
        // Desde la búsqueda, ↓ o Enter pasan a la primera fila.
        const primera = estado?.raiz.querySelector("[data-fila]");
        if (primera) {
          evento.preventDefault();
          clearTimeout(reloj);
          if (entrada.value.trim() !== (estado.parametros.q ?? "")) ctx.actualizarParametros({ q: entrada.value.trim() || null });
          estado.raiz.querySelector("[data-fila]")?.focus();
        }
      }
    },
    { signal: ctx.senal },
  );
  ctx.senal.addEventListener("abort", () => clearTimeout(reloj));

  const buscador = el(
    "div",
    { class: "corridas-buscador", role: "search" },
    el("label", { for: "corridas-buscar", class: "visualmente-oculto", texto: ctx.t("corridas.buscar.etiqueta") }),
    icono("buscar", { clase: "corridas-buscar-icono" }),
    entrada,
    el("span", { class: "corridas-buscar-tecla", "aria-hidden": "true" }, kbd("/")),
  );

  const chips = el("div", { class: "corridas-chips", role: "group", "aria-label": ctx.t("corridas.filtro.etiqueta") });

  const sitio = selector({
    id: "corridas-sitio",
    etiqueta: ctx.t("corridas.sitio.etiqueta"),
    opciones: opcionesDeSitio(ctx, p.sitio),
    valor: p.sitio ?? "",
    alCambiar: (valor) => ctx.actualizarParametros({ sitio: valor || null }),
    ctx,
  });
  const orden = selector({
    id: "corridas-orden",
    etiqueta: ctx.t("corridas.orden.etiqueta"),
    opciones: ["nuevas", "viejas", "exito", "tarea"].map((valor) => ({ valor, texto: ctx.t(`corridas.orden.${valor}`) })),
    valor: p.orden,
    alCambiar: (valor) => ctx.actualizarParametros({ orden: valor === "nuevas" ? null : valor }),
    ctx,
  });
  const vistas = el(
    "div",
    { class: "segmentado corridas-vistas", role: "group", "aria-label": ctx.t("corridas.vista.etiqueta") },
    ["lista", "grilla"].map((valor) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": p.vista === valor ? "true" : "false",
          "aria-label": ctx.t(`corridas.vista.${valor}`),
          title: ctx.t(`corridas.vista.${valor}Titulo`),
          "aria-keyshortcuts": "v",
          "data-foco": `corridas:vista:${valor}`,
          "data-vista": valor,
          onclick: () => ctx.actualizarParametros({ vista: valor === "lista" ? null : valor }),
        },
        icono(valor === "lista" ? "menu" : "corridas"),
      ),
    ),
  );

  return {
    entrada,
    chips,
    sitio,
    orden,
    vistas,
    nodo: el(
      "div",
      { class: "corridas-controles" },
      buscador,
      el("div", { class: "corridas-filtros" }, chips, el("div", { class: "corridas-menus" }, sitio, orden, vistas)),
    ),
  };
}

function ponerChips(ctx, lista) {
  const { cuentas, parametros } = lista;
  conservarFoco(estado.controles.chips, () =>
    reemplazar(
      estado.controles.chips,
      chip({ valor: null, texto: ctx.t("corridas.filtro.todas"), cuenta: cuentas.todas, ctx, activo: !parametros.filtro }),
      chip({ valor: "problemas", texto: ctx.t("corridas.filtro.problemas"), cuenta: cuentas.problemas, iconoNombre: "fallido", ctx, activo: parametros.filtro === "problemas" }),
      chip({ valor: "errores", texto: ctx.t("corridas.filtro.errores"), cuenta: cuentas.errores, iconoNombre: "error-herramienta", ctx, activo: parametros.filtro === "errores" }),
    ),
  );
}

function sincronizarControles(ctx, lista) {
  const p = lista.parametros;
  const { entrada, sitio, orden, vistas } = estado.controles;
  if (document.activeElement !== entrada && entrada.value !== p.q) entrada.value = p.q;
  const selectSitio = sitio.querySelector("select");
  if (selectSitio.value !== (p.sitio ?? "")) {
    if (![...selectSitio.options].some((opcion) => opcion.value === (p.sitio ?? ""))) {
      reemplazar(selectSitio, opcionesDeSitio(ctx, p.sitio).map((opcion) => el("option", { value: opcion.valor, texto: opcion.texto })));
    }
    selectSitio.value = p.sitio ?? "";
  }
  const selectOrden = orden.querySelector("select");
  if (selectOrden.value !== p.orden) selectOrden.value = p.orden;
  for (const boton of vistas.querySelectorAll("button")) boton.setAttribute("aria-pressed", boton.dataset.vista === p.vista ? "true" : "false");
  ponerChips(ctx, lista);
}

// ── Dibujo ──────────────────────────────────────────────────────────────────

function dibujarResultados(ctx) {
  const lista = prepararLista(ctx.tandas, ctx.parametros);
  estado.parametros = lista.parametros;
  estado.raiz.classList.toggle("vista-grilla", lista.parametros.vista === "grilla");
  sincronizarControles(ctx, lista);
  reemplazar(estado.cuenta, cuentaVisible(ctx, lista));
  conservarFoco(estado.resultados, () => reemplazar(estado.resultados, resultados(ctx, lista)));
  return lista;
}

function cuentaVisible(ctx, lista) {
  if (lista.visibles.length === lista.total) return ctx.t("comun.shell.cuentaTandas", { n: lista.total });
  return ctx.t("corridas.cuentaFiltrada", { n: lista.visibles.length, total: lista.total });
}

function limpiarFiltros() {
  const ctx = estado?.ctx;
  if (!ctx) return;
  ctx.actualizarParametros({ q: null, sitio: null, filtro: null });
  estado.controles.entrada.value = "";
  estado.controles.entrada.focus();
}

function filas() {
  return [...(estado?.raiz.querySelectorAll("[data-fila]") ?? [])];
}

/** Mueve el foco a la fila siguiente (+1) o anterior (−1); sin fila enfocada, a la primera o la última. */
function moverFila(delta) {
  const todas = filas();
  if (!todas.length) return;
  const actual = todas.indexOf(document.activeElement);
  const siguiente = actual === -1 ? (delta > 0 ? 0 : todas.length - 1) : Math.min(todas.length - 1, Math.max(0, actual + delta));
  todas[siguiente].focus();
  todas[siguiente].scrollIntoView({ block: "nearest" });
}

function refrescarTiempos(ctx) {
  for (const nodo of estado?.raiz.querySelectorAll("[data-relativo]") ?? []) {
    nodo.textContent = ctx.fmt.tiempoConHora(nodo.dataset.relativo);
  }
}

export default {
  titulo(ctx) {
    return ctx.t("comun.shell.corridas");
  },

  async montar(contenedor, ctx) {
    await ctx.cargarEstilos("estilos/corridas.css");
    // Si otra navegación reemplazó la vista mientras cargaba el CSS, no se arma ni se registra nada.
    if (ctx.senal.aborted) return;
    contenedor.classList.add("p-corridas");
    const lista = prepararLista(ctx.tandas, ctx.parametros);
    const cuenta = el("span", { class: "corridas-cuenta", "aria-live": "polite" });
    const control = controles(ctx, lista);
    const zona = el("div", { class: "corridas-resultados" });
    estado = { ctx, raiz: contenedor, cuenta, controles: control, resultados: zona, parametros: lista.parametros };

    reemplazar(
      contenedor,
      el(
        "header",
        { class: "corridas-cabecera" },
        el("h1", { tabindex: "-1", "data-foco-inicial": "", texto: ctx.t("comun.shell.corridas") }),
        cuenta,
      ),
      ctx.tandas.length ? control.nodo : null,
      zona,
    );
    dibujarResultados(ctx);

    // ↓/↑ solo cuando el foco está en una fila (fuera de ella, las flechas desplazan la página).
    zona.addEventListener(
      "keydown",
      (evento) => {
        if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
        if (!(evento.target instanceof Element) || !evento.target.matches("[data-fila]")) return;
        if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
          evento.preventDefault();
          moverFila(evento.key === "ArrowDown" ? 1 : -1);
        }
      },
      { signal: ctx.senal },
    );

    // P3: brillo de la tarjeta (grilla) que sigue al puntero; las coordenadas van por CSSOM.
    zona.addEventListener(
      "pointermove",
      (evento) => {
        const tarjeta = evento.target instanceof Element ? evento.target.closest(".corridas-tarjeta") : null;
        if (!tarjeta) return;
        const caja = tarjeta.getBoundingClientRect();
        tarjeta.style.setProperty("--x", `${Math.round(evento.clientX - caja.left)}px`);
        tarjeta.style.setProperty("--y", `${Math.round(evento.clientY - caja.top)}px`);
      },
      { signal: ctx.senal, passive: true },
    );

    ctx.atajos.registrar({
      j: { descripcion: () => ctx.t("comun.atajos.desc.filas"), accion: () => moverFila(1) },
      k: { descripcion: () => ctx.t("comun.atajos.desc.filas"), accion: () => moverFila(-1) },
      v: {
        descripcion: () => ctx.t("comun.atajos.desc.listaGrilla"),
        accion: () => estado?.ctx.actualizarParametros({ vista: estado.parametros.vista === "grilla" ? null : "grilla" }),
      },
      "/": {
        descripcion: () => ctx.t("corridas.atajos.buscar"),
        accion: () => {
          estado?.controles.entrada.focus();
          estado?.controles.entrada.select();
        },
      },
    });

    const reloj = setInterval(() => refrescarTiempos(ctx), 60_000);
    ctx.senal.addEventListener("abort", () => clearInterval(reloj));
  },

  actualizar(ctx) {
    if (!estado) return false;
    estado.ctx = ctx;
    dibujarResultados(ctx);
    return true;
  },

  desmontar() {
    estado = null;
  },
};
