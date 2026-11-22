// Overview (spec §3.3–§3.5, artboards 1–5; contrato §6 y §7): el inicio del backoffice. Arriba los agentes (un solo
// número, dividido por rol, con un cuadrito por corrida) y abajo las revisiones, con la página revisada como
// protagonista. El título "Overview" se ve en la barra superior (nucleo/shell.js); aquí queda el h1 para lectores de
// pantalla y para el foco inicial, visualmente oculto.
//
// Estado en el hash: #/?dispositivo=mobile&pestana=failed&link=metro&pagina=3 (sin escribir all, recent, la búsqueda
// vacía ni la página 1). Cambiar el filtro, la pestaña, la búsqueda o la página escribe el hash y redibuja en
// actualizar(ctx), sin remontar ni mover el foco.
// En vivo: vuelve a pedir /api/resumen y /api/overview cada 5 s mientras la pestaña del navegador está visible; si
// la respuesta no cambió no toca nada, y si cambió reconcilia por tarjeta. Todo el tiempo sale de `ahora` de la API.
//
// Paginado (contrato §7.4): páginas de 6. El servidor trae la página 1 de cada pestaña, o la pedida en la pestaña
// activa; elegir otra pestaña vuelve a su página 1, que ya llegó. Ir a una página que no llegó pone tarjetas
// esqueleto hasta que llega, y la pide también al refrescar. Si la página pedida ya no existe, el servidor da la
// última y el hash se corrige. Si dos pedidos se cruzan, manda el último: la respuesta de uno anterior se descarta.
//
// Buscador (overview/dom-revisiones.js): filtra las revisiones por su link en el servidor (cifras de las pestañas
// incluidas) y vuelve a la página 1; mientras llega, la grilla también muestra tarjetas esqueleto. "/" lo enfoca.

import { pedirOverview, pedirResumen } from "../nucleo/datos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { esqueleto } from "../nucleo/estados.js";
import { normalizarBusqueda } from "../nucleo/links.js";
import { leerDispositivo, modeloDeAgentes } from "../overview/agentes.js";
import { escucharColores, imagenes } from "../overview/capturas.js";
import { crearBloqueDeAgentes } from "../overview/dom-agentes.js";
import { crearSeccionDeRevisiones } from "../overview/dom-revisiones.js";
import { TARJETAS_POR_PAGINA, busquedaDe, leerPagina, leerPestana, paginaDePestana, paginacionDePestana } from "../overview/tarjetas.js";

const INTERVALO = 5000;

/**
 * Vista montada: { ctx, datos: { resumen, overview }, firma, error, reloj, turno, pronto, dejarDeEscuchar, agentes,
 * revisiones }.
 */
let estado = null;

const pestanaDe = (actual) => leerPestana(actual.ctx.parametros?.pestana);
const paginaDe = (actual) => leerPagina(actual.ctx.parametros?.pagina);
const linkDe = (actual) => normalizarBusqueda(actual.ctx.parametros?.link);
const firmaDe = (resumen, overview) => JSON.stringify([resumen, overview]);

/**
 * Pide los dos endpoints; el Overview con la búsqueda y la página pedida de la pestaña activa (la 1 de cada una, si
 * no).
 */
function pedirTodo(actual) {
  const pagina = paginaDe(actual);
  const link = linkDe(actual) || null;
  return Promise.all([pedirResumen(), pedirOverview(pagina > 1 ? { pestana: pestanaDe(actual), pagina, link } : { link })]);
}

/** ¿Lo que llegó es de la búsqueda y la página pedidas en la pestaña activa? (sin tabla no hay páginas: siempre sí) */
function tieneLaPagina(actual) {
  const { overview } = actual.datos;
  if (overview?.disponible !== true) return true;
  return busquedaDe(overview) === linkDe(actual) && paginaDePestana(overview, pestanaDe(actual)) === paginaDe(actual);
}

