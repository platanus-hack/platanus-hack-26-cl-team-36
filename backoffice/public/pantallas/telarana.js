// Pestaña Telaraña (diseño §10.5): la telaraña viva (public/telarana/viva.js) con el estado final de la tanda; el
// botón Reproducir la anima a la velocidad real. Los enlaces del panel abren Replay en el intento y el paso.
//
// El estado de la vista vive en el hash: pagina= (la página fijada). Un clic en una página escribe el parámetro con
// ctx.actualizarParametros y actualizar(ctx) lo aplica: una sola fuente de verdad.

import { el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, vacio } from "../nucleo/estados.js";
import { ocultarGlobo } from "../nucleo/globo.js";
import { claveDePagina } from "../nucleo/url.js";
import { nombreDePagina, textoDeTitular } from "../datos/textos.js";
import { nombreConNivel } from "../datos/nombres.js";
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
  const claves = clavesDePaginas(tanda);
  const estado = { avisos: [], profundidad: 0, vista: null };

  contenedor.classList.add("p-telarana");
  const titular = el("h2", { class: "telarana-titular", tabindex: "-1", "data-foco-inicial": "", texto: textoDeTitular(tanda.titulares?.telarana, tanda, t) });
  const zonaDeAvisos = el("div", { class: "telarana-avisos" });
  const cuerpo = el("div", { class: "telarana-cuerpo" });
  reemplazar(contenedor, el("header", { class: "telarana-cabecera" }, titular, zonaDeAvisos), cuerpo);

  function montarVista() {
    estado.vista = montarTelaranaViva(cuerpo, {
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
        ctx.actualizarParametros({ pagina: id });
        if (id) ctx.anunciar(t("telarana.panel.elegida", { nombre: nombreDePagina(paginas.get(id), t) }));
      },
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
    estado.vista?.fijar(pagina ? claves.porId.get(pagina) : null);
    reemplazar(zonaDeAvisos, estado.avisos.map((texto) => avisoEnLinea(texto, "atencion")));
    return true;
  }

  ctx.atajos.registrar({
    "+": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => estado.vista?.acercar() },
    "-": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => estado.vista?.alejar() },
    0: { descripcion: () => t("comun.atajos.desc.ajustar"), accion: () => estado.vista?.ajustar() },
    Escape: {
      descripcion: () => t("comun.atajos.desc.cerrar"),
      accion: () => {
        if (ocultarGlobo()) return;
        estado.vista?.soltar();
      },
    },
  });

  return {
    async montar() {
      await ctx.cargarEstilos("estilos/telarana.css");
      // Si otra navegación reemplazó la vista mientras cargaba el CSS, no se arma nada.
      if (ctx.senal.aborted) return;
      if (eventosDeTanda(tanda).length) montarVista();
      else reemplazar(cuerpo, vacio({ titulo: t("telarana.lienzo.vacio") }));
      aplicar(ctx.parametros);
    },
    actualizar(nuevo) {
      return aplicar(nuevo.parametros) !== false;
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
  desmontar() {
    pantalla?.desmontar();
    pantalla = null;
  },
};
