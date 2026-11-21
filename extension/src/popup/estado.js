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
//                           capturar, así que no hay formulario, solo un aviso.
//
// Para saber si está encendido se usa `activo` de storage (la fuente de verdad) y no la
// clase `mi-tema` de la página: esa cambia recién a mitad de la transición.

import { MAX_COMENTARIO } from "../background/votos.js";

export { MAX_COMENTARIO };

export const AVISOS = {
  noDisponible:
    "Chameleon no puede leer esta pestaña. Las páginas internas de Firefox no lo permiten; si es un sitio web, recárgalo.",
  sinTema: "Esta página todavía no tiene un tema de Chameleon. Cuéntanos qué te gustaría cambiar.",
  apagado: "Chameleon está apagado. Enciéndelo para comparar con la página original, o déjanos un comentario.",
};

// pagina: { alcanzable, temaId } (respuesta de `estado:pagina`, o alcanzable false si falló).
export function decidirVista({ activo, pagina }) {
  if (!pagina?.alcanzable) return { modo: "no-disponible", aviso: AVISOS.noDisponible };
  if (!pagina.temaId) return { modo: "solo-comentario", aviso: AVISOS.sinTema };
  if (!activo) return { modo: "solo-comentario", aviso: AVISOS.apagado };
  return { modo: "completa", aviso: null };
}

// Decide si se puede enviar y qué voto sale. `opcion` es el botón elegido
// ("mejor" | "peor" | "comentario" | null); en "solo-comentario" no hay que elegir.
// → { ok: true, voto, comentario } | { ok: false, motivo }
export function validarEnvio({ modo, opcion, comentario = "" }) {
  if (modo === "no-disponible") return { ok: false, motivo: "No se puede opinar sobre esta pestaña." };
  const voto = modo === "solo-comentario" ? "comentario" : opcion;
  if (!["mejor", "peor", "comentario"].includes(voto)) return { ok: false, motivo: "Elige una opción para enviar." };
  const texto = comentario.trim();
  if (voto === "comentario" && !texto) return { ok: false, motivo: "Escribe tu comentario para enviar." };
  if (texto.length > MAX_COMENTARIO) return { ok: false, motivo: `El comentario es muy largo (máximo ${MAX_COMENTARIO} caracteres).` };
  return { ok: true, voto, comentario: texto };
}

export function textoPendientes(pendientes) {
  if (!Number.isInteger(pendientes) || pendientes <= 0) return "Aún no hay opiniones guardadas en tu equipo.";
  if (pendientes === 1) return "1 opinión guardada en tu equipo.";
  return `${pendientes.toLocaleString("es-CL")} opiniones guardadas en tu equipo.`;
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
