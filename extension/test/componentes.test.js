// Tests de los componentes lanzador y atajo y de las vistas con `datos` y `reemplazar: false`
// (features/vista.js). Son content scripts: se cargan en un contexto aislado con un DOM falso
// mínimo (sin dependencias), que entiende selectores simples: `tag`, `.clase` y `[atributo=valor]`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const leer = (ruta) => readFileSync(new URL(`../src/${ruta}`, import.meta.url), "utf8");

class Elemento {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.atributos = {};
    this.className = "";
    this.dataset = {};
    this.escuchas = {};
    this.parentElement = null;
    this.propio = "";
    this.classList = {
      add: (clase) => (this.className = `${this.className} ${clase}`.trim()),
      contains: (clase) => this.className.split(" ").includes(clase),
      toggle: () => {},
    };
  }
  get children() {
    return this.childNodes;
  }
  get isConnected() {
    return true;
  }
  setAttribute(nombre, valor) {
    this.atributos[nombre] = String(valor);
  }
  getAttribute(nombre) {
    return this.atributos[nombre] ?? null;
  }
  hasAttribute(nombre) {
    return nombre in this.atributos;
  }
  removeAttribute(nombre) {
    delete this.atributos[nombre];
  }
  get label() {
    return this.getAttribute("label");
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  append(...hijos) {
    for (const hijo of hijos) {
      if (typeof hijo === "string") this.propio += hijo;
      else {
        hijo.parentElement = this;
        this.childNodes.push(hijo);
      }
    }
  }
  get textContent() {
    return this.propio + this.childNodes.map((hijo) => hijo.textContent).join("");
  }
  set textContent(valor) {
    this.propio = String(valor);
    this.childNodes = [];
  }
  addEventListener(tipo, fn) {
    (this.escuchas[tipo] ??= []).push(fn);
  }
  disparar(tipo, evento = {}) {
    for (const fn of this.escuchas[tipo] ?? []) fn({ button: 0, preventDefault() {}, ...evento });
  }
  descendientes() {
    return this.childNodes.flatMap((hijo) => [hijo, ...hijo.descendientes()]);
  }
  coincide(selector) {
    const atributo = selector.match(/^\[([\w-]+)=["']?([^\]"']+)["']?\]$/);
    if (atributo) return this.getAttribute(atributo[1]) === atributo[2];
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.descendientes().filter((el) => el.coincide(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  // <select>: las opciones son sus <option> descendientes y `value` es el de la elegida.
  get options() {
    return this.querySelectorAll("option");
  }
  get value() {
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    const opciones = this.options;
    return (opciones.find((o) => o.hasAttribute("selected")) ?? opciones[0])?.value ?? "";
  }
  set value(valor) {
    for (const opcion of this.options) {
      if (opcion.value === valor) opcion.setAttribute("selected", "selected");
      else opcion.removeAttribute("selected");
    }
  }
}

class Select extends Elemento {}

// Un <select> como el de la página, con grupos: [["Línea 1", [["SP", "San Pablo"], …]], …]
function selectDePagina(grupos, elegido) {
  const select = new Select("select");
  for (const [nombre, opciones] of grupos) {
    const padre = nombre ? new Elemento("optgroup") : select;
    if (nombre) {
      padre.setAttribute("label", nombre);
      select.append(padre);
    }
    for (const [valor, texto] of opciones) {
      const opcion = new Elemento("option");
      opcion.setAttribute("value", valor);
      opcion.append(` ${texto}\n `);
      if (valor === elegido) opcion.setAttribute("selected", "");
      padre.append(opcion);
    }
  }
  return select;
}

function cargar(pagina = {}) {
  const document = {
    readyState: "complete",
    createElement: (tag) => (tag === "select" ? new Select(tag) : new Elemento(tag)),
    querySelector: (selector) => pagina[selector] ?? null,
    documentElement: new Elemento("html"),
  };
  const contexto = vm.createContext({ document, URL, HTMLSelectElement: Select, location: { href: "https://www.metro.cl/", pathname: "/" }, console });
  for (const archivo of ["content/registro.js", "comun/idioma.js", "content/plantillas.js", "componentes/lanzador.js", "componentes/atajo.js", "features/vista.js"]) {
    vm.runInContext(leer(archivo), contexto);
  }
  return vm.runInContext("globalThis.MiTema", contexto);
}

const contextoVista = { abrir() {}, viendoOriginal: () => false, alternarOriginal() {} };

const ESTACIONES = [
  ["Línea 1", [["SP", "San Pablo"], ["EL", "Estación Central"]]],
  ["Línea 2", [["LH", "Los Héroes"]]],
];
const CAMPOS = [
  { nombre: "inicio", etiqueta: { es: "Desde", en: "From" }, opciones: "#binicio" },
  { nombre: "fin", etiqueta: { es: "Hasta", en: "To" }, opciones: "#fin" },
  { nombre: "dia", etiqueta: "Día", valor: "DL", valores: [{ valor: "DL", texto: { es: "Laboral", en: "Weekday" } }, { valor: "DS", texto: "Sábado" }] },
];
const OPCIONES_ATAJO = { destino: "/el-viaje/planificador/", invertir: ["inicio", "fin"], fijos: { horario: "VALLE" } };
const paginaMetro = () => ({ "#binicio": selectDePagina(ESTACIONES, "SP"), "#fin": selectDePagina(ESTACIONES, "EL") });

// ---------- textos ----------

test("enIdioma y textosDe: datos por idioma y textos del tema sobre los del diccionario", () => {
  const MiTema = cargar();
  const { enIdioma, textosDe } = MiTema.plantillas;
  assert.equal(enIdioma({ es: "Hola", en: "Hi" }, "en"), "Hi");
  assert.equal(enIdioma({ es: "Hola" }, "en"), "Hola");
  assert.equal(enIdioma("Igual", "en"), "Igual");
  assert.equal(enIdioma(undefined, "es"), "");
  const t = textosDe("atajo", ["titulo", "boton"], { en: { boton: "Go" } }, "en");
  assert.equal(t.boton, "Go");
  assert.equal(t.titulo, MiTema.idioma.t("en", "atajo.titulo"));
});

test("urlMismoSitio: solo enlaces de la misma página, con o sin www", () => {
  const { urlMismoSitio } = cargar().plantillas;
  for (const ajena of ["//evil.com/x", "/\\evil.com/x", "\\\\evil.com", "https://otro.cl", "http://www.metro.cl/", "javascript:alert(1)", "https://www.metro.cl.evil.com/", ""]) {
    assert.equal(urlMismoSitio(ajena), null, ajena);
  }
  assert.equal(urlMismoSitio("/el-viaje/planificador/?a=1"), "https://www.metro.cl/el-viaje/planificador/?a=1");
  assert.equal(urlMismoSitio("https://www.metro.cl/estaciones"), "https://www.metro.cl/estaciones");
  assert.equal(urlMismoSitio("https://metro.cl/estaciones"), "https://metro.cl/estaciones");
});

test("transformar: rechaza patrones largos, inválidos o con cuantificadores anidados", () => {
  const { transformar } = cargar().plantillas;
  assert.equal(transformar("watch?v=abc-1", { patron: "v=([\\w-]+)" }), "abc-1");
  for (const patron of ["(a+)+$", "(a*)*b", "(?:x|y+)+", "(a{1,9})+", "x".repeat(201), "(", 42]) {
    assert.equal(transformar("aaaaaaaaaaaaaaaaaaaaaaaaaaaa!", { patron }), "", String(patron));
  }
  assert.equal(transformar(`${"x".repeat(2000)}FIN`, { patron: "(FIN)" }), "", "solo mira los primeros 2000 caracteres");
});

// ---------- lanzador ----------

test("lanzador: una tarea por item con su enlace, en el idioma actual y con tope", () => {
  const MiTema = cargar();
  const { dibujar } = MiTema.componentes.get("lanzador");
  const items = [
    { titulo: { es: "Horarios", en: "Hours" }, detalle: { es: "Cada día", en: "Every day" }, enlace: "https://www.metro.cl/horarios" },
    { titulo: "Plano", enlace: "/plano" },
    { titulo: "Malo", enlace: "javascript:alert(1)" },
    { titulo: "Tercero", enlace: "/tercero" },
  ];
  MiTema.idioma.fijar("en");
  const nodo = dibujar(items, { max: 2, textos: { en: { titulo: "Top tasks" } } }, contextoVista);
  const tareas = nodo.querySelectorAll(".mt-lanzador__tarea");
  assert.deepEqual(Array.from(tareas, (a) => a.getAttribute("href")), ["https://www.metro.cl/horarios", "https://www.metro.cl/plano"]);
  assert.equal(nodo.querySelector(".mt-lanzador__titulo").textContent, "Hours");
  assert.equal(nodo.querySelector(".mt-lanzador__detalle").textContent, "Every day");
  assert.equal(nodo.querySelector("h2").textContent, "Top tasks");
  assert.equal(nodo.getAttribute("aria-labelledby"), nodo.querySelector("h2").getAttribute("id"));
});

test("lanzador: descarta enlaces e imágenes de otro sitio", () => {
  const { dibujar } = cargar().componentes.get("lanzador");
  const nodo = dibujar([
    { titulo: "Ajena", enlace: "//evil.com/x" },
    { titulo: "Rastreo", enlace: "/plano", imagen: "https://evil.com/pixel.png" },
    { titulo: "Ícono", enlace: "/bip", imagen: "/img/bip.svg" },
  ], {}, contextoVista);
  const tareas = nodo.querySelectorAll(".mt-lanzador__tarea");
  assert.deepEqual(Array.from(tareas, (a) => a.getAttribute("href")), ["https://www.metro.cl/plano", "https://www.metro.cl/bip"]);
  assert.equal(tareas[0].querySelector("img"), null);
  assert.equal(tareas[1].querySelector("img").getAttribute("src"), "https://www.metro.cl/img/bip.svg");
});

test("lanzador: sin tareas válidas no dibuja nada", () => {
  const { dibujar } = cargar().componentes.get("lanzador");
  assert.equal(dibujar([{ titulo: "x", enlace: "data:text/html,hola" }, { enlace: "/sin-titulo" }], {}, contextoVista), null);
});

// ---------- atajo ----------

test("armarEnlace: parámetros en el orden de los campos, después los fijos, sin vacíos ni protocolos raros", () => {
  const { armarEnlace } = cargar().componentes.get("atajo");
  assert.equal(
    armarEnlace("/el-viaje/planificador/", { inicio: "SP", fin: "EL", vacio: "" }, { horario: "VALLE", inicio: "XX" }),
    "https://www.metro.cl/el-viaje/planificador/?inicio=SP&fin=EL&horario=VALLE",
  );
  assert.equal(armarEnlace("javascript:alert(1)", { a: "1" }), "");
  assert.equal(armarEnlace("//evil.com/planificador", { a: "1" }), "");
  assert.equal(armarEnlace("https://otro.cl/", { a: "1" }), "");
});

test("leerOpciones: copia las opciones del <select> de la página con su grupo y la elegida", () => {
  const MiTema = cargar(paginaMetro());
  const { leerOpciones } = MiTema.componentes.get("atajo");
  const raiz = { querySelector: (s) => paginaMetro()[s] ?? null };
  const { opciones, elegido } = leerOpciones(CAMPOS[1], "es", raiz);
  assert.equal(elegido, "EL");
  assert.deepEqual(Array.from(opciones, (o) => ({ ...o })), [
    { valor: "SP", texto: "San Pablo", grupo: "Línea 1" },
    { valor: "EL", texto: "Estación Central", grupo: "Línea 1" },
    { valor: "LH", texto: "Los Héroes", grupo: "Línea 2" },
  ]);
  assert.deepEqual({ ...leerOpciones(CAMPOS[2], "en", raiz).opciones[0] }, { valor: "DL", texto: "Weekday", grupo: "" });
});

test("atajo: arma el deep link con lo elegido, lo sigue al cambiar e intercambia origen y destino", () => {
  const MiTema = cargar(paginaMetro());
  const { dibujar } = MiTema.componentes.get("atajo");
  const nodo = dibujar(CAMPOS, OPCIONES_ATAJO, contextoVista);
  const ir = nodo.querySelector(".mt-atajo__ir");
  assert.equal(ir.getAttribute("href"), "https://www.metro.cl/el-viaje/planificador/?inicio=SP&fin=EL&dia=DL&horario=VALLE");

  const selects = nodo.querySelectorAll("select");
  assert.equal(selects.length, 3);
  assert.equal(selects[0].querySelectorAll("optgroup").length, 2, "conserva los grupos de la página");
  assert.equal(nodo.querySelector("[data-mt-campo=inicio]").querySelector(".mt-atajo__etiqueta").textContent, "Desde");

  selects[2].value = "DS";
  selects[2].disparar("change");
  assert.match(ir.getAttribute("href"), /dia=DS/);

  nodo.querySelector(".mt-atajo__invertir").disparar("click");
  assert.equal(ir.getAttribute("href"), "https://www.metro.cl/el-viaje/planificador/?inicio=EL&fin=SP&dia=DS&horario=VALLE");
});

test("atajo: sin valor en la página muestra «Elige una opción» y el enlace espera a los requeridos", () => {
  const sinElegir = selectDePagina(ESTACIONES, null);
  const MiTema = cargar({ "#binicio": selectDePagina(ESTACIONES, "SP"), "#fin": sinElegir });
  sinElegir.querySelector("option").setAttribute("value", "");
  const { dibujar } = MiTema.componentes.get("atajo");
  const campos = [CAMPOS[0], { ...CAMPOS[1], requerido: true }];
  const nodo = dibujar(campos, { destino: "/planificador/" }, contextoVista);
  const ir = nodo.querySelector(".mt-atajo__ir");
  const fin = nodo.querySelectorAll("select")[1];
  assert.equal(fin.value, "");
  assert.equal(fin.querySelector("option").textContent, MiTema.idioma.t("es", "atajo.elegir"));
  assert.equal(ir.hasAttribute("href"), false);
  assert.equal(ir.getAttribute("aria-disabled"), "true");

  fin.value = "LH";
  fin.disparar("change");
  assert.equal(ir.getAttribute("href"), "https://www.metro.cl/planificador/?inicio=SP&fin=LH");
  assert.equal(ir.hasAttribute("aria-disabled"), false);
  assert.equal(nodo.getAttribute("aria-labelledby"), nodo.querySelector("h2").getAttribute("id"));
});

test("atajo: ignora opciones deshabilitadas, lo que no es <select> y no intercambia valores que el otro no tiene", () => {
  const inicio = selectDePagina([["", [["SP", "San Pablo"], ["XX", "Cerrada"]]]], "SP");
  inicio.querySelectorAll("option")[1].setAttribute("disabled", "");
  const fin = selectDePagina([["", [["EL", "Estación Central"], ["SP", "San Pablo"]]]], "EL");
  const MiTema = cargar({ "#binicio": inicio, "#fin": fin, "#div": new Elemento("div") });
  const atajo = MiTema.componentes.get("atajo");
  assert.deepEqual(Array.from(atajo.leerOpciones(CAMPOS[0], "es").opciones, (o) => o.valor), ["SP"]);
  assert.equal(atajo.dibujar([{ nombre: "x", opciones: "#div" }], { destino: "/" }, contextoVista), null);

  const nodo = atajo.dibujar(CAMPOS.slice(0, 2), OPCIONES_ATAJO, contextoVista);
  const ir = nodo.querySelector(".mt-atajo__ir");
  nodo.querySelector(".mt-atajo__invertir").disparar("click");
  assert.match(ir.getAttribute("href"), /inicio=SP&fin=EL/, "EL no está en el origen: no se intercambia");
  nodo.querySelectorAll("select")[1].value = "SP";
  nodo.querySelector(".mt-atajo__invertir").disparar("click");
  assert.match(ir.getAttribute("href"), /inicio=SP&fin=SP/);
});

test("armarEnlace: marcadores {nombre} en la ruta o el hash, codificados y fuera de la query", () => {
  const { armarEnlace } = cargar().componentes.get("atajo");
  assert.equal(armarEnlace("/estacion/{id}/#{vista}", { id: "a/b c", vista: "mapa", dia: "DL" }), "https://www.metro.cl/estacion/a%2Fb%20c/?dia=DL#mapa");
  assert.equal(armarEnlace("/estacion/{id}", { id: "" }), "", "sin valor para el marcador no hay enlace");
  assert.equal(armarEnlace("/{id}", { id: "/evil.com" }), "https://www.metro.cl/%2Fevil.com");
});

test("atajo: la firma cambia si la página cambia las opciones de un <select>", () => {
  const pagina = paginaMetro();
  const MiTema = cargar(pagina);
  const { firma } = MiTema.componentes.get("atajo");
  const antes = JSON.stringify(firma(CAMPOS, {}));
  pagina["#fin"].querySelector("optgroup").append(new Elemento("option"));
  pagina["#fin"].querySelectorAll("option").at(-1).setAttribute("value", "NU");
  assert.notEqual(JSON.stringify(firma(CAMPOS, {})), antes);
});

test("vista: redibuja el atajo cuando la página cambia sus opciones y no toca los `datos` del tema", () => {
  const ancla = contenedorFalso();
  const pagina = { ...paginaMetro(), "#ancla": ancla };
  const MiTema = cargar(pagina);
  const datos = CAMPOS.map((campo) => ({ ...campo }));
  const vista = { id: "planificar", contenedor: "#ancla", reemplazar: false, componente: "atajo", datos, opciones: OPCIONES_ATAJO };
  const feature = MiTema.features.get("vista");
  feature.actualizar([vista]);
  feature.actualizar([vista]);
  assert.equal(ancla.antes.length, 1, "misma firma: no redibuja");
  const opcion = new Elemento("option");
  opcion.setAttribute("value", "NU");
  pagina["#fin"].append(opcion);
  let reemplazos = 0;
  ancla.antes[0].replaceWith = () => reemplazos++;
  feature.actualizar([vista]);
  assert.equal(reemplazos, 1);
  assert.ok(datos.every((campo) => !("original" in campo)));
});

test("atajo: si a un campo le faltan opciones o el destino no es http(s), no dibuja nada", () => {
  const MiTema = cargar({ "#binicio": selectDePagina(ESTACIONES, "SP") });
  const { dibujar } = MiTema.componentes.get("atajo");
  assert.equal(dibujar(CAMPOS, OPCIONES_ATAJO, contextoVista), null, "falta #fin en la página");
  assert.equal(dibujar([CAMPOS[0]], { destino: "javascript:void(0)" }, contextoVista), null);
});

// ---------- vista con datos del tema ----------

function contenedorFalso() {
  const contenedor = new Elemento("div");
  contenedor.antes = [];
  contenedor.before = (nodo) => contenedor.antes.push(nodo);
  return contenedor;
}

test("vista: con `datos` y `reemplazar: false` suma el componente sin ocultar el ancla, y no redibuja si nada cambió", () => {
  const ancla = contenedorFalso();
  const MiTema = cargar({ "#ancla": ancla });
  const vista = { id: "tareas", contenedor: "#ancla", reemplazar: false, componente: "lanzador", datos: [{ titulo: "Plano", enlace: "/plano" }] };
  MiTema.features.get("vista").actualizar([vista]);
  MiTema.features.get("vista").actualizar([vista]);
  assert.equal(ancla.antes.length, 1);
  assert.ok(ancla.antes[0].classList.contains("mt-lanzador"));
  assert.equal(ancla.antes[0].dataset.mtVista, "tareas");
  assert.equal(ancla.hasAttribute("data-mt-oculto"), false);
});

test("vista: si el componente se niega, deja la página como estaba", () => {
  const ancla = contenedorFalso();
  const MiTema = cargar({ "#ancla": ancla });
  MiTema.features.get("vista").actualizar([{ id: "atajo", contenedor: "#ancla", componente: "atajo", datos: CAMPOS, opciones: OPCIONES_ATAJO }]);
  assert.equal(ancla.antes.length, 0);
  assert.equal(ancla.hasAttribute("data-mt-oculto"), false);
});

// ---------- kit de metro.cl ----------

test("kit de metro.cl: el CSS pasa el saneador sin rechazos y las vistas piden componentes que existen", async () => {
  const { sanearCss } = await import("../src/background/css-remoto.js");
  const { normalizarTema } = await import("../src/background/temas.js");
  const fixture = (archivo) => readFileSync(new URL(`fixtures/metro/${archivo}`, import.meta.url), "utf8");
  assert.deepEqual(sanearCss(fixture("tema.css")).rechazos, []);
  const tema = normalizarTema({ id: "metro", css: "", ...JSON.parse(fixture("tema.json")) });
  const MiTema = cargar();
  for (const vista of tema.features.vista) assert.ok(MiTema.componentes.has(vista.componente), vista.componente);
});
