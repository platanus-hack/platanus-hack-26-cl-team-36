// Background de la extensión (módulo ES). El mismo archivo corre en los dos navegadores:
// en Firefox como "event page" (background.scripts) y en Chrome como service worker
// (background.service_worker). Ninguno queda vivo: los dos lo descargan tras un rato sin uso,
// así que nada de DOM (no hay en un service worker) ni estado en memoria que no se pueda perder.
//
// Responsabilidades:
//   1. Ícono y badge sincronizados con `activo` en storage (el interruptor está en el popup).
//   2. Consultarle a la API la revisión de cada página (el tema que generaron los agentes, ver revisiones.js)
//      e inyectar su CSS cuando esté lista. No dispara revisiones (ver el TODO en consultarYAplicar). El último tema de
//      cada página queda guardado (cache-temas.js) y se aplica al cargar mientras se revalida con la API.
//   3. Guardar en el equipo los votos del usuario sobre la página con tema (ver votos.js).

import { crearAdaptadorIndexedDB } from "./almacen-votos-idb.js";
import { consultarRevision } from "./api.js";
import { crearCacheTemas } from "./cache-temas.js";
import { recargadaEnDesarrollo } from "./config.js";
import { HOJA_FUENTES, hojaConUrlsAbsolutas, inyectarCssDeTema } from "./fuentes.js";
import {
  FACTOR_INTERVALO_REVISION,
  INTERVALO_MAXIMO_REVISION_MS,
  INTERVALO_REVISION_MS,
  TOPE_REVISION_MS,
  resolverRevision,
  urlDePagina,
} from "./revisiones.js";
import { crearAlmacenVotos, crearRegistroVoto, falloVoto, obtenerIdUsuario, validarVoto } from "./votos.js";

// ---------- 1. Estado ON/OFF y badge ----------

// El ON/OFF vive en el popup (popup/popup.js), que guarda `activo` en storage.local;
// content/motor.js escucha ese cambio y anima la página. Acá se pintan ícono y badge,
// escuchando storage: así queda al día venga de donde venga el cambio.

async function leerActivo() {
  const { activo = true } = await browser.storage.local.get("activo");
  return activo;
}

async function pintarBadge(activo) {
  const estado = activo ? "on" : "off";
  // Rutas absolutas: Chrome resuelve las relativas contra el service worker (background/icons/… no existe).
  await browser.action.setIcon({ path: {
    16: `/icons/extension-${estado}-16.png`,
    32: `/icons/extension-${estado}-32.png`,
  } });
  await browser.action.setBadgeText({ text: activo ? "ON" : "" });
  // Colores de marca: turquesa del espectro con texto tinta (ver docs/marca/).
  await browser.action.setBadgeBackgroundColor({ color: "#2EE6C5" });
  if (browser.action.setBadgeTextColor) await browser.action.setBadgeTextColor({ color: "#0B0B10" });
}

browser.storage.onChanged.addListener((cambios, area) => {
  if (area !== "local" || !("activo" in cambios)) return;
  pintarBadge(cambios.activo.newValue ?? true).catch((error) => console.error("[mi-tema] No se pudo pintar el badge:", error));
});

browser.runtime.onStartup.addListener(async () => pintarBadge(await leerActivo()));

// onInstalled se dispara al instalar, al actualizar el navegador y cada vez que se recarga la extensión
// (`npm run dev`/`dev:chrome` al guardar, o el botón de recargar de chrome://extensions).
browser.runtime.onInstalled.addListener(async (detalles) => {
  await pintarBadge(await leerActivo());
  if (await recargadaEnDesarrollo(detalles)) await refrescarPestanasConTema();
});

// En desarrollo, al recargar la extensión las pestañas abiertas siguen con el
// CSS/JS anterior (en Chrome, con un content script que ya no habla con la extensión).
// Refrescamos las que tenían un tema aplicado (content/motor.js les deja el atributo
// data-mt-tema en <html>) para ver el cambio sin tocar nada.
async function refrescarPestanasConTema() {
  const pestanas = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const conTema = await Promise.all(
    pestanas.map(async (pestana) => {
      try {
        const [{ result }] = await browser.scripting.executeScript({
          target: { tabId: pestana.id },
          func: () => document.documentElement.hasAttribute("data-mt-tema"),
        });
        return result ? pestana : null;
      } catch {
        return null; // páginas donde el navegador no deja inyectar (addons.mozilla.org, chromewebstore.google.com)
      }
    }),
  );
  const aRefrescar = conTema.filter(Boolean);
  if (aRefrescar.length === 0) return;
  console.info(`[mi-tema] Modo desarrollo: refrescando ${aRefrescar.length} pestaña(s) con tema.`);
  await Promise.all(aRefrescar.map((p) => browser.tabs.reload(p.id)));
}

