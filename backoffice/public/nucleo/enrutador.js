// Enrutador por hash y contrato de las pantallas (diseño §5.2).
//
// Cada pantalla (public/pantallas/<id>.js) exporta por defecto { titulo(ctx), cargar?(ctx) → datos,
// montar(contenedor, ctx, datos), actualizar?(ctx) → boolean, desmontar?() }. El enrutador la carga con import() y
// espera su sección del diccionario antes de montarla; si el archivo todavía no existe, muestra "Esta vista todavía no
// está lista".
//
// Por navegación: (1) parsear (enlaces viejos → redirigir), (2) cargar datos con esqueleto a los 150 ms: la lista o
// la tanda, y lo que pida cargar(ctx) de la pantalla (el Overview, Revisiones y la Propuesta traen sus propios datos);
// (3) dentro de conTransicion desmontar y montar con esos datos (montar no espera la red: durante la transición la
// página está congelada), (4) foco (§5.4), (5) evento `backoffice:ruta`. Si solo cambia la pestaña, el marco se queda
// y se cambia el panel. Si solo cambian parámetros, no se remonta. Cuando una pantalla se remonta sin pasar por aquí
// (Reintentar, un actualizar que devuelve false), montar recibe datos undefined y los pide ella, con su esqueleto.
//
// Una tanda se abre en una hoja sobre la vista de la que vino, que queda montada debajo (nucleo/hoja.js): la hoja
// aparece al instante con el título y un esqueleto, y volver a esa vista cierra la hoja sin remontar nada.

import { avisar, anunciar } from "./avisos.js";
import { pedirTanda, pedirTandas, urlDeArchivo } from "./datos.js";
import { cargarEstilos, el, reemplazar } from "./dom.js";
import { conCarga, errorDePantalla, esqueleto, vacio } from "./estados.js";
import { EVENTO_IDIOMA, IDIOMAS, cambiarIdioma, cargarSeccion, fmt, idioma, t } from "./i18n.js";
import { registrarAtajos } from "./atajos.js";
import { abrirHoja } from "./hoja.js";
import { montarMarco } from "./marco-tanda.js";
import { NOMBRES_DE_PESTANA, enlaceATanda, extraerIdioma, hashDe, origenDeHoja, parsearHash } from "./rutas.js";
import { conTransicion } from "./transiciones.js";

export const EVENTO_RUTA = "backoffice:ruta";

/** El esqueleto de una vista entera mientras carga, con su geometría (estados.js). */
function esqueletoDeVista(ruta) {
  if (ruta.tipo === "tanda") return "tanda";
  if (ruta.tipo === "overview") return "overview";
  if (ruta.tipo === "revisiones") return ruta.revision ? "tabla" : "revisiones";
  return "lista";
}

// Corridas y la tanda trabajan sobre la lista de tandas y la esperan. El Overview y Revisiones traen sus propios
// datos: no esperan /api/tandas (que con S3 tarda) y la usan si ya llegó; mientras, la lista se carga en segundo plano.
const ESPERAN_LA_LISTA = new Set(["corridas", "tanda"]);
// Vistas cuyos parámetros cambian sin remontar (actualizarParametros → actualizar(ctx) de la pantalla).
const CON_PARAMETROS = new Set(["overview", "corridas", "tanda", "revisiones"]);
// Título de respaldo de una vista sin título propio.
const TITULO_DE_VISTA = { overview: "comun.shell.overview", corridas: "comun.shell.corridas", revisiones: "comun.shell.revisiones" };

const irACorridas = () => ({ texto: t("comun.accion.irACorridas"), href: hashDe({ tipo: "corridas" }) });

