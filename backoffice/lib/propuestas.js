// La propuesta del Diseñador (la etapa improver de una revisión) para una tanda: qué tema generó a partir de lo que
// midieron los visitantes, por qué y cómo se ven las páginas antes y después. Solo lectura, como todo el backoffice.
//
// La corrida del Diseñador es <host>/improver/<corrida>/ y su manifest.json lista en `inputs` las tandas del
// Visitante que leyó: la propuesta de una tanda es la corrida más nueva que la lista. De ahí se lee:
//   tema.css     el tema saneado (agents/app/web_designer)
//   mejora.json  { resumen_tema, decisiones, tarea, modelo, error, vistas? }
//   vistas/*.png capturas antes y después del tema, si el Diseñador las dejó (`vistas` en mejora.json):
//     vistas: [{ url, titulo, capturas: { desktop|mobile: { antes, despues } },   rutas relativas a la corrida
//                marcas: [{ tipo: "siguiente"|"texto"|"objetivos"|"enlaces", dispositivo, caja: [x0, y0, x1, y1] }] }]
//     (caja en fracciones de la captura, 0–1)
//
// GET /api/propuestas/<tanda> → Propuesta (abajo). Las corridas cerradas se guardan en memoria; una en curso se vuelve
// a leer en cada pedido (la pantalla la consulta cada pocos segundos hasta que termina).

import { CORRIDA, MANIFIESTO, partesDeCorrida, partesDeTanda } from "../public/nucleo/almacen.js";

const CERRADA = new Set(["succeeded", "failed"]);
const LIMITE_EN_MEMORIA = 300;
const MAX_CSS = 200_000;
const MAX_TEXTO = 600;
const MAX_DECISIONES = 12;
const MAX_VISTAS = 12;
const DISPOSITIVOS = ["desktop", "mobile"];
const TIPOS_DE_MARCA = new Set(["siguiente", "texto", "objetivos", "enlaces"]);
/** Lo único que se sirve de una corrida del Diseñador, además de tema.css (por /resultados/). */
export const ARCHIVO_DE_VISTA = /^vistas\/[a-z0-9][a-z0-9-]{0,80}\.png$/;

/**
 * @typedef {Object} Cambio      Lo que el tema cambia, leído de tema.css (para las notas y sus muestras)
 * @property {"texto" | "interlineado" | "enlaces" | "objetivos"} tipo
 * @property {number} [porcentaje]   texto: cuánto crece la letra (12 → +12 %)
 * @property {number} [valor]        interlineado: el line-height sin unidad (1.6)
 * @property {number} [px]           objetivos: alto mínimo de botones y enlaces (44)
 *
 * @typedef {Object} Vista
 * @property {string} url
 * @property {string} titulo
 * @property {Record<"desktop" | "mobile", { antes: string | null, despues: string | null }>} capturas   claves de archivo
 *           ("<corrida>/vistas/…png") para urlDePropuesta()
 * @property {{ tipo: string, dispositivo: string, caja: number[] }[]} marcas
 *
 * @typedef {Object} Propuesta
 * @property {"ninguna" | "running" | "succeeded" | "failed"} estado
 * @property {string | null} corrida      clave de la corrida del Diseñador
 * @property {string | null} revision
 * @property {string | null} modelo
 * @property {string | null} inicio       ISO
 * @property {string | null} fin          ISO
 * @property {string | null} resumen      la idea del tema en una o dos frases (del modelo: dato de la corrida)
 * @property {string[]} decisiones        una frase por decisión (del modelo)
 * @property {{ id: string, descripcion: string } | null} tarea   el objetivo que el Diseñador quiso facilitar
 * @property {Cambio[]} cambios
 * @property {{ rol: "fondo" | "texto" | "acento", color: string }[]} paleta
 * @property {string | null} tema         "<corrida>/tema.css", para urlDeResultado()
 * @property {Vista[]} vistas
 * @property {string | null} error
 */

const texto = (valor, limite = MAX_TEXTO) => {
  const limpio = typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  return limpio.length > limite ? `${limpio.slice(0, limite - 1)}…` : limpio;
};
const textoONulo = (valor, limite) => texto(valor, limite) || null;

