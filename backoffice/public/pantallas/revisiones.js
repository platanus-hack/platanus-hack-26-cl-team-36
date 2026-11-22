// Revisiones del flujo en AWS: la lista de las vigentes, una por página (#/revisiones, filtrable con
// ?estado=live|done|failed; ?estado=historial muestra las reemplazadas) y el avance de una
// por etapa y por goal (#/revisiones/<revision>), con enlaces a lo que dejó cada corrida terminada. "En vivo" es
// volver a pedir cada INTERVALO mientras la vista está montada; solo se redibuja si la respuesta (o el filtro) cambió.

import { pedirRevision, pedirRevisiones, urlDeResultado } from "../nucleo/datos.js";
import { conservarFoco, el, esUrlWeb, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { icono } from "../nucleo/iconos.js";
import { enlaceARevision, enlaceARevisiones, enlaceATanda } from "../nucleo/rutas.js";

const INTERVALO = 2500;
const TONO = { queued: "neutro", pending: "neutro", running: "acento", done: "logrado", succeeded: "logrado", failed: "fallido" };
const ICONO = { queued: "proximamente", pending: "proximamente", running: "reproducir", done: "logrado", succeeded: "logrado", failed: "fallido" };
const COMANDO_AWS = "BACKOFFICE_FUENTE=s3 BACKOFFICE_ALMACEN=s3://<bucket> AWS_PROFILE=<perfil> npm run backoffice";
// Qué estados de la tabla deja ver cada filtro (el mismo corte que las pestañas del Overview: Live = corriendo y en cola).
const ESTADOS_DEL_FILTRO = { live: ["running", "queued"], done: ["done"], failed: ["failed"] };

/** Estado de la vista montada: { contenedor, ctx, revision, filtro, firma, error, reloj }. */
let estado = null;

function insignia(ctx, valor) {
  const conocido = Object.hasOwn(TONO, valor);
  return el(
    "span",
    { class: `insignia insignia-${TONO[valor] ?? "neutro"}` },
    icono(ICONO[valor] ?? "info"),
    el("span", { texto: conocido ? ctx.t(`revisiones.estado.${valor}`) : String(valor) }),
  );
}

const cuando = (ctx, fecha, clave) =>
  fecha ? el("time", { datetime: fecha, title: ctx.fmt.fechaLegible(fecha), texto: ctx.t(clave, { cuando: ctx.fmt.tiempoRelativo(fecha) }) }) : null;

function cabecera(ctx, titulo, ...resto) {
  return el(
    "header",
    { class: "revisiones-cabecera" },
    el("h1", { tabindex: "-1", "data-foco-inicial": "", texto: titulo }),
    resto,
  );
}

// ── Lista ──────────────────────────────────────────────────────────────────

function fila(ctx, revision) {
  return el(
    "li",
    {},
    el(
      "a",
      { class: "revisiones-fila", href: enlaceARevision(revision.revision), "data-foco": `revisiones:${revision.revision}` },
      insignia(ctx, revision.estado),
      el(
        "span",
        { class: "revisiones-fila-sitio" },
        el("span", { class: "texto-1 truncar", texto: revision.host ?? revision.revision }),
        el("span", { class: "texto-3 mono truncar", texto: revision.url ?? revision.revision }),
      ),
      el("span", {
        class: "texto-3 revisiones-fila-goals",
        texto: revision.goalsTotal === null ? ctx.t("revisiones.sinGoals") : ctx.t("revisiones.goals", { n: revision.goalsTotal }),
      }),
      el("span", { class: "texto-3 revisiones-fila-fecha", title: ctx.fmt.fechaLegible(revision.creada), texto: ctx.fmt.tiempoRelativo(revision.creada) }),
    ),
  );
}

/** La ficha del filtro activo, con un enlace para quitarlo (vuelve a la lista entera). */
function fichaDelFiltro(ctx, filtro) {
  if (!filtro) return null;
  return el(
    "span",
    { class: "chip revisiones-filtro" },
    el("span", { texto: ctx.t(`revisiones.filtro.${filtro}`) }),
    el(
      "a",
      { class: "revisiones-filtro-quitar", href: enlaceARevisiones(), "aria-label": ctx.t("revisiones.filtro.quitar"), title: ctx.t("revisiones.filtro.quitar"), "data-foco": "revisiones:filtro:quitar" },
      icono("cerrar"),
    ),
  );
}

function vistaDeLista(ctx, datos, filtro) {
  const { t } = ctx;
  if (!datos?.disponible) {
    return [
      cabecera(ctx, t("comun.shell.revisiones")),
      vacio({ titulo: t("revisiones.noDisponible.titulo"), texto: t("revisiones.noDisponible.texto"), codigo: COMANDO_AWS }),
    ];
  }
  const historial = filtro === "historial";
  const todas = historial ? (datos.historial ?? []) : datos.revisiones;
  const estados = ESTADOS_DEL_FILTRO[filtro] ?? null;
  const revisiones = estados ? todas.filter((revision) => estados.includes(revision.estado)) : todas;
  const cuenta = estados ? t("revisiones.cuentaFiltrada", { n: revisiones.length, total: todas.length }) : t("revisiones.cuenta", { n: todas.length });
  return [
    cabecera(ctx, t("comun.shell.revisiones"), fichaDelFiltro(ctx, estados || historial ? filtro : null), el("span", { class: "revisiones-cuenta", texto: cuenta })),
    el("p", { class: "texto-3 t-pequeno", texto: t("revisiones.enVivo") }),
    revisiones.length
      ? el("ul", { class: "revisiones-lista tarjeta" }, revisiones.map((revision) => fila(ctx, revision)))
      : vacio({ titulo: t(estados || historial ? "revisiones.filtro.vacio" : "revisiones.vacio") }),
  ];
}

// ── Una revisión ───────────────────────────────────────────────────────────

function paso(ctx, datos) {
  return el(
    "div",
    { class: "revisiones-paso" },
    insignia(ctx, datos.estado),
    datos.resultados.length
      ? el(
          "span",
          { class: "revisiones-enlaces" },
          datos.resultados.map((resultado) =>
            resultado.tanda
              ? el("a", { href: enlaceATanda(resultado.tanda), texto: ctx.t("revisiones.abrirTanda") })
              : el("a", { class: "mono", href: urlDeResultado(resultado.clave), target: "_blank", rel: "noreferrer", texto: resultado.archivo }),
          ),
        )
      : null,
    datos.actualizada ? el("span", { class: "texto-3 revisiones-paso-cuando" }, cuando(ctx, datos.actualizada, "revisiones.actualizada")) : null,
  );
}

function medidor(avance) {
  const pasos = [avance.catalogo, ...avance.goals.flatMap((goal) => [goal.guide, goal.visitor]), avance.improver];
  const faltan = Math.max(0, avance.progreso.total - pasos.length);
  const tramos = [...pasos.slice(0, -1), ...Array.from({ length: faltan }, () => ({ estado: "pending" })), pasos.at(-1)];
  const tono = { succeeded: "medidor-logrado", failed: "medidor-fallido", running: "medidor-acento" };
  return el("span", { class: "medidor revisiones-medidor", "aria-hidden": "true" }, tramos.map((p) => el("span", { class: `medidor-tramo ${tono[p.estado] ?? ""}` })));
}

function seccion(ctx, id, ...contenido) {
  return el(
    "section",
    { class: "seccion", "aria-labelledby": `revisiones-${id}` },
    el("h2", { id: `revisiones-${id}`, class: "etiqueta-micro", texto: ctx.t(`revisiones.etapa.${id}`) }),
    contenido,
  );
}

function tablaDeGoals(ctx, goals) {
  if (!goals.length) return el("p", { class: "texto-3", texto: ctx.t("revisiones.sinGoals") });
  const columnas = ["goal", "guide", "visitor"];
  return el(
    "div",
    { class: "tarjeta revisiones-tabla-marco" },
    el(
      "table",
      { class: "revisiones-tabla" },
      el("thead", {}, el("tr", {}, columnas.map((columna) => el("th", { scope: "col", texto: ctx.t(`revisiones.columna.${columna}`) })))),
      el(
        "tbody",
        {},
        goals.map((goal) =>
          el("tr", {}, el("th", { scope: "row", class: "mono", texto: goal.goal }), el("td", {}, paso(ctx, goal.guide)), el("td", {}, paso(ctx, goal.visitor))),
        ),
      ),
    ),
  );
}

function vistaDeRevision(ctx, revision, avance) {
  const { t } = ctx;
  const migas = el("nav", { class: "revisiones-migas", "aria-label": t("comun.shell.revisiones") }, el("a", { href: enlaceARevision(), texto: t("comun.shell.revisiones") }));
  if (!avance) {
    return [migas, vacio({ titulo: t("revisiones.noExiste", { revision }), nivel: 1, accion: { texto: t("comun.shell.revisiones"), href: enlaceARevision() } })];
  }
  const { progreso } = avance;
  return [
    migas,
    cabecera(ctx, avance.host ?? revision, insignia(ctx, avance.estado)),
    el(
      "p",
      { class: "revisiones-meta texto-3" },
      avance.url && esUrlWeb(avance.url) ? el("a", { class: "mono", href: avance.url, target: "_blank", rel: "noreferrer", texto: avance.url }) : null,
      el("code", { texto: revision }),
      cuando(ctx, avance.creada, "revisiones.creada"),
      cuando(ctx, avance.actualizada, "revisiones.actualizada"),
    ),
    el(
      "div",
      { class: "revisiones-progreso" },
      medidor(avance),
      el("span", { class: "texto-2", texto: t(progreso.goalsConocidos ? "revisiones.progreso" : "revisiones.progresoParcial", progreso) }),
      avance.css ? el("a", { class: "boton boton-secundario", href: urlDeResultado(avance.css), target: "_blank", rel: "noreferrer", texto: t("revisiones.verTema") }) : null,
    ),
    el("p", { class: "texto-3 t-pequeno", texto: t("revisiones.enVivo") }),
    seccion(ctx, "catalogo", paso(ctx, avance.catalogo)),
    seccion(ctx, "goals", tablaDeGoals(ctx, avance.goals)),
    seccion(ctx, "improver", paso(ctx, avance.improver)),
  ];
}

// ── Montaje y sondeo ───────────────────────────────────────────────────────

const pedir = (actual) => (actual.revision ? pedirRevision(actual.revision) : pedirRevisiones());

function dibujar(actual, datos) {
  const firma = JSON.stringify([datos, actual.error, actual.filtro]);
  if (firma === actual.firma) return;
  actual.firma = firma;
  actual.datos = datos;
  const vista = actual.revision ? vistaDeRevision(actual.ctx, actual.revision, datos) : vistaDeLista(actual.ctx, datos, actual.filtro);
  conservarFoco(actual.contenedor, () =>
    reemplazar(actual.contenedor, vista[0], actual.error ? avisoEnLinea(actual.ctx.t("revisiones.errorAlRefrescar"), "atencion") : null, vista.slice(1)),
  );
}

function programar(actual) {
  actual.reloj = setTimeout(async () => {
    if (estado !== actual) return;
    if (!document.hidden) {
      try {
        const datos = await pedir(actual);
        actual.error = false;
        if (estado === actual) dibujar(actual, datos);
      } catch {
        actual.error = true;
        if (estado === actual) dibujar(actual, actual.datos);
      }
    }
    if (estado === actual) programar(actual);
  }, INTERVALO);
}

export default {
  titulo(ctx) {
    return ctx.ruta.revision ?? ctx.t("comun.shell.revisiones");
  },

  async montar(contenedor, ctx) {
    contenedor.classList.add("p-revisiones");
    const revision = ctx.ruta.revision ?? null;
    const filtro = revision ? null : (ctx.parametros.estado ?? null);
    const actual = { contenedor, ctx, revision, filtro, firma: null, datos: null, error: false, reloj: null };
    const [datos] = await Promise.all([pedir(actual), ctx.cargarEstilos("estilos/revisiones.css")]);
    if (ctx.senal.aborted) return;
    estado = actual;
    dibujar(actual, datos);
    programar(actual);
  },

  // Cambiar el filtro (?estado=) no vuelve a pedir: se redibuja la lista con lo último que llegó.
  actualizar(ctx) {
    if (!estado || estado.revision !== (ctx.ruta.revision ?? null)) return false;
    estado.ctx = ctx;
    const filtro = estado.revision ? null : (ctx.parametros.estado ?? null);
    if (filtro !== estado.filtro) {
      estado.filtro = filtro;
      dibujar(estado, estado.datos);
    }
    return true;
  },

  desmontar() {
    if (estado) clearTimeout(estado.reloj);
    estado = null;
  },
};