let raiz = null;
/** @type {import("./rutas.js").Ruta | null} */
let ruta = null;
/** Vista montada: { tipo, id, ruta, modulo, contenedor, controlador, quitar[], tanda?, tandaId?, marco?, pestana? } */
let vista = null;
let turno = 0;
/** Turno de la navegación que todavía no fija `ruta` (0 si no hay): mientras tanto no se reescribe la URL. */
let navegando = 0;
let hashMostrado = null;
let cambiandoIdiomaDesdeHash = false;
const desplazamientos = new Map();
let listaDeTandas = { carpeta: null, tandas: [] };
/** La hoja de la tanda abierta: { hoja, fondo (la vista de debajo, montada) | null, volver: { clave, hash }, abridor }. */
let hojaAbierta = null;
/** El último enlace interno con clic: el que abrió la hoja, para devolverle el foco al cerrarla. */
let ultimoEnlace = null;
/** El desmontaje de la pantalla que sale con la hoja: espera a que termine su animación (o a la próxima pantalla). */
let diferido = null;

// ── Pantallas ──────────────────────────────────────────────────────────────

function pantallaPendiente(id) {
  return {
    pendiente: true,
    titulo: () => (NOMBRES_DE_PESTANA[id] ? t(NOMBRES_DE_PESTANA[id]) : t(`comun.shell.${id}`)),
    montar(contenedor) {
      contenedor.classList.add("vista-pendiente");
      contenedor.append(
        vacio({ titulo: t("comun.vista.noLista"), texto: t("comun.vista.noListaTexto"), nivel: NOMBRES_DE_PESTANA[id] ? 2 : 1, icono: "proximamente" }),
      );
    },
  };
}

const modulos = new Map();

/** Carga el módulo de una pantalla y su sección del diccionario. Nunca lanza: si falta, devuelve el aviso. */
function cargarPantalla(id) {
  if (!modulos.has(id)) {
    const promesa = import(`../pantallas/${id}.js`)
      .then((modulo) => {
        const pantalla = modulo.default;
        if (!pantalla || typeof pantalla.montar !== "function") throw new Error(`pantallas/${id}.js no exporta { montar }`);
        return pantalla;
      })
      .catch((error) => {
        console.warn(`enrutador: la pantalla «${id}» no está lista; se muestra el aviso.`, error?.message ?? error);
        modulos.delete(id); // se reintenta en la próxima navegación (puede aparecer mientras corre el servidor)
        return pantallaPendiente(id);
      });
    modulos.set(id, promesa);
  }
  return Promise.all([modulos.get(id), cargarSeccion(id)]).then(([pantalla]) => pantalla);
}

// ── Contexto que recibe cada pantalla ─────────────────────────────────────

// Las capturas están en la carpeta del intento (`desktop-2`), no en la de su perfil.
function carpetaDeIntento(tanda, intentoId) {
  return tanda?.intentos?.find((intento) => intento.id === intentoId)?.carpeta ?? intentoId;
}

function crearContexto(v) {
  const tandaId = v.tandaId ?? null;
  const controlador = v.controlador;
  // Una pantalla ya reemplazada (o a punto de serlo) no toca la URL ni registra atajos: su reloj o una tecla
  // durante una navegación pendiente escribirían el hash viejo encima del nuevo.
  const vigente = () => !controlador.signal.aborted && vista === v && v.ruta === ruta && !navegando;
  return {
    ruta: v.ruta,
    parametros: { ...(v.ruta.parametros ?? {}) },
    tandas: listaDeTandas.tandas,
    carpeta: listaDeTandas.carpeta,
    tanda: v.tanda ?? null,
    pestana: v.pestana ?? null,
    urlDeArchivo: (intentoId, archivo) => urlDeArchivo(tandaId, carpetaDeIntento(v.tanda, intentoId), archivo),
    // En una tanda, el enlace a una de sus pestañas; fuera de ella, a esta misma vista con otros parámetros.
    enlace: (pestana, parametros = {}) =>
      tandaId ? enlaceATanda(tandaId, pestana, parametros) : hashDe({ tipo: v.ruta.tipo, revision: v.ruta.revision ?? null, parametros }),
    enlaceATanda,
    navegar,
    actualizarParametros: (cambios, opciones) => (vigente() ? actualizarParametros(cambios, opciones) : Promise.resolve()),
    atajos: {
      registrar(mapa) {
        if (controlador.signal.aborted) return () => {};
        const quitar = registrarAtajos(mapa, { ambito: "pantalla", grupo: v.id });
        v.quitar.push(quitar);
        return quitar;
      },
    },
    anunciar,
    avisar,
    cargarEstilos,
    t,
    fmt,
    idioma: idioma(),
    senal: controlador.signal,
  };
}

