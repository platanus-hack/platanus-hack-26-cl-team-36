// Lo que la pestaña Propuesta deduce de la tanda y de la propuesta del Diseñador (lib/propuestas.js). Puro: no toca
// document ni window, así node:test lo importa.
//
// Una vista es una página de la ruta de la Guía con su captura antes y después del tema, en escritorio y en móvil.
// El «antes» es la captura del Diseñador si la dejó y, si no (todavía diseña, o no deja capturas), la de un visitante
// al llegar a esa página. El «después» solo existe si el Diseñador lo capturó.

export const DISPOSITIVOS = ["desktop", "mobile"];

/** La URL sin esquema, www, consulta, fragmento ni barra final: así calzan la de la Guía, la del visitante y la del Diseñador. */
export function claveDeUrl(url) {
  const texto = String(url ?? "").trim();
  try {
    const { host, pathname } = new URL(texto);
    return `${host.replace(/^www\./, "")}${pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return texto.replace(/^https?:\/\/(www\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

/** Escritorio o móvil: el perfil `mobile` o un viewport angosto. */
export function dispositivoDelIntento(intento) {
  const ancho = Number(intento?.viewport?.ancho) || 0;
  return intento?.perfil === "mobile" || (ancho > 0 && ancho < 600) ? "mobile" : "desktop";
}

/** La captura de un intento al llegar a la página `id`: la inicial si parte ahí; si no, la del primer paso que llega. */
function capturaDeLlegada(intento, id) {
  const primero = intento.pasos?.[0];
  if (intento.inicio?.captura && (primero ? primero.paginaAntes === id : false)) {
    return { tipo: "intento", intento: intento.id, archivo: intento.inicio.captura };
  }
  const pasos = intento.pasos ?? [];
  const paso = pasos.find((cada) => cada.pagina === id && cada.captura && cada.paginaAntes !== id) ?? pasos.find((cada) => cada.pagina === id && cada.captura);
  return paso ? { tipo: "intento", intento: intento.id, archivo: paso.captura } : null;
}

const valido = (intento) => intento.resultado !== "error";
/** La página donde terminó un intento: la del último paso o, sin pasos, la de inicio. */
const paginaFinal = (intento) => intento.pasos?.at(-1)?.pagina ?? intento.pasos?.[0]?.paginaAntes ?? null;

/**
 * El sufijo que el sitio pone a sus títulos (« - Móvil Sur»), sacado de una página de la telaraña que ya tiene título
 * corto; "" si no hay. Para nombrar igual las páginas que solo capturó el Diseñador.
 */
export function sufijoDeLaTanda(tanda) {
  for (const pagina of tanda?.telarana?.paginas ?? []) {
    const { titulo, tituloCorto } = pagina;
    if (pagina.tituloTipo === "sitio" && tituloCorto && titulo && titulo !== tituloCorto && titulo.startsWith(tituloCorto)) return titulo.slice(tituloCorto.length);
  }
  return "";
}

const sinSufijo = (titulo, sufijo) => (sufijo && titulo?.endsWith(sufijo) && titulo.length > sufijo.length ? titulo.slice(0, -sufijo.length).trim() : (titulo ?? ""));

/** Las páginas que se muestran: la ruta de la Guía; sin ella, la de la telaraña; sin ninguna, las del Diseñador. */
function paginasBase(tanda, propuesta) {
  const guia = tanda?.rutaGuia?.paginas ?? [];
  if (guia.length) return guia.map((pagina) => ({ id: pagina.id ?? null, url: pagina.url, titulo: pagina.titulo, tituloCorto: pagina.tituloCorto, tituloTipo: pagina.tituloTipo, accion: pagina.accion ?? null }));
  const porId = new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const telarana = (tanda?.telarana?.ruta?.paginas ?? []).map((id) => porId.get(id)).filter(Boolean);
  if (telarana.length) return telarana.map((pagina) => ({ id: pagina.id, url: pagina.url, accion: null }));
  return (propuesta?.vistas ?? []).map((vista) => ({ id: null, url: vista.url, titulo: vista.titulo, tituloCorto: null, tituloTipo: "sitio", accion: null }));
}

/**
 * @typedef {{ tipo: "propuesta", clave: string } | { tipo: "intento", intento: string, archivo: string }} Captura
 *
 * @typedef {Object} VistaDePropuesta
 * @property {string} id            id estable para la URL: el de la página de la telaraña o la URL sin consulta
 * @property {string | null} pagina id de la página en la telaraña (para nombrarla), o null
 * @property {{ titulo?: string, tituloCorto?: string | null, tituloTipo?: string, url: string }} datos  para nombrarla si no está en la telaraña
 * @property {string} url
 * @property {number} paradas       intentos válidos que no llegaron y terminaron aquí
 * @property {Record<"desktop" | "mobile", { antes: Captura | null, despues: Captura | null }>} capturas
 * @property {{ tipo: string, dispositivo: string, caja: number[] }[]} marcas
 */

/**
 * Las vistas de la propuesta, en el orden de la ruta: las páginas que tienen alguna captura (de un visitante o del
 * Diseñador). Las que el Diseñador capturó fuera de la ruta van al final.
 * @returns {VistaDePropuesta[]}
 */
export function vistasDeLaPropuesta(tanda, propuesta) {
  const intentos = (tanda?.intentos ?? []).filter(valido);
  const delDisenador = new Map((propuesta?.vistas ?? []).map((vista) => [claveDeUrl(vista.url), vista]));
  const porId = new Map((tanda?.telarana?.paginas ?? []).map((pagina) => [pagina.id, pagina]));
  const usadas = new Set();
  const sufijo = sufijoDeLaTanda(tanda);
  const vistas = [];
  const agregar = (base) => {
    const url = base.url ?? (base.id ? porId.get(base.id)?.url : null) ?? "";
    const clave = claveDeUrl(url);
    const id = base.id ?? clave;
    if (!clave || vistas.some((vista) => vista.id === id)) return;
    const disenador = delDisenador.get(clave) ?? null;
    if (disenador) usadas.add(clave);
    const capturas = Object.fromEntries(
      DISPOSITIVOS.map((dispositivo) => {
        const propias = disenador?.capturas?.[dispositivo] ?? {};
        let antes = propias.antes ? { tipo: "propuesta", clave: propias.antes } : null;
        if (!antes && base.id) {
          for (const intento of intentos.filter((cada) => dispositivoDelIntento(cada) === dispositivo)) {
            antes = capturaDeLlegada(intento, base.id);
            if (antes) break;
          }
        }
        return [dispositivo, { antes, despues: propias.despues ? { tipo: "propuesta", clave: propias.despues } : null }];
      }),
    );
    if (!DISPOSITIVOS.some((dispositivo) => capturas[dispositivo].antes || capturas[dispositivo].despues)) return;
    vistas.push({
      id,
      pagina: base.id && porId.has(base.id) ? base.id : null,
      datos: {
        titulo: base.titulo ?? disenador?.titulo ?? "",
        tituloCorto: base.tituloCorto ?? (sinSufijo(base.titulo ?? disenador?.titulo, sufijo) || null),
        tituloTipo: base.tituloTipo ?? "sitio",
        url,
      },
      url,
      paradas: base.id ? intentos.filter((intento) => intento.resultado !== "logrado" && paginaFinal(intento) === base.id).length : 0,
      capturas,
      marcas: disenador?.marcas ?? [],
    });
  };
  for (const base of paginasBase(tanda, propuesta)) agregar(base);
  for (const vista of propuesta?.vistas ?? []) {
    if (!usadas.has(claveDeUrl(vista.url))) agregar({ id: null, url: vista.url, titulo: vista.titulo, tituloTipo: "sitio" });
  }
  return vistas;
}

/** El texto entre «» de una acción («clic «Requisitos»» → «Requisitos»), o null. */
const objetivoDeAccion = (accion) => /«(.+)»/s.exec(String(accion ?? ""))?.[1]?.trim() ?? null;

/**
 * @typedef {Object} Evidencia      Dónde se quedaron los que no llegaron (la nota 1)
 * @property {string} vista         id de la vista donde se quedaron más
 * @property {number} paradas
 * @property {number} de            intentos válidos de la tanda
 * @property {{ texto: string | null, pagina: object | null, clics: number } | null} siguiente
 *           el paso siguiente de la ruta desde ahí: el texto del enlace (dato del sitio) o la página, y cuántos clics
 *           le dieron los visitantes en esa página
 */

/**
 * La evidencia de los visitantes: la vista donde más intentos se quedaron sin llegar y el enlace de la ruta que no
 * tomaron. null si ninguno se quedó en una página de la propuesta.
 * @returns {Evidencia | null}
 */
export function evidenciaDeLaTanda(tanda, vistas) {
  const intentos = (tanda?.intentos ?? []).filter(valido);
  const parada = [...vistas].sort((a, b) => b.paradas - a.paradas)[0];
  if (!parada?.paradas) return null;
  const ruta = tanda?.rutaGuia?.paginas ?? [];
  const indice = ruta.findIndex((pagina) => (pagina.id ?? claveDeUrl(pagina.url)) === parada.id || claveDeUrl(pagina.url) === claveDeUrl(parada.url));
  const proxima = indice >= 0 ? ruta[indice + 1] : null;
  let siguiente = null;
  if (proxima) {
    const texto = objetivoDeAccion(proxima.accion);
    const clics = intentos
      .flatMap((intento) => intento.pasos ?? [])
      .filter((paso) => paso.paginaAntes === parada.pagina && ((proxima.id && paso.pagina === proxima.id) || (texto && paso.elemento === texto))).length;
    siguiente = { texto, pagina: proxima, clics };
  }
  return { vista: parada.id, paradas: parada.paradas, de: intentos.length, siguiente };
}

/**
 * @typedef {Object} Nota
 * @property {number} n
 * @property {"evidencia" | "texto" | "objetivos" | "enlaces"} tipo
 * @property {object[]} cambios     los cambios del tema que muestra (lib/propuestas.js)
 * @property {string} marca         el tipo de marca de las vistas que la ubica sobre la captura
 */

/**
 * Las notas numeradas de la columna derecha, en el orden de sus marcas: la evidencia (con los enlaces subrayados si
 * el tema los subraya), la letra y el interlineado, y el alto de los botones.
 * @returns {Nota[]}
 */
export function notasDeLaPropuesta(propuesta, evidencia) {
  const cambios = propuesta?.cambios ?? [];
  const de = (...tipos) => cambios.filter((cambio) => tipos.includes(cambio.tipo));
  const notas = [];
  const agregar = (tipo, suyos, marca) => notas.push({ n: notas.length + 1, tipo, cambios: suyos, marca });
  if (evidencia) agregar("evidencia", de("enlaces"), "siguiente");
  if (de("texto", "interlineado").length) agregar("texto", de("texto", "interlineado"), "texto");
  if (de("objetivos").length) agregar("objetivos", de("objetivos"), "objetivos");
  if (!evidencia && de("enlaces").length) agregar("enlaces", de("enlaces"), "siguiente");
  return notas;
}