// ── tema.css → cambios y paleta ─────────────────────────────────────────

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const esDelCuerpo = (selector) => /(?:^|[\s>,])(?:html\.mi-tema|body|html\.mi-tema\s+body)\s*$/i.test(selector.trim()) || /\bbody\b/i.test(selector);
const esDeEnlaces = (selector) => /(?:^|[\s>,(])a(?:[\s:,.[)]|$)/i.test(selector);
const esDeBotones = (selector) => /\bbutton\b|role\s*=\s*["']?button|\binput\b|(?:^|[\s>,])a(?:[\s:,.[]|$)/i.test(selector);

function reglasDe(css) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const reglas = [];
  // Los bloques más internos: «selector { declaraciones }» (también los que están dentro de @media o @supports).
  for (const [, selector, cuerpo] of sinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector.trim().startsWith("@")) continue;
    const declaraciones = new Map();
    for (const parte of cuerpo.split(";")) {
      const corte = parte.indexOf(":");
      if (corte < 0) continue;
      const propiedad = parte.slice(0, corte).trim().toLowerCase();
      const valor = parte.slice(corte + 1).replace(/!important/gi, "").trim();
      if (propiedad && valor) declaraciones.set(propiedad, valor);
    }
    reglas.push({ selector: selector.trim(), declaraciones });
  }
  return reglas;
}

/**
 * Lo que un tema cambia y sus colores, leído de su CSS: letra (font-size en % sobre el cuerpo), interlineado
 * (line-height sin unidad), enlaces subrayados, alto mínimo de botones y enlaces, y fondo, texto y acento (con las
 * variables del tema resueltas). Lo que no reconoce no aparece: es un resumen, no el CSS.
 * @param {string} css
 * @returns {{ cambios: Cambio[], paleta: { rol: string, color: string }[] }}
 */
export function leerTema(css) {
  const reglas = reglasDe(String(css ?? "").slice(0, MAX_CSS));
  const variables = new Map();
  for (const { declaraciones } of reglas) {
    for (const [propiedad, valor] of declaraciones) if (propiedad.startsWith("--")) variables.set(propiedad, valor);
  }
  const resolver = (valor, profundidad = 0) => {
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(String(valor ?? "").trim());
    if (!ref || profundidad > 4) return String(valor ?? "").trim();
    return resolver(variables.get(ref[1]) ?? ref[2] ?? "", profundidad + 1);
  };
  const color = (valor) => {
    const resuelto = resolver(valor).split(/\s+/).find((parte) => COLOR.test(parte));
    return resuelto ? resuelto.toLowerCase() : null;
  };

  const cambios = [];
  const paleta = new Map();
  const agregar = (cambio) => {
    if (!cambios.some((otro) => otro.tipo === cambio.tipo)) cambios.push(cambio);
  };
  for (const { selector, declaraciones } of reglas) {
    const cuerpo = esDelCuerpo(selector) && !esDeEnlaces(selector);
    if (cuerpo) {
      const tamano = /^(\d+(?:\.\d+)?)%$/.exec(resolver(declaraciones.get("font-size")));
      if (tamano && Number(tamano[1]) > 100) agregar({ tipo: "texto", porcentaje: Math.round(Number(tamano[1]) - 100) });
      const em = /^(\d+(?:\.\d+)?)r?em$/.exec(resolver(declaraciones.get("font-size")));
      if (em && Number(em[1]) > 1) agregar({ tipo: "texto", porcentaje: Math.round((Number(em[1]) - 1) * 100) });
      const interlineado = /^(\d+(?:\.\d+)?)$/.exec(resolver(declaraciones.get("line-height")));
      if (interlineado && Number(interlineado[1]) >= 1.2) agregar({ tipo: "interlineado", valor: Number(interlineado[1]) });
      const fondo = color(declaraciones.get("background-color") ?? declaraciones.get("background"));
      if (fondo && !paleta.has("fondo")) paleta.set("fondo", fondo);
      const tinta = color(declaraciones.get("color"));
      if (tinta && !paleta.has("texto")) paleta.set("texto", tinta);
    }
    if (esDeEnlaces(selector)) {
      const decoracion = resolver(declaraciones.get("text-decoration") ?? declaraciones.get("text-decoration-line"));
      if (/\bunderline\b/i.test(decoracion)) agregar({ tipo: "enlaces" });
      const acento = color(declaraciones.get("color"));
      if (acento && !paleta.has("acento")) paleta.set("acento", acento);
    }
    if (esDeBotones(selector)) {
      const alto = /^(\d+(?:\.\d+)?)px$/.exec(resolver(declaraciones.get("min-height")));
      if (alto && Number(alto[1]) >= 40) agregar({ tipo: "objetivos", px: Math.round(Number(alto[1])) });
    }
  }
  // Sin una regla del cuerpo o de enlaces que los use, las variables con nombre de rol también cuentan.
  for (const [rol, nombres] of [["fondo", ["--mi-fondo"]], ["texto", ["--mi-texto"]], ["acento", ["--mi-acento"]]]) {
    if (paleta.has(rol)) continue;
    const valor = nombres.map((nombre) => color(variables.get(nombre))).find(Boolean);
    if (valor) paleta.set(rol, valor);
  }
  const orden = ["texto", "interlineado", "enlaces", "objetivos"];
  cambios.sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo));
  return { cambios, paleta: ["fondo", "texto", "acento"].filter((rol) => paleta.has(rol)).map((rol) => ({ rol, color: paleta.get(rol) })) };
}

