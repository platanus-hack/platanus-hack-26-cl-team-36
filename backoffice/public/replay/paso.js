// Lo que el Replay deduce de un paso para mostrarlo. Puro: no toca document ni window, así node:test lo importa.

const TONO_DE_SENAL = { no_effect: "aviso", went_back: "aviso", revisit: "aviso", visible_error: "peligro", security_block: "peligro" };

/**
 * Tono de un paso para la lista y las marcas de la línea de tiempo: "peligro" (error visible, bloqueo), "aviso"
 * (sin efecto, volvió atrás), "fuera" (sin señales pero fuera de la ruta) o null.
 * @param {{ senales?: string[], carril?: string }} paso
 */
export function tonoDelPaso(paso) {
  const tonos = (paso?.senales ?? []).map((senal) => TONO_DE_SENAL[senal] ?? "aviso");
  if (tonos.includes("peligro")) return "peligro";
  if (tonos.length) return "aviso";
  return paso?.carril === "fuera-de-ruta" ? "fuera" : null;
}

/**
 * Descripción corta de un paso para la lista: la etiqueta que el explorador antepone a su expectativa
 * («[rama 1, buscador] Espero ver…» → «rama 1, buscador»); si no la hay, la expectativa entera (la lista la recorta)
 * y, si tampoco, la descripción de la acción.
 * @param {{ expectativa?: string, descripcion?: string }} paso
 */
export function resumenDelPaso(paso) {
  const expectativa = String(paso?.expectativa ?? "").trim();
  const etiqueta = /^\[([^\]]+)\]/.exec(expectativa)?.[1]?.trim();
  return etiqueta || expectativa || String(paso?.descripcion ?? "").trim();
}

