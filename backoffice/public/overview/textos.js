// Textos del Overview a partir de los modelos puros (agentes.js, tarjetas.js, tiempo.js). Puro: recibe `t` y `fmt`
// (los del contexto de la pantalla, o en las pruebas los de formatear() y crearFormatos()). Ningún texto visible
// se escribe aquí: todos salen del diccionario (sección "overview", y "comun" donde el término ya existe).

/** Clave del diccionario de cada estado (leyenda): los resultados viven en "comun" (comun.resultado.*). */
export const CLAVE_DE_ESTADO = Object.freeze(
  Object.fromEntries(
    ["logrado", "fallido", "abandonado", "sin_medir", "error", "detenido", "en_curso", "en_cola"].map((estado) => [estado, `comun.resultado.${estado}`]),
  ),
);

/** "1,286" (en) | "1.286" (es). */
export const cifra = (n, fmt) => fmt.numero(Number(n) || 0);

/** Tasa de éxito: "89%" / "89 %", "3/4" con n chico, "—" sin medidos. */
export function textoDeExito(exito, fmt) {
  if (!exito?.medidos) return "—";
  if (exito.chico) return `${exito.logrados}/${exito.medidos}`;
  return fmt.numero(exito.pct / 100, { style: "percent", maximumFractionDigits: 0 });
}

/** "3 h", "45 min", "2 d" (la duración de "No progress for …"). */
export function textoDeDuracion(duracion, t) {
  if (!duracion) return "";
  return t(`overview.duracion.${duracion.unidad}`, { n: duracion.n });
}

/** Pie de la tarjeta: "<1 min", "12 min", "3 h 04 min" si corre; "5 hr ago" / "hace 5 h" si terminó. */
export function textoDeTiempo(tiempo, { t, fmt }) {
  if (!tiempo) return "";
  if (tiempo.tipo === "relativo") return fmt.tiempoRelativo(tiempo.fecha, tiempo.ahora);
  if (tiempo.minutos < 1) return t("overview.tiempo.menosDeUnMinuto");
  if (tiempo.minutos < 60) return t("overview.tiempo.minutos", { n: tiempo.minutos });
  return t("overview.tiempo.horas", { h: tiempo.horas, min: String(tiempo.resto).padStart(2, "0") });
}

/** "No progress for 3 h", "Rate limited · AgentCore 429", "Cataloger failed"… */
export function textoDeAviso(aviso, t) {
  if (!aviso) return "";
  if (aviso.tipo === "sin_avance") return t("overview.aviso.sin_avance", { duracion: textoDeDuracion(aviso.duracion, t) });
  return t(`overview.aviso.${aviso.tipo}`);
}

/** Nombre de un estado para la leyenda. */
export const nombreDeEstado = (estado, t) => t(CLAVE_DE_ESTADO[estado] ?? "comun.resultado.error");

/**
 * Resumen accesible de una fila de agentes (la matriz de cuadritos va aria-hidden):
 * "922 visitors: 595 succeeded, 128 failed, 128 gave up, 49 unmeasured, 22 tool errors. 70% succeeded."
 */
export function resumenDeFila(fila, { t, fmt }) {
  const partes = Object.entries(fila.conteos)
    .filter(([, n]) => n > 0)
    .map(([estado, n]) => t(`overview.resumen.estado.${estado}`, { n, cifra: cifra(n, fmt) }));
  const exito = fila.exito.medidos
    ? t("overview.resumen.exito", { texto: textoDeExito(fila.exito, fmt) })
    : t("overview.resumen.sinMedidos");
  return t("overview.resumen.fila", {
    sujeto: t(`overview.resumen.rol.${fila.rol}`, { n: fila.n, cifra: cifra(fila.n, fmt) }),
    detalle: partes.length ? partes.join(", ") : t("overview.resumen.ninguna"),
    exito,
  });
}

/** Etiqueta accesible de una tarjeta (la tarjeta entera es un enlace): "Móvil Sur · movilsur.test/ · Running · 12 min". */
export function etiquetaDeTarjeta(modelo, { t, fmt }) {
  return t("overview.tarjeta.etiqueta", {
    sitio: modelo.sitio,
    direccion: `${modelo.host}${modelo.ruta}`,
    estado: t(`overview.estado.${modelo.estado}`),
    tiempo: textoDeTiempo(modelo.tiempo, { t, fmt }),
  });
}
