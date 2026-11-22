// Pestaña Mapa de caminos (diseño §10.5): a la izquierda el riel de trazas por interés (tanda/riel.js); al centro la
// telaraña viva (public/telarana/viva.js) con el estado final de la tanda; a la derecha su panel o, con una traza
// elegida, lo que la hace interesante y el enlace a sus pasos en Replay.
//
// El estado de la vista vive en el hash: intento= (la traza elegida, la misma clave del Replay) o pagina= (la página
// fijada). Un clic escribe el parámetro con ctx.actualizarParametros y actualizar(ctx) lo aplica: una sola fuente de
// verdad. Pasar sobre una fila del riel resalta su traza sin moverla; elegirla acerca la cámara a su camino.

import { el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { claveDePagina } from "../nucleo/url.js";
import { nombreDePagina } from "../datos/textos.js";
import { nombreConNivel } from "../datos/nombres.js";
import { crearRiel } from "../tanda/riel.js";
import { seleccion, vecina } from "../tanda/riel-estado.js";
import { detalleDeTraza, filasDeTrazas, resumenDeOtra, trazasDeLaTanda } from "../tanda/trazas.js";
import { eventosDeTanda, fuenteDeTanda, rutaDeTanda } from "../telarana/fuente-tanda.js";
import { montarTelaranaViva } from "../telarana/viva.js";

/** Página de la tanda (id) ↔ clave del componente, con las URL y títulos tal como los vieron los intentos. */
function clavesDePaginas(tanda) {
  const porId = new Map();
  for (const intento of tanda.intentos ?? []) {
    const primero = intento.pasos?.[0];
    if (primero?.paginaAntes && intento.inicio) porId.set(primero.paginaAntes, claveDePagina(intento.inicio.url, intento.inicio.titulo));
    for (const paso of intento.pasos ?? []) if (paso.pagina && !porId.has(paso.pagina)) porId.set(paso.pagina, claveDePagina(paso.url, paso.titulo));
  }
  for (const pagina of tanda.telarana?.paginas ?? []) if (!porId.has(pagina.id)) porId.set(pagina.id, claveDePagina(pagina.url, pagina.titulo));
  const porClave = new Map([...porId].map(([id, clave]) => [clave, id]));
  return { porId, porClave };
}

function crearPantalla(contenedor, ctx) {
  const { tanda, t } = ctx;
  const paginas = new Map((tanda.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const intentos = new Map((tanda.intentos ?? []).map((intento) => [`${tanda.id}|${intento.id}`, intento]));
  const runDe = (id) => `${tanda.id}|${id}`;
  const claves = clavesDePaginas(tanda);
  const trazas = trazasDeLaTanda(tanda, t);
  const estado = { avisos: [], profundidad: 0, vista: null, pagina: null, intento: null };

  contenedor.classList.add("p-telarana");
  const zonaDeAvisos = el("div", { class: "telarana-avisos" });
  const centro = el("div", { class: "telarana-anfitrion" });

  const elegir = (id) => ctx.actualizarParametros({ intento: id === estado.intento?.grupo.representante ? null : id, pagina: null });
  const riel = crearRiel({
    titulo: t("comun.traza.titulo"),
    orden: t("comun.traza.orden"),
    etiqueta: t("comun.traza.etiqueta"),
    filas: filasDeTrazas(trazas, t),
    senal: ctx.senal,
    alApuntar: (id) => {
      const grupo = id ? seleccion(trazas.grupos, id)?.grupo : null;
      estado.vista?.apuntarAgente(grupo ? grupo.intentos.map((intento) => runDe(intento.id)) : null);
    },
    alElegir: elegir,
    otras: { titulo: t("comun.traza.otrasTandas"), tanda, pestana: "telarana", resumen: resumenDeOtra(ctx.tandas), fecha: (iso) => ctx.fmt.fechaCorta(iso) },
  });
  reemplazar(contenedor, zonaDeAvisos, el("div", { class: "tanda-columnas" }, riel.nodo, centro));

  function montarVista() {
    estado.vista = montarTelaranaViva(centro, {
      ruta: rutaDeTanda(tanda),
      fuente: fuenteDeTanda(tanda),
      repetir: () => fuenteDeTanda(tanda, { reproducir: true }),
      i18n: { t },
      nombre: (n) => {
        const pagina = paginas.get(claves.porClave.get(n.clave));
        return pagina ? nombreDePagina(pagina, t) : n.titulo || n.url;
      },
      nombreDeIntento: (run, perfil) => nombreConNivel(intentos.get(run)?.nombrePerfil ?? perfil, t),
      enlaceAReplay: (run, paso) => (intentos.has(run) ? ctx.enlace("replay", { intento: intentos.get(run).id, paso }) : null),
      alFijar: (clave) => {
        const id = clave ? claves.porClave.get(clave) : null;
        // Una página que la tanda no conoce se fija igual, pero no tiene cómo ir al hash.
        if (clave && !id) return;
        ctx.actualizarParametros({ pagina: id, intento: null });
        if (id) ctx.anunciar(t("telarana.panel.elegida", { nombre: nombreDePagina(paginas.get(id), t) }));
      },
      alElegir: (run) => ctx.actualizarParametros({ intento: run ? (intentos.get(run)?.id ?? null) : null, pagina: null }),
      detalleDeAgente: () =>
        estado.intento
          ? detalleDeTraza(estado.intento, trazas, {
              t,
              enlaceAReplay: (id) => ctx.enlace("replay", { intento: id }),
              alQuitar: () => ctx.actualizarParametros({ intento: null }),
            })
          : null,
    });
  }

  function reescribir(cambios) {
    estado.profundidad += 1;
    try {
      ctx.actualizarParametros(cambios);
    } finally {
      estado.profundidad -= 1;
    }
  }

  function aplicar(parametros) {
    if (estado.profundidad === 0) estado.avisos = [];
    const pagina = parametros.pagina ?? null;
    if (pagina) {
      const canonica = tanda.telarana?.alias?.[pagina] ?? pagina;
      if (!paginas.has(canonica) || !claves.porId.has(canonica)) {
        estado.avisos.push(t("comun.estado.paginaNoExiste", { pagina }));
        return reescribir({ pagina: null });
      }
      if (canonica !== pagina) return reescribir({ pagina: canonica });
    }
    const elegida = seleccion(trazas.grupos, parametros.intento ?? null);
    if (parametros.intento && !elegida) {
      estado.avisos.push(t("comun.estado.trazaNoExiste", { intento: parametros.intento }));
      return reescribir({ intento: null });
    }
    estado.intento = elegida;
    estado.pagina = elegida ? null : pagina;
    riel.marcar(elegida?.grupo.representante ?? null);
    if (elegida) estado.vista?.elegirAgente(runDe(elegida.intento.id), elegida.grupo.intentos.map((intento) => runDe(intento.id)));
    else {
      estado.vista?.elegirAgente(null);
      estado.vista?.fijar(estado.pagina ? claves.porId.get(estado.pagina) : null);
    }
    reemplazar(zonaDeAvisos, estado.avisos.map((texto) => avisoEnLinea(texto, "atencion")));
    return true;
  }

  const mover = (delta) => {
    const id = vecina(trazas.grupos, estado.intento?.grupo.representante ?? null, delta);
    if (id) ctx.actualizarParametros({ intento: id, pagina: null });
  };
  ctx.atajos.registrar({
    "+": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => estado.vista?.acercar() },
    "-": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => estado.vista?.alejar() },
    0: { descripcion: () => t("comun.atajos.desc.ajustar"), accion: () => estado.vista?.ajustar() },
    ArrowDown: { descripcion: () => t("comun.atajos.desc.trazas"), accion: () => mover(1) },
    ArrowUp: { descripcion: () => t("comun.atajos.desc.trazas"), accion: () => mover(-1) },
  });

  return {
    async montar() {
      await ctx.cargarEstilos("estilos/telarana.css");
      // Si otra navegación reemplazó la vista mientras cargaba el CSS, no se arma nada.
      if (ctx.senal.aborted) return;
      if (eventosDeTanda(tanda).length) montarVista();
      else reemplazar(centro, vacio({ titulo: t("telarana.lienzo.vacio") }));
      aplicar(ctx.parametros);
    },
    actualizar(nuevo) {
      return aplicar(nuevo.parametros) !== false;
    },
    /** Esc cierra la leyenda y suelta la traza o la página antes de cerrar la hoja. */
    escapar() {
      if (estado.vista?.cerrarAyuda()) return true;
      if (estado.intento) {
        ctx.actualizarParametros({ intento: null });
        return true;
      }
      if (!estado.pagina) return false;
      estado.vista?.soltar();
      return true;
    },
    desmontar() {
      estado.vista?.desmontar();
      estado.vista = null;
    },
  };
}

let pantalla = null;

export default {
  titulo: (ctx) => ctx.t("comun.pestana.telarana"),
  async montar(contenedor, ctx) {
    pantalla = crearPantalla(contenedor, ctx);
    await pantalla.montar();
  },
  actualizar(ctx) {
    return pantalla ? pantalla.actualizar(ctx) : false;
  },
  escapar() {
    return pantalla?.escapar() ?? false;
  },
  desmontar() {
    pantalla?.desmontar();
    pantalla = null;
  },
};