function ponerTitulo(v) {
  let titulo = "";
  try {
    titulo = v.modulo.titulo?.(crearContexto(v)) ?? "";
  } catch (error) {
    console.error("enrutador: titulo() falló", error);
  }
  if (!titulo) titulo = v.tipo === "tanda" ? t(NOMBRES_DE_PESTANA[v.pestana]) : t(TITULO_DE_VISTA[v.tipo] ?? "comun.shell.overview");
  const tanda = v.tanda ? (v.tanda.tarea ?? v.tanda.host ?? v.tanda.id) : null;
  document.title = [titulo, tanda, t("comun.marca.titulo")].filter(Boolean).join(" · ");
}

// ── Montar y desmontar ────────────────────────────────────────────────────

function vaciarDiferido() {
  const pendiente = diferido;
  diferido = null;
  pendiente?.();
}

/** Desmonta la pantalla; con `despues`, su desmontar() espera esa promesa (la salida de la hoja sigue mostrándola). */
function desmontarPantalla(v, { despues = null } = {}) {
  if (!v?.modulo) return;
  v.controlador.abort();
  for (const quitar of v.quitar.splice(0)) quitar();
  const modulo = v.modulo;
  v.modulo = null;
  const terminar = () => {
    try {
      modulo.desmontar?.();
    } catch (error) {
      console.error("enrutador: desmontar() falló", error);
    }
  };
  if (!despues) return terminar();
  vaciarDiferido();
  diferido = terminar;
  despues.then(() => diferido === terminar && vaciarDiferido());
}

/** Cierra la hoja (con su animación de salida) y desmonta la tanda y la vista de debajo. */
function cerrarHoja({ conservarFondo = false } = {}) {
  if (!hojaAbierta) return null;
  const { hoja, fondo } = hojaAbierta;
  hojaAbierta = null;
  const salida = hoja?.cerrar() ?? Promise.resolve();
  if (vista?.tipo === "tanda") {
    desmontarPantalla(vista, { despues: salida });
    vista.marco?.desmontar();
    vista = null;
  }
  if (fondo && !conservarFondo) desmontarPantalla(fondo);
  return salida;
}

function desmontarVista() {
  if (vista) {
    if (hojaAbierta && vista.tipo === "tanda") return void cerrarHoja();
    desmontarPantalla(vista);
    vista.marco?.desmontar();
    vista = null;
  }
  cerrarHoja();
}

/** Donde está lo que el usuario ve: la hoja, si hay una abierta. */
const zona = () => hojaAbierta?.hoja?.nodo ?? raiz;

/** `datos`: lo que devolvió cargar(ctx) de la pantalla; undefined si no se cargó antes (la pantalla lo pide). */
async function montarPantalla(v, modulo, destino, datos) {
  vaciarDiferido();
  v.modulo = modulo;
  v.controlador = new AbortController();
  v.quitar = [];
  v.contenedor = el("div", { class: "vista-pantalla" });
  reemplazar(destino, v.contenedor);
  try {
    await modulo.montar(v.contenedor, crearContexto(v), datos);
  } catch (error) {
    console.error(`enrutador: montar() de «${v.id}» falló`, error);
    reemplazar(
      v.contenedor,
      errorDePantalla({
        titulo: t("comun.estado.errorDeVista"),
        detalle: error?.stack ?? String(error),
        reintentar: () => remontarPantalla(),
        nivel: v.tipo === "tanda" ? 2 : 1,
      }),
    );
  }
  ponerTitulo(v);
}

async function remontarPantalla() {
  if (!vista?.modulo) return;
  const destino = vista.tipo === "tanda" ? vista.marco.panel : raiz;
  const modulo = vista.modulo;
  desmontarPantalla(vista);
  await montarPantalla(vista, modulo, destino);
}

// ── Foco y desplazamiento (§5.4) ──────────────────────────────────────────

function claveDeFoco() {
  return document.activeElement?.closest?.("[data-foco]")?.getAttribute("data-foco") ?? null;
}

