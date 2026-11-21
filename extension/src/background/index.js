// Background de la extensión (módulo ES).
// En Firefox MV3 corre como "event page" (background.scripts), NO como service worker.
//
// Responsabilidades:
//   1. Botón de la barra: activa/desactiva el tema (guarda `activo` en storage).
//   2. Preguntarle a la API qué tema corresponde a cada página e inyectar su CSS.

import { consultarTema } from "./api.js";
import { cargarTemaLocal } from "./temas-locales.js";
import { resolverTema } from "./temas.js";

// ---------- 1. Botón de la barra de herramientas ----------

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

// Clic en el ícono: invierte el estado y lo guarda.
// content/motor.js escucha el cambio en storage y aplica/quita el tema al instante.
// Los clics se encolan: leer y guardar son asíncronos, y dos clics seguidos que leyeran
// el mismo valor viejo contarían como uno solo.
let clicsPendientes = Promise.resolve();

async function alternar() {
  const activo = !(await leerActivo());
  await browser.storage.local.set({ activo });
  await pintarBadge(activo);
}

browser.action.onClicked.addListener(() => {
  clicsPendientes = clicsPendientes.then(alternar, alternar);
  return clicsPendientes;
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

  const { css, ...resto } = tema;
  return resto;
}

browser.runtime.onMessage.addListener((mensaje, sender) => {
  if (mensaje?.tipo === "tema:aplicar") return aplicarTema(sender);
  return undefined; // no es para nosotros
});
