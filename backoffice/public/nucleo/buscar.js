// Normalizar texto para buscar sin tildes ni mayúsculas (la búsqueda de Corridas). Pura.

/** Sin tildes y en minúsculas: "Telaraña" → "telarana". */
export function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}
