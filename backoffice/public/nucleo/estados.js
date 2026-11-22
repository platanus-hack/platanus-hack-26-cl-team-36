// Estados de una vista (diseño §5.9): esqueletos con la geometría final, vacíos, errores y avisos en línea.

import { avisar } from "./avisos.js";
import { copiarTexto, el } from "./dom.js";
import { icono } from "./iconos.js";
import { t } from "./i18n.js";

const bloque = (clase) => el("div", { class: `esqueleto ${clase}` });
const varios = (n, armar) => Array.from({ length: n }, armar);

/**
 * Una tarjeta de revisión del Overview mientras carga, con la geometría de la de verdad (barra de navegador,
 * captura, nombre, etapas, tres medidores y pie). Va en un <li>: el Overview la usa también dentro de su grilla.
 */
export function tarjetaEsqueleto() {
  return el(
    "li",
    { class: "esqueleto-ov-celda", "aria-hidden": "true" },
    el(
      "div",
      { class: "esqueleto-ov-tarjeta" },
      el("div", { class: "esqueleto-ov-barra" }),
      bloque("esqueleto-ov-captura"),
      el(
        "div",
        { class: "esqueleto-ov-cuerpo" },
        el("div", { class: "esqueleto-ov-nombre" }, bloque("esqueleto-ov-marca"), bloque("esqueleto-ov-sitio")),
        bloque("esqueleto-ov-etapas"),
        el("div", { class: "esqueleto-ov-goals" }, varios(3, () => bloque("esqueleto-ov-goal"))),
        bloque("esqueleto-ov-pie"),
      ),
    ),
  );
}

const FORMAS = {
  // El inicio: el título, el bloque de agentes (total, fichas de dispositivo, cuatro roles) y Reviews con sus
  // pestañas y 6 tarjetas.
  overview: () => [
    el(
      "div",
      { class: "esqueleto-ov-grupo" },
      el("div", { class: "esqueleto-ov-cabecera" }, bloque("esqueleto-ov-titulo")),
      el(
        "div",
        { class: "esqueleto-ov-agentes" },
        el("div", { class: "esqueleto-ov-fila" }, bloque("esqueleto-ov-total"), el("div", { class: "esqueleto-ov-fichas" }, varios(3, () => bloque("esqueleto-ov-ficha")))),
        varios(4, () => el("div", { class: "esqueleto-ov-rol" }, bloque("esqueleto-ov-baldosa"), bloque("esqueleto-ov-rol-nombre"), bloque("esqueleto-ov-cuadritos"))),
        bloque("esqueleto-ov-leyenda"),
      ),
    ),
    el(
      "div",
      { class: "esqueleto-ov-grupo" },
      el("div", { class: "esqueleto-ov-cabecera" }, bloque("esqueleto-ov-titulo"), bloque("esqueleto-ov-pestanas")),
      el("ul", { class: "esqueleto-ov-grilla" }, varios(6, tarjetaEsqueleto)),
    ),
  ],
  // Revisiones: el título con la cuenta y una fila por revisión (estado, sitio y URL, goals, cuándo).
  revisiones: () => [
    el("div", { class: "esqueleto-fila-titulo" }, bloque("esqueleto-titulo"), bloque("esqueleto-cuenta")),
    bloque("esqueleto-meta"),
    el(
      "div",
      { class: "esqueleto-revisiones" },
      varios(6, () =>
        el(
          "div",
          { class: "esqueleto-revision" },
          bloque("esqueleto-insignia"),
          el("div", { class: "esqueleto-vista" }, bloque("esqueleto-texto"), bloque("esqueleto-meta")),
          bloque("esqueleto-cuenta"),
        ),
      ),
    ),
  ],
  // Propuesta: las vistas de la ruta | el antes y después | el relato del Diseñador.
  propuesta: () => [
    el(
      "div",
      { class: "esqueleto-propuesta" },
      el("div", { class: "esqueleto-vista" }, varios(3, () => bloque("esqueleto-miniatura-vista"))),
      bloque("esqueleto-escenario"),
      el("div", { class: "esqueleto-vista" }, bloque("esqueleto-titulo"), varios(5, () => bloque("esqueleto-texto")), bloque("esqueleto-bloque-corto")),
    ),
  ],
  lista: () => [
    bloque("esqueleto-titulo"),
    bloque("esqueleto-texto"),
    ...Array.from({ length: 4 }, () =>
      el("div", { class: "esqueleto-fila" }, bloque("esqueleto-miniatura"), el("div", { class: "esqueleto-vista" }, bloque("esqueleto-texto"), bloque("esqueleto-meta"))),
    ),
  ],
  tanda: () => [
    bloque("esqueleto-meta"),
    bloque("esqueleto-titulo"),
    bloque("esqueleto-texto"),
    bloque("esqueleto-meta"),
    bloque("esqueleto-pestanas"),
    bloque("esqueleto-bloque"),
  ],
  lienzo: () => [bloque("esqueleto-texto"), bloque("esqueleto-lienzo")],
  // La hoja de una tanda: el riel, el lienzo y el panel derecho.
  hoja: () => [
    el("div", { class: "esqueleto-riel" }, Array.from({ length: 5 }, () => el("div", { class: "esqueleto-vista" }, bloque("esqueleto-texto"), bloque("esqueleto-meta")))),
    bloque("esqueleto-bloque"),
    el("div", { class: "esqueleto-vista" }, bloque("esqueleto-meta"), ...Array.from({ length: 4 }, () => bloque("esqueleto-texto"))),
  ],
  replay: () => [bloque("esqueleto-texto"), el("div", { class: "esqueleto-replay" }, bloque("esqueleto-bloque"), bloque("esqueleto-bloque"))],
  tabla: () => [bloque("esqueleto-texto"), ...Array.from({ length: 6 }, () => bloque("esqueleto-linea"))],
};