// ---------- 2. Temas ----------

// El content script pide su tema al cargar. Inyectamos el CSS desde aquí con
// scripting.insertCSS (no le afecta la CSP de la página) y le devolvemos al
// content script solo lo que necesita para las features.
//
// `tema:aplicar` y `tema:revision` → tema (sin css) | null | { esperarRevision: { intervaloMs, maximoMs, factor, topeMs } }.
const ESPERAR_REVISION = {
  esperarRevision: {
    intervaloMs: INTERVALO_REVISION_MS,
    maximoMs: INTERVALO_MAXIMO_REVISION_MS,
    factor: FACTOR_INTERVALO_REVISION,
    topeMs: TOPE_REVISION_MS,
  },
};

const cacheTemas = crearCacheTemas(browser.storage.local);

async function aplicarTema(sender) {
  if (sender.frameId === 0) temaPorPestana.set(sender.tab.id, { origen: new URL(sender.url).origin, temaId: null, css: "" });
  if (!(await puedeConsultarRevision(sender))) return null;
  const pagina = urlDePagina(sender.url);
  const guardado = await cacheTemas.leer(pagina);
  if (!guardado) return consultarYAplicar(sender);
  const respuesta = await inyectarTema(guardado.tema, sender, pagina);
  revalidarTema(guardado, sender, pagina).catch((error) => console.warn("[mi-tema] No se pudo revalidar el tema:", error));
  return respuesta;
}

// Un error pasajero o una revisión nueva en curso dejan el tema guardado; un 404 lo olvida para la próxima visita.
// Si la API trae otro tema, se cambia el CSS en la página; las features del tema nuevo llegan en la próxima carga.
async function revalidarTema(guardado, sender, pagina) {
  const resultado = await resolverRevision(sender.url, { consultar: consultarRevision });
  if (resultado.estado === "sin-revision") return cacheTemas.olvidar(pagina);
  if (resultado.estado !== "listo" || JSON.stringify(resultado.tema) === JSON.stringify(guardado.tema)) return;
  await cacheTemas.guardar(pagina, resultado.revision, resultado.tema);
  const actual = temaPorPestana.get(sender.tab.id);
  if (actual?.pagina !== pagina || actual.temaId !== guardado.tema.id) return; // la pestaña ya navegó
  if (resultado.tema.css === guardado.tema.css) return;
  await inyectarTema(resultado.tema, sender, pagina);
  // Después de inyectar el nuevo, para que la página no quede un instante sin tema.
  await browser.scripting.removeCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, css: guardado.tema.css });
}

// `esperando`: lo pide el motor mientras sondea; un error pasajero no corta la espera.
async function revisarPagina(sender, { esperando = false } = {}) {
  return (await puedeConsultarRevision(sender)) ? consultarYAplicar(sender, { esperando }) : null;
}

// TODO: la extensión no dispara revisiones: solo consulta (GET) la de la página, y una página sin revisión queda tal
// cual. Cada revisión corre agentes en AWS y cuesta; por ahora se piden con `just aws revision <url>` o
// `just aws seed`. Para volver a dispararlas al entrar a una página nueva, usar pedirRevision (POST, api.js) en vez de
// consultarRevision cuando el GET responda que no existe, idealmente con un límite por usuario o a pedido desde el popup.
async function consultarYAplicar(sender, { esperando = false } = {}) {
  const resultado = await resolverRevision(sender.url, { consultar: consultarRevision });
  if (resultado.estado === "esperando" || (esperando && resultado.estado === "error")) return ESPERAR_REVISION;
  if (resultado.estado !== "listo") return null;
  const pagina = urlDePagina(sender.url);
  cacheTemas.guardar(pagina, resultado.revision, resultado.tema);
  return inyectarTema(resultado.tema, sender, pagina);
}