// ── mejora.json ─────────────────────────────────────────────────────────

const caja = (valor) =>
  Array.isArray(valor) && valor.length === 4 && valor.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && valor[2] > valor[0] && valor[3] > valor[1]
    ? valor.map((n) => Math.round(n * 10000) / 10000)
    : null;

/** Las vistas de mejora.json con las rutas validadas (solo vistas/*.png de la misma corrida). */
export function vistasDeMejora(mejora, runKey) {
  const crudas = Array.isArray(mejora?.vistas) ? mejora.vistas.slice(0, MAX_VISTAS) : [];
  const archivo = (relativa) => (typeof relativa === "string" && ARCHIVO_DE_VISTA.test(relativa) ? `${runKey}/${relativa}` : null);
  return crudas
    .filter((vista) => vista && typeof vista === "object" && texto(vista.url))
    .map((vista) => ({
      url: texto(vista.url, 2000),
      titulo: texto(vista.titulo ?? vista.title, 300),
      capturas: Object.fromEntries(
        DISPOSITIVOS.map((dispositivo) => {
          const par = vista.capturas?.[dispositivo];
          return [dispositivo, { antes: archivo(par?.antes), despues: archivo(par?.despues) }];
        }),
      ),
      marcas: (Array.isArray(vista.marcas) ? vista.marcas : [])
        .map((marca) => ({ tipo: marca?.tipo, dispositivo: marca?.dispositivo, caja: caja(marca?.caja) }))
        .filter((marca) => TIPOS_DE_MARCA.has(marca.tipo) && DISPOSITIVOS.includes(marca.dispositivo) && marca.caja),
    }));
}

/**
 * La propuesta armada a partir de lo leído de una corrida del Diseñador.
 * @param {{ runKey: string, manifiesto: object, mejora?: object | null, css?: string | null }} leido
 * @returns {Propuesta}
 */
