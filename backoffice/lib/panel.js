// El Overview del backoffice: arma las respuestas de GET /api/resumen y GET /api/overview leyendo el almacén (por la
// fuente, con el índice de lib/indice.js) y la tabla de revisiones (lib/revisiones.js). Formas exactas en el
// contrato del Overview v3 (§1, §2); la lógica está en módulos puros: lib/overview.js (cifras, pestañas, cola),
// lib/tarjeta.js (estado, detenida, etapas, agentes, goals, motivo, capturas), lib/sitio.js (host, nombre, acento)
// y lib/clasificar.js (dispositivo y estado de cada intento).
//
// Lecturas por pasada (la página pide /api/resumen y /api/overview juntos cada 5 s):
// - Cada lectura compartida (índice del almacén, ids de tandas, tabla) y cada respuesta se guardan MEMORIA_MS desde
//   que terminan: dos pedidos que llegan juntos comparten la misma lectura. /api/overview se guarda aparte por cada
//   página pedida (?pestana=<p>&limite=<n>, ya normalizada): una no responde por otra.
// - Tabla: un Scan de los META y los URL#<url> (solo cuentan las vigentes: revisionesVigentes en lib/revisiones.js) y
//   una Query por cada revisión que corre (para en_cola y "detenida"). En /api/overview, además, una Query por cada
//   revisión con tarjeta (6 por pestaña, hasta LIMITE_MAXIMO en la pedida); los ítems de las cerradas (done, failed) se
//   guardan, así una página más larga solo consulta las que se suman.
// - Almacén: el índice lista el almacén entero a lo más cada LISTADO_MS (30 s) y en cada pasada relee solo lo abierto.
//   goals.json y el acento del tema.css de corridas cerradas se leen una vez. Las tandas que se listan (capturas,
//   `tanda`, /archivos/) salen del índice, sin listar; un id que no está ahí se busca en un listado fresco.
//
// Seguridad: el almacén solo se lee con claves que listó la fuente o con run_key / css_key de la tabla validadas con
// partesDeCorrida para el rol y el goal esperados (claveDeCorridaDelItem, claveDelTema). Las capturas solo apuntan a
// tandas que lista idsDeTandas (las mismas que sirve /archivos/, que pregunta por esa misma lista: esTandaListada), y el
// acento sale solo si es un hex.

import { REVISION } from "../public/nucleo/almacen.js";
import { LISTADO_MS, crearIndice } from "./indice.js";
import { contarResumen, idsConTarjeta, listasDelOverview, parametrosDelOverview } from "./overview.js";
import { claveDeCorridaDelItem, claveDelTema, revisionesVigentes } from "./revisiones.js";
import { acentoDelTema, hostDeRevision, nombreDelSitio, nombreDeHost, rutaComparable } from "./sitio.js";
import { idsDeTandas } from "./tandas.js";
import {
  UMBRAL_DETENIDA_MS,
  actualizadaDe,
  armarTarjeta,
  elegirCapturas,
  enColaDeRevision,
  estaDetenida,
  estadoDeTarjeta,
  itemsPorEtapa,
} from "./tarjeta.js";

/** Cuánto se reutiliza una lectura o una respuesta ya terminada (los pedidos de una misma pasada llegan juntos). */
export const MEMORIA_MS = 2000;
// Revisiones cerradas, goals.json y acentos guardados (los más viejos se olvidan primero): caben las tarjetas de la
// página más larga (LIMITE_MAXIMO más las otras pestañas) con holgura.
const LIMITE_EN_MEMORIA = 2000;
// Páginas de /api/overview distintas guardadas a la vez (cada una MEMORIA_MS).
const PAGINAS_EN_MEMORIA = 16;
const TABLA_CERRADA = new Set(["done", "failed"]);

/**
 * La función memorizada: mientras la promesa corre, todos la comparten; ya resuelta, por `ms` más. Un error no se
 * guarda. Cuenta con el reloj del proceso, no con el inyectado (el del mock está quieto).
 * Con `{ desde }` (un performance.now()) solo sirve una lectura que empezó en ese momento o después: si la guardada es
 * más vieja, empieza otra, que queda como la compartida (así varios que preguntan a la vez comparten la nueva).
 */
