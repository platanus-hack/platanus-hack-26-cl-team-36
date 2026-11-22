// La hoja de una revisión fallida (#/f/<revision>): dónde se detuvo la cadena de agentes y por qué. Puro: no toca
// document ni window. Trabaja sobre la tarjeta del Overview (GET /api/tarjetas/<revision>: sitio, etapas, motivo,
// capturas) y el avance de la revisión (GET /api/revisiones/<revision>: las corridas de cada etapa y sus archivos).

/** Las etapas en el orden de la cadena. */
export const ETAPAS = Object.freeze(["catalog", "guide", "visitor", "improver"]);
/** Los motivos que tienen texto propio; cualquier otro es "error". */
export const MOTIVOS = Object.freeze(["limite", "catalogador", "guia", "disenador", "error"]);

/** El estado de una etapa en la tarjeta → el de la cadena: hecho, fallido, en_curso o no_corrio. */
function estadoDeEtapa(valor) {
  if (valor === "hecho") return "hecho";
  if (valor === "fallido" || valor === "detenido") return "fallido";
  if (valor === "en_curso") return "en_curso";
  return "no_corrio";
}

/** Las corridas de una etapa en el avance: la del catálogo y la del Diseñador, o la de cada goal (Guía, Visitante). */
function corridasDe(fase, avance) {
  if (fase === "catalog") return avance?.catalogo ? [avance.catalogo] : [];
  if (fase === "improver") return avance?.improver ? [avance.improver] : [];
  return (avance?.goals ?? []).map((goal) => goal?.[fase]).filter(Boolean);
}

/** La clave del manifest.json de la corrida que falló en esa etapa (o de la última que corrió), o null. */
export function manifiestoDe(fase, avance) {
  const corridas = corridasDe(fase, avance);
  const elegida = corridas.find((corrida) => corrida?.estado === "failed") ?? corridas.at(-1);
  return elegida?.resultados?.find((resultado) => resultado?.archivo === "manifest.json")?.clave ?? null;
}

const ms = (iso) => {
  const valor = Date.parse(iso ?? "");
  return Number.isFinite(valor) ? valor : null;
};

/**
 * El modelo de la hoja. → { revision, sitio, host, url, etapa (la que falló, o null), etapas: [{ fase, estado }],
 * motivo: { tipo, detalle }, segundos (de creada a la última actualización, o null), actualizada, manifiesto (clave o
 * null), anteriores, captura ({ tanda, carpeta, archivo } o null) }.
 */
export function modeloDeFalla({ tarjeta, avance = null, revision }) {
  const etapas = ETAPAS.map((fase) => ({ fase, estado: estadoDeEtapa(tarjeta?.etapas?.[fase]) }));
  // Sin etapa marcada en la tarjeta, la que tenga una corrida fallida en el avance.
  let etapa = etapas.find((cada) => cada.estado === "fallido")?.fase ?? null;
  if (!etapa) {
    etapa = ETAPAS.find((fase) => corridasDe(fase, avance).some((corrida) => corrida?.estado === "failed")) ?? null;
    if (etapa) etapas.find((cada) => cada.fase === etapa).estado = "fallido";
  }
  // Después de la que falló, nada corrió (aunque la tarjeta diga "pendiente").
  if (etapa) {
    for (const cada of etapas.slice(ETAPAS.indexOf(etapa) + 1)) if (cada.estado !== "hecho") cada.estado = "no_corrio";
  }
  const tipo = MOTIVOS.includes(tarjeta?.motivo?.tipo) ? tarjeta.motivo.tipo : "error";
  const desde = ms(tarjeta?.creada ?? avance?.creada);
  const actualizada = tarjeta?.actualizada ?? avance?.actualizada ?? null;
  const hasta = ms(actualizada);
  const captura = tarjeta?.capturas?.desktop ?? tarjeta?.capturas?.mobile ?? null;
  return {
    revision: String(revision ?? tarjeta?.revision ?? ""),
    sitio: tarjeta?.sitio || tarjeta?.host || avance?.host || "",
    host: tarjeta?.host || avance?.host || "",
    url: tarjeta?.url ?? avance?.url ?? null,
    etapa,
    etapas,
    motivo: { tipo, detalle: typeof tarjeta?.motivo?.detalle === "string" && tarjeta.motivo.detalle ? tarjeta.motivo.detalle : null },
    segundos: desde !== null && hasta !== null && hasta >= desde ? Math.round((hasta - desde) / 1000) : null,
    actualizada,
    manifiesto: etapa ? manifiestoDe(etapa, avance) : null,
    anteriores: Number.isInteger(tarjeta?.anteriores) && tarjeta.anteriores > 0 ? tarjeta.anteriores : 0,
    captura: captura && typeof captura.tanda === "string" && typeof captura.carpeta === "string" && typeof captura.archivo === "string" ? captura : null,
  };
}
