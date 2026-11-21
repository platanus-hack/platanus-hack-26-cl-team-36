// Pestaña Perfiles (diseño §8 WP5, §10.7): compara los perfiles de una tanda sin radares. Arriba, el titular y la
// nota de honestidad (con 1 intento por perfil son conteos, no tasas); después cuatro bloques: resultado (un punto
// por intento), dónde avanza cada perfil (perfiles × hitos de la ruta), métricas (puntos con escala por columna) e
// intentos (tabla ordenable). Toda marca, celda, punto y fila abre el Replay en un paso con sentido.

import { conservarFoco, el } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { textoDeTitular } from "../datos/textos.js";
import { parsearOrden, siguienteOrden, textoDeOrden, unoPorPerfil } from "../perfiles/escalas.js";
import { graficoDePuntos, graficoDeUnidades, mapaDeHitos } from "../perfiles/graficos.js";
import { tablaDeIntentos } from "../perfiles/tabla.js";

/** Estado de la pestaña montada. */
let estado = null;

function bloque(id, ctx, ...contenido) {
  const tituloId = `perfiles-${id}-titulo`;
  return el(
    "section",
    { class: `seccion perfiles-bloque perfiles-bloque-${id}`, "aria-labelledby": tituloId },
    el(
      "header",
      { class: "perfiles-bloque-cabecera" },
      el("h3", { id: tituloId, class: "etiqueta-micro", texto: ctx.t(`perfiles.bloque.${id}.titulo`) }),
      el("p", { class: "perfiles-ayuda", texto: ctx.t(`perfiles.bloque.${id}.ayuda`) }),
    ),
    contenido,
  );
}

/** Mueve el foco a la fila siguiente (+1) o anterior (−1) de la tabla; sin foco en la tabla, a la primera. */
function moverFila(direccion) {
  const raiz = estado?.contenedor;
  if (!raiz) return;
  const enlaces = [...raiz.querySelectorAll("a.perfiles-fila-enlace")];
  if (!enlaces.length) return;
  const actual = enlaces.findIndex((enlace) => enlace.closest("tr")?.contains(document.activeElement));
  const destino = actual === -1 ? (direccion > 0 ? 0 : enlaces.length - 1) : Math.min(enlaces.length - 1, Math.max(0, actual + direccion));
  enlaces[destino].focus();
  enlaces[destino].scrollIntoView({ block: "nearest" });
}

function abrirFilaEnfocada() {
  const fila = document.activeElement?.closest?.("tr.perfiles-fila");
  const enlace = fila && estado?.contenedor.contains(fila) ? fila.querySelector("a.perfiles-fila-enlace") : null;
  if (enlace) estado.ctx.navegar(enlace.getAttribute("href"));
}

function ordenar(columna) {
  if (!estado) return;
  const nuevo = siguienteOrden(estado.orden, columna);
  estado.ctx.actualizarParametros({ orden: textoDeOrden(nuevo) });
}

function anunciarOrden(ctx, orden) {
  if (!orden) return;
  const columna = ctx.t(`perfiles.tabla.columna.${orden.columna}`);
  ctx.anunciar(ctx.t(orden.descendente ? "perfiles.tabla.ordenDescendente" : "perfiles.tabla.ordenAscendente", { columna }));
}

export default {
  titulo(ctx) {
    return ctx.t("comun.pestana.perfiles");
  },

  async montar(contenedor, ctx) {
    contenedor.classList.add("p-perfiles");
    await ctx.cargarEstilos("estilos/perfiles.css");
    const { tanda, t } = ctx;

    if (!tanda?.intentos?.length) {
      contenedor.append(vacio({ titulo: t("perfiles.vacio.sinIntentos") }));
      return;
    }

    const orden = parsearOrden(ctx.parametros.orden);
    estado = { contenedor, ctx, orden, tabla: null };

    const titular = tanda.titulares?.perfiles ? textoDeTitular(tanda.titulares.perfiles, tanda, t) : t("comun.pestana.perfiles");
    const hayRuta = !!tanda.telarana?.ruta?.paginas?.length;
    const sinValidos = (tanda.perfiles ?? []).some((perfil) => (perfil.validos ?? 0) === 0);

    const mapa = hayRuta ? mapaDeHitos(tanda, ctx) : null;
    const puntos = graficoDePuntos(tanda, ctx);
    estado.tabla = tablaDeIntentos(tanda, orden, ctx, ordenar);

    contenedor.append(
      el(
        "header",
        { class: "perfiles-cabecera" },
        el("h2", { class: "perfiles-titular", tabindex: "-1", "data-foco-inicial": "", texto: titular }),
        unoPorPerfil(tanda) ? avisoEnLinea(t("perfiles.nota.unIntento", { sinValidos: sinValidos ? 1 : 0 })) : null,
        hayRuta ? null : avisoEnLinea(t("perfiles.nota.sinRuta"), "atencion"),
      ),
      bloque("resultado", ctx, graficoDeUnidades(tanda, ctx)),
      mapa ? bloque("hitos", ctx, mapa) : null,
      puntos ? bloque("metricas", ctx, puntos) : null,
      bloque("intentos", ctx, estado.tabla.raiz),
    );

    ctx.atajos.registrar({
      j: { descripcion: () => t("comun.atajos.desc.filas"), accion: () => moverFila(1) },
      k: { descripcion: () => t("comun.atajos.desc.filas"), accion: () => moverFila(-1) },
      // Enter sobre un enlace ya lo abre el navegador; esto cubre el foco en una fila (y lo lista en la hoja "?").
      Enter: { descripcion: () => t("comun.atajos.desc.abrirEnReplay"), accion: abrirFilaEnfocada },
    });
  },

  actualizar(ctx) {
    if (!estado?.tabla || !estado.contenedor.isConnected) return false;
    estado.ctx = ctx;
    const orden = parsearOrden(ctx.parametros.orden);
    if (textoDeOrden(orden) !== textoDeOrden(estado.orden)) {
      estado.orden = orden;
      conservarFoco(estado.contenedor, () => estado.tabla.actualizar(orden));
      anunciarOrden(ctx, orden);
    }
    return true;
  },

  desmontar() {
    estado = null;
  },
};
