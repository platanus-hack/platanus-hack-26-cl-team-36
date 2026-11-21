/**
 * Saneador de CSS. Se aplica siempre, justo antes de inyectar una piel.
 *
 * Usa el analizador de CSS del navegador (`CSSStyleSheet.replaceSync`) y trabaja sobre el CSSOM:
 * así los escapes (`u\72l(`) y las abreviaturas ya llegan normalizados. Módulo puro: solo
 * necesita un entorno con DOM (el script de fondo de Firefox lo tiene).
 */

/**
 * @typedef {object} ResultadoSaneado
 * @property {string} css CSS saneado, listo para inyectar (vacío si se rechazó).
 * @property {number} eliminadas Reglas eliminadas por completo.
 * @property {number} total Reglas que traía la piel.
 * @property {number} declaraciones_eliminadas Declaraciones sueltas eliminadas.
 * @property {boolean} rechazada Si la piel no se debe aplicar.
 * @property {string | null} motivo Por qué se rechazó, en español.
 */

export const LARGO_MAXIMO_CSS = 30_000;
export const FRACCION_MAXIMA_ELIMINADA = 0.3;

const FUNCIONES_PROHIBIDAS = ["url(", "image-set(", "expression("];
const PROPIEDADES_PROHIBIDAS = new Set(["-moz-binding"]);
const CONTENIDOS_PERMITIDOS = new Set(['""', "none", "normal"]);

/** Reglas que solo agrupan a otras: se recorren, no cuentan como regla propia. */
const REGLAS_DE_GRUPO = new Set([
  "CSSMediaRule",
  "CSSSupportsRule",
  "CSSLayerBlockRule",
  "CSSContainerRule",
  "CSSScopeRule",
  "CSSStartingStyleRule",
]);
const REGLAS_DE_ESTILO = new Set(["CSSStyleRule", "CSSNestedDeclarations"]);

/**
 * Abreviaturas que se revisan cuando una declaración usa `var()`: en ese caso el CSSOM no
 * expone el valor de cada propiedad larga, solo el de la abreviatura.
 */
const ABREVIATURAS = [
  "all", "animation", "background", "border", "border-block", "border-block-end", "border-block-start",
  "border-bottom", "border-color", "border-image", "border-inline", "border-inline-end",
  "border-inline-start", "border-left", "border-radius", "border-right", "border-style", "border-top",
  "border-width", "column-rule", "columns", "container", "flex", "flex-flow", "font", "font-variant",
  "gap", "grid", "grid-area", "grid-column", "grid-row", "grid-template", "inset", "inset-block",
  "inset-inline", "list-style", "margin", "margin-block", "margin-inline", "mask", "offset", "outline",
  "overflow", "overscroll-behavior", "padding", "padding-block", "padding-inline", "place-content",
  "place-items", "place-self", "scroll-margin", "scroll-padding", "text-decoration", "text-emphasis",
  "transition",
];

/**
 * @param {string} propiedad
 * @param {string} valor
 * @returns {boolean}
 */
function estaProhibida(propiedad, valor) {
  const nombre = propiedad.toLowerCase();
  const texto = valor.toLowerCase();
  if (PROPIEDADES_PROHIBIDAS.has(nombre)) return true;
  if (FUNCIONES_PROHIBIDAS.some((funcion) => texto.includes(funcion))) return true;
  return nombre === "content" && !CONTENIDOS_PERMITIDOS.has(texto.trim());
}

/**
 * Quita las declaraciones prohibidas de un bloque y, si se pide, marca el resto con `!important`.
 * @param {CSSStyleDeclaration} estilo
 * @param {boolean} forzarImportante
 * @returns {number} Declaraciones eliminadas.
 */
function sanearDeclaraciones(estilo, forzarImportante) {
  let eliminadas = 0;
  const pendientes = [];
  for (const propiedad of Array.from(estilo)) {
    const valor = estilo.getPropertyValue(propiedad);
    if (valor === "") {
      pendientes.push(propiedad);
    } else if (estaProhibida(propiedad, valor)) {
      estilo.removeProperty(propiedad);
      eliminadas += 1;
    } else if (forzarImportante) {
      estilo.setProperty(propiedad, valor, "important");
    }
  }
  if (pendientes.length > 0) eliminadas += sanearAbreviaturasConVariables(estilo, pendientes, forzarImportante);
  return eliminadas;
}

/**
 * Propiedades largas en las que se descompone una abreviatura.
 * @param {string} abreviatura
 * @param {string} valor
 * @returns {string[]}
 */
function propiedadesLargas(abreviatura, valor) {
  const hoja = new CSSStyleSheet();
  hoja.replaceSync("a {}");
  const estilo = /** @type {CSSStyleRule} */ (hoja.cssRules[0]).style;
  estilo.setProperty(abreviatura, valor);
  return Array.from(estilo);
}

/**
 * Trata las propiedades largas cuyo valor no se puede leer porque vienen de una abreviatura con
 * `var()`: se revisa la abreviatura completa. Lo que no se logra revisar se elimina.
 * @param {CSSStyleDeclaration} estilo
 * @param {string[]} pendientes
 * @param {boolean} forzarImportante
 * @returns {number} Declaraciones eliminadas.
 */
