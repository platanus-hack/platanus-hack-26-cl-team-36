// Saneamiento de las `features` del tema.json que llega de la API (lo genera el improver, no viene empaquetado).
// Lógica pura, sin `browser.*`.
//
// Espejo exacto de agents/app/web_designer/disenador/tema_json.py: los mismos esquemas (un subconjunto de JSON
// Schema que valida `errores`), patrones y topes, y la misma semántica: un item que no valida se descarta solo y la
// vista sigue; una vista que no valida (o una clave que el esquema no conoce) se descarta entera. Si cambian allá,
// cambian acá: agents/app/web_designer/tests/test_contrato.py pasa por `sanearTema` lo que arma el improver y
// exige cero rechazos y las mismas vistas.
//
// Solo la feature `vista`, con los componentes que emite el improver y sus `datos`: los enlaces son rutas relativas
// (`/…`, nunca `//host` ni `/\host`) y nada carga recursos de otro host (sin imágenes).

export const COMPONENTES = ["atajo", "lanzador"];
export const MAX_VISTAS = 6;
export const MAX_CADENA = 200;

const TEXTO_CORTO = { type: "string", maxLength: 160 };
const TEXTO = { type: "object", properties: { es: TEXTO_CORTO, en: TEXTO_CORTO }, required: ["es", "en"], additionalProperties: false };
// Sin `\s`: no es el mismo conjunto en Python y en JS. Sin controles: el parser de URLs borra tabs y saltos.
const RUTA = {
  type: "string",
  maxLength: MAX_CADENA,
  pattern: "^/(?![/\\\\])[^\\\\\\x00-\\x20\\x7f-\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$",
};
const SELECTOR = { type: "string", minLength: 1, maxLength: MAX_CADENA };
const ID = { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" };
const NOMBRE_PARAMETRO = { type: "string", pattern: "^[A-Za-z0-9_.\\[\\]-]{1,40}$" };
const VALOR = { type: "string", maxLength: 100 };

function textos(claves) {
  const porIdioma = { type: "object", properties: Object.fromEntries(claves.map((c) => [c, TEXTO_CORTO])), additionalProperties: false };
  return { type: "object", properties: { es: porIdioma, en: porIdioma }, additionalProperties: false };
}

const ITEM = {
  atajo: {
    type: "object",
    properties: {
      nombre: NOMBRE_PARAMETRO,
      etiqueta: TEXTO,
      opciones: SELECTOR,
      valores: {
        type: "array",
        minItems: 1,
        maxItems: 60,
        items: { type: "object", properties: { valor: VALOR, texto: TEXTO }, required: ["valor", "texto"], additionalProperties: false },
      },
      valor: VALOR,
      requerido: { type: "boolean" },
    },
    required: ["nombre", "etiqueta"],
    anyOf: [{ required: ["opciones"] }, { required: ["valores"] }],
    additionalProperties: false,
  },
  lanzador: {
    type: "object",
    properties: { titulo: TEXTO, detalle: TEXTO, insignia: TEXTO, enlace: RUTA },
    required: ["titulo", "enlace"],
    additionalProperties: false,
  },
};
export const MAX_ITEMS = { atajo: 8, lanzador: 12 };

const OPCIONES = {
  atajo: {
    type: "object",
    properties: {
      destino: RUTA,
      fijos: { type: "object", maxProperties: 6, propertyNames: NOMBRE_PARAMETRO, additionalProperties: VALOR },
      invertir: { type: "array", minItems: 2, maxItems: 2, items: NOMBRE_PARAMETRO },
      textos: textos(["titulo", "subtitulo", "boton", "invertir", "elegir"]),
    },
    required: ["destino"],
    additionalProperties: false,
  },
  lanzador: {
    type: "object",
    properties: { max: { type: "integer", minimum: 1, maximum: 12 }, textos: textos(["titulo", "subtitulo"]) },
    additionalProperties: false,
  },
};

function esquemaVista(componente) {
  return {
    type: "object",
    properties: {
      id: ID,
      rutas: { type: "array", minItems: 1, maxItems: 10, items: RUTA },
      contenedor: SELECTOR,
      reemplazar: { type: "boolean" },
      componente: { enum: COMPONENTES },
      datos: { type: "array", minItems: 1, maxItems: MAX_ITEMS[componente], items: ITEM[componente] },
      opciones: OPCIONES[componente],
    },
    required: ["id", "contenedor", "componente", "datos", "opciones"],
    additionalProperties: false,
  };
}

// ---------- Validador ----------

const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const esEntero = (valor) => Number.isInteger(valor);
const TIPOS = {
  object: esObjeto,
  array: Array.isArray,
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  integer: esEntero,
};
// Como `len` de Python: cuenta caracteres, no unidades UTF-16.
const largo = (texto) => [...texto].length;
const mostrar = (valor) => JSON.stringify(valor)?.slice(0, 60) ?? String(valor);
const propia = (objeto, clave) => objeto !== undefined && Object.hasOwn(objeto, clave);

// Los errores de `valor` contra `esquema`, con la ruta JSON de cada uno; vacío si valida.
export function errores(valor, esquema, ruta = "$") {
  if (esquema.enum && !esquema.enum.includes(valor)) return [`${ruta}: ${mostrar(valor)} no está entre ${mostrar(esquema.enum)}`];
  if (esquema.type && !TIPOS[esquema.type](valor)) return [`${ruta}: se esperaba ${esquema.type}`];
  const salida = [];
  if (typeof valor === "string") {
    const n = largo(valor);
    if (n > (esquema.maxLength ?? n) || n < (esquema.minLength ?? 0)) salida.push(`${ruta}: largo ${n} fuera de rango`);
    // Sin la bandera `m`, `$` solo calza al final: como `re.fullmatch`, un `\n` final no valida.
    if (esquema.pattern && !new RegExp(esquema.pattern).test(valor)) salida.push(`${ruta}: ${mostrar(valor)} no cumple ${esquema.pattern}`);
  }
  if (esEntero(valor) && !((esquema.minimum ?? valor) <= valor && valor <= (esquema.maximum ?? valor))) {
    salida.push(`${ruta}: ${valor} fuera de rango`);
  }
  if (Array.isArray(valor)) {
    if (!((esquema.minItems ?? 0) <= valor.length && valor.length <= (esquema.maxItems ?? valor.length))) {
      salida.push(`${ruta}: ${valor.length} elementos fuera de rango`);
    }
    valor.forEach((item, i) => salida.push(...errores(item, esquema.items ?? {}, `${ruta}[${i}]`)));
  }
  if (esObjeto(valor)) {
    const propiedades = esquema.properties;
    const extra = esquema.additionalProperties ?? true;
    for (const clave of esquema.required ?? []) if (!Object.hasOwn(valor, clave)) salida.push(`${ruta}: falta ${clave}`);
    const claves = Object.keys(valor);
    if (claves.length > (esquema.maxProperties ?? claves.length)) salida.push(`${ruta}: demasiadas claves`);
    for (const clave of claves) {
      if (esquema.propertyNames) salida.push(...errores(clave, esquema.propertyNames, `${ruta}.${clave}`));
      if (propia(propiedades, clave)) salida.push(...errores(valor[clave], propiedades[clave], `${ruta}.${clave}`));
      else if (extra === false) salida.push(`${ruta}: clave no permitida ${mostrar(clave)}`);
      else if (esObjeto(extra)) salida.push(...errores(valor[clave], extra, `${ruta}.${clave}`));
    }
  }
  if (esquema.anyOf && esquema.anyOf.every((alternativa) => errores(valor, alternativa, ruta).length)) {
    salida.push(`${ruta}: no cumple ninguna alternativa`);
  }
  return salida;
}

// → [vista con solo sus items válidos | null, razones de lo descartado]
export function validarVista(vista) {
  const componente = esObjeto(vista) ? vista.componente : undefined;
  if (!COMPONENTES.includes(componente)) return [null, [`componente no permitido: ${mostrar(componente)}`]];
  const nombre = `vista ${mostrar(vista.id)}`;
  const limpia = { ...vista };
  const descartes = [];
  if (Array.isArray(limpia.datos)) {
    limpia.datos = limpia.datos.filter((item, i) => {
      const fallas = errores(item, ITEM[componente], `datos[${i}]`);
      if (fallas.length) descartes.push(`${nombre}, item descartado: ${fallas[0]}`);
      return !fallas.length;
    });
  }
  let fallas = errores(limpia, esquemaVista(componente));
  if (componente === "atajo" && !fallas.length) {
    const nombres = new Set(limpia.datos.map((campo) => campo.nombre));
    fallas = (limpia.opciones.invertir ?? []).filter((n) => !nombres.has(n)).map((n) => `$.opciones.invertir: ${mostrar(n)} no es un campo`);
  }
  if (fallas.length) return [null, [...descartes, `${nombre} descartada: ${fallas[0]}`]];
  return [limpia, descartes];
}

// → { features, rechazos }: lo que el motor puede correr y por qué se descartó lo demás.
export function sanearTema(tema) {
  if (!esObjeto(tema)) return { features: {}, rechazos: tema == null ? [] : ["el tema no es un objeto"] };
  if (tema.features === undefined) return { features: {}, rechazos: [] };
  if (!esObjeto(tema.features)) return { features: {}, rechazos: ["`features` no es un objeto"] };
  const rechazos = Object.keys(tema.features).filter((n) => n !== "vista").map((n) => `feature desconocida ${mostrar(n)}`);
  if (tema.features.vista === undefined) return { features: {}, rechazos };
  if (!Array.isArray(tema.features.vista)) return { features: {}, rechazos: [...rechazos, "`vista` no es una lista"] };

  const validas = [];
  const ids = new Set();
  for (const vista of tema.features.vista) {
    const [limpia, razones] = validarVista(vista);
    rechazos.push(...razones);
    if (!limpia) continue;
    if (ids.has(limpia.id) || validas.length >= MAX_VISTAS) {
      rechazos.push(`vista ${mostrar(limpia.id)} descartada: repetida o sobre el máximo de ${MAX_VISTAS}`);
      continue;
    }
    ids.add(limpia.id);
    validas.push(limpia);
  }
  return { features: validas.length ? { vista: validas } : {}, rechazos };
}
