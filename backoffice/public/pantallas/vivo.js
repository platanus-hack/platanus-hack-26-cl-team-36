// En vivo (#/revisiones/<revision>/<goal>): la telaraña viva (public/telarana/viva.js) de un goal mientras corre su
// revisión, alimentada por el SSE de api/vivo (telarana/fuente-sse.js). Se monta cuando llegó lo conocido al
// conectar (o al tope de fuenteSSE), así el histórico se dibuja de una vez y solo se anima lo nuevo. Al terminar el
// Visitante ofrece su tanda. "No existe" solo cuando la revisión respondió y el goal no está; un corte de la
// transmisión deja la vista con un aviso y «Reintentar».

import { pedirRevision } from "../nucleo/datos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, esqueleto, vacio } from "../nucleo/estados.js";
import { ocultarGlobo } from "../nucleo/globo.js";
import { cargarSeccion } from "../nucleo/i18n.js";
import { icono } from "../nucleo/iconos.js";
import { enlaceARevision, enlaceATanda } from "../nucleo/rutas.js";
import { nombreConNivel } from "../datos/nombres.js";
import { estadoDelVivo, tandaDelGoal } from "../datos/vivo.js";
import { fuenteSSE } from "../telarana/fuente-sse.js";
import { montarTelaranaViva } from "../telarana/viva.js";

// Tras `fin`, la proyectora tarda unos segundos en anotar la tanda: se vuelve a leer la revisión hasta tenerla.
const REINTENTO_MS = 3000;
const REINTENTOS = 10;
const INDICADOR = {
  conectando: { tono: "neutro", icono: "proximamente", clave: "conectando" },
  "en-vivo": { tono: "acento", icono: "reproducir", clave: "enVivo" },
  reconectando: { tono: "aviso", icono: "proximamente", clave: "reconectando" },
  terminado: { tono: "logrado", icono: "logrado", clave: "terminado" },
  error: { tono: "fallido", icono: "error-visible", clave: "error" },
};

