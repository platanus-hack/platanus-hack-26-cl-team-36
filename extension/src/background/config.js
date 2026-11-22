// URL base del backend (carpeta backend/ del repo). Hay dos:
//   - Local: `npm run dev:backend` o `just local up`. La usa la extensión cargada en
//     modo desarrollo (`npm run dev`, `just local up`).
//   - AWS: la API desplegada en api.chameleonmode.app (ver infra/README.md). La usa la extensión instalada (.xpi).
// `host_permissions` del manifest debe cubrir los dos dominios, SIN puerto (Firefox no
// acepta puertos ahí). test/api.test.js lo verifica.
export const API_URL_LOCAL = "http://localhost:4747";
export const API_URL_AWS = "https://api.chameleonmode.app";

// web-ext y about:debugging cargan la extensión como temporal: installType "development".
// getSelf() no necesita el permiso "management". Fuera de Firefox (tests) no hay
// `browser`, y se usa la de AWS.
export async function urlDeLaApi() {
  const extension = await globalThis.browser?.management?.getSelf();
  return extension?.installType === "development" ? API_URL_LOCAL : API_URL_AWS;
}
