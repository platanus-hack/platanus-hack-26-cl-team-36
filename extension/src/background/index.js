// Background de la extensión (módulo ES).
// En Firefox MV3 corre como "event page" (background.scripts), NO como service worker.
//
// Responsabilidades:
//   1. Badge ON/OFF del ícono, sincronizado con `activo` en storage (el interruptor está en el popup).
//   2. Preguntarle a la API qué tema corresponde a cada página e inyectar su CSS.
//   3. Guardar en el equipo los votos del usuario sobre la página con tema (ver votos.js).

import { crearAdaptadorIndexedDB } from "./almacen-votos-idb.js";
import { consultarTema } from "./api.js";
import { cargarTemaLocal } from "./temas-locales.js";
import { resolverTema } from "./temas.js";
import { crearAlmacenVotos, crearRegistroVoto, falloVoto, obtenerIdUsuario, validarVoto } from "./votos.js";

// ---------- 1. Estado ON/OFF y badge ----------

// El ON/OFF vive en el popup (popup/popup.js), que guarda `activo` en storage.local;
// content/motor.js escucha ese cambio y anima la página. Acá solo se pinta el badge,
// escuchando storage: así queda al día venga de donde venga el cambio.

async function leerActivo() {
  const { activo = true } = await browser.storage.local.get("activo");
  return activo;
}

async function pintarBadge(activo) {
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

// onInstalled se dispara al instalar y cada vez que `npm run dev` recarga la extensión.
// `temporary` solo es true si la extensión se cargó con web-ext o about:debugging.
browser.runtime.onInstalled.addListener(async ({ temporary }) => {
  await pintarBadge(await leerActivo());
  if (temporary) await refrescarPestanasConTema();
});

// En desarrollo, al recargar la extensión las pestañas abiertas siguen con el
// CSS/JS anterior. Refrescamos las que tenían un tema aplicado (content/motor.js
// les deja el atributo data-mt-tema en <html>) para ver el cambio sin tocar nada.
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
        return null; // páginas donde Firefox no deja inyectar (ej. addons.mozilla.org)
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
async function aplicarTema(sender) {
  const tema = await resolverTema(sender.url, { consultarApi: consultarTema, cargarTema: cargarTemaLocal });
  if (!tema) return null;
  console.info(`[mi-tema] Tema "${tema.id}" aplicado en ${new URL(sender.url).origin}`);

  await browser.scripting.insertCSS({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    css: tema.css,
  });
  if (sender.frameId === 0) cssPorPestana.set(sender.tab.id, { temaId: tema.id, css: tema.css });

  const { css, ...resto } = tema;
  return resto;
}

// ---------- 3. Votos ----------

// Los votos (con el HTML de la página) se guardan solo en el equipo, en IndexedDB.
// La subida al servidor todavía no existe: ver sincronizarVotos en votos.js.
const almacenVotos = crearAlmacenVotos(crearAdaptadorIndexedDB());

// CSS que aplicarTema inyectó en cada pestaña, para incrustarlo en el HTML "editado".
// Firefox descarga el background tras un rato sin uso y esto se pierde: por eso, si no
// está (o es de otro tema), se vuelve a cargar el tema por su id.
const cssPorPestana = new Map(); // tabId → { temaId, css }
browser.tabs.onRemoved.addListener((tabId) => cssPorPestana.delete(tabId));

// CSS base de las features y componentes (los `css` de content_scripts). Sin él, el
// editado mostraría la vista sin estilo y la sección original sin ocultar. Se omite
// transicion.css: todo va bajo html[data-mt-transicion], que la captura quita.
let cssFeatures = null;
function leerCssFeatures() {
  cssFeatures ??= (async () => {
    // Firefox devuelve URLs completas (moz-extension://<uuid>/…): se pasan a rutas relativas,
    // que el uuid es propio de cada instalación y no debe quedar en el HTML guardado.
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

async function cssParaEditado(tabId, temaId) {
  if (!temaId) return "";
  const inyectado = cssPorPestana.get(tabId);
  let cssTema = inyectado?.temaId === temaId ? inyectado.css : null;
  if (cssTema === null) {
    try {
      cssTema = (await cargarTemaLocal(temaId)).css;
    } catch (error) {
      console.warn(`[mi-tema] No se pudo cargar el CSS del tema "${temaId}" para el voto:`, error);
      cssTema = "";
    }
  }
  const features = await leerCssFeatures().catch((error) => {
    console.warn("[mi-tema] No se pudo leer el CSS de las features para el voto:", error);
    return "";
  });
  return `${features}\n/* tema ${temaId} */\n${cssTema}`;
}

// `voto:guardar` { tabId?, voto, comentario } → { ok: true, id, pendientes } | { ok: false, codigo, error }
// `tabId` hace falta si el mensaje no viene de un content script (p. ej. un popup).
// `codigo` se traduce con la clave `error.<codigo>` del diccionario (comun/idioma.js).
async function guardarVoto(mensaje, sender) {
  const validacion = validarVoto(mensaje);
  if (!validacion.ok) return validacion;

  const tabId = mensaje.tabId ?? sender.tab?.id;
  if (!Number.isInteger(tabId)) return falloVoto("sin-pestana");

  let captura;
  try {
    captura = await browser.tabs.sendMessage(tabId, { tipo: "voto:capturar" }, { frameId: 0 });
  } catch (error) {
    console.warn("[mi-tema] No se pudo capturar la página para el voto:", error);
    captura = null;
  }
  if (!captura) return falloVoto("sin-captura");
  if (!captura.temaId && validacion.voto !== "comentario") return falloVoto("sin-tema");

  try {
    const [cssTema, idUsuario] = await Promise.all([
      cssParaEditado(tabId, captura.temaId),
      obtenerIdUsuario(browser.storage.local),
    ]);
    const registro = await crearRegistroVoto({
      idUsuario,
      voto: validacion.voto,
      comentario: validacion.comentario,
      captura,
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
    case "voto:guardar":
      return guardarVoto(mensaje, sender);
    case "votos:estado":
      return estadoVotos();
    default:
      return undefined; // no es para nosotros
  }
});