function sanearAbreviaturasConVariables(estilo, pendientes, forzarImportante) {
  let eliminadas = 0;
  const sinRevisar = new Set(pendientes);
  for (const abreviatura of ABREVIATURAS) {
    const valor = estilo.getPropertyValue(abreviatura);
    if (valor === "") continue;
    const largas = propiedadesLargas(abreviatura, valor);
    if (estaProhibida(abreviatura, valor)) {
      estilo.removeProperty(abreviatura);
      eliminadas += 1;
    } else if (forzarImportante) {
      estilo.setProperty(abreviatura, valor, "important");
    }
    for (const propiedad of largas) sinRevisar.delete(propiedad);
  }
  for (const propiedad of sinRevisar) {
    if (!Array.from(estilo).includes(propiedad)) continue;
    estilo.removeProperty(propiedad);
    eliminadas += 1;
  }
  return eliminadas;
}

/**
 * @typedef {object} Cuenta
 * @property {number} total
 * @property {number} eliminadas
 * @property {number} declaraciones
 * @property {Set<CSSRule>} descartadas Reglas eliminadas que no se pudieron borrar de la hoja.
 */

/**
 * Sanea las reglas hijas de una hoja o de una regla de grupo, borrando las que no se conservan.
 * @param {CSSStyleSheet | CSSGroupingRule} padre
 * @param {Cuenta} cuenta
 * @returns {number} Reglas hijas que quedaron.
 */
function sanearLista(padre, cuenta) {
  for (let indice = padre.cssRules.length - 1; indice >= 0; indice -= 1) {
    const regla = padre.cssRules[indice];
    const tipo = regla.constructor.name;
    let conservar;
    if (REGLAS_DE_GRUPO.has(tipo)) {
      conservar = sanearLista(/** @type {CSSGroupingRule} */ (regla), cuenta) > 0;
    } else {
      cuenta.total += 1;
      conservar = sanearRegla(regla, tipo, cuenta);
      if (!conservar) cuenta.eliminadas += 1;
    }
    if (!conservar) descartar(padre, indice, cuenta);
  }
  return Array.from(padre.cssRules).filter((regla) => !cuenta.descartadas.has(regla)).length;
}

/**
 * Borra una regla. El CSSOM no deja borrar un `@namespace` si la hoja tiene otras reglas: esas
 * se anotan en `cuenta.descartadas` y se saltan al escribir el resultado.
 * @param {CSSStyleSheet | CSSGroupingRule} padre
 * @param {number} indice
 * @param {Cuenta} cuenta
 */
function descartar(padre, indice, cuenta) {
  try {
    padre.deleteRule(indice);
  } catch {
    cuenta.descartadas.add(padre.cssRules[indice]);
  }
}

/**
 * @param {CSSRule} regla
 * @param {string} tipo Nombre del constructor de la regla.
 * @param {Cuenta} cuenta
 * @returns {boolean} Si la regla se conserva.
 */
function sanearRegla(regla, tipo, cuenta) {
  if (tipo === "CSSKeyframesRule") {
    for (const fotograma of /** @type {CSSKeyframesRule} */ (regla).cssRules) {
      cuenta.declaraciones += sanearDeclaraciones(/** @type {CSSKeyframeRule} */ (fotograma).style, false);
    }
    return true;
  }
  if (REGLAS_DE_ESTILO.has(tipo)) {
    const reglaEstilo = /** @type {CSSStyleRule} */ (regla);
    cuenta.declaraciones += sanearDeclaraciones(reglaEstilo.style, true);
    const anidadas = reglaEstilo.cssRules ? sanearLista(reglaEstilo, cuenta) : 0;
    return reglaEstilo.style.length > 0 || anidadas > 0;
  }
  // Todo lo demás (@font-face, @namespace, @import, @page, @property…) se elimina.
  return false;
}

/**
 * Cuenta los `@import` del texto. `replaceSync` los descarta sin dejarlos en `cssRules`, así que
 * esta cuenta solo sirve para el total de reglas eliminadas: quien los quita es el analizador.
 * @param {string} css
 * @returns {number}
 */
function contarImportaciones(css) {
  return css.toLowerCase().split("@import").length - 1;
}

/**
 * @param {string} motivo
 * @param {Partial<ResultadoSaneado>} [datos]
 * @returns {ResultadoSaneado}
 */
function rechazar(motivo, datos = {}) {
  return { css: "", eliminadas: 0, total: 0, declaraciones_eliminadas: 0, ...datos, rechazada: true, motivo };
}

/**
 * Sanea el CSS de una piel.
 * @param {string} css
 * @returns {ResultadoSaneado}
 */
export function sanearCss(css) {
  if (typeof css !== "string" || css.trim() === "") return rechazar("La piel no trae CSS.");
  if (css.length > LARGO_MAXIMO_CSS) {
    return rechazar(`La piel supera los ${LARGO_MAXIMO_CSS} caracteres permitidos.`);
  }
  const hoja = new CSSStyleSheet();
  hoja.replaceSync(css);
  const importaciones = contarImportaciones(css);
  /** @type {Cuenta} */
  const cuenta = { total: importaciones, eliminadas: importaciones, declaraciones: 0, descartadas: new Set() };
  const restantes = sanearLista(hoja, cuenta);
  const resumen = {
    eliminadas: cuenta.eliminadas,
    total: cuenta.total,
    declaraciones_eliminadas: cuenta.declaraciones,
  };
  if (restantes === 0) return rechazar("Después de sanear la piel no quedó ninguna regla.", resumen);
  if (cuenta.eliminadas / cuenta.total > FRACCION_MAXIMA_ELIMINADA) {
    return rechazar(
      `El saneador eliminó ${cuenta.eliminadas} de ${cuenta.total} reglas; la piel se rechaza.`,
      resumen,
    );
  }
  const saneado = Array.from(hoja.cssRules)
    .filter((regla) => !cuenta.descartadas.has(regla))
    .map((regla) => regla.cssText)
    .join("\n");
  return { css: saneado, ...resumen, rechazada: false, motivo: null };
}