function enfocar(objetivo) {
  if (!objetivo) return;
  if (!objetivo.hasAttribute("tabindex") && !objetivo.matches("a[href], button, input, select, textarea, summary")) {
    objetivo.setAttribute("tabindex", "-1");
  }
  objetivo.focus({ preventScroll: true });
}

function enfocarDespues({ clave, completa, panel, quedarseEnArmazon = false }) {
  const activo = document.activeElement;
  if (clave) {
    const destino = zona().querySelector(`[data-foco="${CSS.escape(clave)}"]`);
    if (destino) {
      if (destino !== activo) destino.focus({ preventScroll: true });
      return;
    }
  }
  const perdido = !activo || activo === document.body || !activo.isConnected;
  const enArmazon = !!activo?.closest?.(".barra-superior");
  if (!perdido && !(completa && enArmazon && !quedarseEnArmazon)) return;
  const objetivo = completa
    ? (zona().querySelector("h1") ?? zona().querySelector("[data-foco-inicial]") ?? zona())
    : (panel?.querySelector("[data-foco-inicial]") ?? panel?.querySelector('h2[tabindex="-1"]') ?? panel ?? zona());
  enfocar(objetivo);
}

function guardarDesplazamiento() {
  if (hashMostrado) desplazamientos.set(hashMostrado, scrollY);
}

function desplazarDespues({ origen, completa, conservar }) {
  // La hoja se desplaza por dentro; la vista de debajo conserva su scroll.
  if (hojaAbierta) return;
  if (conservar !== undefined) return scrollTo(0, conservar);
  if (origen === "historial") return scrollTo(0, desplazamientos.get(location.hash) ?? 0);
  if (completa) return scrollTo(0, 0);
  // Cambio de pestaña: si la fila de pestañas ya quedó fija arriba, se vuelve hasta ella y no más.
  const pestanas = raiz.querySelector(".pestanas");
  if (pestanas) {
    const tope = pestanas.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(pestanas).top) || 0);
    if (scrollY > tope) scrollTo(0, Math.max(0, tope));
  }
}

// ── Navegación ─────────────────────────────────────────────────────────────

const profundidad = (r) => (r?.tipo === "vivo" ? 2 : r?.tipo === "tanda" || r?.revision ? 1 : 0);

function direccionEntre(anterior, nueva) {
  if (!anterior) return "lado";
  const a = profundidad(anterior);
  const b = profundidad(nueva);
  return b > a ? "adelante" : b < a ? "atras" : "lado";
}

function avisarRuta() {
  dispatchEvent(new CustomEvent(EVENTO_RUTA, { detail: ruta }));
}

function vistaDeEstado(nodo) {
  desmontarVista();
  vista = null;
  reemplazar(raiz, el("div", { class: "vista-estado" }, nodo));
}

function noExisteLaTanda(id) {
  const tarea = id.includes("/") ? id.split("/")[0] : null;
  const otras = tarea ? listaDeTandas.tandas.filter((tanda) => tanda.tarea === tarea && tanda.id !== id).slice(0, 3) : [];
  return vacio({
    titulo: t("comun.estado.tandaNoExiste", { id }),
    nivel: 1,
    hijos: otras.length
      ? [
          el("p", { class: "vacio-texto", texto: t("comun.estado.otrasDeLaTarea") }),
          el(
            "ul",
            { class: "vacio-lista" },
            otras.map((tanda) =>
              el("li", {}, el("a", { href: enlaceATanda(tanda.id), texto: `${tanda.tarea ?? tanda.host} · ${fmt.fechaLegible(tanda.fechaIso ?? tanda.fecha)}` })),
            ),
          ),
        ]
      : null,
    accion: irACorridas(),
  });
}

function errorDeCarga(error, tipo) {
  const sinRespuesta = error?.estado === 0;
  return errorDePantalla({
    titulo: t(sinRespuesta ? "comun.estado.sinConexion" : tipo === "tanda" ? "comun.estado.errorDeTanda" : "comun.estado.errorDeCarga"),
    detalle: error?.message ?? String(error),
    reintentar: () => {
      pedirTandas({ refrescar: true }).catch(() => {});
      procesar({ origen: "reintento" });
    },
    nivel: 1,
  });
}