/**
 * Esqueleto con la misma geometría que la vista final: "overview" | "revisiones" | "propuesta" | "lista" | "tanda" |
 * "hoja" | "lienzo" | "replay" | "tabla".
 */
export function esqueleto(tipo = "lista") {
  return el(
    "div",
    { class: `esqueleto-vista esqueleto-${tipo}`, role: "status", "aria-busy": "true" },
    el("span", { class: "visualmente-oculto", texto: t("comun.estado.cargando") }),
    (FORMAS[tipo] ?? FORMAS.lista)(),
  );
}

function bloqueDeCodigo(codigo) {
  const texto = Array.isArray(codigo) ? codigo.join("\n") : String(codigo);
  const boton = el("button", {
    type: "button",
    class: "boton boton-icono",
    "aria-label": t("comun.accion.copiar"),
    title: t("comun.accion.copiar"),
  }, icono("copiar"));
  boton.addEventListener("click", async () => {
    avisar(t((await copiarTexto(texto)) ? "comun.aviso.textoCopiado" : "comun.aviso.noSePudoCopiar"));
  });
  return el("div", { class: "vacio-codigo" }, el("pre", { class: "mono" }, el("code", { texto })), boton);
}

function enlaceOBoton(accion, clase) {
  if (!accion) return null;
  if (accion.href) return el("a", { class: clase, href: accion.href, texto: accion.texto });
  return el("button", { type: "button", class: clase, texto: accion.texto, onclick: accion.accion });
}

/**
 * Estado vacío: título, texto opcional, bloque de código copiable opcional y una acción ({ texto, href } o
 * { texto, accion }). Extensiones: `hijos` (nodos extra bajo el texto), `nivel` (1 o 2: h1/h2 del título),
 * `icono` (nombre de ícono).
 */
export function vacio({ titulo, texto = null, accion = null, codigo = null, hijos = null, nivel = 2, icono: nombreIcono = null }) {
  return el(
    "div",
    { class: "vacio" },
    nombreIcono ? icono(nombreIcono) : null,
    el(`h${nivel === 1 ? 1 : 2}`, { class: "vacio-titulo", tabindex: "-1", "data-foco-inicial": "", texto: titulo }),
    texto ? el("p", { class: "vacio-texto", texto }) : null,
    codigo ? bloqueDeCodigo(codigo) : null,
    hijos,
    accion ? el("div", { class: "vacio-acciones" }, enlaceOBoton(accion, "boton boton-secundario")) : null,
  );
}

/** Error de una vista: qué falló en palabras simples, el detalle técnico plegado y "Reintentar". */
export function errorDePantalla({ titulo, detalle = null, reintentar = null, nivel = 2 }) {
  return el(
    "div",
    { class: "vacio vacio-error", role: "alert" },
    icono("error-visible"),
    el(`h${nivel === 1 ? 1 : 2}`, { class: "vacio-titulo", tabindex: "-1", "data-foco-inicial": "", texto: titulo }),
    detalle
      ? el(
          "details",
          { class: "detalle-tecnico" },
          el("summary", { texto: t("comun.estado.detalleTecnico") }),
          el("pre", { class: "mono", texto: String(detalle) }),
        )
      : null,
    reintentar
      ? el("div", { class: "vacio-acciones" }, el("button", { type: "button", class: "boton boton-secundario", texto: t("comun.accion.reintentar"), onclick: reintentar }))
      : null,
  );
}

/** Aviso dentro de la vista: "info" (ícono info) o "atencion" (fondo naranja tenue). */
export function avisoEnLinea(texto, nivel = "info") {
  return el(
    "p",
    { class: `aviso-en-linea${nivel === "atencion" ? " aviso-atencion" : ""}`, role: "status" },
    icono(nivel === "atencion" ? "error-visible" : "info"),
    el("span", { texto }),
  );
}

/**
 * Muestra el esqueleto solo si la carga tarda más de 150 ms y, una vez visible, lo mantiene al menos 300 ms
 * (evita el parpadeo). Devuelve el valor de la promesa.
 */
export async function conCarga(promesa, mostrar, ocultar) {
  let visibleDesde = 0;
  const reloj = setTimeout(() => {
    mostrar?.();
    visibleDesde = performance.now();
  }, 150);
  try {
    return await promesa;
  } finally {
    clearTimeout(reloj);
    if (visibleDesde) {
      const falta = 300 - (performance.now() - visibleDesde);
      if (falta > 0) await new Promise((listo) => setTimeout(listo, falta));
    }
    ocultar?.();
  }
}
