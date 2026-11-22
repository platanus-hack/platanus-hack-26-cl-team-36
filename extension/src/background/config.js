// URL base de la API (carpeta backend/ del repo). Hay dos:
//   - AWS: la API desplegada en api.chameleonmode.app (ver infra/README.md). Lee cada revisión de DynamoDB y su
//     tema.css de S3. La usa la extensión instalada (.xpi) y, por defecto, también la de desarrollo
//     (`npm run dev`, `just local up`): sin AWS, el backend local no tiene revisiones.
//   - Local: `npm run dev:backend` o `just local up`. Solo en modo desarrollo y si se pide, desde la consola del
//     background (Firefox: about:debugging → Inspeccionar; Chrome: chrome://extensions → "service worker"):
//     `browser.storage.local.set({ apiLocal: true })`; `false` vuelve a la de AWS. Sirve para probar cambios del backend.
// `host_permissions` del manifest debe cubrir los dos dominios, SIN puerto (Firefox no
// acepta puertos ahí). test/api.test.js lo verifica.
export const API_URL_LOCAL = "http://localhost:4747";
export const API_URL_AWS = "https://api.chameleonmode.app";
export const CLAVE_API_LOCAL = "apiLocal";

// installType "development": en Firefox, la extensión temporal (web-ext o about:debugging); en Chrome, toda
// extensión cargada desempaquetada (web-ext o "Cargar descomprimida"), que es como se instala en Chrome.
// getSelf() no necesita el permiso "management". Fuera de un navegador (tests) no hay `browser`: false.
export async function enDesarrollo() {
  const extension = await globalThis.browser?.management?.getSelf();
  return extension?.installType === "development";
}

// Para onInstalled: ¿se acaba de cargar o recargar en modo desarrollo? Firefox lo avisa con `temporary` (solo true con
// web-ext o about:debugging). Chrome no lo tiene: ahí cuenta la extensión desempaquetada al instalarla o recargarla
// (reason "install"/"update"), no cuando se actualiza el navegador ("chrome_update").
export async function recargadaEnDesarrollo({ reason, temporary } = {}) {
  if (typeof temporary === "boolean") return temporary;
  return (reason === "install" || reason === "update") && (await enDesarrollo());
}

export async function urlDeLaApi() {
  if (!(await enDesarrollo())) return API_URL_AWS;
  const guardado = (await globalThis.browser.storage?.local.get(CLAVE_API_LOCAL)) ?? {};
  return guardado[CLAVE_API_LOCAL] === true ? API_URL_LOCAL : API_URL_AWS;
}
