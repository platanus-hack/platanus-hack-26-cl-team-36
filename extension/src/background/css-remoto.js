// Saneamiento del CSS que llega de la API (un tema generado, no empaquetado). Lógica pura, sin `browser.*`.
// Mismas reglas que el diseñador (agents/app/web_designer/disenador/css.py y su README): si cambian allá,
// cambian acá. Se descarta todo lo que pueda cargar recursos o ejecutar código, las at-reglas que no sean
// @media/@supports/@container/@keyframes mt-*, y cada selector de primer nivel queda bajo `html.mi-tema`.

const AGRUPADORAS = new Set(["media", "supports", "layer", "container", "document", "scope", "starting-style"]);
const PERMITIDAS = new Set(["media", "supports", "container"]);
const KEYFRAMES = new Set(["keyframes", "-webkit-keyframes"]);
const NOMBRE_KEYFRAMES = /^mt-[\w-]+$/;
const MAX_CADENA = 200;
export const MAX_BYTES_CSS = 200_000;
// La lectura es recursiva: sin tope, `a{a{a{…` agota la pila o multiplica la sangría de la salida.
export const MAX_PROFUNDIDAD = 16;

class DemasiadoProfundo extends Error {}

const CADENA_ROTA = "";
const FIN_DE_CADENA = "\n\r\f";

