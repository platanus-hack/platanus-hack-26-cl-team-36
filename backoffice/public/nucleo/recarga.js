// Recarga la página una vez cuando un módulo de esta versión ya no carga (un despliegue nuevo cambió los
// archivos): la página nueva trae módulos que calzan entre sí. La marca en sessionStorage guarda la versión que ya
// recargó, así un módulo que de verdad falta no recarga en bucle.

const CLAVE = "backoffice:recargaPorVersion";

/** La versión de la página: el <versión> de /backoffice/v/<versión>/…, o "" si se sirve sin versión. */
export const versionDe = (url) => /\/v\/([^/]+)\//.exec(new URL(url).pathname)?.[1] ?? "";

/**
 * Recarga si esta versión todavía no recargó. → true si recarga (quien llama no muestra nada más).
 * @param {{ version?: string, almacen?: Storage | null, recargar?: () => void }} [opciones]
 */
export function recargarUnaVez({
  version = versionDe(import.meta.url),
  almacen = globalThis.sessionStorage ?? null,
  recargar = () => location.reload(),
} = {}) {
  try {
    if (!almacen || almacen.getItem(CLAVE) === version) return false;
    almacen.setItem(CLAVE, version);
  } catch {
    return false;
  }
  recargar();
  return true;
}