/**
 * Lo que recibe cargar(ctx) de una pantalla: la ruta y sus parámetros, la tanda (en una tanda) y lo que no depende
 * de la vista montada. No trae la señal ni la URL: cargar solo pide datos.
 */
function contextoDeCarga(nueva, tanda = null) {
  return { ruta: nueva, parametros: { ...(nueva.parametros ?? {}) }, tanda, tandas: listaDeTandas.tandas, cargarEstilos, t, fmt, idioma: idioma() };
}

async function cargarRuta(nueva) {
  const espera = ESPERAN_LA_LISTA.has(nueva.tipo);
  if (!espera) {
    pedirTandas()
      .then((lista) => {
        listaDeTandas = lista;
      })
      .catch(() => {});
  }
  const [lista, extra] = await Promise.all([
    espera ? pedirTandas() : null,
    nueva.tipo === "tanda"
      ? Promise.all([pedirTanda(nueva.tandaId), cargarPantalla(nueva.pestana)])
      : cargarPantalla(nueva.tipo),
  ]);
  if (lista) listaDeTandas = lista;
  if (nueva.tipo === "tanda") {
    const [tanda, modulo] = extra;
    // Sin tanda no hay qué montar (la vista dice que no existe): no se piden sus datos.
    const datos = tanda && typeof modulo.cargar === "function" ? await modulo.cargar(contextoDeCarga(nueva, tanda)) : undefined;
    return { tanda, modulo, datos };
  }
  const datos = typeof extra.cargar === "function" ? await extra.cargar(contextoDeCarga(nueva)) : undefined;
  return { modulo: extra, datos };
}