const PROHIBIDOS = [
  ["cadena rota", new RegExp(CADENA_ROTA)],
  ["url(", /url\s*\(/i],
  ["src(", /(?<![\w-])src\s*\(/i],
  ["image-set(", /(?<![\w-])(?:-webkit-)?image(?:-set)?\s*\(/i],
  ["@import", /@import/i],
  ["barra invertida", /\\/],
  ["expression(", /expression\s*\(/i],
  ["javascript:", /javascript\s*:/i],
  ["behavior", /(?<![\w-])behavior\s*:/i],
  ["-moz-binding", /-moz-binding/i],
];

const AMBITO = /^html\.mi-tema(?![\w-])/;

// ---------- Lectura ----------

function quitarComentarios(css) {
  const salida = [];
  let i = 0;
  let comilla = null;
  while (i < css.length) {
    const c = css[i];
    if (comilla) {
      if (FIN_DE_CADENA.includes(c)) {
        salida.push(CADENA_ROTA, c);
        comilla = null;
        i += 1;
        continue;
      }
      salida.push(c);
      if (c === "\\" && i + 1 < css.length) {
        salida.push(css[i + 1]);
        i += 2;
        continue;
      }
      if (c === comilla) comilla = null;
    } else if (c === '"' || c === "'") {
      comilla = c;
      salida.push(c);
    } else if (css.startsWith("/*", i)) {
      const fin = css.indexOf("*/", i + 2);
      i = fin < 0 ? css.length : fin + 2;
      continue;
    } else {
      salida.push(c);
    }
    i += 1;
  }
  if (comilla) salida.push(CADENA_ROTA);
  return salida.join("");
}

// Avanza hasta un carácter de `paradas` fuera de comillas y paréntesis: [fragmento, índice, carácter].
function escanear(texto, i, paradas) {
  const inicio = i;
  let profundidad = 0;
  let comilla = null;
  while (i < texto.length) {
    const c = texto[i];
    if (comilla) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === comilla || FIN_DE_CADENA.includes(c)) comilla = null;
    } else if (c === '"' || c === "'") {
      comilla = c;
    } else if (c === "(" || c === "[") {
      profundidad += 1;
    } else if (c === ")" || c === "]") {
      profundidad = Math.max(0, profundidad - 1);
    } else if (profundidad === 0 && paradas.includes(c)) {
      return [texto.slice(inicio, i), i, c];
    }
    i += 1;
  }
  return [texto.slice(inicio), i, ""];
}

const compactar = (texto) => texto.split(/\s+/).filter(Boolean).join(" ");

function dividirSelectores(preludio) {
  const selectores = [];
  let i = 0;
  while (i <= preludio.length) {
    const [parte, j, c] = escanear(preludio, i, ",");
    if (parte.trim()) selectores.push(compactar(parte));
    if (!c) break;
    i = j + 1;
  }
  return selectores;
}

function saltarEspacios(texto, i) {
  while (i < texto.length && " \t\r\n;".includes(texto[i])) i += 1;
  return i;
}

function leerCuerpo(texto, i, nivel) {
  if (nivel > MAX_PROFUNDIDAD) throw new DemasiadoProfundo();
  const declaraciones = [];
  const anidadas = [];
  for (;;) {
    i = saltarEspacios(texto, i);
    if (i >= texto.length) return [declaraciones, anidadas, i];
    if (texto[i] === "}") return [declaraciones, anidadas, i + 1];
    const [fragmento, j, c] = escanear(texto, i, "{;}");
    if (c === "{") {
      const [subDeclaraciones, subAnidadas, k] = leerCuerpo(texto, j + 1, nivel + 1);
      i = k;
      const preludio = compactar(fragmento);
      const selectores = preludio.startsWith("@") ? [preludio] : dividirSelectores(fragmento);
      anidadas.push({ tipo: "regla", selectores, declaraciones: subDeclaraciones, anidadas: subAnidadas });
      continue;
    }
    if (fragmento.trim()) declaraciones.push(fragmento.trim());
    i = c === ";" ? j + 1 : j;
  }
}

function leerLista(texto, i, nivel) {
  if (nivel > MAX_PROFUNDIDAD) throw new DemasiadoProfundo();
  const items = [];
  for (;;) {
    i = saltarEspacios(texto, i);
    if (i >= texto.length) return [items, i];
    if (texto[i] === "}") return [items, i + 1];
    if (texto[i] === "@") {
      const [preludio, j, c] = escanear(texto, i, "{;}");
      const nombre = (preludio.match(/^@([\w-]+)/)?.[1] ?? "").toLowerCase();
      const resto = preludio.slice(nombre.length + 1).trim();
      if (c !== "{") {
        items.push({ tipo: "sentencia", nombre, texto: preludio.trim() });
        i = c === ";" ? j + 1 : j;
      } else if (AGRUPADORAS.has(nombre) || nombre.endsWith("keyframes")) {
        const [hijos, k] = leerLista(texto, j + 1, nivel + 1);
        items.push({ tipo: "bloque", nombre, preludio: resto, hijos });
        i = k;
      } else {
        const [declaraciones, , k] = leerCuerpo(texto, j + 1, nivel + 1);
        items.push({ tipo: "declaraciones", nombre, preludio: resto, declaraciones });
        i = k;
      }
      continue;
    }
    const [preludio, j, c] = escanear(texto, i, "{;}");
    if (c !== "{") {
      if (preludio.trim()) items.push({ tipo: "suelto", texto: preludio.trim() });
      if (c === "}") return [items, j + 1];
      i = c === ";" ? j + 1 : j;
      continue;
    }
    const [declaraciones, anidadas, k] = leerCuerpo(texto, j + 1, nivel + 1);
    items.push({ tipo: "regla", selectores: dividirSelectores(preludio), declaraciones, anidadas });
    i = k;
  }
}

function leer(css) {
  const texto = quitarComentarios(css);
  const items = [];
  let i = 0;
  while (i < texto.length) {
    const [parte, j] = leerLista(texto, i, 0);
    items.push(...parte);
    i = j;
  }
  return items;
}

// ---------- Escritura ----------

function escribirBloque(cabecera, declaraciones, anidadas, nivel) {
  const sangria = "  ".repeat(nivel);
  return [
    `${sangria}${cabecera} {`,
    ...declaraciones.map((d) => `${sangria}  ${d};`),
    ...anidadas.map((r) => escribirRegla(r, nivel + 1)),
    `${sangria}}`,
  ].join("\n");
}

function escribirRegla(regla, nivel) {
  return escribirBloque(regla.selectores.join(", "), regla.declaraciones, regla.anidadas, nivel);
}

function escribir(items, nivel = 0) {
  const sangria = "  ".repeat(nivel);
  return items
    .map((item) =>
      item.tipo === "regla"
        ? escribirRegla(item, nivel)
        : `${sangria}${`@${item.nombre} ${item.preludio}`.trim()} {\n${escribir(item.hijos, nivel + 1)}\n${sangria}}`,
    )
    .join("\n");
}

// ---------- Saneamiento ----------

// Lo que haría que el navegador corte el texto en otro lugar que esta lectura, o una cadena demasiado larga.
function estructura(texto) {
  const pila = [];
  let comilla = null;
  let inicio = 0;
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (comilla) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (FIN_DE_CADENA.includes(c)) return "cadena rota";
      if (c === comilla) {
        comilla = null;
        if (i - inicio - 1 > MAX_CADENA) return "cadena demasiado larga";
      }
    } else if (c === '"' || c === "'") {
      comilla = c;
      inicio = i;
    } else if (c === "{" || c === "}") {
      return "llave fuera de una cadena";
    } else if (texto.startsWith("/*", i) || texto.startsWith("*/", i)) {
      return "comentario";
    } else if (c === "(" || c === "[") {
      pila.push(c === "(" ? ")" : "]");
    } else if ((c === ")" || c === "]") && (pila.length === 0 || pila.pop() !== c)) {
      return "paréntesis o corchetes desbalanceados";
    }
    i += 1;
  }
  if (comilla) return "cadena rota";
  if (pila.length) return "paréntesis o corchetes desbalanceados";
  return null;
}