// En ventanas privadas no se envía la URL a nadie, y con el interruptor apagado tampoco: se consultará en la próxima
// visita con Chameleon encendido.
async function puedeConsultarRevision(sender) {
  return sender.frameId === 0 && !sender.tab?.incognito && /^https?:/.test(sender.url ?? "") && (await leerActivo());
}

// `pagina`: un tema de revisión vale para esa página y no para todo el origen.
async function inyectarTema(tema, sender, pagina) {
  const origen = new URL(sender.url).origin;
  if (sender.frameId === 0) temaPorPestana.set(sender.tab.id, { origen, pagina, temaId: tema.id, css: tema.css });
  console.info(`[mi-tema] Tema "${tema.id}" aplicado en ${pagina}`);

  const target = { tabId: sender.tab.id, frameIds: [sender.frameId] };
  await inyectarCssDeTema(tema.css, target, (detalles) => browser.scripting.insertCSS(detalles), leerHojaFuentes);

  const { css, ...resto } = tema;
  return { ...resto, pagina };
}

// fuentes/fuentes.css como texto, con las url() absolutas para que valgan en los dos navegadores (ver fuentes.js).
async function leerHojaFuentes() {
  const respuesta = await fetch(browser.runtime.getURL(HOJA_FUENTES));
  if (!respuesta.ok) throw new Error(`${HOJA_FUENTES}: ${respuesta.status}`);
  return hojaConUrlsAbsolutas(await respuesta.text(), (archivo) => browser.runtime.getURL(archivo));
}

// ---------- 3. Votos ----------

// Los votos (con el HTML de la página) se guardan solo en el equipo, en IndexedDB.
// La subida al servidor todavía no existe: ver sincronizarVotos en votos.js.
const almacenVotos = crearAlmacenVotos(crearAdaptadorIndexedDB());

// Tema que aplicarTema resolvió para la página de cada pestaña (frame principal), con su
// origen y su CSS (para incrustarlo en el HTML "editado"). El voto toma el tema de acá y
// no del DOM, que la página controla: un sitio cualquiera podría poner
// `data-mt-tema="rev-…"` en su <html>. El navegador descarga el background tras un rato sin
// uso y esto se pierde: por eso, si no está o es de otro origen o página, se vuelve a consultar.
const temaPorPestana = new Map(); // tabId → { origen, pagina?, temaId | null, css }
browser.tabs.onRemoved.addListener((tabId) => temaPorPestana.delete(tabId));

async function temaDePestana(tabId, url) {
  const origen = new URL(url).origin;
  const conocido = temaPorPestana.get(tabId);
  if (conocido?.origen === origen && (!conocido.pagina || conocido.pagina === urlDePagina(url))) return conocido;
  // Solo consulta (GET): votar no debe disparar una revisión.
  const resultado = await resolverRevision(url, { consultar: consultarRevision });
  const tema = resultado.estado === "listo" ? resultado.tema : null;
  const pagina = tema ? urlDePagina(url) : null;
  const resuelto = { origen, pagina, temaId: tema?.id ?? null, css: tema?.css ?? "" };
  temaPorPestana.set(tabId, resuelto);
  return resuelto;
}