/** Procesa location.hash. `origen`: "inicio" | "navegar" | "historial" | "idioma" | "reintento". */
async function procesar({ origen = "historial" } = {}) {
  const miTurno = ++turno;
  navegando = miTurno;
  const fijarRuta = (nueva, hash) => {
    ruta = nueva;
    hashMostrado = hash;
    if (navegando === miTurno) navegando = 0;
  };
  let hash = location.hash || "#/";

  const { idioma: pedido, hash: sinIdioma } = extraerIdioma(hash);
  if (pedido !== null) {
    history.replaceState(history.state, "", sinIdioma);
    hash = sinIdioma;
    if (IDIOMAS.includes(pedido) && pedido !== idioma()) {
      cambiandoIdiomaDesdeHash = true;
      try {
        await cambiarIdioma(pedido);
      } finally {
        cambiandoIdiomaDesdeHash = false;
      }
      origen = "idioma";
    }
    if (miTurno !== turno) return;
  }

  let nueva = parsearHash(hash);
  if (nueva.tipo === "legado") {
    history.replaceState(history.state, "", nueva.destino);
    if (nueva.aviso) avisar(t(nueva.aviso));
    hash = nueva.destino;
    nueva = parsearHash(hash);
  }
  if (CON_PARAMETROS.has(nueva.tipo) || nueva.tipo === "vivo") {
    const canonico = hashDe(nueva);
    if (canonico !== hash) {
      history.replaceState(history.state, "", canonico);
      hash = canonico;
    }
  }

  const anterior = ruta;
  const clave = claveDeFoco();
  const remontarTodo = origen === "idioma" || origen === "reintento";
  const conservar = origen === "idioma" ? scrollY : undefined;

  // Solo cambiaron parámetros (atrás/adelante o un enlace dentro de la misma vista): no se remonta.
  const mismaVista =
    !remontarTodo &&
    vista?.modulo &&
    ((nueva.tipo === "overview" && vista.tipo === "overview") ||
      (nueva.tipo === "corridas" && vista.tipo === "corridas") ||
      (nueva.tipo === "revisiones" && vista.tipo === "revisiones" && vista.ruta.revision === nueva.revision) ||
      (nueva.tipo === "vivo" && vista.tipo === "vivo" && vista.ruta.revision === nueva.revision && vista.ruta.goal === nueva.goal) ||
      (nueva.tipo === "tanda" && vista.tipo === "tanda" && vista.tandaId === nueva.tandaId && vista.pestana === nueva.pestana));
  if (mismaVista) {
    fijarRuta(nueva, hash);
    vista.ruta = nueva;
    vista.marco?.actualizar(nueva);
    await actualizarPantalla();
    avisarRuta();
    return;
  }

  // Volver a la vista de debajo de la hoja: se cierra la hoja y esa vista sigue tal como estaba.
  if (!remontarTodo && hojaAbierta?.fondo && hash === hojaAbierta.volver.hash) {
    fijarRuta(nueva, hash);
    volverAlFondo();
    avisarRuta();
    return;
  }

  if (nueva.tipo === "desconocida") {
    fijarRuta(nueva, hash);
    await conTransicion(() => vistaDeEstado(vacio({ titulo: t("comun.estado.pantallaNoExiste"), nivel: 1, accion: irACorridas() })), {
      direccion: direccionEntre(anterior, nueva),
    });
    document.title = [t("comun.estado.pantallaNoExiste"), t("comun.marca.titulo")].join(" · ");
    enfocarDespues({ clave: null, completa: true });
    desplazarDespues({ origen, completa: true, conservar });
    avisarRuta();
    return;
  }

  // Solo cambia la pestaña: el marco se queda.
  const soloPestana = !remontarTodo && nueva.tipo === "tanda" && vista?.tipo === "tanda" && vista.tandaId === nueva.tandaId && !!vista.tanda;
  if (nueva.tipo === "tanda" && !soloPestana) return abrirTanda(nueva, hash, { miTurno, fijarRuta, origen });
  const panel = soloPestana ? vista.marco.panel : null;

  let cargado;
  try {
    cargado = await conCarga(
      cargarRuta(nueva),
      () => {
        if (miTurno !== turno || remontarTodo) return;
        if (soloPestana) {
          desmontarPantalla(vista);
          reemplazar(panel, esqueleto("hoja"));
        } else {
          desmontarVista();
          reemplazar(raiz, esqueleto(esqueletoDeVista(nueva)));
        }
      },
      null,
    );
  } catch (error) {
    if (miTurno !== turno) return;
    console.error(error);
    fijarRuta(nueva, hash);
    vistaDeEstado(errorDeCarga(error, nueva.tipo));
    document.title = t("comun.marca.titulo");
    enfocarDespues({ clave: null, completa: true });
    avisarRuta();
    return;
  }
  if (miTurno !== turno) return;

  fijarRuta(nueva, hash);

  if (nueva.tipo === "tanda" && !cargado.tanda) {
    await conTransicion(() => vistaDeEstado(noExisteLaTanda(nueva.tandaId)), { direccion: direccionEntre(anterior, nueva) });
    document.title = [t("comun.estado.tandaNoExiste", { id: nueva.tandaId }), t("comun.marca.titulo")].join(" · ");
    enfocarDespues({ clave: null, completa: true });
    desplazarDespues({ origen, completa: true, conservar });
    avisarRuta();
    return;
  }

  const montar = async () => {
    // Otra navegación empezó mientras se esperaba la transición: esa monta lo suyo.
    if (miTurno !== turno) return;
    if (soloPestana && vista?.marco) {
      desmontarPantalla(vista);
      vista.ruta = nueva;
      vista.pestana = nueva.pestana;
      vista.id = nueva.pestana;
      vista.marco.actualizar(nueva);
      await montarPantalla(vista, cargado.modulo, vista.marco.panel, cargado.datos);
      return;
    }
    desmontarVista();
    vista = { tipo: nueva.tipo, id: nueva.tipo, ruta: nueva, quitar: [] };
    await montarPantalla(vista, cargado.modulo, raiz, cargado.datos);
  };

  try {
    if (remontarTodo) await montar();
    else await conTransicion(montar, { direccion: soloPestana ? "pestana" : direccionEntre(anterior, nueva) });
  } catch (error) {
    // montarPantalla ya atrapa los errores de la pantalla; esto es el marco u otra falla a medio armar.
    if (miTurno !== turno) return;
    console.error("enrutador: no se pudo montar la vista", error);
    vistaDeEstado(errorDeCarga(error, nueva.tipo));
    enfocarDespues({ clave: null, completa: true });
    avisarRuta();
    return;
  }
  if (miTurno !== turno) return;

  // Al cambiar de idioma el foco queda en el selector (ES/EN); en una navegación completa va al h1. El foco
  // guardado (data-foco) solo vale en la misma tanda: en otra, "telarana:pagina:n2" es otra estación.
  const mismaTanda = anterior?.tipo === nueva.tipo && (nueva.tipo !== "tanda" || anterior.tandaId === nueva.tandaId);
  enfocarDespues({
    clave: origen === "idioma" || mismaTanda ? clave : null,
    completa: !soloPestana,
    panel: vista?.marco?.panel,
    quedarseEnArmazon: origen === "idioma",
  });
  desplazarDespues({ origen, completa: !soloPestana, conservar });
  avisarRuta();
}

