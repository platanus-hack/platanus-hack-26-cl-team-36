// Saneamiento de las `features` del tema.json que llega de la API (lo genera el improver, no viene empaquetado).
// Lógica pura, sin `browser.*`. Mismas reglas que agents/app/web_designer/disenador/tema_json.py: si cambian allá,
// cambian acá.
//
// Solo pasan las features `vista` y `modo-foco`, con componentes del catálogo que sirven para un tema remoto y
// datos que no pueden sacar al usuario del sitio ni cargar nada de otro host: los enlaces son rutas relativas
// (`/…`, nunca `//host` ni `/\host`) y las imágenes se descartan. Una clave desconocida se descarta sola; un valor
// que no cumple descarta la vista entera, que nunca queda a medias. Cada descarte deja su razón en `rechazos`.

export const MAX_VISTAS = 6;
export const MAX_ITEMS = 12;
export const MAX_CAMPOS = 6;
export const MAX_CADENA = 200;
// Las opciones fijas de un <select> del atajo (p. ej. estaciones) pueden ser más que los items de una vista.
const MAX_VALORES = 60;
const MAX_RUTAS = 12;

const ID = /^[\w-]{1,60}$/;
// Sin control: el parser de URLs borra tabs y saltos, y `/\t/host` quedaría `//host`.
const RUTA = /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/;
const JAVASCRIPT = /javascript\s*:/i;
// Como `expresion` de content/plantillas.js: `(a+)+` y parecidos se cuelgan con texto hostil.
const CUANTIFICADOR_ANIDADO = /[+*}]\)+[+*{]/;
const DESCARTADAS = new Set(["imagen", "imagen_grande"]);

class Rechazo extends Error {}

function fallar(donde, motivo) {
  throw new Rechazo(`${donde}: ${motivo}`);
}

const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

// ---------- Valores ----------

function cadena(valor, donde) {
  if (typeof valor !== "string") fallar(donde, "no es texto");
  if (valor.length > MAX_CADENA) fallar(donde, `más de ${MAX_CADENA} caracteres`);
  if (JAVASCRIPT.test(valor)) fallar(donde, "contiene javascript:");
  return valor;
}

function ruta(valor, donde) {
  cadena(valor, donde);
  if (!RUTA.test(valor)) fallar(donde, "no es una ruta relativa del sitio (/…)");
  return valor;
}

const selector = cadena;

function id(valor, donde) {
  if (typeof valor !== "string" || !ID.test(valor)) fallar(donde, "id inválido (letras, números, _ y -)");
  return valor;
}

function booleano(valor, donde) {
  if (typeof valor !== "boolean") fallar(donde, "no es true/false");
  return valor;
}

const entero = (min, max) => (valor, donde) => {
  if (!Number.isInteger(valor) || valor < min || valor > max) fallar(donde, `no es un entero entre ${min} y ${max}`);
  return valor;
};

// Un texto del tema: "texto" o { es: "…", en: "…" }.
function texto(valor, donde, rechazos) {
  if (typeof valor === "string") return cadena(valor, donde);
  if (!esObjeto(valor)) fallar(donde, "no es texto ni { es, en }");
  const salida = limpiar(valor, { es: cadena, en: cadena }, donde, rechazos);
  if (!Object.keys(salida).length) fallar(donde, "sin texto en es ni en");
  return salida;
}

function patron(valor, donde) {
  cadena(valor, donde);
  if (CUANTIFICADOR_ANIDADO.test(valor)) fallar(donde, "cuantificadores anidados");
  try {
    new RegExp(valor);
  } catch {
    fallar(donde, "expresión regular inválida");
  }
  return valor;
}

const lista = (validar, max) => (valor, donde, rechazos) => {
  if (!Array.isArray(valor)) fallar(donde, "no es una lista");
  if (valor.length > max) fallar(donde, `más de ${max} elementos`);
  return valor.map((elemento, i) => validar(elemento, `${donde}[${i}]`, rechazos));
};

const objeto = (esquema, requeridos = []) => (valor, donde, rechazos) => {
  if (!esObjeto(valor)) fallar(donde, "no es un objeto");
  const salida = limpiar(valor, esquema, donde, rechazos);
  for (const clave of requeridos) if (!(clave in salida)) fallar(donde, `falta \`${clave}\``);
  return salida;
};

// Un diccionario { clave: valor } de claves libres, con tope.
const diccionario = (validarValor, max) => (valor, donde, rechazos) => {
  if (!esObjeto(valor)) fallar(donde, "no es un objeto");
  const entradas = Object.entries(valor);
  if (entradas.length > max) fallar(donde, `más de ${max} entradas`);
  return Object.fromEntries(entradas.map(([clave, v]) => [cadena(clave, donde), validarValor(v, `${donde}.${clave}`, rechazos)]));
};

// Las claves fuera del esquema se descartan (con su razón); un valor que no cumple lanza.
function limpiar(valor, esquema, donde, rechazos) {
  const salida = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (v === undefined) continue;
    if (!Object.hasOwn(esquema, clave)) {
      rechazos.push(`${donde}: se descarta \`${clave}\`${DESCARTADAS.has(clave) ? " (las imágenes no se aceptan)" : ""}`);
    } else {
      salida[clave] = esquema[clave](v, `${donde}.${clave}`, rechazos);
    }
  }
  return salida;
}

