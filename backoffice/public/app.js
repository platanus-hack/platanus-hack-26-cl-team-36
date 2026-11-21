// Backoffice v0: pantallas 01 Corridas, 03 Telaraña, 04 Replay y 05 Perfiles del Claude Design,
// sobre las corridas del evaluador. Rutas: #/  #/telarana?t=<tanda>  #/replay?t=<tanda>&perfil=<p>&paso=<n>
// #/perfiles?t=<tanda>. Solo lectura.

import { el, recortar } from "./dom.js";
import { EJES, dibujarHuella } from "./huella.js";
import { COLORES, dibujarTelarana } from "./telarana.js";

const contenido = document.getElementById("contenido");
const secciones = document.getElementById("secciones");
const lateralExtra = document.getElementById("lateral-extra");

const RESULTADOS = {
  success: { texto: "Logrado", clase: "exito" },
  failed: { texto: "Fallido", clase: "fallo" },
  abandoned: { texto: "Abandonado", clase: "abandono" },
};
const ESTADOS = { no_cumplida: "No cumplida", sin_efecto: "Sin efecto", sin_evaluar: "Sin evaluar" };
const MOTIVOS_DE_FIN = {
  done: "terminó y respondió",
  blocked: "se declaró bloqueado",
  gave_up: "se rindió",
  step_limit: "agotó las acciones",
  time_limit: "agotó el tiempo",
  refusal: "el modelo se negó",
  api_error: "error de la API",
  no_response: "el modelo no respondió",
  internal_error: "error interno",
};

// ── Datos ────────────────────────────────────────────────────────────────

let tandas = null;
const detalle = new Map();

async function pedir(url) {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`${url} respondió ${respuesta.status}`);
  return respuesta.json();
}

async function cargarTandas() {
  tandas ??= await pedir("/api/tandas");
  return tandas;
}

async function cargarTanda(id) {
  if (!detalle.has(id)) detalle.set(id, await pedir(`/api/tandas/${id.split("/").map(encodeURIComponent).join("/")}`));
  return detalle.get(id);
}

const urlDeArchivo = (tandaId, perfil, archivo) =>
  `/archivos/${[...tandaId.split("/"), perfil, archivo].map(encodeURIComponent).join("/")}`;

function recordar(clave, valor) {
  try {
    if (valor === undefined) return localStorage.getItem(`backoffice:${clave}`);
    localStorage.setItem(`backoffice:${clave}`, valor);
  } catch {
    return null;
  }
  return valor;
}

// La tanda de las pantallas 03 a 05: la pedida, la última vista o la más nueva.
async function tandaElegida(parametros) {
  const lista = await cargarTandas();
  const pedida = parametros.get("t");
  const id = [pedida, recordar("tanda")].find((candidata) => candidata && lista.some((t) => t.id === candidata)) ?? lista[0]?.id;
  if (!id) return null;
  recordar("tanda", id);
  return cargarTanda(id);
}

const enlace = (pantalla, parametros = {}) => {
  const consulta = new URLSearchParams(Object.entries(parametros).filter(([, v]) => v !== undefined && v !== null));
  return `#/${pantalla}${consulta.size ? `?${consulta}` : ""}`;
};

// ── Formato ──────────────────────────────────────────────────────────────

function fechaLegible(marca) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/.exec(marca ?? "");
  return m ? `${m[3]}-${m[2]} ${m[4]}:${m[5]}` : (marca ?? "");
}

