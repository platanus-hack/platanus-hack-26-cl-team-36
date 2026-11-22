// Teclado (diseño §5.5 y §7): un solo oyente keydown/keyup en document. Prioridad: diálogo modal abierto (se
// maneja solo) > ámbito "pantalla" (pantalla y marco de la tanda) > "global". Se ignoran las teclas mientras se
// escribe en un campo, salvo las que declaran `enCampos`. Una tecla ya tomada en el mismo ámbito se rechaza con
// console.error: así el mapa de §7 no tiene conflictos.
//
// `descripcion` puede ser un texto o una función que lo devuelve (para los atajos que sobreviven a un cambio de
// idioma). Teclas: "j", "?", "Shift+N", "Shift+ArrowRight", "Mod+k" (⌘ en Mac, Ctrl en el resto), "g c" (acorde, 1 s),
// "Space", "Home", "Escape". Shift cuenta en letras y teclas con nombre; en símbolos ("?", "+", "[") ya va
// incluido en el carácter.

import { el } from "./dom.js";
import { t } from "./i18n.js";
import { icono } from "./iconos.js";

const plataforma = globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform ?? "";
export const esMac = /mac|iphone|ipad/i.test(plataforma);

const MODIFICADORES = ["Mod", "Ctrl", "Alt", "Meta", "Shift"];
const ESPERA_DE_ACORDE = 1000;

/** @type {{ global: object[], pantalla: object[] }} */
const registros = { global: [], pantalla: [] };
const sostenidas = new Map(); // event.code → registro con alSoltar
let pendiente = null;
let relojDeAcorde = 0;
let iniciado = false;

const esLetra = (tecla) => /^\p{L}$/u.test(tecla);

function canonica(modificadores, tecla) {
  let clave = tecla === " " ? "Space" : tecla;
  if (clave.length === 1) clave = esLetra(clave) ? clave.toLowerCase() : clave;
  const conjunto = new Set(modificadores);
  // En un símbolo, Shift ya está en el carácter ("?" es Shift+/ en un teclado US).
  if (clave.length === 1 && !esLetra(clave)) conjunto.delete("Shift");
  const prefijo = MODIFICADORES.filter((m) => conjunto.has(m)).map((m) => `${m}+`).join("");
  return `${prefijo}${clave}`;
}

/** "Shift+P" → "Shift+p"; "g c" → "g c"; "+" → "+". */
export function normalizarTecla(especificacion) {
  return String(especificacion)
    .trim()
    .split(/\s+/)
    .map((parte) => {
      const m = /^((?:(?:Mod|Ctrl|Alt|Meta|Shift)\+)*)(.+)$/.exec(parte);
      const modificadores = m[1] ? m[1].slice(0, -1).split("+") : [];
      return canonica(modificadores, m[2]);
    })
    .join(" ");
}

/**
 * La tecla de un evento en la forma de los registros ("j", "Shift+n", "Mod+k", "[").
 * En teclados español/latinoamericano "[", "]", "{", "@"… se escriben con Option (Mac) o AltGr (Windows/Linux,
 * que llega como Ctrl+Alt): en un símbolo esos modificadores ya están en el carácter, como Shift, y no cuentan.
 * @param {{ key: string, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean, shiftKey?: boolean,
 *           getModifierState?: (nombre: string) => boolean }} evento
 * @param {{ mac?: boolean }} [opciones]   para las pruebas; por defecto, la plataforma del navegador
 */
export function teclaDelEvento(evento, { mac = esMac } = {}) {
  const { key } = evento;
  if (!key || key === "Dead" || key === "Unidentified" || ["Shift", "Control", "Alt", "AltGraph", "Meta", "OS"].includes(key)) return null;
  const simbolo = key.length === 1 && key !== " " && !esLetra(key);
  const altGr = simbolo && (evento.getModifierState?.("AltGraph") || (!mac && evento.ctrlKey && evento.altKey));
  const ctrl = evento.ctrlKey && !altGr;
  const alt = evento.altKey && !simbolo;
  const modificadores = [];
  if (mac ? evento.metaKey : ctrl) modificadores.push("Mod");
  if (mac && ctrl) modificadores.push("Ctrl");
  if (!mac && evento.metaKey) modificadores.push("Meta");
  if (alt) modificadores.push("Alt");
  if (evento.shiftKey) modificadores.push("Shift");
  return canonica(modificadores, key);
}