// ---------- Componentes ----------

// Textos propios de un componente: por idioma ({ es: {…}, en: {…} }) o planos para todos.
function textos(claves) {
  const porClave = Object.fromEntries(claves.map((clave) => [clave, cadena]));
  return (valor, donde, rechazos) => {
    if (!esObjeto(valor)) fallar(donde, "no es un objeto");
    const planos = Object.values(valor).every((v) => typeof v === "string");
    if (planos) return limpiar(valor, porClave, donde, rechazos);
    return limpiar(valor, { es: objeto(porClave), en: objeto(porClave) }, donde, rechazos);
  };
}

const COMPONENTES = {
  atajo: {
    item: objeto(
      {
        nombre: id,
        etiqueta: texto,
        opciones: selector,
        valores: lista(
          objeto({ valor: (v, donde) => (Number.isFinite(v) ? String(v) : cadena(v, donde)), texto }, ["valor", "texto"]),
          MAX_VALORES,
        ),
        valor: cadena,
        requerido: booleano,
      },
      ["nombre"],
    ),
    opciones: objeto(
      {
        destino: ruta,
        fijos: diccionario(cadena, MAX_CAMPOS),
        invertir: (valor, donde) => {
          if (!Array.isArray(valor) || valor.length !== 2) fallar(donde, "no es un par de campos");
          return valor.map((nombre, i) => id(nombre, `${donde}[${i}]`));
        },
        textos: textos(["titulo", "subtitulo", "boton", "invertir", "elegir"]),
      },
      ["destino"],
    ),
  },
  lanzador: {
    item: objeto({ titulo: texto, detalle: texto, insignia: texto, enlace: ruta }, ["titulo", "enlace"]),
    opciones: objeto({ max: entero(1, MAX_ITEMS), textos: textos(["titulo", "subtitulo"]) }),
  },
  cartelera: {
    item: objeto({ titulo: cadena, subtitulo: cadena, detalle: cadena, insignia: cadena, enlace: ruta }, ["titulo", "enlace"]),
    opciones: objeto({
      fila: entero(1, MAX_ITEMS),
      textos: textos(["titulo", "destacado", "boton", "fila", "lista", "original", "volver"]),
    }),
  },
};

// ---------- Plantillas (leer los datos de la página) ----------

const reglaSimple = objeto({ selector, atributo: cadena, partes: selector, separador: cadena, patron, formato: cadena });

function regla(valor, donde, rechazos) {
  if (Array.isArray(valor)) return lista(reglaSimple, MAX_CAMPOS)(valor, donde, rechazos);
  return reglaSimple(valor, donde, rechazos);
}

