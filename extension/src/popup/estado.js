// Lógica pura del popup (sin `browser.*` ni DOM): se testea con Node (test/popup.test.js).
//
// Qué muestra la sección de opinión según la pestaña activa:
//
//   modo "completa"         la página tiene tema y Chameleon está encendido: pregunta
//                           "¿Esta página es mejor…?" con Mejor / Peor / Solo quiero comentar.
//   modo "solo-comentario"  se puede hablar con la página pero no hay con qué comparar (no
//                           tiene tema, o Chameleon está apagado): sin Mejor/Peor, solo el
//                           comentario, con un aviso que explica por qué.
//   modo "no-disponible"    la pestaña no tiene content script (about:, addons.mozilla.org,
//                           una pestaña abierta antes de instalar la extensión): no se puede
//                           capturar, así que no hay formulario, solo un aviso. También en una
//                           ventana privada: ahí no se guardan opiniones (el interruptor sí anda).
//
// `privacidad` es la clave del texto del pie que dice qué se guarda al enviar: con tema, una
// copia de la página; sin tema, solo el comentario (el background no la captura).
//
// Para saber si está encendido se usa `activo` de storage (la fuente de verdad) y no la
// clase `mi-tema` de la página: esa cambia recién a mitad de la transición.
//
// Avisos y motivos se devuelven como claves del diccionario (comun/idioma.js): el popup
// los traduce al idioma elegido, así un cambio de idioma no obliga a recalcular nada.

import "../comun/idioma.js";
import { MAX_COMENTARIO } from "../background/votos.js";

export { MAX_COMENTARIO };

const { t } = globalThis.MiTema.idioma;

// Claves del diccionario de cada aviso.
export const AVISOS = {
  noDisponible: "aviso.noDisponible",
  privada: "aviso.privada",
  sinTema: "aviso.sinTema",
  apagado: "aviso.apagado",
};

export const PRIVACIDAD = {
  conCopia: "opinion.privacidad",
  sinCopia: "opinion.privacidadSinCopia",
};

// pagina: { alcanzable, privada, temaId } (respuesta de `estado:pagina` más si la pestaña es de
// una ventana privada; alcanzable false si falló).
export function decidirVista({ activo, pagina }) {
  if (pagina?.privada) return { modo: "no-disponible", aviso: AVISOS.privada, privacidad: null };
  if (!pagina?.alcanzable) return { modo: "no-disponible", aviso: AVISOS.noDisponible, privacidad: null };
  if (!pagina.temaId) return { modo: "solo-comentario", aviso: AVISOS.sinTema, privacidad: PRIVACIDAD.sinCopia };
  if (!activo) return { modo: "solo-comentario", aviso: AVISOS.apagado, privacidad: PRIVACIDAD.conCopia };
  return { modo: "completa", aviso: null, privacidad: PRIVACIDAD.conCopia };
}

// La ayuda bajo el interruptor dice lo que hace el clic en esta pestaña. Con tema, el cambio se ve (vuelve a la
// página original o aplica el diseño); sin tema (o sin saber todavía), solo se enciende o apaga Chameleon.
export function claveDeAyuda({ activo, pagina }) {
  if (activo === null || activo === undefined) return null;
  const conTema = Boolean(pagina?.alcanzable && pagina?.temaId);
  if (conTema) return activo ? "interruptor.ayudaEncendido" : "interruptor.ayudaApagado";
  return activo ? "interruptor.ayudaEncendidoSinTema" : "interruptor.ayudaApagadoSinTema";
}

// Decide si se puede enviar y qué voto sale. `opcion` es el botón elegido
// ("mejor" | "peor" | "comentario" | null); en "solo-comentario" no hay que elegir.
// → { ok: true, voto, comentario } | { ok: false, motivo, parametros? } (motivo = clave del diccionario)
export function validarEnvio({ modo, opcion, comentario = "" }) {
  if (modo === "no-disponible") return { ok: false, motivo: "motivo.noDisponible" };
  const voto = modo === "solo-comentario" ? "comentario" : opcion;
  if (!["mejor", "peor", "comentario"].includes(voto)) return { ok: false, motivo: "motivo.elegir" };
  const texto = comentario.trim();
  if (voto === "comentario" && !texto) return { ok: false, motivo: "motivo.escribir" };
  if (texto.length > MAX_COMENTARIO) return { ok: false, motivo: "motivo.largo", parametros: { max: MAX_COMENTARIO } };
  return { ok: true, voto, comentario: texto };
}

export function textoPendientes(pendientes, idioma) {
  const n = Number.isInteger(pendientes) && pendientes > 0 ? pendientes : 0;
  return t(idioma, "opinion.pendientes", { n });
}

// Ejecuta tareas asíncronas de a una, en orden. Así dos clics rápidos en el interruptor
// cuentan como dos: si corrieran a la vez, los dos leerían el mismo `activo` viejo.
// Una tarea que falla no corta la cola; su error llega solo a quien la encoló.
export function crearCola() {
  let ultima = Promise.resolve();
  return function encolar(tarea) {
    const resultado = ultima.then(() => tarea());
    ultima = resultado.catch(() => {});
    return resultado;
  };
}
