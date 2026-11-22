// En vivo (#/revisiones/<revision>/<goal>): un goal de una revisión que todavía corre, en la hoja (marco en
// nucleo/marco-tanda.js, montarMarcoEnVivo), como el Path map de una tanda terminada. A la izquierda, el riel con los
// goals de la revisión (el que corre late; uno con tanda lleva a su Path map); al centro, la telaraña viva
// (public/telarana/viva.js) alimentada por el SSE de api/vivo (telarana/fuente-sse.js). Se monta cuando llegó lo
// conocido al conectar (o al tope de fuenteSSE), así el histórico se dibuja de una vez y solo se anima lo nuevo. La
// pastilla de la cabecera dice cómo va la transmisión; al terminar el Visitante, arriba del mapa aparece su tanda.
// "No existe" solo cuando la revisión respondió y el goal no está; un corte de la transmisión deja la vista con un
// aviso y «Reintentar».

import { pedirRevision } from "../nucleo/datos.js";
import { el, reemplazar } from "../nucleo/dom.js";
import { avisoEnLinea, esqueleto, vacio } from "../nucleo/estados.js";
import { ocultarGlobo } from "../nucleo/globo.js";
import { cargarSeccion } from "../nucleo/i18n.js";
import { enlaceARevision, enlaceATanda, enlaceAVivo } from "../nucleo/rutas.js";
import { nombreConNivel } from "../datos/nombres.js";
import { estadoDelVivo, filaDeGoal, tandaDelGoal } from "../datos/vivo.js";
import { crearRiel } from "../tanda/riel.js";
import { fuenteSSE } from "../telarana/fuente-sse.js";
import { montarTelaranaViva } from "../telarana/viva.js";

// Tras `fin`, la proyectora tarda unos segundos en anotar la tanda: se vuelve a leer la revisión hasta tenerla.
const REINTENTO_MS = 3000;
const REINTENTOS = 10;
// El riel de goals se refresca con la revisión mientras la hoja está abierta.
const REFRESCO_MS = 8000;
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
  const estado = { fuente: null, vista: null, avance: null, reloj: null, refresco: null, reintentos: 0, vivo: true, riel: null, firmaDelRiel: null, fijado: false };
  const delGoal = () => estado.avance?.goals?.find((g) => g.goal === goal) ?? null;

  contenedor.classList.add("p-telarana", "p-vivo");
  const zonaDeFin = el("div", { class: "telarana-avisos" });
  const lado = el("div", { class: "vivo-riel" });
  const centro = el("div", { class: "telarana-anfitrion" }, esqueleto("lienzo"));
  reemplazar(contenedor, zonaDeFin, el("div", { class: "tanda-columnas" }, lado, centro));

  /** El riel de goals; se rehace solo si cambió algo de lo que muestra. */
  function pintarRiel() {
    const goals = estado.avance?.goals ?? [];
    const filas = goals.map((cada) => filaDeGoal(cada, t));
    const firma = JSON.stringify(filas);
    if (firma === estado.firmaDelRiel) return;
    estado.firmaDelRiel = firma;
    estado.riel = crearRiel({
      titulo: t("vivo.riel.titulo"),
      orden: ctx.fmt.numero(goals.length),
      etiqueta: t("vivo.riel.titulo"),
      filas,
      senal: ctx.senal,
      alElegir: (id) => {
        if (id === goal) return;
        const tanda = tandaDelGoal(goals.find((cada) => cada.goal === id));
        ctx.navegar(tanda ? enlaceATanda(tanda, "telarana") : enlaceAVivo(revision, id));
      },
    });
    reemplazar(lado, estado.riel.nodo);
    estado.riel.marcar(goal);
  }

  function pintarEstado() {
    const actual = estadoDelVivo(estado.fuente?.estado, delGoal());
    const { tono, icono, clave } = INDICADOR[actual];
    ctx.marco?.ponerEstado({ tono, icono, texto: t(`vivo.estado.${clave}`), latiendo: actual === "en-vivo" });
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
      if (estado.vivo) {
        pintarRiel();
        pintarEstado();
      }
    }, REINTENTO_MS);
  }

  // Mientras la pestaña del navegador se ve, el riel sigue a los demás goals.
  function refrescar() {
    if (!estado.vivo) return;
    estado.refresco = setTimeout(async () => {
      if (document.visibilityState === "visible") {
        try {
          const avance = await pedirRevision(revision);
          if (avance && estado.vivo) {
            estado.avance = avance;
            pintarRiel();
            pintarEstado();
          }
        } catch {
          // La próxima vuelta lo intenta de nuevo.
        }
      }
      refrescar();
    }, REFRESCO_MS);
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
    estado.vista = montarTelaranaViva(centro, {
      ruta: fuente.ruta ?? [],
      fuente,
      i18n: { t },
      nombreDeIntento: (run, perfil) => nombreConNivel(perfil, t),
      // Lo que está fijado o elegido en el mapa: Esc lo suelta antes de cerrar la hoja.
      alFijar: (clave) => {
        estado.fijado = !!clave;
      },
      alElegir: (run) => {
        estado.fijado = !!run;
      },
    });
  }

  ctx.atajos.registrar({
    "+": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => estado.vista?.acercar() },
    "-": { descripcion: () => t("comun.atajos.desc.zoom"), accion: () => estado.vista?.alejar() },
    0: { descripcion: () => t("comun.atajos.desc.ajustar"), accion: () => estado.vista?.ajustar() },
  });

  return {
    async montar() {
      // Se conecta mientras cargan los estilos y la revisión: lo que llegue antes de montar se dibuja sin animar.
      const fuente = conectar();
      pintarEstado();
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
        return reemplazar(
          contenedor,
          vacio({ titulo: t("vivo.noExiste", { goal, revision }), nivel: 2, accion: { texto: t("vivo.volver"), href: enlaceARevision(revision) } }),
        );
      }
      if (estado.avance?.host) ctx.marco?.ponerRevision({ host: estado.avance.host, url: estado.avance.url ?? null });
      pintarRiel();
      montarVista(estado.fuente);
      pintarEstado();
      refrescar();
    },
    /** Esc cierra la leyenda o suelta la página fijada antes de cerrar la hoja. */
    escapar() {
      if (ocultarGlobo()) return true;
      if (estado.vista?.cerrarAyuda()) return true;
      if (!estado.fijado) return false;
      estado.fijado = false;
      estado.vista?.soltar();
      return true;
    },
    desmontar() {
      estado.vivo = false;
      clearTimeout(estado.reloj);
      clearTimeout(estado.refresco);
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
  escapar() {
    return pantalla?.escapar() ?? false;
  },
  desmontar() {
    pantalla?.desmontar();
    pantalla = null;
  },
};
