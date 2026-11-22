// Nombres de los perfiles con su nivel de conocimiento en el idioma de la pantalla. Puro: node:test lo importa.
//
// Los nombres de los exploradores llevan el nivel entre paréntesis al final: «Explorador del contenido (sin
// contexto)». El nivel lo escribe el evaluador en español; aquí se traduce sin tocar el resto del nombre.

const NIVEL = /^(.*?)\s*\(([^()]+)\)\s*$/;

/** «Explorador del pie (conoce el tema)» → { base: "Explorador del pie", nivel: "conoce el tema" }. */
export function partirNombre(nombre) {
  const texto = String(nombre ?? "").trim();
  const partes = NIVEL.exec(texto);
  return partes && partes[1] ? { base: partes[1], nivel: partes[2].trim() } : { base: texto, nivel: null };
}

/** Los niveles de conocimiento que escribe el evaluador en el nombre del perfil, con su clave del diccionario. */
const CLAVE_DE_NIVEL = { "conoce el tema": "conoce_tema", "sin contexto": "sin_contexto" };

/** El nivel de un perfil en el idioma de la pantalla (las mismas palabras que la cabecera de la tanda, en minúscula). */
export function textoDeNivel(nivel, t) {
  const clave = CLAVE_DE_NIVEL[String(nivel ?? "").trim().toLocaleLowerCase("es")];
  if (!clave) return nivel ?? null;
  const texto = t(`comun.nivel.${clave}`);
  return texto === `comun.nivel.${clave}` ? nivel : texto;
}

/** «Explorador del pie (conoce el tema)» con el nivel en el idioma de la pantalla: «Explorador del pie (knows the topic)». */
export function nombreConNivel(nombre, t) {
  const { base, nivel } = partirNombre(nombre);
  return nivel ? `${base} (${textoDeNivel(nivel, t)})` : String(nombre ?? "");
}