// CSS base de las features y componentes (los `css` de content_scripts). Sin él, el
// editado mostraría la vista sin estilo y la sección original sin ocultar. Se omite
// transicion.css: todo va bajo html[data-mt-transicion], que la captura quita.
let cssFeatures = null;
function leerCssFeatures() {
  cssFeatures ??= (async () => {
    // Firefox devuelve URLs completas (moz-extension://<uuid>/…) y Chrome rutas: todo pasa a rutas
    // relativas, que el uuid es propio de cada instalación y no debe quedar en el HTML guardado.
    const raiz = browser.runtime.getURL("/");
    const archivos = browser.runtime
      .getManifest()
      .content_scripts.flatMap((cs) => cs.css ?? [])
      .map((archivo) => new URL(archivo, raiz).pathname.replace(/^\//, ""))
      .filter((archivo) => archivo !== "content/transicion.css");
    const textos = await Promise.all(
      archivos.map(async (archivo) => {
        const respuesta = await fetch(browser.runtime.getURL(archivo));
        if (!respuesta.ok) throw new Error(`No se pudo leer ${archivo} (${respuesta.status})`);
        return `/* ${archivo} */\n${await respuesta.text()}`;
      }),
    );
    return textos.join("\n");
  })();
  cssFeatures.catch(() => (cssFeatures = null)); // reintentar en la próxima llamada
  return cssFeatures;
}

async function cssParaEditado({ temaId, css }) {
  if (!temaId) return "";
  const features = await leerCssFeatures().catch((error) => {
    console.warn("[mi-tema] No se pudo leer el CSS de las features para el voto:", error);
    return "";
  });
  return `${features}\n/* tema ${temaId} */\n${css}`;
}

// Pide la captura a la pestaña. → captura | null. Si la pestaña ya navegó a otro origen
// (el tema resuelto no le corresponde), tampoco vale.
async function capturarPestana(tabId, origen) {
  try {
    const captura = await browser.tabs.sendMessage(tabId, { tipo: "voto:capturar" }, { frameId: 0 });
    return captura && new URL(captura.url).origin === origen ? captura : null;
  } catch (error) {
    console.warn("[mi-tema] No se pudo capturar la página para el voto:", error);
    return null;
  }
}

// `voto:guardar` { tabId?, voto, comentario } → { ok: true, id, pendientes } | { ok: false, codigo, error }
// `tabId` hace falta si el mensaje no viene de un content script (p. ej. un popup).
// `codigo` se traduce con la clave `error.<codigo>` del diccionario (comun/idioma.js).
//   - Ventana privada: no se guarda nada (el navegador espera que lo de esas ventanas no quede en disco).
//   - Página sin tema: solo se puede comentar, y se guarda el comentario sin capturar la página.
//   - Página con tema: se captura el HTML sin y con el tema (content/captura.js).
async function guardarVoto(mensaje, sender) {
  const validacion = validarVoto(mensaje);
  if (!validacion.ok) return validacion;

  const tabId = mensaje.tabId ?? sender.tab?.id;
  if (!Number.isInteger(tabId)) return falloVoto("sin-pestana");
  const pestana = await browser.tabs.get(tabId).catch(() => null);
  if (!pestana) return falloVoto("sin-pestana");
  if (pestana.incognito) return falloVoto("privada");
  if (!/^https?:/.test(pestana.url ?? "")) return falloVoto("sin-captura");

  const tema = await temaDePestana(tabId, pestana.url);
  if (!tema.temaId && validacion.voto !== "comentario") return falloVoto("sin-tema");

  let captura = { url: pestana.url, temaActivo: false }; // sin tema: sin HTML
  if (tema.temaId) {
    captura = await capturarPestana(tabId, tema.origen);
    if (!captura) return falloVoto("sin-captura");
  }

  try {
    const [cssTema, idUsuario] = await Promise.all([cssParaEditado(tema), obtenerIdUsuario(browser.storage.local)]);
    const registro = await crearRegistroVoto({
      idUsuario,
      voto: validacion.voto,
      comentario: validacion.comentario,
      captura: { ...captura, temaId: tema.temaId },
      cssTema,
      versionExtension: browser.runtime.getManifest().version,
    });
    await almacenVotos.guardar(registro);
    if (registro.originalOmitido || registro.editadoOmitido) {
      console.info("[mi-tema] Voto guardado sin parte del HTML por tamaño:", registro.bytes);
    }
    return { ok: true, id: registro.id, pendientes: await almacenVotos.contar() };
  } catch (error) {
    console.error("[mi-tema] No se pudo guardar el voto:", error);
    return falloVoto("guardar");
  }
}

// `votos:estado` → { pendientes } (votos guardados en el equipo, aún sin subir).
async function estadoVotos() {
  try {
    return { pendientes: await almacenVotos.contar() };
  } catch (error) {
    console.error("[mi-tema] No se pudieron contar los votos:", error);
    const { codigo, error: texto } = falloVoto("contar");
    return { pendientes: 0, codigo, error: texto };
  }
}

// Cada listener devuelve una promesa con la respuesta, o undefined si el mensaje no es suyo.
browser.runtime.onMessage.addListener((mensaje, sender) => {
  switch (mensaje?.tipo) {
    case "tema:aplicar":
      return aplicarTema(sender);
    case "tema:revision":
      return revisarPagina(sender, { esperando: true });
    case "voto:guardar":
      return guardarVoto(mensaje, sender);
    case "votos:estado":
      return estadoVotos();
    default:
      return undefined; // no es para nosotros
  }
});
