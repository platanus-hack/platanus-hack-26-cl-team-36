// Respuestas de revisión guardadas en el equipo ({ revision, css, tema? } tal como llegaron de la API) para aplicar el
// tema al cargar sin esperarla. Se guardan crudas: quien las lee las sanea (temaDeRevision) antes de inyectarlas.
// Sin `browser.*`: `area` es browser.storage.local (ver test/cache-temas.test.js).
//
// Cada respuesta va en su propia clave (`tema:<clave>`) y el índice `temasGuardados` ({ clave: { usadoEn, bytes } })
// decide cuáles se descartan: las de uso más antiguo, hasta quedar en MAXIMO_TEMAS_GUARDADOS y MAXIMO_BYTES_TEMAS.
// Se descarta antes de escribir para no llenar storage.local, que comparte cuota con `activo`, el idioma, etc.
// Nunca lanza: sin almacén, la página espera a la API.

export const CLAVE_INDICE_TEMAS = "temasGuardados";
export const MAXIMO_TEMAS_GUARDADOS = 50;
export const MAXIMO_BYTES_TEMAS = 2 * 1024 * 1024;

export const claveTema = (clave) => `tema:${clave}`;

const bytesDe = (valor) => new TextEncoder().encode(JSON.stringify(valor)).length;

const esGuardado = (valor) => typeof valor?.revision === "string" && typeof valor.css === "string";

const esEntrada = (entrada) => Number.isFinite(entrada?.usadoEn) && Number.isFinite(entrada?.bytes);

export function crearCacheTemas(
  area,
  { maximo = MAXIMO_TEMAS_GUARDADOS, maximoBytes = MAXIMO_BYTES_TEMAS, ahora = Date.now, log = console } = {},
) {
  // Los cambios al índice van en fila: dos pestañas guardando a la vez no deben perder entradas.
  let fila = Promise.resolve();
  function enFila(accion, cambio) {
    const hecho = fila.then(cambio).catch((error) => log.warn(`[mi-tema] No se pudo ${accion} el tema guardado:`, error));
    fila = hecho;
    return hecho;
  }

  async function leerIndice() {
    const { [CLAVE_INDICE_TEMAS]: indice } = await area.get(CLAVE_INDICE_TEMAS);
    if (!indice || typeof indice !== "object" || Array.isArray(indice)) return {};
    return Object.fromEntries(Object.entries(indice).filter(([, entrada]) => esEntrada(entrada)));
  }

  // → { revision, css, tema? } | null. Marca el uso sin esperar a que se escriba.
  async function leer(clave) {
    try {
      const { [claveTema(clave)]: guardado, [CLAVE_INDICE_TEMAS]: indice } = await area.get([
        claveTema(clave),
        CLAVE_INDICE_TEMAS,
      ]);
      if (!esGuardado(guardado) || !esEntrada(indice?.[clave])) return null;
      enFila("marcar", async () => {
        const actual = await leerIndice();
        if (!actual[clave]) return;
        await area.set({ [CLAVE_INDICE_TEMAS]: { ...actual, [clave]: { ...actual[clave], usadoEn: ahora() } } });
      });
      return guardado;
    } catch (error) {
      log.warn("[mi-tema] No se pudo leer el tema guardado:", error);
      return null;
    }
  }

  function guardar(clave, respuesta) {
    return enFila("guardar", async () => {
      const bytes = bytesDe(respuesta);
      const { [clave]: _, ...otras } = await leerIndice();
      if (bytes > maximoBytes) {
        await area.remove(claveTema(clave));
        await area.set({ [CLAVE_INDICE_TEMAS]: otras });
        return;
      }
      const recientes = Object.entries(otras).sort(([, a], [, b]) => b.usadoEn - a.usadoEn);
      const quedan = {};
      const sobrantes = [];
      let total = bytes;
      for (const [otra, entrada] of recientes) {
        if (Object.keys(quedan).length + 1 < maximo && total + entrada.bytes <= maximoBytes) {
          quedan[otra] = entrada;
          total += entrada.bytes;
        } else sobrantes.push(otra);
      }
      if (sobrantes.length) await area.remove(sobrantes.map(claveTema));
      await area.set({ [claveTema(clave)]: respuesta });
      await area.set({ [CLAVE_INDICE_TEMAS]: { ...quedan, [clave]: { usadoEn: ahora(), bytes } } });
    });
  }

  function olvidar(clave) {
    return enFila("olvidar", async () => {
      const { [clave]: _, ...indice } = await leerIndice();
      await area.set({ [CLAVE_INDICE_TEMAS]: indice });
      await area.remove(claveTema(clave));
    });
  }

  return { leer, guardar, olvidar };
}