/** El elemento que abrió la hoja (con foco o recién cliqueado, dentro de la vista de debajo). */
function abridorDeLaHoja() {
  const activo = document.activeElement;
  const elemento = activo && activo !== document.body && raiz.contains(activo) ? activo : ultimoEnlace?.isConnected && raiz.contains(ultimoEnlace) ? ultimoEnlace : null;
  return { elemento, clave: elemento?.closest?.("[data-foco]")?.getAttribute("data-foco") ?? null };
}

/**
 * Abre una tanda en la hoja: al instante el marco con el título y un esqueleto; los datos y la pantalla después.
 * Sobre la vista de antes (que queda montada debajo) o, si ya hay una hoja abierta, en su lugar.
 */
async function abrirTanda(nueva, hash, { miTurno, fijarRuta, origen }) {
  if (hojaAbierta) {
    if (vista?.tipo === "tanda") {
      desmontarPantalla(vista);
      vista.marco?.desmontar();
    }
    // Con otro idioma, la vista de debajo quedó en el anterior: al volver se monta de nuevo.
    if (origen === "idioma" && hojaAbierta.fondo) {
      desmontarPantalla(hojaAbierta.fondo);
      hojaAbierta.fondo = null;
    }
  } else {
    const conFondo = !!vista?.modulo && vista.tipo !== "tanda";
    const volver = origenDeHoja(conFondo ? vista.ruta : null, conFondo ? hashMostrado : null);
    const abridor = conFondo ? abridorDeLaHoja() : { elemento: null, clave: null };
    if (!conFondo) {
      desmontarVista();
      reemplazar(raiz);
    }
    hojaAbierta = { hoja: null, fondo: conFondo ? vista : null, volver, abridor };
  }
  vista = null;
  const marco = montarMarco({
    tandaId: nueva.tandaId,
    ruta: nueva,
    navegar,
    volver: hojaAbierta.volver,
    escapar: () => vista?.modulo?.escapar?.() === true,
  });
  if (hojaAbierta.hoja) reemplazar(hojaAbierta.hoja.nodo, marco.raiz);
  else hojaAbierta.hoja = abrirHoja(marco.raiz, { fondo: raiz });
  const v = { tipo: "tanda", id: nueva.pestana, ruta: nueva, tanda: null, tandaId: nueva.tandaId, pestana: nueva.pestana, marco, quitar: [] };
  vista = v;
  enfocar(marco.titulo);

  let cargado;
  try {
    cargado = await cargarRuta(nueva);
  } catch (error) {
    if (miTurno !== turno) return;
    console.error(error);
    fijarRuta(nueva, hash);
    reemplazar(marco.panel, errorDeCarga(error, "tanda"));
    avisarRuta();
    return;
  }
  if (miTurno !== turno || vista !== v) return;
  fijarRuta(nueva, hash);
  if (!cargado.tanda) {
    reemplazar(marco.panel, noExisteLaTanda(nueva.tandaId));
    document.title = [t("comun.estado.tandaNoExiste", { id: nueva.tandaId }), t("comun.marco.titulo")].join(" · ");
    avisarRuta();
    return;
  }
  marco.ponerTanda(cargado.tanda);
  v.tanda = cargado.tanda;
  await montarPantalla(v, cargado.modulo, marco.panel, cargado.datos);
  if (miTurno !== turno) return;
  avisarRuta();
}