function campos(valor, donde, rechazos) {
  if (!esObjeto(valor)) fallar(donde, "no es un objeto");
  const entradas = [];
  for (const [nombre, v] of Object.entries(valor)) {
    if (DESCARTADAS.has(nombre)) {
      rechazos.push(`${donde}: se descarta \`${nombre}\` (las imágenes no se aceptan)`);
      continue;
    }
    entradas.push([id(nombre, `${donde}.${nombre}`), regla(v, `${donde}.${nombre}`, rechazos)]);
  }
  if (entradas.length > MAX_CAMPOS) fallar(donde, `más de ${MAX_CAMPOS} campos`);
  // fromEntries y no `salida[nombre] =`: un campo `__proto__` cambiaría el prototipo.
  const salida = Object.fromEntries(entradas);
  // Con `formato`, el enlace lo arma el tema: que no pueda apuntar a otro host.
  for (const alternativa of [].concat(salida.enlace ?? [])) {
    if (alternativa.formato !== undefined) ruta(alternativa.formato, `${donde}.enlace.formato`);
  }
  return salida;
}

// ---------- Features ----------

function vista(valor, donde, rechazos) {
  if (!esObjeto(valor)) fallar(donde, "no es un objeto");
  const componente = COMPONENTES[valor.componente];
  if (!componente) fallar(donde, `componente desconocido ${JSON.stringify(valor.componente)}`);
  const salida = limpiar(
    valor,
    {
      id,
      rutas: lista(ruta, MAX_RUTAS),
      contenedor: selector,
      reemplazar: booleano,
      items: selector,
      datos: lista(componente.item, MAX_ITEMS),
      campos,
      accion: objeto({ selector }, ["selector"]),
      componente: (v) => v,
      opciones: componente.opciones,
    },
    donde,
    rechazos,
  );
  for (const clave of ["id", "contenedor"]) if (!(clave in salida)) fallar(donde, `falta \`${clave}\``);
  if (!salida.datos && !(salida.items && salida.campos)) fallar(donde, "sin `datos` ni plantilla (`items` y `campos`)");
  if (valor.componente === "atajo" && !salida.opciones) fallar(donde, "el atajo necesita `opciones.destino`");
  return salida;
}

const modoFoco = objeto({ rutas: lista(ruta, MAX_RUTAS), ancla: selector });

function vistas(valor, rechazos) {
  const salida = [];
  const ids = new Set();
  [].concat(valor).forEach((v, i) => {
    const nombre = esObjeto(v) && typeof v.id === "string" ? `vista ${JSON.stringify(v.id.slice(0, 60))}` : `vista[${i}]`;
    if (salida.length >= MAX_VISTAS) return rechazos.push(`${nombre}: más de ${MAX_VISTAS} vistas`);
    try {
      const saneada = vista(v, nombre, rechazos);
      if (ids.has(saneada.id)) fallar(nombre, "id repetido");
      ids.add(saneada.id);
      salida.push(saneada);
    } catch (error) {
      if (!(error instanceof Rechazo)) throw error;
      rechazos.push(`${error.message} (se descarta la vista)`);
    }
  });
  return salida;
}

// → { features, rechazos }: lo que el motor puede correr y por qué se descartó lo demás.
export function sanearTema(tema) {
  const rechazos = [];
  const features = {};
  if (!esObjeto(tema)) return { features, rechazos: tema == null ? [] : ["el tema no es un objeto"] };
  if (tema.features === undefined) return { features, rechazos };
  if (!esObjeto(tema.features)) return { features, rechazos: ["`features` no es un objeto"] };

  for (const [nombre, opciones] of Object.entries(tema.features)) {
    if (nombre === "vista") {
      const saneadas = vistas(opciones, rechazos);
      if (saneadas.length) features.vista = saneadas;
    } else if (nombre === "modo-foco") {
      try {
        features["modo-foco"] = modoFoco(opciones, "modo-foco", rechazos);
      } catch (error) {
        if (!(error instanceof Rechazo)) throw error;
        rechazos.push(`${error.message} (se descarta la feature)`);
      }
    } else {
      rechazos.push(`feature desconocida ${JSON.stringify(nombre.slice(0, 60))}`);
    }
  }
  return { features, rechazos };
}