export function prohibidoEn(texto) {
  for (const [motivo, patron] of PROHIBIDOS) if (patron.test(texto)) return motivo;
  return estructura(texto);
}

function conAmbito(selector) {
  if (AMBITO.test(selector)) return selector;
  for (const inicio of [":root", "html"]) {
    if (new RegExp(`^${inicio}(?![\\w-])`, "i").test(selector)) return `html.mi-tema${selector.slice(inicio.length)}`;
  }
  return `html.mi-tema ${selector}`;
}

function sanearDeclaraciones(declaraciones, rechazos) {
  return declaraciones.filter((declaracion) => {
    // `@layer a, b;` anidado también fija el orden global de las capas, con el tema apagado o no.
    const motivo = declaracion.startsWith("@") ? "at-regla sin bloque" : prohibidoEn(declaracion);
    if (motivo) rechazos.push(motivo);
    return !motivo;
  });
}

// contexto: "primer-nivel" (se exige html.mi-tema), "anidada" (relativa a su regla) o "keyframes".
function sanearRegla(regla, rechazos, contexto) {
  let motivo = prohibidoEn(regla.selectores.join(", "));
  if (!motivo && contexto === "anidada") {
    const nombre = regla.selectores.join(", ").match(/^@([\w-]+)/)?.[1]?.toLowerCase();
    if (nombre && !PERMITIDAS.has(nombre)) motivo = `@${nombre} no permitida`;
    else if (!nombre && regla.selectores.some((s) => s.includes("&") && !s.startsWith("&"))) motivo = "& fuera del inicio";
  }
  if (motivo) {
    rechazos.push(`${motivo} en el selector`);
    return null;
  }
  const selectores = contexto === "primer-nivel" ? regla.selectores.map(conAmbito) : regla.selectores;
  const declaraciones = sanearDeclaraciones(regla.declaraciones, rechazos);
  const anidadas = regla.anidadas.map((r) => sanearRegla(r, rechazos, "anidada")).filter(Boolean);
  if (!declaraciones.length && !anidadas.length && (regla.declaraciones.length || regla.anidadas.length)) return null;
  return { tipo: "regla", selectores, declaraciones, anidadas };
}

function sanearLista(items, rechazos, enKeyframes = false) {
  const limpios = [];
  for (const item of items) {
    if (item.tipo === "regla") {
      const regla = sanearRegla(item, rechazos, enKeyframes ? "keyframes" : "primer-nivel");
      if (regla) limpios.push(regla);
    } else if (item.tipo === "bloque") {
      if (enKeyframes || !(PERMITIDAS.has(item.nombre) || KEYFRAMES.has(item.nombre))) {
        rechazos.push(`@${item.nombre} no permitida`);
        continue;
      }
      const motivo = prohibidoEn(item.preludio);
      if (motivo) {
        rechazos.push(`${motivo} en @${item.nombre}`);
        continue;
      }
      if (KEYFRAMES.has(item.nombre) && !NOMBRE_KEYFRAMES.test(item.preludio.trim())) {
        rechazos.push(`@${item.nombre} sin el prefijo mt-`);
        continue;
      }
      const hijos = sanearLista(item.hijos, rechazos, KEYFRAMES.has(item.nombre));
      if (hijos.length) limpios.push({ ...item, hijos });
    } else if (item.tipo === "declaraciones" || item.tipo === "sentencia") {
      rechazos.push(item.nombre === "import" ? "@import" : `@${item.nombre} no permitida`);
    } else if (item.texto) {
      rechazos.push("texto fuera de una regla");
    }
  }
  return limpios;
}

// → { css, rechazos } con `css` listo para inyectar ("" si no queda nada). Nunca lanza.
export function sanearCss(css) {
  if (typeof css !== "string" || !css.trim()) return { css: "", rechazos: [] };
  if (css.length > MAX_BYTES_CSS) return { css: "", rechazos: ["css demasiado grande"] };
  const rechazos = [];
  const texto = css.replace(/^\s*```[a-z]*\s*\n|\n\s*```\s*$/g, "");
  let items;
  try {
    items = leer(texto);
  } catch (error) {
    if (error instanceof DemasiadoProfundo) return { css: "", rechazos: ["anidamiento demasiado profundo"] };
    throw error;
  }
  const arbol = sanearLista(items, rechazos);
  return { css: arbol.length ? `${escribir(arbol)}\n` : "", rechazos };
}
