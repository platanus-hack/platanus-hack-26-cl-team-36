// Overview (spec §3.3–§3.5, artboards 1–5): el inicio del backoffice. Arriba los agentes (un solo número, dividido
// por rol, con un cuadrito por corrida) y abajo las revisiones, con la página revisada como protagonista. El título
// "Overview" encabeza la página (h1, contrato §6.2) con el mismo formato que "Reviews".
//
// Estado en el hash: #/?dispositivo=mobile&pestana=failed (sin escribir all ni recent). Cambiar el filtro o la
// pestaña escribe el hash (ctx.actualizarParametros) y redibuja en actualizar(ctx), sin remontar ni mover el foco.
// En vivo: vuelve a pedir /api/resumen y /api/overview cada 5 s mientras la pestaña del navegador está visible; si
// la respuesta no cambió no toca nada, y si cambió reconcilia por tarjeta. Todo el tiempo sale de `ahora` de la API.

import { pedirOverview, pedirResumen } from "../nucleo/datos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { leerDispositivo, modeloDeAgentes } from "../overview/agentes.js";
import { escucharColores, imagenes } from "../overview/capturas.js";
import { crearBloqueDeAgentes } from "../overview/dom-agentes.js";
import { crearSeccionDeRevisiones } from "../overview/dom-revisiones.js";
import { leerPestana } from "../overview/tarjetas.js";

const INTERVALO = 5000;

/** Vista montada: { ctx, datos: { resumen, overview }, firma, error, reloj, pidiendo, pronto, dejarDeEscuchar, agentes, revisiones }. */
let estado = null;

const pedirTodo = () => Promise.all([pedirResumen(), pedirOverview()]);
const firmaDe = (resumen, overview) => JSON.stringify([resumen, overview]);

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
  actual.reloj = setTimeout(() => refrescar(actual), INTERVALO);
}

async function refrescar(actual) {
  if (estado !== actual || actual.pidiendo) return;
  actual.pidiendo = true;
  try {
    const [resumen, overview] = await pedirTodo();
    if (estado !== actual) return;
    const firma = firmaDe(resumen, overview);
    if (firma !== actual.firma || actual.error) {
      actual.firma = firma;
      actual.datos = { resumen, overview };
      actual.error = false;
      dibujar(actual);
    }
  } catch {
    if (estado !== actual) return;
    if (!actual.error) {
      // Se queda con lo último que llegó y avisa; el próximo intento sigue solo.
      actual.error = true;
      dibujar(actual);
    }
  } finally {
    actual.pidiendo = false;
    programar(actual);
  }
}

export default {
  titulo(ctx) {
    return ctx.t("comun.shell.overview");
  },

  async montar(contenedor, ctx) {
    const [[resumen, overview]] = await Promise.all([pedirTodo(), ctx.cargarEstilos("estilos/overview.css")]);
    // Si otra navegación reemplazó la vista mientras se pedían los datos, no se arma ni se programa nada.
    if (ctx.senal.aborted) return;
    contenedor.classList.add("p-overview");

    const actual = { ctx, datos: { resumen, overview }, firma: firmaDe(resumen, overview), error: false, reloj: 0, pidiendo: false, pronto: 0 };
    actual.dejarDeEscuchar = escucharColores(() => dibujarPronto(actual));
    // El ctx más nuevo (actualizar lo cambia) es el que escribe el hash.
    actual.agentes = crearBloqueDeAgentes(ctx, {
      alElegirDispositivo: (valor) => actual.ctx.actualizarParametros({ dispositivo: valor === "all" ? null : valor }),
    });
    actual.revisiones = crearSeccionDeRevisiones(ctx, {
      imagenes,
      alElegirPestana: (valor) => actual.ctx.actualizarParametros({ pestana: valor === "recent" ? null : valor }),
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
        else refrescar(actual);
      },
      { signal: ctx.senal },
    );
    programar(actual);
  },

  actualizar(ctx) {
    if (!estado) return false;
    estado.ctx = ctx;
    dibujar(estado);
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