export function memorizar(fn, ms = MEMORIA_MS) {
  let guardada = null;
  const empezar = () => {
    const actual = { promesa: null, desde: performance.now(), hasta: null };
    actual.promesa = Promise.resolve()
      .then(fn)
      .then(
        (valor) => {
          actual.hasta = performance.now() + ms;
          return valor;
        },
        (error) => {
          if (guardada === actual) guardada = null;
          throw error;
        },
      );
    guardada = actual;
    return actual.promesa;
  };
  return ({ desde } = {}) => {
    if (!guardada) return empezar();
    if (desde !== undefined) return guardada.desde >= desde ? guardada.promesa : empezar();
    return guardada.hasta === null || performance.now() < guardada.hasta ? guardada.promesa : empezar();
  };
}

function recordar(mapa, clave, valor, limite = LIMITE_EN_MEMORIA) {
  mapa.delete(clave);
  mapa.set(clave, valor);
  if (mapa.size > limite) mapa.delete(mapa.keys().next().value);
  return valor;
}

const idDe = (meta) => String(meta?.PK ?? "").replace(/^REV#/, "");
const sinMeta = (items) => items.filter((item) => item?.SK !== "META");
const compararTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// La tanda más nueva primero (por id de corrida; desempate por clave).
const masNuevaPrimero = (a, b) => compararTexto(b.corrida, a.corrida) || compararTexto(a.clave, b.clave);

/**
 * Lo que se busca por host en el índice: las tandas del Visitante (la más nueva primero) por host y ruta de inicio, y
 * el título de la página de inicio de cada host.
 */
function porHost(corridas) {
  const tandas = corridas.filter((corrida) => corrida.rol === "visitor").sort(masNuevaPrimero);
  const porRuta = new Map();
  const titulos = new Map();
  for (const tanda of tandas) {
    const conUrl = tanda.intentos.find((intento) => intento.url);
    const ruta = conUrl ? rutaComparable(conUrl.url) : null;
    if (ruta) {
      const clave = `${tanda.host}|${ruta}`;
      if (!porRuta.has(clave)) porRuta.set(clave, []);
      porRuta.get(clave).push(tanda);
    }
    for (const intento of tanda.intentos) {
      if (!intento.titulo) continue;
      if (!titulos.has(tanda.host)) titulos.set(tanda.host, { inicio: null, cualquiera: null });
      const titulo = titulos.get(tanda.host);
      titulo.cualquiera ??= intento.titulo;
      if (rutaComparable(intento.url) === "/") titulo.inicio ??= intento.titulo;
    }
  }
  return {
    tandasDe: (host, ruta) => porRuta.get(`${host}|${ruta}`) ?? [],
    sitioDe: (host) => {
      const titulo = titulos.get(host);
      return nombreDelSitio(titulo?.inicio ?? titulo?.cualquiera ?? null, host ?? "");
    },
  };
}

/**
 * @param {{ fuente: import("./fuente.js").Fuente,
 *           revisiones?: ReturnType<typeof import("./revisiones.js").crearRevisiones> | null,
 *           reloj?: () => Date, memoriaMs?: number, listadoMs?: number }} opciones
 *        sin `revisiones`, /api/overview dice que no está disponible y en_cola es 0; `memoriaMs` y `listadoMs` (cada
 *        cuánto se vuelve a listar el almacén, LISTADO_MS) solo para pruebas
 */
export function crearPanel({ fuente, revisiones = null, reloj = () => new Date(), memoriaMs = MEMORIA_MS, listadoMs = LISTADO_MS }) {
  const indice = crearIndice(fuente, { listadoMs });
  const leerIndice = memorizar(() => indice.leer(), memoriaMs);
  // Las tandas que lista idsDeTandas, sin volver a listar el almacén: las del índice que terminaron bien y tienen
  // route_tree.json (la misma regla de Fuente.listarIds; ver CorridaDelIndice.listada).
  const leerListadas = memorizar(async () => new Set((await leerIndice()).corridas.filter((corrida) => corrida.listada).map((c) => c.clave)), memoriaMs);
  // idsDeTandas en el momento, solo cuando un id no está en la del índice (una tanda que terminó después del listado).
  const leerFrescas = memorizar(async () => new Set(await idsDeTandas(fuente)), memoriaMs);
  let frescas = new Set();

  // Las tandas que ya aparecieron en una lista. Una tanda listada es una corrida que terminó bien y no deja de serlo:
  // no se vuelve a listar por ella (sin esto, cada captura pedida después de MEMORIA_MS costaba una pasada entera).
  const confirmadas = new Set();

  /**
   * ¿idsDeTandas de esta fuente lista la tanda? Una ya confirmada, sin leer nada. Si no, mira la lista del índice (sin
   * listar el almacén) y la última fresca; si el id no está en ninguna, una fresca que empezó después de la pregunta
   * (compartida entre los que preguntan a la vez y guardada para los siguientes): una tanda recién terminada se sirve
   * igual, antes del 404. La que aparece en una lista queda confirmada. Lo usan /archivos/ y /api/propuestas/
   * (servidor.js).
   * @param {string} id
   */
  async function esTandaListada(id) {
    if (confirmadas.has(id)) return true;
    const pregunta = performance.now();
    let listada = (await leerListadas()).has(id) || frescas.has(id);
    if (!listada) {
      frescas = await leerFrescas({ desde: pregunta });
      listada = frescas.has(id);
    }
    if (listada) confirmadas.add(id);
    return listada;
  }
  const leerTabla = memorizar(async () => {
    const leidas = await revisiones.metasYPunteros();
    const todas = leidas.metas.filter((meta) => meta?.SK === "META" && REVISION.test(idDe(meta)));
    const { vigentes, anteriores } = revisionesVigentes(todas, leidas.punteros);
    const metas = todas.filter((meta) => vigentes.has(idDe(meta)));
    const corriendo = metas.filter((meta) => meta.status === "running");
    const items = new Map(await Promise.all(corriendo.map(async (meta) => [idDe(meta), sinMeta(await revisiones.items(idDe(meta)))])));
    return { metas, todas, anteriores, items };
  }, memoriaMs);

  const itemsCerrados = new Map();
  const catalogos = new Map();
  const acentos = new Map();
  const paginas = new Map();
  // Lo de cada host se arma una vez por pasada del índice (el mismo objeto mientras dura la memoria).
  const deHostPorPasada = new WeakMap();
  const deHostDe = (almacen) => {
    if (!deHostPorPasada.has(almacen)) deHostPorPasada.set(almacen, porHost(almacen.corridas));
    return deHostPorPasada.get(almacen);
  };

  async function itemsDe(meta, tabla) {
    const id = idDe(meta);
    if (tabla.items.has(id)) return tabla.items.get(id);
    if (itemsCerrados.has(id)) return itemsCerrados.get(id);
    const items = sinMeta(await revisiones.items(id));
    return TABLA_CERRADA.has(meta.status) ? recordar(itemsCerrados, id, items) : items;
  }

  // goals.json de un catalogador que terminó bien: no cambia más.
  async function catalogoDe(clave) {
    if (catalogos.has(clave)) return catalogos.get(clave);
    const datos = await fuente.leerJson(clave, "goals.json");
    return datos ? recordar(catalogos, clave, datos) : null;
  }

  // El acento del tema.css de un improver que terminó bien: no cambia más.
  async function acentoDe(clave) {
    if (acentos.has(clave)) return acentos.get(clave);
    const css = typeof fuente.leerTexto === "function" ? await fuente.leerTexto(clave, "tema.css") : null;
    return css === null ? null : recordar(acentos, clave, acentoDelTema(css));
  }

  // Estado de tarjeta de cada META, con los ítems de las que corren (para "detenida").
  function estadosDeLaTabla(tabla, ahora) {
    return tabla.metas.map((meta) => {
      const items = tabla.items.get(idDe(meta)) ?? [];
      const detenida = estaDetenida(meta.status, actualizadaDe(meta, items), ahora);
      return { revision: idDe(meta), creada: meta.created_at ?? null, estado: estadoDeTarjeta(meta.status, detenida), meta, items };
    });
  }

  async function tarjetaDe(meta, { tabla, ahora, almacen, deHost }) {
    const items = await itemsDe(meta, tabla);
    const { catalogo: itemCatalogo, improver, goals } = itemsPorEtapa(items);

    const claveCatalogo = itemCatalogo?.status === "succeeded" ? claveDeCorridaDelItem(itemCatalogo, "cataloger") : null;
    const claveTema = (improver?.status === "succeeded" ? claveDeCorridaDelItem(improver, "improver") : null) ?? claveDelTema(meta.css_key);
    const tandas = new Map();
    const [catalogo, acento] = await Promise.all([
      claveCatalogo ? catalogoDe(claveCatalogo) : null,
      claveTema ? acentoDe(claveTema) : null,
      ...[...goals].map(async ([goal, { visitor }]) => {
        const clave = claveDeCorridaDelItem(visitor, "visitor", goal);
        // Una run_key que el índice todavía no conoce (recién creada, antes del próximo listado) se lee por su clave.
        const tanda = clave ? (almacen.porClave.get(clave) ?? (await indice.corrida(clave))) : null;
        if (tanda) tandas.set(goal, tanda);
      }),
    ]);

    const host = hostDeRevision(meta);
    const ruta = rutaComparable(meta.url);
    // Solo tandas que /archivos/ sirve (las que idsDeTandas lista: CorridaDelIndice.listada).
    const comoGrupo = (lista) => lista.filter((tanda) => tanda.listada).map((tanda) => ({ tanda: tanda.clave, intentos: tanda.intentos }));
    const capturas = elegirCapturas([
      comoGrupo([...tandas.values()].sort(masNuevaPrimero)),
      comoGrupo(host && ruta ? deHost.tandasDe(host, ruta) : []),
    ]);
    return armarTarjeta({
      meta,
      items,
      ahora,
      catalogo,
      intentosDe: (goal) => tandas.get(goal)?.intentos ?? [],
      // La tanda del Visitante de cada goal en esta revisión (nunca otra del mismo goal), si /archivos/ la sirve.
      tandaDe: (goal) => (tandas.get(goal)?.listada ? tandas.get(goal).clave : null),
      capturas,
      acento,
      sitio: host ? deHost.sitioDe(host) : nombreDeHost(""),
      anteriores: tabla.anteriores.get(idDe(meta)) ?? 0,
    });
  }

  async function resumen() {
    const ahora = reloj();
    const [almacen, tabla] = await Promise.all([leerIndice(), revisiones ? leerTabla() : null]);
    const enCola = { cataloger: 0, guide: 0, visitor: 0, improver: 0 };
    for (const { meta, items, estado } of tabla ? estadosDeLaTabla(tabla, ahora) : []) {
      if (estado !== "running") continue;
      const deEsta = enColaDeRevision(meta, items, false);
      for (const rol of Object.keys(enCola)) enCola[rol] += deEsta[rol];
    }
    const intentos = almacen.corridas.flatMap((corrida) => (corrida.rol === "visitor" ? corrida.intentos : []));
    return { ahora: ahora.toISOString(), roles: contarResumen({ corridas: almacen.corridas, intentos, enCola }) };
  }

  async function armarOverview(pagina) {
    const ahora = reloj();
    if (!revisiones) return { ahora: ahora.toISOString(), disponible: false };
    const [tabla, almacen] = await Promise.all([leerTabla(), leerIndice()]);
    const estados = estadosDeLaTabla(tabla, ahora);
    const { cuentas, pestanas } = listasDelOverview(estados, pagina);
    const ids = idsConTarjeta({ pestanas });
    const porId = new Map(estados.map((estado) => [estado.revision, estado.meta]));
    const contexto = { tabla, ahora, almacen, deHost: deHostDe(almacen) };
    const tarjetas = await Promise.all(ids.map((id) => tarjetaDe(porId.get(id), contexto)));
    return {
      ahora: ahora.toISOString(),
      disponible: true,
      umbralDetenidaMin: UMBRAL_DETENIDA_MS / 60_000,
      cuentas,
      pestanas,
      tarjetas: Object.fromEntries(ids.map((id, i) => [id, tarjetas[i]])),
    };
  }

  return {
    esTandaListada,
    /** GET /api/resumen (contrato §1). */
    resumen: memorizar(resumen, memoriaMs),
    /**
     * GET /api/overview (contrato §2 y §7.4): `parametros` tal como llegan en la URL ({ pestana, limite }); cada página
     * normalizada se guarda aparte.
     */
    overview(parametros = {}) {
      const pagina = parametrosDelOverview(parametros);
      const clave = `${pagina.pestana ?? ""}:${pagina.limite}`;
      const guardada = paginas.get(clave) ?? memorizar(() => armarOverview(pagina), memoriaMs);
      recordar(paginas, clave, guardada, PAGINAS_EN_MEMORIA);
      return guardada();
    },
    /** Una tarjeta cualquiera (aunque no esté en una pestaña), o null si la revisión no existe. Para pruebas. */
    async tarjeta(revision) {
      if (!revisiones || !REVISION.test(String(revision ?? ""))) return null;
      const ahora = reloj();
      const tabla = await leerTabla();
      const meta = tabla.todas.find((otra) => idDe(otra) === revision);
      if (!meta) return null;
      const almacen = await leerIndice();
      return tarjetaDe(meta, { tabla, ahora, almacen, deHost: deHostDe(almacen) });
    },
  };
}
