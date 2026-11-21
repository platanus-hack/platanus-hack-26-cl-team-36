// Background de la extensión (módulo ES).
// En Firefox MV3 corre como "event page" (background.scripts), NO como service worker.
//
// Responsabilidades:
//   1. Botón de la barra: activa/desactiva el tema (guarda `activo` en storage).
//   2. Resolver qué tema corresponde a cada página e inyectar su CSS.

import { proveedorLocal } from "./proveedor-local.js";

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

browser.runtime.onInstalled.addListener(async () => pintarBadge(await leerActivo()));
browser.runtime.onStartup.addListener(async () => pintarBadge(await leerActivo()));

// ---------- 2. Temas ----------

// Orden de prioridad. Futuro: [proveedorApi, proveedorLocal].
const proveedores = [proveedorLocal];

async function buscarTema(url) {
  for (const proveedor of proveedores) {
    try {
      const tema = await proveedor.buscar(url);
      if (tema) return tema;
    } catch (error) {
      console.error("[mi-tema] Error en proveedor de temas:", error);
    }
  }
  return null;
}

// El content script pide su tema al cargar. Inyectamos el CSS desde aquí con
// scripting.insertCSS (no le afecta la CSP de la página) y le devolvemos al
// content script solo lo que necesita para las features.
async function aplicarTema(sender) {
  const tema = await buscarTema(sender.url);
  if (!tema) return null;

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
