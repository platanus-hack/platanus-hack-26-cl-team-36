// Background de la extensión (módulo ES).
// En Firefox MV3 corre como "event page" (background.scripts), NO como service worker.
//
// Responsabilidades:
//   1. Botón de la barra: activa/desactiva el tema (guarda `activo` en storage).
//   2. Resolver qué tema corresponde a cada página e inyectar su CSS.

import { proveedorApi } from "./proveedor-api.js";
import { proveedorLocal } from "./proveedor-local.js";
import { buscarEnProveedores } from "./temas.js";

// ---------- 1. Botón de la barra de herramientas ----------

async function leerActivo() {
  const { activo = true } = await browser.storage.local.get("activo");
  return activo;
}

async function pintarBadge(activo) {
  await browser.action.setBadgeText({ text: activo ? "ON" : "" });
  await browser.action.setBadgeBackgroundColor({ color: "#7c3aed" });
}

// Clic en el ícono: invierte el estado y lo guarda.
// content/motor.js escucha el cambio en storage y aplica/quita el tema al instante.
browser.action.onClicked.addListener(async () => {
  const activo = !(await leerActivo());
  await browser.storage.local.set({ activo });
  await pintarBadge(activo);
});

browser.runtime.onStartup.addListener(async () => pintarBadge(await leerActivo()));

// onInstalled se dispara al instalar y cada vez que `npm run dev` recarga la extensión.
// `temporary` solo es true si la extensión se cargó con web-ext o about:debugging.
browser.runtime.onInstalled.addListener(async ({ temporary }) => {
  await pintarBadge(await leerActivo());
  if (temporary) await refrescarPestanasDelSitio();
});

// En desarrollo, al recargar la extensión las pestañas abiertas siguen con el
// CSS/JS anterior. Las refrescamos para ver el cambio sin tocar nada.
async function refrescarPestanasDelSitio() {
  const patrones = browser.runtime.getManifest().content_scripts.flatMap((cs) => cs.matches);
  const pestanas = await browser.tabs.query({ url: patrones });
  // Sin permiso sobre una pestaña, `url` viene vacía: nunca refrescamos pestañas ajenas.
  const delSitio = pestanas.filter((p) => p.url);
  if (delSitio.length === 0) return;
  console.info(`[mi-tema] Modo desarrollo: refrescando ${delSitio.length} pestaña(s).`);
  await Promise.all(delSitio.map((p) => browser.tabs.reload(p.id)));
}

// ---------- 2. Temas ----------

// Orden de prioridad: primero el backend; si no tiene tema o no responde, los locales.
const proveedores = [proveedorApi, proveedorLocal];

// El content script pide su tema al cargar. Inyectamos el CSS desde aquí con
// scripting.insertCSS (no le afecta la CSP de la página) y le devolvemos al
// content script solo lo que necesita para las features.
async function aplicarTema(sender) {
  const tema = await buscarEnProveedores(proveedores, sender.url);
  if (!tema) return null;
  console.info(`[mi-tema] Tema "${tema.id}" aplicado en ${new URL(sender.url).origin}`);

  await browser.scripting.insertCSS({
    target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
    css: tema.css,
  });

  const { css, ...resto } = tema;
  return resto;
}

browser.runtime.onMessage.addListener((mensaje, sender) => {
  if (mensaje?.tipo === "tema:aplicar") return aplicarTema(sender);
  return undefined; // no es para nosotros
});