function duracionLegible(segundos) {
  if (typeof segundos !== "number") return "";
  const s = Math.round(segundos);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

// "clic en (766, 93)" se lee mejor como "clic en «Ayuda»" cuando se sabe qué había bajo el clic.
const accionLegible = (paso) =>
  paso.elemento && /click/.test(paso.accion) ? `${paso.descripcion.replace(/ en \(.*$/, "")} en «${recortar(paso.elemento, 60)}»` : paso.descripcion;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const tituloDeTanda = (tanda) => tanda.tarea ?? tanda.host ?? tanda.id;
const nombreDeNodo = (tanda, id) => {
  const nodo = tanda.telarana.nodos.find((n) => n.id === id);
  return nodo ? recortar(nodo.titulo || nodo.url, 60) : "";
};

// ── Armazón ──────────────────────────────────────────────────────────────

const PANTALLAS = [
  { clave: "", nombre: "Corridas" },
  { clave: "inventario", nombre: "Inventario", falta: "etapa 02 · no existe" },
  { clave: "telarana", nombre: "Telaraña" },
  { clave: "replay", nombre: "Replays" },
  { clave: "perfiles", nombre: "Perfiles" },
  { clave: "propuestas", nombre: "Propuestas", falta: "etapa 05 · no existe" },
];

function dibujarSecciones(actual, tandaId) {
  secciones.replaceChildren(
    ...PANTALLAS.map((pantalla) =>
      pantalla.falta
        ? el("span", { class: "deshabilitada", title: `Todavía no hay datos: ${pantalla.falta}` }, pantalla.nombre, el("small", { texto: "pronto" }))
        : el("a", {
            href: pantalla.clave ? enlace(pantalla.clave, { t: tandaId }) : "#/",
            "aria-current": pantalla.clave === actual ? "page" : null,
            texto: pantalla.nombre,
          }),
    ),
  );
}

function encabezado(migas, titulo, descripcion) {
  return el(
    "header",
    { class: "encabezado" },
    el("span", { class: "etiqueta", texto: migas }),
    el("h1", { texto: titulo }),
    descripcion ? el("p", { texto: descripcion }) : null,
  );
}

function sinTandas() {
  return el(
    "div",
    { class: "vacio" },
    el("p", { texto: "Todavía no hay corridas en agents/.runs/." }),
    el("p", {}, "Gatilla una desde la terminal: ", el("code", { texto: "just local explore <url> \"<tarea>\"" }), " o, en agents/app/web_evaluator, ", el("code", { texto: "uv run main.py --task wom-baja-fibra" }), "."),
  );
}

// ── 01 Corridas ──────────────────────────────────────────────────────────

const ETAPAS = [
  { n: "01", nombre: "Recorrido", desc: "Abre la página y la recorre entera.", existe: false },
  { n: "02", nombre: "Inventario", desc: "Acciones por categoría y prioridad.", existe: false },
  { n: "03", nombre: "Happy path", desc: "Un agente con el DOM halla el camino ideal por tarea. Mientras no exista, se usa la ruta recomendada.", existe: false },
  { n: "04", nombre: "Usuarios de visión", desc: "Solo ven capturas y hacen clic como una persona.", existe: true },
  { n: "05", nombre: "Refinador", desc: "Propone módulos para el front con UX/UI gen.", existe: false },
];

async function pantallaCorridas(parametros) {
  const lista = await cargarTandas();
  dibujarSecciones("", recordar("tanda"));
  const filtro = (parametros.get("q") ?? "").toLowerCase();
  const sitio = parametros.get("sitio");

  const porSitio = new Map();
  for (const tanda of lista) porSitio.set(tanda.host, (porSitio.get(tanda.host) ?? 0) + 1);
  const buscador = el("input", {
    class: "campo-busqueda",
    type: "search",
    placeholder: "sitio o tarea",
    value: parametros.get("q") ?? "",
    "aria-label": "Buscar por sitio o tarea",
  });
  buscador.addEventListener("input", () => {
    history.replaceState(null, "", enlace("", { q: buscador.value || null, sitio }));
    dibujarGrilla();
  });
  lateralExtra.replaceChildren(
    el("label", { class: "etiqueta" }, "Buscar"),
    buscador,
    el("span", { class: "etiqueta", texto: "Sitios" }),
    el("a", { class: "opcion", href: enlace("", {}), "aria-current": sitio ? null : "true" }, "Todos ", el("span", { class: "tenue", texto: `· ${lista.length}` })),
    ...[...porSitio].map(([host, n]) =>
      el("a", { class: "opcion", href: enlace("", { sitio: host }), "aria-current": host === sitio ? "true" : null }, host, el("span", { class: "tenue", texto: ` · ${n}` })),
    ),
  );

  const grilla = el("div", { class: "grilla" });
  const dibujarGrilla = () => {
    const texto = buscador.value.toLowerCase().trim();
    const visibles = lista.filter(
      (t) =>
        (!sitio || t.host === sitio) &&
        (!texto || [t.host, t.tarea, t.instruccion].some((campo) => (campo ?? "").toLowerCase().includes(texto))),
    );
    grilla.replaceChildren(
      ...visibles.map((tanda) =>
        el(
          "a",
          { class: "tarjeta", href: enlace("telarana", { t: tanda.id }), title: tanda.instruccion },
          tanda.captura
            ? el("img", { class: "miniatura", src: urlDeArchivo(tanda.id, tanda.captura.perfil, tanda.captura.archivo), alt: `Inicio de ${tanda.host}`, loading: "lazy" })
            : el("div", { class: "sin-captura", texto: `${tanda.host} · sin captura` }),
          el("div", { class: "barra-etapas", "aria-label": "Etapas con datos: 04 Usuarios de visión" }, ETAPAS.map((etapa) => el("span", { class: etapa.existe ? "hecha" : null }))),
          el("b", { texto: recortar(tanda.instruccion || tituloDeTanda(tanda), 90) }),
          el("span", { class: "mono tenue", texto: `${tanda.host} · ${plural(tanda.intentos, "intento", "intentos")} · ${Math.round((100 * tanda.exitos) / Math.max(1, tanda.intentos))} % éxito · ${fechaLegible(tanda.fecha)}` }),
        ),
      ),
    );
    if (!visibles.length) grilla.replaceChildren(el("p", { class: "tenue", texto: "Ninguna corrida coincide con la búsqueda." }));
  };
  dibujarGrilla();
  if (filtro) buscador.value = parametros.get("q");

  return [
    encabezado("Backoffice / Corridas", "Corridas", "Cada corrida recorre una página, inventaría lo que se puede hacer en ella, busca el camino ideal por tarea y lo contrasta con usuarios que solo ven la pantalla. Hoy existe la etapa 04: los usuarios de visión."),
    el(
      "section",
      { class: "panel gatillar", "aria-label": "Gatillar un recorrido" },
      el("label", { style: "flex: 3 1 320px" }, "URL a recorrer", el("input", { type: "url", value: "https://www.wom.cl/", disabled: true })),
      el("label", { style: "flex: 2 1 200px" }, "Tareas", el("select", { disabled: true }, el("option", { texto: "Usar las tareas guardadas" }))),
      el("label", { style: "flex: 1 1 140px" }, "Perfiles", el("select", { disabled: true }, el("option", { texto: "Los tres" }))),
      el("button", { class: "boton", type: "button", disabled: true, texto: "Gatillar recorrido" }),
      el("p", { class: "nota" }, "Deshabilitado en la v0: se gatilla desde la terminal con ", el("code", { texto: "just local explore <url> \"<tarea>\"" }), " y la corrida aparece aquí al recargar."),
    ),
    el(
      "section",
      { class: "etapas", "aria-label": "Etapas" },
      ETAPAS.map((etapa) =>
        el(
          "div",
          { class: "etapa" },
          el("span", { class: "mono tenue", texto: etapa.n }),
          el("b", { texto: etapa.nombre }),
          el("span", { texto: etapa.desc }),
          el("span", { class: `estado-etapa${etapa.existe ? " si" : ""}`, texto: etapa.existe ? "● con datos" : "○ todavía no existe" }),
        ),
      ),
    ),
    el(
      "section",
      { "aria-label": "Grilla de corridas" },
      el("div", { class: "subtitulo", style: "margin-bottom: 16px" }, el("h2", { texto: "Recientes" }), el("span", { class: "mono tenue", texto: `${plural(lista.length, "corrida", "corridas")} en agents/.runs/` })),
      lista.length ? grilla : sinTandas(),
    ),
  ];
}

// ── 03 Telaraña ──────────────────────────────────────────────────────────

function quiebres(tanda) {
  return tanda.intentos
    .filter((intento) => intento.seSepara)
    .map((intento) => {
      const separa = intento.seSepara;
      const paso = intento.pasos.find((p) => p.numero === separa.paso);
      const destino = separa.nodo ? nombreDeNodo(tanda, separa.nodo) : null;
      return el(
        "a",
        { class: `quiebre${intento.vuelveALaRuta ? " vuelve" : ""}`, href: enlace("replay", { t: tanda.id, perfil: intento.perfil, paso: separa.paso }) },
        el("span", { class: "mono", style: `color: ${intento.vuelveALaRuta ? "var(--azul-claro)" : "var(--naranja-claro)"}`, texto: `TRAMO ${separa.etapa} · PASO ${separa.paso} · ${intento.perfil.toUpperCase()}` }),
        el("b", { texto: separa.seDetuvo ? "Se detiene antes de terminar la ruta" : `Se va a «${destino}»` }),
        paso?.expectativa ? el("span", { texto: `«${recortar(paso.expectativa, 160)}»` }) : null,
        el("span", { texto: `${intento.vuelveALaRuta ? "Vuelve a la ruta más adelante." : "No vuelve a la ruta."} ${RESULTADOS[intento.resultado]?.texto ?? intento.resultado} en ${plural(intento.pasos.length, "paso", "pasos")}.` }),
        el("span", { class: "", style: "color: var(--azul)", texto: "Ver replay" }),
      );
    });
}

function panelDeNodo(tanda, nodo) {
  const pasaron = tanda.intentos
    .map((intento) => ({ intento, paso: intento.pasos.find((p) => p.nodo === nodo.id) }))
    .filter(({ intento, paso }) => paso || intento.camino[0] === nodo.id);
  const finales = nodo.finales ?? {};
  return el(
    "section",
    { class: "panel detalle-nodo", "aria-label": "Página elegida" },
    nodo.captura ? el("img", { src: urlDeArchivo(tanda.id, nodo.captura.perfil, nodo.captura.archivo), alt: `Captura de ${nodo.titulo}` }) : null,
    el(
      "div",
      { class: "texto" },
      el("span", { class: "etiqueta", texto: `${nodo.esInicio ? "Inicio" : `Paso ${nodo.anillo}`}${nodo.enRuta ? " · en la ruta recomendada" : ""}` }),
      el("b", { style: "font-size: 18px", texto: nodo.titulo || nodo.url }),
      el("span", { class: "mono tenue", style: "overflow-wrap: anywhere", texto: nodo.url }),
      el("span", { class: "tenue", texto: `${plural(nodo.visitas, "visita", "visitas")} · ${nodo.perfiles.join(", ")} · terminan aquí: ${finales.success ?? 0} con éxito, ${finales.failed ?? 0} fallidos, ${finales.abandoned ?? 0} abandonos` }),
      el("span", { class: "etiqueta", style: "margin-top: 8px", texto: "Intentos que pasaron por aquí" }),
      pasaron.length
        ? pasaron.map(({ intento, paso }) =>
            el("a", { href: enlace("replay", { t: tanda.id, perfil: intento.perfil, paso: paso?.numero ?? 1 }) }, `${intento.perfil} · ${paso ? `paso ${paso.numero}` : "al empezar"} · ${RESULTADOS[intento.resultado]?.texto ?? intento.resultado} →`),
          )
        : el("span", { class: "tenue", texto: "Ninguno." }),
    ),
  );
}

async function pantallaTelarana(parametros) {
  const tanda = await tandaElegida(parametros);
  dibujarSecciones("telarana", tanda?.id);
  lateralExtra.replaceChildren();
  if (!tanda) return [encabezado("Backoffice / Telaraña", "Telaraña"), sinTandas()];
  dibujarListaDeTandas(tanda.id, "telarana");

  const { kpis } = tanda;
  const caminos = new Set(tanda.intentos.filter((i) => i.camino.length).map((i) => i.camino.join(">"))).size;
  const titulo = tanda.telarana.ruta
    ? `La ruta recomendada tiene ${plural(kpis.tramosDeRuta, "tramo", "tramos")}. Los usuarios tomaron ${plural(caminos, "camino", "caminos")}.`
    : `Ningún usuario llegó a la respuesta. Tomaron ${plural(caminos, "camino", "caminos")}.`;

  let perfilActivo = parametros.get("perfil");
  let detalleNodo = el("div");
  const telarana = dibujarTelarana(tanda, {
    urlDeCaptura: (captura) => urlDeArchivo(tanda.id, captura.perfil, captura.archivo),
    alElegir: (nodo) => {
      telarana.enfocar(nodo.id);
      const nuevo = panelDeNodo(tanda, nodo);
      detalleNodo.replaceWith(nuevo);
      detalleNodo = nuevo;
    },
  });
  telarana.filtrar(perfilActivo);

  const perfiles = [...new Set(tanda.intentos.map((i) => i.perfil))];
  const chips = el("div", { class: "chips", role: "group", "aria-label": "Filtrar por perfil" });
  const dibujarChips = () =>
    chips.replaceChildren(
      ...[null, ...perfiles].map((perfil) =>
        el("button", {
          class: "filtro",
          type: "button",
          "aria-pressed": String((perfilActivo ?? null) === perfil),
          texto: perfil ?? "Todos",
          onclick: () => {
            perfilActivo = perfil;
            history.replaceState(null, "", enlace("telarana", { t: tanda.id, perfil }));
            telarana.filtrar(perfil);
            dibujarChips();
          },
        }),
      ),
    );
  dibujarChips();

  const cortes = quiebres(tanda);
  return [
    encabezado(`${tanda.host} / ${tituloDeTanda(tanda)} · etapa 04`, titulo, tanda.instruccion),
    chips,
    el(
      "div",
      { class: "kpis" },
      el("div", { class: "kpi" }, el("b", { texto: `${kpis.exitos} de ${kpis.intentos}` }), el("span", { texto: "llegan a la respuesta, según el juez" })),
      el("div", { class: "kpi" }, el("b", { texto: `${kpis.siguenLaRuta} de ${kpis.intentos}` }), el("span", { texto: "siguen la ruta recomendada" })),
      el("div", { class: "kpi" }, el("b", { texto: kpis.pasosMediana ?? "—" }), el("span", { texto: `pasos en mediana${kpis.pasosIdeales ? ` · la ruta recomendada, ${kpis.pasosIdeales}` : ""}` })),
      el("div", { class: "kpi" }, el("b", { class: kpis.noCumplidas + kpis.sinEfecto ? "alerta" : null, texto: kpis.noCumplidas + kpis.sinEfecto }), el("span", { texto: `pasos con tropiezos (${kpis.noCumplidas} no cumplidos, ${kpis.sinEfecto} sin efecto)` })),
    ),
    el(
      "div",
      { class: "lienzo-telarana" },
      telarana.elemento,
      el(
        "div",
        { class: "controles-lienzo" },
        el("button", { type: "button", "aria-label": "Acercar", texto: "+", onclick: telarana.acercar }),
        el("button", { type: "button", "aria-label": "Alejar", texto: "−", onclick: telarana.alejar }),
        el("button", { type: "button", "aria-label": "Ver todo", texto: "⤢", onclick: telarana.reiniciar }),
      ),
    ),
    el(
      "div",
      { class: "leyenda" },
      el("span", {}, el("i", { style: "border-color: #EDEDED; border-top-width: 2px" }), "ruta recomendada (la de menor costo; no es el happy path)"),
      el("span", {}, el("i", { style: `border-color: ${COLORES.exito}` }), "sin errores, con éxito"),
      el("span", {}, el("i", { style: `border-color: ${COLORES.mixto}` }), "mixta"),
      el("span", {}, el("i", { style: `border-color: ${COLORES.fallo}` }), "con errores o sin éxito"),
      el("span", {}, el("i", { style: `border-color: ${COLORES.abandono}; border-top-style: dashed` }), "termina en abandono"),
      el("span", { texto: "grosor = intentos · arrastra para mover, Ctrl o ⌘ + rueda (o pellizca) para acercar, clic en una página para ver quién pasó" }),
    ),
    detalleNodo,
    el(
      "section",
      { "aria-label": "Puntos de quiebre", style: "display: flex; flex-direction: column; gap: 14px" },
      el("h2", { texto: "Dónde se separan de la ruta recomendada" }),
      cortes.length ? el("div", { class: "quiebres" }, cortes) : el("p", { class: "tenue", texto: "Todos los intentos siguieron la ruta recomendada." }),
    ),
    el("p", { class: "mono tenue", texto: `${plural(kpis.intentos, "intento", "intentos")} · ${perfiles.length} perfiles · mide agentes, no personas · ${fechaLegible(tanda.fecha)} · ${tanda.modeloUsuarios ?? ""}` }),
  ];
}

function dibujarListaDeTandas(actual, pantalla) {
  if (!tandas || tandas.length < 2) return;
  lateralExtra.append(
    el("span", { class: "etiqueta", texto: "Otras corridas" }),
    ...tandas.slice(0, 12).map((tanda) =>
      el("a", { class: "opcion", href: enlace(pantalla, { t: tanda.id }), "aria-current": tanda.id === actual ? "true" : null }, `${tanda.tarea ?? tanda.host} `, el("span", { class: "tenue", texto: fechaLegible(tanda.fecha) })),
    ),
  );
}

// ── 04 Replay ────────────────────────────────────────────────────────────

function rutaEnEstePaso(tanda, intento, indice) {
  const ruta = tanda.telarana.ruta;
  if (!ruta) return "No hay ruta recomendada: ningún intento llegó a la respuesta.";
  const nodoAntes = indice === 0 ? intento.camino[0] : intento.pasos[indice - 1].nodo;
  const posicion = ruta.nodos.indexOf(nodoAntes);
  if (posicion === -1) {
    return `Esta página no está en la ruta recomendada, que pasa por: ${ruta.nodos.map((id) => `«${nombreDeNodo(tanda, id)}»`).join(" → ")}.`;
  }
  if (posicion === ruta.nodos.length - 1) return "La ruta recomendada termina en esta página: aquí está la respuesta.";
  const tramo = ruta.tramos[posicion];
  return `Tramo ${posicion + 1} de ${ruta.tramos.length}: desde esta página, la ruta recomendada sigue con ${tramo.accion} hacia «${nombreDeNodo(tanda, tramo.destino)}».`;
}

async function pantallaReplay(parametros) {
  const tanda = await tandaElegida(parametros);
  dibujarSecciones("replay", tanda?.id);
  lateralExtra.replaceChildren();
  if (!tanda) return [encabezado("Backoffice / Replays", "Replays"), sinTandas()];

  const conPasos = tanda.intentos.filter((i) => i.inicio);
  const intento = conPasos.find((i) => i.perfil === parametros.get("perfil")) ?? conPasos[0];
  if (!intento) return [encabezado("Backoffice / Replays", "Replays"), el("p", { class: "tenue", texto: "Ningún intento de esta corrida alcanzó a cargar la página." })];

  lateralExtra.replaceChildren(
    el("span", { class: "etiqueta", texto: "Intentos de esta corrida" }),
    ...tanda.intentos.map((i) =>
      el("a", { class: "opcion", href: enlace("replay", { t: tanda.id, perfil: i.perfil }), "aria-current": i === intento ? "true" : null, texto: `${i.perfil} · ${RESULTADOS[i.resultado]?.texto.toLowerCase() ?? i.resultado}` }),
    ),
  );
  dibujarListaDeTandas(tanda.id, "replay");

  const total = intento.pasos.length;
  let indice = Math.min(Math.max(0, Number(parametros.get("paso") ?? 1) - 1), Math.max(0, total - 1));
  let mostrar = "antes";

  const tira = el("div", { class: "tira-pasos", role: "group", "aria-label": "Pasos del intento" });
  const zonaPantalla = el("div", { class: "pantalla" });
  const pie = el("figcaption", { class: "mono tenue" });
  const alterna = el("div", { class: "vista-alterna", role: "group", "aria-label": "Qué captura mostrar" });
  const zonaDetalle = el("section", { class: "detalle-paso", "aria-label": "Detalle del paso" });
  const video = intento.video ? el("video", { src: urlDeArchivo(tanda.id, intento.perfil, "video.webm"), controls: true, preload: "metadata" }) : null;

  const elegir = (nuevo) => {
    indice = Math.min(Math.max(0, nuevo), total - 1);
    history.replaceState(null, "", enlace("replay", { t: tanda.id, perfil: intento.perfil, paso: indice + 1 }));
    dibujarPaso();
  };

  const dibujarPaso = () => {
    const paso = intento.pasos[indice];
    tira.replaceChildren(
      ...intento.pasos.map((p, i) =>
        el(
          "button",
          {
            type: "button",
            class: `paso-mini ${p.estado}${tanda.telarana.ruta?.nodos.includes(p.nodo) && p.estado === "sin_evaluar" ? " en-ruta" : ""}`,
            "aria-current": i === indice ? "step" : null,
            "aria-label": `Paso ${p.numero}: ${accionLegible(p)}, ${ESTADOS[p.estado]}`,
            onclick: () => elegir(i),
          },
          el("span", { class: "mono tenue", texto: `${p.numero} · ${ESTADOS[p.estado]}` }),
          el("span", { texto: recortar(accionLegible(p), 70) }),
        ),
      ),
    );
    if (!paso) {
      zonaDetalle.replaceChildren(el("p", { class: "tenue", texto: "Este intento no tiene pasos." }));
      return;
    }

    const archivo = mostrar === "antes" ? paso.capturaAntes : paso.captura;
    const clic = mostrar === "antes" && paso.coordenadas && /click/.test(paso.accion) && intento.viewport.ancho;
    zonaPantalla.replaceChildren(
      mostrar === "video" && video
        ? video
        : el("img", { src: urlDeArchivo(tanda.id, intento.perfil, archivo), alt: `Pantalla ${mostrar === "antes" ? "antes" : "después"} del paso ${paso.numero}` }),
      clic ? el("span", { class: "clic-anillo", style: `left: ${(100 * paso.coordenadas[0]) / intento.viewport.ancho}%; top: ${(100 * paso.coordenadas[1]) / intento.viewport.alto}%` }) : null,
      clic ? el("span", { class: "clic-punto", style: `left: ${(100 * paso.coordenadas[0]) / intento.viewport.ancho}%; top: ${(100 * paso.coordenadas[1]) / intento.viewport.alto}%` }) : null,
    );
    if (mostrar === "video" && video) video.currentTime = Math.max(0, (paso.segundos ?? 0) - (paso.duracion ?? 0));
    pie.textContent = `${mostrar === "antes" ? paso.urlAntes : paso.url} · ${paso.coordenadas ? `${paso.accion} (${paso.coordenadas.join(", ")})` : paso.accion} · a los ${duracionLegible(paso.segundos)}`;
    alterna.replaceChildren(
      ...[
        ["antes", "Antes, con el clic"],
        ["despues", "Después"],
        ...(video ? [["video", "Video"]] : []),
      ].map(([clave, texto]) =>
        el("button", { type: "button", class: "filtro", "aria-pressed": String(mostrar === clave), texto, onclick: () => { mostrar = clave; dibujarPaso(); } }),
      ),
    );

    const colorEstado = paso.estado === "no_cumplida" ? "fallo" : paso.estado === "sin_efecto" ? "abandono" : "";
    zonaDetalle.replaceChildren(
      el("div", { style: "display: flex; gap: 10px; align-items: center; flex-wrap: wrap" }, el("span", { class: `chip ${colorEstado}`, texto: ESTADOS[paso.estado] }), el("span", { class: "mono tenue", texto: `paso ${paso.numero} de ${total}` })),
      el("div", { class: "caja" }, el("span", { class: "etiqueta", texto: "Acción" }), el("span", { texto: accionLegible(paso) })),
      el("div", { class: "caja" }, el("span", { class: "etiqueta", texto: "Lo que esperaba" }), el("span", { texto: paso.expectativa ? `«${paso.expectativa}»` : "No lo dijo." })),
      el("div", { class: "caja" }, el("span", { class: "etiqueta", texto: "Lo que pasó" }), el("span", { texto: paso.loQuePaso })),
      el("div", { class: "caja borde" }, el("span", { class: "etiqueta", texto: "Ruta recomendada en este paso" }), el("span", { texto: rutaEnEstePaso(tanda, intento, indice) })),
      el(
        "div",
        { class: "botones" },
        el("button", { type: "button", class: "boton secundario", disabled: indice === 0, texto: "Paso anterior", onclick: () => elegir(indice - 1) }),
        el("button", { type: "button", class: "boton", disabled: indice >= total - 1, texto: "Paso siguiente", onclick: () => elegir(indice + 1) }),
      ),
    );
  };

  atajos = (evento) => {
    if (evento.target.closest("input, select, textarea, video")) return;
    if (evento.key === "ArrowRight") elegir(indice + 1);
    if (evento.key === "ArrowLeft") elegir(indice - 1);
  };
  dibujarPaso();

  const resultado = RESULTADOS[intento.resultado] ?? { texto: intento.resultado, clase: "" };
  const veredicto = el(
    "section",
    { class: "panel veredicto", "aria-label": "Veredicto del juez" },
    el("div", {}, el("span", { class: "etiqueta", texto: "Criterio del juez" }), el("span", { texto: tanda.criterio?.criterion ?? "Sin criterio guardado." })),
    el("div", {}, el("span", { class: "etiqueta", texto: "Respuesta del usuario" }), el("span", { texto: intento.respuesta ? `«${intento.respuesta}»` : "No respondió." })),
    el("div", {}, el("span", { class: "etiqueta", texto: "Veredicto" }), el("span", { class: resultado.clase === "exito" ? "texto-exito" : "texto-fallo", texto: `${resultado.texto}: ${intento.justificacion}` })),
  );

  return [
    el(
      "div",
      { class: "fila-encabezado" },
      encabezado(`${tituloDeTanda(tanda)} / replay`, `${intento.perfil} · ${intento.nombrePerfil}`),
      el(
        "div",
        { class: "chips" },
        el("span", { class: `chip ${resultado.clase}`, texto: resultado.texto.toUpperCase() }),
        el("span", { class: "chip", texto: `${plural(total, "acción", "acciones")} · ${duracionLegible(intento.duracion)}` }),
        el("span", { class: "chip", texto: `${MOTIVOS_DE_FIN[intento.motivoDeFin] ?? intento.motivoDeFin} · ${intento.viewport.ancho}×${intento.viewport.alto}` }),
        el("span", { class: "chip", texto: "solo capturas · clic por coordenadas" }),
      ),
    ),
    tira,
    el("div", { class: "replay" }, el("figure", {}, alterna, zonaPantalla, pie), zonaDetalle),
    veredicto,
  ];
}

// ── 05 Perfiles ──────────────────────────────────────────────────────────

async function pantallaPerfiles(parametros) {
  const tanda = await tandaElegida(parametros);
  dibujarSecciones("perfiles", tanda?.id);
  lateralExtra.replaceChildren();
  if (!tanda) return [encabezado("Backoffice / Perfiles", "Perfiles"), sinTandas()];
  dibujarListaDeTandas(tanda.id, "perfiles");

  const { perfiles } = tanda;
  const ruta = tanda.telarana.ruta;
  const separados = perfiles.filter((p) => p.seSepara);
  const titulo = !ruta
    ? "Ningún perfil llegó a la respuesta"
    : !separados.length
      ? "Todos los perfiles siguen la ruta recomendada"
      : `${separados.map((p) => p.perfil).join(" y ")} se ${separados.length === 1 ? "separa" : "separan"} en el tramo ${Math.min(...separados.map((p) => p.seSepara.etapa))}`;

  const color = (valor) => (valor >= 50 ? "var(--azul)" : "var(--naranja)");
  const tablaTramos = ruta
    ? el(
        "div",
        { class: "tabla-envoltura" },
        el(
          "table",
          { style: "min-width: 760px" },
          el("thead", {}, el("tr", {}, el("th", { texto: "PERFIL" }), ruta.tramos.map((tramo, i) => el("th", { title: tramo.accion, texto: `${i + 1} · ${recortar(tramo.accion.replace(/^clic /, ""), 28).toUpperCase()}` })), el("th", { texto: "SE SEPARA EN" }))),
          el(
            "tbody",
            {},
            perfiles.map((perfil) =>
              el(
                "tr",
                {},
                el("th", { scope: "row", texto: perfil.perfil }),
                perfil.enRutaPorTramo.map((valor, i) => {
                  const aqui = perfil.seSepara && perfil.seSepara.etapa === i + 1;
                  const nota = aqui
                    ? perfil.seSepara.seDetuvo
                      ? "se detiene"
                      : `se va a «${recortar(nombreDeNodo(tanda, perfil.seSepara.nodo), 40)}»`
                    : valor === 100
                      ? "en la ruta"
                      : "";
                  return el(
                    "td",
                    {},
                    el(
                      "span",
                      { class: "celda" },
                      el("b", { style: `color: ${color(valor)}`, texto: `${valor} %` }),
                      el("span", { class: "pista" }, el("span", { style: `width: ${valor}%; background: ${color(valor)}` })),
                      el("span", { class: "tenue", style: "font-size: 12px", texto: nota }),
                    ),
                  );
                }),
                el("td", { class: "tenue", texto: perfil.seSepara ? `tramo ${perfil.seSepara.etapa} · paso ${perfil.seSepara.paso}${perfil.seSepara.nodo ? ` · «${recortar(nombreDeNodo(tanda, perfil.seSepara.nodo), 40)}»` : ""}` : "no se separa" }),
              ),
            ),
          ),
        ),
      )
    : el("p", { class: "aviso", texto: "Sin ruta recomendada no hay tramos contra los cuales comparar: ningún intento llegó a la respuesta." });

  const promedio = Object.fromEntries(
    EJES.map((eje) => {
      const valores = perfiles.map((p) => p.metricas[eje.clave]).filter((v) => v !== null);
      return [eje.clave, valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0];
    }),
  );

  return [
    encabezado(`${tituloDeTanda(tanda)} / perfiles`, titulo, "Cada fila es un perfil y cada columna un tramo de la ruta recomendada. La celda dice qué parte de los intentos sigue en el camino y qué los sacó de él."),
    tablaTramos,
    el(
      "section",
      { "aria-label": "Huella por perfil", style: "display: flex; flex-direction: column; gap: 14px" },
      el("div", { class: "subtitulo" }, el("h2", { texto: "Huella de cada perfil" }), el("span", { class: "tenue", style: "font-size: 13px", texto: "Ejes de 0 a 100 · gris: promedio de los perfiles · la tabla da las cifras" })),
      el(
        "div",
        { class: "huellas" },
        perfiles.map((perfil) =>
          el("figure", { class: "huella" }, dibujarHuella(perfil.perfil, perfil.metricas, promedio, perfil.metricas.exito >= 50 ? "#5AB0FF" : "#FF9F43"), el("figcaption", { texto: `${perfil.perfil} · ${perfil.nombre}` })),
        ),
      ),
    ),
    el(
      "div",
      { class: "tabla-envoltura" },
      el(
        "table",
        { class: "numeros", style: "min-width: 720px" },
        el("thead", {}, el("tr", {}, el("th", { texto: "PERFIL" }), el("th", { texto: "INTENTOS" }), EJES.map((eje) => el("th", { texto: eje.nombre.toUpperCase() })))),
        el(
          "tbody",
          {},
          perfiles.map((perfil) =>
            el("tr", {}, el("th", { scope: "row", texto: perfil.perfil }), el("td", { texto: perfil.intentos }), EJES.map((eje) => el("td", { texto: perfil.metricas[eje.clave] ?? "—" }))),
          ),
        ),
      ),
    ),
    el(
      "p",
      { class: "tenue", style: "margin: -12px 0 0; font-size: 13px; line-height: 1.55" },
      "Éxito: intentos logrados según el juez. Eficiencia: pasos de la ruta recomendada sobre pasos reales, en los intentos logrados. Adherencia: intentos que siguen la ruta recomendada completa. Sin tropiezos: pasos sin la señal «no cumplida» ni «sin efecto» (el evaluador todavía no compara cada expectativa con lo que pasó). Recuperación: intentos desviados que vuelven a la ruta; «—» si ninguno se desvió. ",
      el("b", { texto: `Sobre ${plural(tanda.kpis.intentos, "intento", "intentos")}: mide agentes, no personas.` }),
    ),
  ];
}

// ── Enrutador ────────────────────────────────────────────────────────────

let atajos = null;
document.addEventListener("keydown", (evento) => atajos?.(evento));

const RUTAS = { "": pantallaCorridas, telarana: pantallaTelarana, replay: pantallaReplay, perfiles: pantallaPerfiles };

async function mostrar() {
  const [ruta, consulta] = location.hash.replace(/^#\/?/, "").split("?");
  const pantalla = RUTAS[ruta] ?? pantallaCorridas;
  atajos = null;
  try {
    const partes = await pantalla(new URLSearchParams(consulta ?? ""));
    contenido.replaceChildren(...partes.flat().filter(Boolean));
  } catch (error) {
    console.error(error);
    contenido.replaceChildren(el("div", { class: "vacio" }, el("p", { texto: "No se pudieron leer las corridas." }), el("p", { class: "mono", texto: String(error.message ?? error) })));
  }
  document.title = `${PANTALLAS.find((p) => p.clave === ruta)?.nombre ?? "Corridas"} · Backoffice`;
}

window.addEventListener("hashchange", () => {
  mostrar();
  contenido.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
mostrar();
