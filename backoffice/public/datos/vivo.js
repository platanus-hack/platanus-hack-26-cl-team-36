// Cuándo un goal de una revisión ofrece su telaraña en vivo y qué muestra su indicador. Puro: node:test lo importa.

const CERRADO = new Set(["succeeded", "failed", "skipped"]);
export const RECIENTE_MS = 30 * 60 * 1000;

/** Un goal con la Guía o el Visitante corriendo, o que cerró una de las dos hace menos de RECIENTE_MS. */
export function goalEnVivo(goal, ahora = Date.now()) {
  const etapas = [goal?.guide, goal?.visitor].filter(Boolean);
  if (etapas.some((etapa) => etapa.estado === "running")) return true;
  return etapas.some((etapa) => {
    const cuando = Date.parse(etapa.actualizada ?? "");
    return CERRADO.has(etapa.estado) && Number.isFinite(cuando) && ahora - cuando < RECIENTE_MS;
  });
}

/** El id de la tanda que dejó el Visitante del goal, o null mientras no exista. */
export const tandaDelGoal = (goal) => goal?.visitor?.resultados?.find((resultado) => resultado.tanda)?.tanda ?? null;

/**
 * El estado del indicador: el de la transmisión, salvo que la revisión ya diga que el Visitante cerró (una
 * reconexión a un goal terminado puede no traer `fin`). → "conectando" | "en-vivo" | "reconectando" | "terminado" | "error"
 */
export function estadoDelVivo(estadoDeLaFuente, goal) {
  if (estadoDeLaFuente === "terminado" || CERRADO.has(goal?.visitor?.estado)) return "terminado";
  return estadoDeLaFuente ?? "conectando";
}