function dibujar(actual) {
  const { ctx, datos } = actual;
  const dispositivo = leerDispositivo(ctx.parametros?.dispositivo);
  const pestana = leerPestana(ctx.parametros?.pestana);
  actual.agentes.actualizar(modeloDeAgentes(datos.resumen, dispositivo));
  // Sin /api/overview (un servidor viejo responde 404): como sin tabla, los agentes siguen. Mientras se espera otra
  // página, la grilla se queda con sus tarjetas esqueleto (un redibujo no devuelve las de la página anterior).
  actual.revisiones.actualizar({
    overview: datos.overview ?? { disponible: false },
    dispositivo,
    pestana,
    error: actual.error,
    esperando: !tieneLaPagina(actual),
    busqueda: linkDe(actual),
  });
}

/**
 * Redibuja apenas se pueda (cuando llega el color de marca de una captura): varios avisos seguidos, un solo dibujo.
 * Con un temporizador y no con requestAnimationFrame, que no corre mientras no se pinta un cuadro.
 */
function dibujarPronto(actual) {
  if (actual.pronto) return;
  actual.pronto = setTimeout(() => {
    actual.pronto = 0;
    if (estado === actual) dibujar(actual);
  }, 30);
}

function programar(actual) {
  clearTimeout(actual.reloj);
  if (estado !== actual || document.hidden) return;
  actual.reloj = setTimeout(() => pedir(actual), INTERVALO);
}

/**
 * Pide y, si la respuesta cambió, redibuja. → true si esta respuesta es la que quedó (ningún pedido posterior la
 * reemplazó). El refresco de 5 s se vuelve a programar después del último pedido.
 */
async function pedir(actual) {
  if (estado !== actual) return false;
  const turno = ++actual.turno;
  clearTimeout(actual.reloj);
  try {
    const [resumen, overview] = await pedirTodo(actual);
    if (estado !== actual || turno !== actual.turno) return false;
    const firma = firmaDe(resumen, overview);
    if (firma !== actual.firma || actual.error) {
      actual.firma = firma;
      actual.datos = { resumen, overview };
      actual.error = false;
      dibujar(actual);
    }
    return true;
  } catch {
    if (estado !== actual || turno !== actual.turno) return false;
    if (!actual.error) {
      // Se queda con lo último que llegó y avisa; el próximo intento sigue solo.
      actual.error = true;
      dibujar(actual);
    }
    return true;
  } finally {
    if (estado === actual && turno === actual.turno) programar(actual);
  }
}

/**
 * Otra página o búsqueda de la pestaña activa: tarjetas esqueleto en la grilla hasta que llega. Si el servidor dio
 * otra página (la pedida ya no existe: dio la última), corrige el hash; si no, anuncia la página o cuántas calzan.
 */
async function irAPagina(actual) {
  const pestana = pestanaDe(actual);
  const pagina = paginaDe(actual);
  const link = linkDe(actual);
  const otraBusqueda = busquedaDe(actual.datos.overview) !== link;
  const conocida = otraBusqueda ? null : actual.datos.overview?.pestanas?.[pestana];
  const total = Math.max(Number(conocida?.total) || 0, pagina * TARJETAS_POR_PAGINA);
  actual.revisiones.esperarPagina({ pagina, paginas: Math.max(pagina, Number(conocida?.paginas) || 1), total });
  dibujar(actual);
  const quedo = await pedir(actual);
  if (!quedo || estado !== actual || pestanaDe(actual) !== pestana || paginaDe(actual) !== pagina || linkDe(actual) !== link) return;
  const real = paginaDePestana(actual.datos.overview, pestana);
  if (actual.datos.overview?.disponible === true && real !== pagina) {
    actual.ctx.actualizarParametros({ pagina: real > 1 ? real : null });
    return;
  }
  if (otraBusqueda && link) {
    const n = Number(actual.datos.overview?.pestanas?.[pestana]?.total) || 0;
    actual.ctx.anunciar(actual.ctx.t("overview.buscar.resultados", { n }));
    return;
  }
  const paginacion = paginacionDePestana(actual.datos.overview, pestana);
  if (paginacion) actual.ctx.anunciar(actual.ctx.t("overview.paginas.anuncio", { pagina: paginacion.pagina, paginas: paginacion.paginas }));
}

