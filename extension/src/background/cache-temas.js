// Temas de revisión ya saneados, guardados en el equipo por página (urlDePagina) para aplicarlos al cargar sin esperar
// a la API. Sin `browser.*`: `area` es browser.storage.local (ver test/cache-temas.test.js).
//
// Cada tema va en su propia clave (`tema:<pagina>` → { revision, tema }) y el índice `temasGuardados`
// ({ pagina: usadoEn }) decide cuáles se descartan: quedan los MAXIMO_TEMAS_GUARDADOS usados más recientemente.
// Así, marcar un tema como usado no reescribe el CSS de todos. Nunca lanza: sin almacén, la página espera a la API.

export const CLAVE_INDICE_TEMAS = "temasGuardados";
export const MAXIMO_TEMAS_GUARDADOS = 50;

export const claveTema = (pagina) => `tema:${pagina}`;

const esGuardado = (valor) =>
  typeof valor?.revision === "string" && typeof valor.tema?.id === "string" && typeof valor.tema.css === "string";

export function crearCacheTemas(area, { maximo = MAXIMO_TEMAS_GUARDADOS, ahora = Date.now, log = console } = {}) {
  // Los cambios al índice van en fila: dos pestañas guardando a la vez no deben perder entradas.
  let fila = Promise.resolve();
  function enFila(accion, cambio) {
    const hecho = fila.then(cambio).catch((error) => log.warn(`[mi-tema] No se pudo ${accion} el tema guardado:`, error));
    fila = hecho;
    return hecho;
  }

  async function leerIndice() {
    const { [CLAVE_INDICE_TEMAS]: indice } = await area.get(CLAVE_INDICE_TEMAS);
    return indice && typeof indice === "object" && !Array.isArray(indice) ? indice : {};
  }

  // → { revision, tema } | null. Marca el uso sin esperar a que se escriba.
  async function leer(pagina) {
    try {
      const { [claveTema(pagina)]: guardado } = await area.get(claveTema(pagina));
      if (!esGuardado(guardado)) return null;
      enFila("marcar", async () => {
        const indice = await leerIndice();
        if (pagina in indice) await area.set({ [CLAVE_INDICE_TEMAS]: { ...indice, [pagina]: ahora() } });
      });
      return guardado;
    } catch (error) {
      log.warn("[mi-tema] No se pudo leer el tema guardado:", error);
      return null;
    }
  }

  function guardar(pagina, revision, tema) {
    return enFila("guardar", async () => {
      const indice = { ...(await leerIndice()), [pagina]: ahora() };
      const sobrantes = Object.keys(indice)
        .sort((a, b) => indice[b] - indice[a])
        .slice(maximo);
      for (const vieja of sobrantes) delete indice[vieja];
      await area.set({ [claveTema(pagina)]: { revision, tema }, [CLAVE_INDICE_TEMAS]: indice });
      if (sobrantes.length) await area.remove(sobrantes.map(claveTema));
    });
  }

  function olvidar(pagina) {
    return enFila("olvidar", async () => {
      const { [pagina]: _, ...indice } = await leerIndice();
      await area.set({ [CLAVE_INDICE_TEMAS]: indice });
      await area.remove(claveTema(pagina));
    });
  }

  return { leer, guardar, olvidar };
}