/** Cierra la hoja y deja a la vista la de debajo, en su scroll, con el foco en lo que abrió la hoja. */
function volverAlFondo() {
  const { fondo, abridor } = hojaAbierta;
  cerrarHoja({ conservarFondo: true });
  vista = fondo;
  vista.ruta = ruta;
  ponerTitulo(vista);
  const destino = abridor.elemento?.isConnected ? abridor.elemento : abridor.clave ? raiz.querySelector(`[data-foco="${CSS.escape(abridor.clave)}"]`) : null;
  enfocar(destino ?? raiz.querySelector("h1") ?? raiz);
}

async function actualizarPantalla() {
  if (!vista?.modulo) return;
  let sigue = false;
  try {
    sigue = typeof vista.modulo.actualizar === "function" ? vista.modulo.actualizar(crearContexto(vista)) !== false : false;
  } catch (error) {
    console.error(`enrutador: actualizar() de «${vista.id}» falló`, error);
  }
  if (!sigue) {
    const raizDeFoco = vista.tipo === "tanda" ? vista.marco.panel : raiz;
    const clave = claveDeFoco();
    await remontarPantalla();
    enfocarDespues({ clave, completa: false, panel: raizDeFoco });
  } else {
    ponerTitulo(vista);
  }
}

// ── API pública ────────────────────────────────────────────────────────────

/** Navegación completa a `hash` (monta, transición, foco). `reemplazar` usa replaceState. */
export function navegar(hash, { reemplazar: sinHistorial = false } = {}) {
  const destino = String(hash).startsWith("#") ? String(hash) : `#${hash}`;
  if (destino === location.hash && !sinHistorial) return Promise.resolve();
  guardarDesplazamiento();
  if (sinHistorial) history.replaceState(history.state, "", destino);
  else history.pushState(null, "", destino);
  return procesar({ origen: "navegar" });
}

/**
 * Mezcla `cambios` en los parámetros de la ruta actual (null borra), escribe el hash (replaceState, o pushState
 * con historial "agregar") y llama a actualizar(contexto) de la pantalla activa; si devuelve false, la remonta.
 */
export function actualizarParametros(cambios, { historial = "reemplazar" } = {}) {
  if (!ruta || !CON_PARAMETROS.has(ruta.tipo)) return Promise.resolve();
  const parametros = { ...ruta.parametros };
  for (const [clave, valor] of Object.entries(cambios ?? {})) {
    if (valor === null || valor === undefined || valor === "") delete parametros[clave];
    else parametros[clave] = String(valor);
  }
  const hash = hashDe({ ...ruta, parametros });
  if (hash !== location.hash) {
    if (historial === "agregar") {
      guardarDesplazamiento();
      history.pushState(null, "", hash);
    } else history.replaceState(history.state, "", hash);
  }
  ruta = parsearHash(hash);
  hashMostrado = hash;
  if (vista) vista.ruta = ruta;
  vista?.marco?.actualizar(ruta);
  const hecho = actualizarPantalla();
  avisarRuta();
  return hecho;
}

/** → Ruta actual. */
export function rutaActual() {
  return ruta;
}

function interceptarEnlaces(evento) {
  if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
  const enlace = evento.target instanceof Element ? evento.target.closest("a[href]") : null;
  if (!enlace || (enlace.target && enlace.target !== "_self") || enlace.hasAttribute("download")) return;
  const href = enlace.getAttribute("href");
  if (!href?.startsWith("#/") && href !== "#") return;
  evento.preventDefault();
  ultimoEnlace = enlace;
  navegar(href === "#" ? "#/" : href);
}

/** Arranca el enrutador sobre <main id="contenido">. */
export function iniciarEnrutador({ raiz: contenedor }) {
  raiz = contenedor;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  document.addEventListener("click", interceptarEnlaces);
  addEventListener("hashchange", () => {
    guardarDesplazamiento();
    procesar({ origen: "historial" });
  });
  addEventListener(EVENTO_IDIOMA, () => {
    if (!cambiandoIdiomaDesdeHash) procesar({ origen: "idioma" });
  });
  return procesar({ origen: "inicio" });
}