const esCampo = (objetivo) =>
  objetivo instanceof Element && !!objetivo.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

// Espacio y Enter sobre un botón o enlace: gana la activación nativa.
const activacionNativa = (objetivo, tecla) =>
  (tecla === "Space" || tecla === "Enter") &&
  objetivo instanceof Element &&
  !!objetivo.closest('button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"]');

function hayDialogoModal() {
  for (const dialogo of document.querySelectorAll("dialog[open]")) {
    try {
      if (dialogo.matches(":modal")) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function buscar(tecla) {
  for (const ambito of ["pantalla", "global"]) {
    const lista = registros[ambito];
    for (let i = lista.length - 1; i >= 0; i -= 1) if (lista[i].tecla === tecla) return lista[i];
  }
  return null;
}

const hayAcordeQueEmpiezaCon = (tecla) =>
  [...registros.pantalla, ...registros.global].some((registro) => registro.tecla.startsWith(`${tecla} `));

function ejecutar(registro, evento) {
  evento.preventDefault();
  if (registro.mantener) {
    if (evento.repeat) return;
    if (registro.alSoltar) sostenidas.set(evento.code || evento.key, registro);
  }
  try {
    registro.accion(evento);
  } catch (error) {
    console.error(`atajos: falló la acción de «${registro.tecla}»`, error);
  }
}

function alPresionar(evento) {
  if (evento.defaultPrevented || evento.isComposing || hayDialogoModal()) return;
  const tecla = teclaDelEvento(evento);
  if (!tecla) return;
  const enCampo = esCampo(evento.target);

  if (pendiente) {
    const acorde = `${pendiente} ${tecla}`;
    pendiente = null;
    clearTimeout(relojDeAcorde);
    const registro = buscar(acorde);
    if (registro && (!enCampo || registro.enCampos)) return ejecutar(registro, evento);
  }

  const registro = buscar(tecla);
  if (registro) {
    if (enCampo && !registro.enCampos) return;
    if (activacionNativa(evento.target, tecla)) return;
    return ejecutar(registro, evento);
  }
  if (!enCampo && hayAcordeQueEmpiezaCon(tecla)) {
    pendiente = tecla;
    clearTimeout(relojDeAcorde);
    relojDeAcorde = setTimeout(() => {
      pendiente = null;
    }, ESPERA_DE_ACORDE);
  }
}

function soltar(clave, evento) {
  const registro = sostenidas.get(clave);
  if (!registro) return;
  sostenidas.delete(clave);
  try {
    registro.alSoltar(evento);
  } catch (error) {
    console.error(`atajos: falló alSoltar de «${registro.tecla}»`, error);
  }
}

/** Pone los oyentes una sola vez (registrarAtajos lo llama solo). */
export function iniciarAtajos() {
  if (iniciado || typeof document === "undefined") return;
  iniciado = true;
  document.addEventListener("keydown", alPresionar);
  document.addEventListener("keyup", (evento) => soltar(evento.code || evento.key, evento));
  addEventListener("blur", (evento) => {
    for (const clave of [...sostenidas.keys()]) soltar(clave, evento);
  });
}

/**
 * Registra atajos en un ámbito. → quitar().
 * @param {Record<string, { accion: (e: KeyboardEvent) => void, descripcion: string, grupo?: string,
 *   mantener?: boolean, alSoltar?: (e: Event) => void, enCampos?: boolean }>} mapa
 * @param {{ ambito?: "pantalla" | "global", grupo?: string }} opciones  grupo por defecto de las entradas
 */
export function registrarAtajos(mapa, { ambito = "pantalla", grupo = null } = {}) {
  iniciarAtajos();
  const lista = registros[ambito] ?? registros.pantalla;
  const agregados = [];
  for (const [especificacion, datos] of Object.entries(mapa ?? {})) {
    if (!datos || typeof datos.accion !== "function") continue;
    const tecla = normalizarTecla(especificacion);
    if (lista.some((registro) => registro.tecla === tecla)) {
      console.error(`atajos: la tecla «${especificacion}» ya está tomada en el ámbito «${ambito}»; se rechaza`);
      continue;
    }
    const registro = {
      tecla,
      especificacion,
      ambito,
      accion: datos.accion,
      descripcion: datos.descripcion ?? "",
      grupo: datos.grupo ?? grupo ?? ambito,
      mantener: !!datos.mantener,
      alSoltar: datos.alSoltar ?? null,
      enCampos: !!datos.enCampos,
    };
    lista.push(registro);
    agregados.push(registro);
  }
  return function quitar() {
    for (const registro of agregados) {
      const indice = lista.indexOf(registro);
      if (indice !== -1) lista.splice(indice, 1);
      for (const [clave, sostenida] of sostenidas) if (sostenida === registro) sostenidas.delete(clave);
    }
    agregados.length = 0;
  };
}

/** → [{ grupo, tecla, descripcion, mantener }] de los atajos activos ahora (para la hoja "?"). */
export function listarAtajos() {
  return [...registros.pantalla, ...registros.global].map(({ grupo, especificacion, descripcion, mantener }) => ({
    grupo,
    tecla: especificacion,
    descripcion: typeof descripcion === "function" ? descripcion() : descripcion,
    mantener,
  }));
}

// ── Cómo se ven las teclas ────────────────────────────────────────────────

const NOMBRES_VISIBLES = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: () => t("comun.atajos.tecla.escape"),
  Enter: () => t("comun.atajos.tecla.intro"),
  Space: () => t("comun.atajos.tecla.espacio"),
  Tab: () => t("comun.atajos.tecla.tab"),
  Home: () => t("comun.atajos.tecla.inicio"),
  End: () => t("comun.atajos.tecla.fin"),
};

const MODIFICADORES_VISIBLES = {
  Mod: () => (esMac ? "⌘" : "Ctrl"),
  Ctrl: () => (esMac ? "⌃" : "Ctrl"),
  Alt: () => (esMac ? "⌥" : "Alt"),
  Meta: () => "Meta",
  Shift: () => "⇧",
};

/** "Mod+k" → [["⌘", "K"]]; "g c" → [["g"], ["c"]] (un arreglo por golpe del acorde). */
export function teclasVisibles(especificacion) {
  return String(especificacion)
    .trim()
    .split(/\s+/)
    .map((parte) => {
      const m = /^((?:(?:Mod|Ctrl|Alt|Meta|Shift)\+)*)(.+)$/.exec(parte);
      const modificadores = m[1] ? m[1].slice(0, -1).split("+") : [];
      const tecla = m[2];
      const nombre = NOMBRES_VISIBLES[tecla];
      const visible = typeof nombre === "function" ? nombre() : nombre ?? (modificadores.length ? tecla.toUpperCase() : tecla);
      return [...modificadores.map((mod) => MODIFICADORES_VISIBLES[mod]?.() ?? mod), visible];
    });
}

/** <span class="teclas"><kbd>⌘</kbd><kbd>K</kbd></span>; los acordes van separados por "luego". */
export function kbd(especificacion, { mantener = false } = {}) {
  const golpes = teclasVisibles(especificacion);
  const hijos = [];
  if (mantener) hijos.push(el("span", { class: "teclas-separador", texto: t("comun.atajos.mantener") }));
  golpes.forEach((golpe, indice) => {
    if (indice) hijos.push(el("span", { class: "teclas-separador", texto: t("comun.atajos.luego") }));
    for (const pieza of golpe) hijos.push(el("kbd", { texto: pieza }));
  });
  return el("span", { class: "teclas" }, hijos);
}

// ── Hoja de atajos ("?") ─────────────────────────────────────────────────

// Orden y título de los grupos. La hoja muestra solo los atajos registrados ahora (los de todas partes, los de la
// tanda y los de la pantalla abierta): así nunca anuncia una tecla que no hace nada, ni calla una que sí.
const GRUPOS = ["global", "overview", "tanda", "corridas", "telarana", "replay"];

/**
 * Los grupos de la hoja a partir de listarAtajos(): en el orden de GRUPOS (los desconocidos, al final) y, dentro de
 * cada grupo, una fila por descripción con todas sus teclas. Puro: las pruebas lo usan sin navegador.
 * → [{ grupo, filas: [{ descripcion, teclas: string[], mantener }] }]
 */
export function gruposDeLaHoja(vivos) {
  const conocidos = GRUPOS.filter((grupo) => vivos.some((registro) => registro.grupo === grupo));
  const otros = [...new Set(vivos.map((registro) => registro.grupo))].filter((grupo) => !GRUPOS.includes(grupo));
  return [...conocidos, ...otros].map((grupo) => {
    const porDescripcion = new Map();
    for (const registro of vivos.filter((cada) => cada.grupo === grupo)) {
      const fila = porDescripcion.get(registro.descripcion) ?? { descripcion: registro.descripcion, teclas: [], mantener: registro.mantener };
      fila.teclas.push(registro.tecla);
      porDescripcion.set(registro.descripcion, fila);
    }
    return { grupo, filas: [...porDescripcion.values()] };
  });
}

let hoja = null;

function dialogoDeHoja() {
  if (hoja?.isConnected) return hoja;
  hoja = document.getElementById("hoja-atajos") ?? document.body.appendChild(el("dialog", { id: "hoja-atajos", class: "hoja-atajos" }));
  hoja.addEventListener("click", (evento) => {
    if (evento.target === hoja) hoja.close();
  });
  return hoja;
}

/** Abre la hoja con los atajos que funcionan en la vista actual. */
export function abrirHojaDeAtajos() {
  const dialogo = dialogoDeHoja();
  dialogo.setAttribute("aria-labelledby", "hoja-atajos-titulo");
  dialogo.replaceChildren(
    el(
      "header",
      { class: "hoja-atajos-cabecera" },
      el("h2", { id: "hoja-atajos-titulo", texto: t("comun.atajos.titulo") }),
      el("button", {
        type: "button",
        class: "boton boton-icono",
        "aria-label": t("comun.accion.cerrar"),
        onclick: () => dialogo.close(),
      }, icono("cerrar")),
    ),
    el("p", { class: "hoja-atajos-nota texto-3", texto: t("comun.atajos.nota") }),
    el(
      "div",
      { class: "hoja-atajos-grupos" },
      gruposDeLaHoja(listarAtajos()).map(({ grupo, filas }) => {
        const titulo = GRUPOS.includes(grupo) ? t(`comun.atajos.grupo.${grupo}`) : grupo;
        return el(
          "section",
          { class: "hoja-atajos-grupo" },
          el("h3", { class: "etiqueta-micro", texto: titulo }),
          el(
            "dl",
            {},
            filas.map((fila) =>
              el(
                "div",
                { class: "hoja-atajos-fila" },
                el("dt", {}, fila.teclas.map((tecla, indice) => [indice ? el("span", { class: "teclas-separador", texto: "/" }) : null, kbd(tecla, { mantener: fila.mantener && indice === 0 })])),
                el("dd", { texto: fila.descripcion }),
              ),
            ),
          ),
        );
      }),
    ),
  );
  if (!dialogo.open) dialogo.showModal();
  dialogo.querySelector("button")?.focus();
}
