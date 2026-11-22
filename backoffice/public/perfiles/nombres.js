// Etiquetas cortas de los perfiles para los gráficos de Perfiles. Puro: node:test lo importa.
//
// Los nombres de los exploradores son largos y casi iguales: «Explorador del contenido (sin contexto)». En una
// columna angosta el corte se comía justo lo que los distingue (el lugar y el nivel). Aquí el nivel (lo que va entre
// paréntesis al final) va aparte, para mostrarlo en su propia línea, y se quitan las palabras iniciales que comparten
// todos los perfiles de la tanda («Explorador», y el «del» que queda), así se lee «Contenido» · «sin contexto».
// El nombre completo queda siempre en el title.

const NIVEL = /^(.*?)\s*\(([^()]+)\)\s*$/;
const UNIONES = new Set(["de", "del", "la", "las", "el", "los"]);

/** «Explorador del pie (conoce el tema)» → { base: "Explorador del pie", nivel: "conoce el tema" }. */
export function partirNombre(nombre) {
  const texto = String(nombre ?? "").trim();
  const partes = NIVEL.exec(texto);
  return partes && partes[1] ? { base: partes[1], nivel: partes[2].trim() } : { base: texto, nivel: null };
}

/** Los niveles de conocimiento que escribe el evaluador en el nombre del perfil, con su clave del diccionario. */
const CLAVE_DE_NIVEL = { "conoce el tema": "conoce_tema", "sin contexto": "sin_contexto" };

/** El nivel de un perfil en el idioma de la pantalla (las mismas palabras que la tabla de Resumen, en minúscula). */
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

const conMayuscula = (texto) => texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);

/**
 * Etiqueta corta de cada nombre: { completo, base, nivel }. Quita las palabras iniciales comunes a todas las bases
 * (y las uniones que queden al principio) solo si hay al menos dos bases distintas y a ninguna la deja vacía.
 * @param {string[]} nombres
 * @returns {Map<string, { completo: string, base: string, nivel: string | null }>}
 */
export function etiquetasDePerfiles(nombres) {
  const lista = [...new Set((nombres ?? []).map((nombre) => String(nombre ?? "")))];
  const partidos = new Map(lista.map((nombre) => [nombre, partirNombre(nombre)]));
  const bases = [...new Set([...partidos.values()].map(({ base }) => base))];
  const palabras = bases.map((base) => base.split(/\s+/));
  let comunes = 0;
  if (bases.length > 1) {
    while (palabras.every((p) => p.length > comunes + 1 && p[comunes].toLocaleLowerCase("es") === palabras[0][comunes].toLocaleLowerCase("es"))) comunes += 1;
  }
  const corta = (base) => {
    if (!comunes) return base;
    const resto = base.split(/\s+/).slice(comunes);
    while (resto.length > 1 && UNIONES.has(resto[0].toLocaleLowerCase("es"))) resto.shift();
    return conMayuscula(resto.join(" "));
  };
  return new Map(lista.map((nombre) => {
    const { base, nivel } = partidos.get(nombre);
    return [nombre, { completo: nombre, base: corta(base), nivel }];
  }));
}