export function armarPropuesta({ runKey, manifiesto, mejora = null, css = null }) {
  const estado = ["running", "succeeded", "failed"].includes(manifiesto?.status) ? manifiesto.status : "running";
  const tema = estado === "succeeded" && css ? leerTema(css) : { cambios: [], paleta: [] };
  const tarea = mejora?.tarea && typeof mejora.tarea === "object" && texto(mejora.tarea.id)
    ? { id: texto(mejora.tarea.id, 100), descripcion: texto(mejora.tarea.descripcion) }
    : null;
  return {
    estado,
    corrida: runKey,
    revision: textoONulo(manifiesto?.revision, 60),
    modelo: textoONulo(manifiesto?.model ?? mejora?.modelo, 120),
    inicio: textoONulo(manifiesto?.started_at, 40),
    fin: estado === "running" ? null : textoONulo(manifiesto?.finished_at, 40),
    resumen: textoONulo(mejora?.resumen_tema),
    decisiones: (Array.isArray(mejora?.decisiones) ? mejora.decisiones : []).map((decision) => texto(decision, 300)).filter(Boolean).slice(0, MAX_DECISIONES),
    tarea,
    cambios: tema.cambios,
    paleta: tema.paleta,
    tema: estado === "succeeded" && css ? `${runKey}/tema.css` : null,
    vistas: estado === "succeeded" ? vistasDeMejora(mejora, runKey) : [],
    error: estado === "failed" ? textoONulo(mejora?.error, 300) : null,
  };
}

/** @type {Propuesta} */
export const SIN_PROPUESTA = Object.freeze({
  estado: "ninguna", corrida: null, revision: null, modelo: null, inicio: null, fin: null, resumen: null, decisiones: [],
  tarea: null, cambios: [], paleta: [], tema: null, vistas: [], error: null,
});

// ── Lectura ─────────────────────────────────────────────────────────────

async function leerTexto(fuente, runKey, relativa) {
  const abierto = await fuente.abrirArchivo(runKey, relativa);
  if (!abierto?.cuerpo) return null;
  if (abierto.tamano > MAX_CSS * 2) {
    abierto.cuerpo.destroy();
    return null;
  }
  const partes = [];
  for await (const parte of abierto.cuerpo) partes.push(Buffer.from(parte));
  return Buffer.concat(partes).toString("utf8");
}

function recordar(mapa, clave, valor) {
  mapa.delete(clave);
  mapa.set(clave, valor);
  if (mapa.size > LIMITE_EN_MEMORIA) mapa.delete(mapa.keys().next().value);
}

/**
 * @param {import("./fuente.js").Fuente} fuente
 * @returns {{ deTanda(id: string): Promise<Propuesta> }}
 */
export function crearPropuestas(fuente) {
  const manifiestos = new Map(); // corridas cerradas: runKey → manifest.json
  const armadas = new Map(); // corridas cerradas: runKey → Propuesta

  async function manifiesto(runKey) {
    if (manifiestos.has(runKey)) return manifiestos.get(runKey);
    const datos = await fuente.leerJson(runKey, MANIFIESTO);
    if (datos && CERRADA.has(datos.status)) recordar(manifiestos, runKey, datos);
    return datos;
  }

  async function leer(runKey, datos) {
    if (armadas.has(runKey)) return armadas.get(runKey);
    const cerrada = CERRADA.has(datos.status);
    const [mejora, css] = cerrada
      ? await Promise.all([fuente.leerJson(runKey, "mejora.json"), datos.status === "succeeded" ? leerTexto(fuente, runKey, "tema.css") : null])
      : [null, null];
    const propuesta = armarPropuesta({ runKey, manifiesto: datos, mejora, css });
    if (cerrada) recordar(armadas, runKey, propuesta);
    return propuesta;
  }

  return {
    /** La propuesta de una tanda (id ya validado), o SIN_PROPUESTA si ninguna corrida del Diseñador la leyó. */
    async deTanda(id) {
      const { host, corrida } = partesDeTanda(id);
      const carpeta = `${host}/improver`;
      // Solo las corridas posteriores a la tanda pueden haberla leído; de la más nueva a la más vieja.
      const corridas = (await fuente.listarPerfiles(carpeta))
        .filter((run) => CORRIDA.test(run) && run >= corrida && partesDeCorrida(`${carpeta}/${run}`))
        .sort()
        .reverse();
      for (const run of corridas) {
        const runKey = `${carpeta}/${run}`;
        const datos = await manifiesto(runKey);
        if (Array.isArray(datos?.inputs) && datos.inputs.includes(id)) return leer(runKey, datos);
      }
      return SIN_PROPUESTA;
    },
  };
}