function crearPantalla(contenedor, ctx) {
  const { t } = ctx;
  const { revision, goal } = ctx.ruta;
  const estado = { fuente: null, vista: null, avance: null, reloj: null, reintentos: 0, vivo: true };
  const delGoal = () => estado.avance?.goals?.find((g) => g.goal === goal) ?? null;

  contenedor.classList.add("p-vivo");
  const indicador = el("span", { class: "vivo-indicador", role: "status" });
  const meta = el("p", { class: "vivo-meta texto-3" });
  const zonaDeFin = el("div", { class: "vivo-fin" });
  const cuerpo = el("div", { class: "vivo-cuerpo" }, esqueleto("lienzo"));
  const cabecera = el("header", { class: "vivo-cabecera" }, el("h1", { tabindex: "-1", "data-foco-inicial": "", texto: t("vivo.titulo", { goal }) }), indicador);
  reemplazar(
    contenedor,
    el("nav", { class: "vivo-migas", "aria-label": t("comun.shell.revisiones") }, el("a", { href: enlaceARevision(), texto: t("comun.shell.revisiones") }), " / ", el("a", { class: "mono", href: enlaceARevision(revision), texto: revision })),
    cabecera,
    meta,
    zonaDeFin,
    cuerpo,
  );

  function pintarMeta() {
    reemplazar(meta, estado.avance?.host ? el("span", { texto: estado.avance.host }) : null, el("code", { texto: `${revision} / ${goal}` }), el("span", { texto: t("vivo.subtitulo") }));
  }

  function pintarEstado() {
    const actual = estadoDelVivo(estado.fuente?.estado, delGoal());
    const { tono, icono: nombre, clave } = INDICADOR[actual];
    indicador.className = `vivo-indicador insignia insignia-${tono}${actual === "en-vivo" ? " vivo-latiendo" : ""}`;
    reemplazar(indicador, icono(nombre), el("span", { texto: t(`vivo.estado.${clave}`) }));
    pintarFin(actual);
  }

  function pintarFin(actual) {
    // Antes de montar la vista no hay a qué reintentar: montar() pinta de nuevo al terminar.
    if (!estado.vista) return reemplazar(zonaDeFin);
    if (actual === "error") {
      // Se arma una vez: rehacerlo en cada relectura le quitaría el foco al botón.
      if (!zonaDeFin.querySelector(".vivo-reintentar")) {
        reemplazar(
          zonaDeFin,
          el(
            "div",
            { class: "vivo-aviso" },
            avisoEnLinea(t("vivo.sinConexion"), "atencion"),
            el("button", { type: "button", class: "boton boton-secundario vivo-reintentar", texto: t("comun.accion.reintentar"), onclick: reintentar }),
          ),
        );
      }
      // Un 204 o un 503 al reconectar a un goal que ya cerró: la revisión dice si en realidad terminó.
      if (estado.reintentos < REINTENTOS) releer();
      return;
    }
    if (actual !== "terminado") return reemplazar(zonaDeFin);
    const tanda = tandaDelGoal(delGoal());
    if (tanda) {
      return reemplazar(
        zonaDeFin,
        el(
          "div",
          { class: "vivo-aviso tarjeta" },
          el("span", { class: "texto-2", texto: t("vivo.terminado.conTanda") }),
          el("a", { class: "boton", href: enlaceATanda(tanda, "telarana"), texto: t("vivo.terminado.verTanda") }),
        ),
      );
    }
    const visitante = delGoal()?.visitor?.estado;
    const esperando = visitante !== "failed" && visitante !== "skipped" && estado.reintentos < REINTENTOS;
    reemplazar(zonaDeFin, avisoEnLinea(t(esperando ? "vivo.terminado.esperandoTanda" : "vivo.terminado.sinTanda")));
    if (esperando) releer();
  }

  // Lee la revisión otra vez (una sola lectura pendiente a la vez) para saber cómo cerró el Visitante y su tanda.
  function releer() {
    if (estado.reloj || !estado.vivo) return;
    estado.reloj = setTimeout(async () => {
      estado.reintentos += 1;
      try {
        const avance = await pedirRevision(revision);
        if (avance) estado.avance = avance;
      } catch {
        // Se reintenta en la próxima vuelta.
      }
      estado.reloj = null;
      if (estado.vivo) pintarEstado();
    }, REINTENTO_MS);
  }

  function conectar() {
    // fuenteSSE avisa «conectando» antes de devolver la fuente; los avisos de una fuente reemplazada se ignoran.
    const vigente = () => !estado.fuente || estado.fuente === fuente;
    estado.fuente = null;
    const fuente = fuenteSSE(revision, goal, {
      alRuta: (ruta) => vigente() && estado.vista?.ponerRuta(ruta),
      alEstado: () => vigente() && pintarEstado(),
    });
    estado.fuente = fuente;
    return fuente;
  }

  // Una fuente nueva; cuando llega lo conocido, reemplaza a la cortada (el componente rehace el estado sin animar).
  async function reintentar() {
    estado.fuente?.cerrar();
    estado.reintentos = 0;
    const fuente = conectar();
    pintarEstado();
    await fuente.listo;
    if (!estado.vivo || estado.fuente !== fuente) return;
    estado.vista.cambiarFuente(fuente);
    pintarEstado();
  }

  function montarVista(fuente) {
    estado.vista = montarTelaranaViva(cuerpo, {
      ruta: fuente.ruta ?? [],
      titulo: goal,
      fuente,
      i18n: { t },
      nombreDeIntento: (run, perfil) => nombreConNivel(perfil, t),
    });
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
      // Se conecta mientras cargan los estilos y la revisión: lo que llegue antes de montar se dibuja sin animar.
      const fuente = conectar();
      const [lectura] = await Promise.all([
        pedirRevision(revision).then(
          (avance) => ({ avance }),
          () => ({ avance: null, fallo: true }),
        ),
        ctx.cargarEstilos("estilos/telarana.css"),
        ctx.cargarEstilos("estilos/vivo.css"),
        cargarSeccion("telarana"),
        fuente.listo,
      ]);
      if (ctx.senal.aborted || !estado.vivo) return fuente.cerrar();
      estado.avance = lectura.avance;
      // pedirRevision da null con un 404: la revisión o el goal no existen de verdad.
      if (!lectura.fallo && !delGoal()) {
        fuente.cerrar();
        cabecera.hidden = true;
        meta.hidden = true;
        return reemplazar(
          cuerpo,
          vacio({ titulo: t("vivo.noExiste", { goal, revision }), nivel: 1, accion: { texto: t("vivo.volver"), href: enlaceARevision(revision) } }),
        );
      }
      pintarMeta();
      montarVista(estado.fuente);
      pintarEstado();
    },
    desmontar() {
      estado.vivo = false;
      clearTimeout(estado.reloj);
      estado.vista?.desmontar();
      estado.fuente?.cerrar();
      estado.vista = null;
    },
  };
}

let pantalla = null;

export default {
  titulo: (ctx) => ctx.t("vivo.titulo", { goal: ctx.ruta.goal }),
  async montar(contenedor, ctx) {
    pantalla = crearPantalla(contenedor, ctx);
    await pantalla.montar();
  },
  actualizar() {
    return pantalla !== null;
  },
  desmontar() {
    pantalla?.desmontar();
    pantalla = null;
  },
};
