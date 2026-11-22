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

/**
 * Cómo va un goal, para el riel de la hoja en vivo: "ruta" (la Guía arma la ruta), "visita" (los Visitantes
 * recorren), "tanda" (terminó con tanda), "fallido" (la Guía o el Visitante fallaron, o se saltó) o "espera".
 */
export function faseDeGoal(goal) {
  const guia = goal?.guide?.estado;
  const visitante = goal?.visitor?.estado;
  if (tandaDelGoal(goal)) return "tanda";
  if (guia === "failed" || visitante === "failed" || visitante === "skipped") return "fallido";
  if (visitante === "running" || visitante === "succeeded") return "visita";
  if (guia === "running" || guia === "succeeded") return "ruta";
  return "espera";
}

const PUNTO_DE_FASE = { ruta: "en_curso", visita: "en_curso", tanda: "logrado", fallido: "fallido", espera: "espera" };

/** La fila del riel de un goal: { id, punto, nombre, cifra }. La cifra es la fase, corta (Route, Live, Done…). */
export function filaDeGoal(goal, t) {
  const fase = faseDeGoal(goal);
  return { id: goal?.goal ?? "", punto: PUNTO_DE_FASE[fase], nombre: goal?.goal ?? "", cifra: t(`vivo.riel.fase.${fase}`), cifraAviso: fase === "fallido" };
}
