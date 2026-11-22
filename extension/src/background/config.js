// URL base de la API (carpeta backend/ del repo). Hay dos:
//   - AWS: la API desplegada en api.chameleonmode.app (ver infra/README.md). Lee cada revisión de DynamoDB y su
//     tema.css de S3. La usa la extensión instalada (.xpi) y, por defecto, también la de desarrollo
//     (`npm run dev`, `just local up`): sin AWS, el backend local no tiene revisiones.
//   - Local: `npm run dev:backend` o `just local up`. Solo en modo desarrollo y si se pide, desde la consola del
//     background (about:debugging → Inspeccionar): `browser.storage.local.set({ apiLocal: true })`; `false` vuelve
//     a la de AWS. Sirve para probar cambios del backend.
// `host_permissions` del manifest debe cubrir los dos dominios, SIN puerto (Firefox no
// acepta puertos ahí). test/api.test.js lo verifica.
export const API_URL_LOCAL = "http://localhost:4747";
export const API_URL_AWS = "https://api.chameleonmode.app";
export const CLAVE_API_LOCAL = "apiLocal";

// web-ext y about:debugging cargan la extensión como temporal: installType "development".
// getSelf() no necesita el permiso "management". Fuera de Firefox (tests) no hay
// `browser`, y se usa la de AWS.
export async function urlDeLaApi() {
  const navegador = globalThis.browser;
  const extension = await navegador?.management?.getSelf();
  if (extension?.installType !== "development") return API_URL_AWS;
  const guardado = (await navegador.storage?.local.get(CLAVE_API_LOCAL)) ?? {};
  return guardado[CLAVE_API_LOCAL] === true ? API_URL_LOCAL : API_URL_AWS;
}