/**
 * Los datos para montar: los dos endpoints (con la página del hash) y la hoja de estilos. El enrutador lo llama antes
 * de la transición, con el esqueleto del Overview mientras tanto. → { resumen, overview }
 */
async function cargar(ctx) {
  const [[resumen, overview]] = await Promise.all([pedirTodo({ ctx }), ctx.cargarEstilos("estilos/overview.css")]);
  return { resumen, overview };
}

export default {
  titulo(ctx) {
    return ctx.t("comun.shell.overview");
  },

  cargar,

  async montar(contenedor, ctx, cargado) {
    if (!cargado) {
      // Remontada sin pasar por el enrutador (Reintentar): pide ella, con el mismo esqueleto.
      reemplazar(contenedor, esqueleto("overview"));
      cargado = await cargar(ctx);
    }
    // Si otra navegación reemplazó la vista mientras se pedían los datos, no se arma ni se programa nada.
    if (ctx.senal.aborted) return;
    contenedor.classList.add("p-overview");
    const { resumen, overview } = cargado;

    const actual = {
      ctx,
      datos: { resumen, overview },
      firma: firmaDe(resumen, overview),
      error: false,
      reloj: 0,
      turno: 0,
      pronto: 0,
    };
    actual.dejarDeEscuchar = escucharColores(() => dibujarPronto(actual));
    // El ctx más nuevo (actualizar lo cambia) es el que escribe el hash.
    actual.agentes = crearBloqueDeAgentes(ctx, {
      alElegirDispositivo: (valor) => actual.ctx.actualizarParametros({ dispositivo: valor === "all" ? null : valor }),
    });
    actual.revisiones = crearSeccionDeRevisiones(ctx, {
      imagenes,
      // Otra pestaña empieza en su página 1.
      alElegirPestana: (valor) => actual.ctx.actualizarParametros({ pestana: valor === "recent" ? null : valor, pagina: null }),
      enlaceAPagina: (n) => actual.ctx.enlace(null, { ...actual.ctx.parametros, pagina: n > 1 ? n : null }),
      // Otra búsqueda empieza en la página 1.
      alBuscar: (texto) => {
        const link = normalizarBusqueda(texto);
        if (link !== linkDe(actual)) actual.ctx.actualizarParametros({ link: link || null, pagina: null });
      },
    });
    const titulo = el("h1", { class: "visualmente-oculto", tabindex: "-1", "data-foco-inicial": "", texto: ctx.t("comun.shell.overview") });
    reemplazar(contenedor, el("div", { class: "ov-arriba" }, titulo, actual.agentes.nodo), actual.revisiones.nodo);
    estado = actual;
    dibujar(actual);

    ctx.atajos.registrar({
      "/": { descripcion: () => ctx.t("overview.buscar.atajo"), accion: () => actual.revisiones.enfocarBusqueda() },
    });

    // Con la pestaña del navegador oculta no se pide nada; al volver, se refresca de inmediato.
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) clearTimeout(actual.reloj);
        else pedir(actual);
      },
      { signal: ctx.senal },
    );
    programar(actual);
  },

  actualizar(ctx) {
    if (!estado) return false;
    const antes = { pestana: pestanaDe(estado), pagina: paginaDe(estado) };
    estado.ctx = ctx;
    if (tieneLaPagina(estado)) dibujar(estado);
    else irAPagina(estado);
    // Se cambió de página desde el paginador (abajo): la sección vuelve a quedar a la vista desde su cabecera.
    if (antes.pestana === pestanaDe(estado) && antes.pagina !== paginaDe(estado)) estado.revisiones.subirAlInicio();
    return true;
  },

  desmontar() {
    if (estado) {
      clearTimeout(estado.reloj);
      clearTimeout(estado.pronto);
      estado.dejarDeEscuchar();
      // Las capturas quedan sueltas en el banco: al volver (otra navegación, otro idioma) no se vuelven a pedir.
      estado.revisiones.soltar();
    }
    estado = null;
  },
};
