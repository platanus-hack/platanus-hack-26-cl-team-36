// Overview (spec §3.3–§3.5, artboards 1–5; contrato §6 y §7): el inicio del backoffice. Arriba los agentes (un solo
// número, dividido por rol, con un cuadrito por corrida) y abajo las revisiones, con la página revisada como
// protagonista. El título "Overview" encabeza la página (h1) con el mismo formato que "Reviews".
//
// Estado en el hash: #/?dispositivo=mobile&pestana=failed (sin escribir all ni recent). Cambiar el filtro o la
// pestaña escribe el hash (ctx.actualizarParametros) y redibuja en actualizar(ctx), sin remontar ni mover el foco.
// En vivo: vuelve a pedir /api/resumen y /api/overview cada 5 s mientras la pestaña del navegador está visible; si
// la respuesta no cambió no toca nada, y si cambió reconcilia por tarjeta. Todo el tiempo sale de `ahora` de la API.
//
// Paginado (contrato §7.4): cada pestaña recuerda su límite mientras la vista está montada (6, y 10 más con cada
// "Show N more"); se pide la pestaña activa con su límite, también al refrescar. Si dos pedidos se cruzan, manda el
// último: la respuesta de uno anterior se descarta.

import { pedirOverview, pedirResumen } from "../nucleo/datos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { leerDispositivo, modeloDeAgentes } from "../overview/agentes.js";
import { escucharColores, imagenes } from "../overview/capturas.js";
import { crearBloqueDeAgentes } from "../overview/dom-agentes.js";
import { crearSeccionDeRevisiones } from "../overview/dom-revisiones.js";
import { PESTANAS, TARJETAS_POR_PAGINA, idsDePestana, leerPestana, limiteSiguiente, masDePestana, sumadas } from "../overview/tarjetas.js";

const INTERVALO = 5000;

/**
 * Vista montada: { ctx, datos: { resumen, overview }, firma, error, reloj, turno, pronto, limites, cargandoMas,
 * dejarDeEscuchar, agentes, revisiones }.
 */
let estado = null;

const pestanaDe = (actual) => leerPestana(actual.ctx.parametros?.pestana);
const firmaDe = (resumen, overview) => JSON.stringify([resumen, overview]);

/** Pide los dos endpoints; el Overview con la pestaña activa y su límite (6 si no se pidió más). */
function pedirTodo(actual) {
  const pestana = pestanaDe(actual);
  const limite = actual.limites[pestana];
  return Promise.all([pedirResumen(), pedirOverview(limite > TARJETAS_POR_PAGINA ? { pestana, limite } : {})]);
}

function dibujar(actual) {
  const { ctx, datos } = actual;
  const dispositivo = leerDispositivo(ctx.parametros?.dispositivo);
  const pestana = leerPestana(ctx.parametros?.pestana);
  actual.agentes.actualizar(modeloDeAgentes(datos.resumen, dispositivo));
  // Sin /api/overview (un servidor viejo responde 404): como sin tabla, los agentes siguen.
  actual.revisiones.actualizar({ overview: datos.overview ?? { disponible: false }, dispositivo, pestana, error: actual.error });
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

/** "Show N more": sube 10 el límite de la pestaña activa, pide y suma abajo las nuevas; anuncia cuántas llegaron. */
async function cargarMas(actual) {
  if (estado !== actual || actual.cargandoMas) return;
  const pestana = pestanaDe(actual);
  const antes = actual.datos.overview;
  actual.limites[pestana] = limiteSiguiente(Math.max(actual.limites[pestana], idsDePestana(antes, pestana).length));
  actual.cargandoMas = true;
  actual.revisiones.cargando(true);
  try {
    const quedo = await pedir(actual);
    if (!quedo || estado !== actual || pestanaDe(actual) !== pestana) return;
    const nuevas = sumadas(antes, actual.datos.overview, pestana);
    if (nuevas) actual.ctx.anunciar(actual.ctx.t("overview.sumadas", { n: nuevas }));
    // Si ya no quedan más, el botón se oculta: el foco que estaba en él pasa a la primera de las nuevas en vez de
    // perderse (el botón oculto puede seguir siendo activeElement hasta el próximo cuadro).
    const activo = document.activeElement;
    const enElBoton = !activo || activo === document.body || activo.classList?.contains("ov-mas");
    if (nuevas && enElBoton && !masDePestana(actual.datos.overview, pestana)) {
      actual.revisiones.enfocarTarjeta(idsDePestana(antes, pestana).length);
    }
  } finally {
    actual.cargandoMas = false;
    if (estado === actual) actual.revisiones.cargando(false);
  }
}

export default {
  titulo(ctx) {
    return ctx.t("comun.shell.overview");
  },

  async montar(contenedor, ctx) {
    const limites = Object.fromEntries(PESTANAS.map((pestana) => [pestana, TARJETAS_POR_PAGINA]));
    const inicial = { ctx, limites };
    const [[resumen, overview]] = await Promise.all([pedirTodo(inicial), ctx.cargarEstilos("estilos/overview.css")]);
    // Si otra navegación reemplazó la vista mientras se pedían los datos, no se arma ni se programa nada.
    if (ctx.senal.aborted) return;
    contenedor.classList.add("p-overview");

    const actual = {
      ...inicial,
      datos: { resumen, overview },
      firma: firmaDe(resumen, overview),
      error: false,
      reloj: 0,
      turno: 0,
      pronto: 0,
      cargandoMas: false,
    };
    actual.dejarDeEscuchar = escucharColores(() => dibujarPronto(actual));
    // El ctx más nuevo (actualizar lo cambia) es el que escribe el hash.
    actual.agentes = crearBloqueDeAgentes(ctx, {
      alElegirDispositivo: (valor) => actual.ctx.actualizarParametros({ dispositivo: valor === "all" ? null : valor }),
    });
    actual.revisiones = crearSeccionDeRevisiones(ctx, {
      imagenes,
      alElegirPestana: (valor) => actual.ctx.actualizarParametros({ pestana: valor === "recent" ? null : valor }),
      alPedirMas: () => cargarMas(actual),
    });
    const titulo = el("h1", { class: "ov-titulo", tabindex: "-1", "data-foco-inicial": "", texto: ctx.t("comun.shell.overview") });
    reemplazar(contenedor, el("div", { class: "ov-arriba" }, el("div", { class: "ov-cabecera" }, titulo), actual.agentes.nodo), actual.revisiones.nodo);
    estado = actual;
    dibujar(actual);

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
    estado.ctx = ctx;
    dibujar(estado);
    // Una pestaña que ya había sumado más vuelve con las que tenía: se pide con su límite (las nuevas se suman abajo).
    const pestana = pestanaDe(estado);
    if (estado.limites[pestana] > idsDePestana(estado.datos.overview, pestana).length && masDePestana(estado.datos.overview, pestana)) {
      pedir(estado);
    }
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
