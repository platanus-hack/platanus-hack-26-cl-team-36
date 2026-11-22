// Tests del componente buscador (src/componentes/buscador.js): filtrado, normalización, enlaces
// fuera del sitio y teclado. Es un content script: se carga en un contexto aislado con un DOM
// falso mínimo, como en componentes.test.js, más lo que usa una paleta (<dialog>, foco, teclas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const leer = (ruta) => readFileSync(new URL(`../src/${ruta}`, import.meta.url), "utf8");

class Elemento {
  constructor(tag, documento) {
    this.tagName = tag.toUpperCase();
    this.documento = documento;
    this.childNodes = [];
    this.atributos = {};
    this.className = "";
    this.escuchas = {};
    this.propio = "";
    this.conectado = true;
    this.clics = 0;
    this.classList = {
      add: (clase) => (this.className = `${this.className} ${clase}`.trim()),
      contains: (clase) => this.className.split(" ").includes(clase),
    };
    if (this.tagName === "INPUT") this.value = "";
    if (this.tagName === "DIALOG") this.open = false;
  }
  get isConnected() {
    return this.conectado;
  }
  get id() {
    return this.getAttribute("id") ?? "";
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
  get hidden() {
    return this.hasAttribute("hidden");
  }
  set hidden(valor) {
    if (valor) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }
  append(...hijos) {
    for (const hijo of hijos) {
      if (typeof hijo === "string") this.childNodes.push({ textContent: hijo, descendientes: () => [], coincide: () => false });
      else this.childNodes.push(hijo);
    }
  }
  replaceChildren(...hijos) {
    this.childNodes = [];
    this.append(...hijos);
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
    const completo = { button: 0, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...evento };
    for (const fn of this.escuchas[tipo] ?? []) fn(completo);
    return completo;
  }
  focus() {
    this.documento.activeElement = this;
  }
  click() {
    this.clics++;
    this.disparar("click");
  }
  showModal() {
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.disparar("close");
  }
  descendientes() {
    return this.childNodes.flatMap((hijo) => (hijo instanceof Elemento ? [hijo, ...hijo.descendientes()] : []));
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
}

function cargar() {
  const escuchas = {};
  const document = {
    readyState: "complete",
    activeElement: null,
    addEventListener: (tipo, fn) => (escuchas[tipo] ??= []).push(fn),
    // Una tecla en la página, como la vería el escucha global (en captura).
    tecla(evento) {
      const completo = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...evento };
      for (const fn of escuchas.keydown ?? []) fn(completo);
      return completo;
    },
  };
  document.createElement = (tag) => new Elemento(tag, document);
  document.documentElement = new Elemento("html", document);
  document.documentElement.classList.add("mi-tema");
  document.body = new Elemento("body", document);
  const contexto = vm.createContext({ document, URL, location: { href: "https://www.metro.cl/", pathname: "/" }, console });
  for (const archivo of ["content/registro.js", "comun/idioma.js", "content/plantillas.js", "componentes/buscador.js"]) {
    vm.runInContext(leer(archivo), contexto);
  }
  const MiTema = vm.runInContext("globalThis.MiTema", contexto);
  return { MiTema, document, buscador: MiTema.componentes.get("buscador") };
}

const TAREAS = [
  { titulo: { es: "Planificar un viaje", en: "Plan a trip" }, detalle: "Ruta entre dos estaciones", enlace: "/el-viaje/planificador", palabras: { es: ["ruta", "cómo llegar"], en: ["route"] }, grupo: "Viaje" },
  { titulo: "Horarios y tarifas", detalle: "Cuánto cuesta el pasaje", enlace: "/el-viaje/horarios-y-tarifas", palabras: ["precio", "valor"], grupo: "Viaje" },
  { titulo: "Cargar la bip!", detalle: "Recarga saldo", enlace: "https://www.metro.cl/el-viaje/carga-bip", palabras: ["saldo", "tarjeta"], grupo: "Tarjeta" },
  { titulo: "Tarjeta Adulto Mayor", detalle: "Paga la tarifa rebajada", enlace: "/atencion-cliente/tarjeta-adulto-mayor", palabras: "tercera edad, bip", grupo: "Tarjeta" },
  { titulo: "Buscar una estación", detalle: "Accesos de cada estación", enlace: "/el-viaje/estaciones", grupo: "Viaje" },
];

const contextoVista = (extra = {}) => ({ abrir() {}, viendoOriginal: () => false, alternarOriginal() {}, ...extra });
const titulos = (resultados) => resultados.map((r) => r.tarea.titulo);

// ---------- filtrado ----------

test("normalizar: sin acentos ni mayúsculas y del mismo largo que el original", () => {
  const { buscador } = cargar();
  for (const texto of ["Estación ÑUÑOA ¡bip!", "Über café", "Línea 4A"]) {
    const normal = buscador.normalizar(texto);
    assert.equal(normal.length, texto.length, texto);
  }
  assert.equal(buscador.normalizar("Estación ÑUÑOA ¡bip!"), "estacion nunoa ¡bip!");
  assert.equal(buscador.normalizar(undefined), "");
});

test("filtrar: acentos y mayúsculas no importan, y pesa más el título que las palabras y que el detalle", () => {
  const { buscador } = cargar();
  const tareas = buscador.tareasDe(TAREAS, "es");
  assert.deepEqual(titulos(buscador.filtrar(tareas, "ESTACION")), ["Buscar una estación", "Planificar un viaje"]);
  // «tarifa»: en el título de una, en el detalle de otra.
  assert.deepEqual(titulos(buscador.filtrar(tareas, "tarifa")), ["Horarios y tarifas", "Tarjeta Adulto Mayor"]);
  // «bip»: título > palabras.
  assert.deepEqual(titulos(buscador.filtrar(tareas, "bip")), ["Cargar la bip!", "Tarjeta Adulto Mayor"]);
  // «tarjeta»: al comienzo del título le gana a estar en las palabras.
  assert.deepEqual(titulos(buscador.filtrar(tareas, "tarjeta")), ["Tarjeta Adulto Mayor", "Cargar la bip!"]);
});

test("filtrar: cada palabra debe aparecer, con tope de resultados y letras en orden como último recurso", () => {
  const { buscador } = cargar();
  const tareas = buscador.tareasDe(TAREAS, "es");
  assert.deepEqual(titulos(buscador.filtrar(tareas, "tarifa rebajada")), ["Tarjeta Adulto Mayor"]);
  assert.deepEqual(titulos(buscador.filtrar(tareas, "como llegar")), ["Planificar un viaje"], "por las palabras, sin acento");
  assert.deepEqual(titulos(buscador.filtrar(tareas, "plnfcr")), ["Planificar un viaje"]);
  assert.deepEqual(buscador.filtrar(tareas, "xyzzy"), []);
  assert.equal(buscador.filtrar(tareas, "a", 2).length, 2);
});

test("filtrar: palabras por idioma y marcas en el título donde coincide", () => {
  const { buscador } = cargar();
  assert.deepEqual(titulos(buscador.filtrar(buscador.tareasDe(TAREAS, "en"), "route")), ["Plan a trip"]);
  assert.deepEqual(buscador.filtrar(buscador.tareasDe(TAREAS, "es"), "route"), [], "en español no tiene esa palabra");
  const [primero] = buscador.filtrar(buscador.tareasDe(TAREAS, "es"), "estacion");
  assert.equal(JSON.stringify(primero.marcas), "[[11,19]]"); // «estación» en «Buscar una estación»
});

test("tareasDe: descarta tareas sin título o con enlaces fuera del sitio", () => {
  const { buscador } = cargar();
  const tareas = buscador.tareasDe([
    { titulo: "Ajena", enlace: "//evil.com/x" },
    { titulo: "Otro sitio", enlace: "https://otro.cl/" },
    { titulo: "Script", enlace: "javascript:alert(1)" },
    { titulo: "Datos", enlace: "data:text/html,hola" },
    { enlace: "/sin-titulo" },
    { titulo: "Buena", enlace: "/plano" },
  ], "es");
  assert.deepEqual(tareas.map((t) => [t.titulo, t.enlace]), [["Buena", "https://www.metro.cl/plano"]]);
});

// ---------- dibujo y teclado ----------

function abrirBuscador(opciones = {}, extra = {}) {
  const cargado = cargar();
  const nodo = cargado.buscador.dibujar(TAREAS, opciones, contextoVista(extra));
  const parte = (clase) => nodo.querySelector(`.mt-buscador__${clase}`);
  const opcionesVisibles = () => nodo.querySelectorAll("[role=option]");
  const escribir = (texto) => {
    parte("campo").value = texto;
    parte("campo").disparar("input");
  };
  const tecla = (key) => parte("campo").disparar("keydown", { key });
  return { ...cargado, nodo, parte, opcionesVisibles, escribir, tecla };
}

test("buscador: sin tareas válidas no dibuja nada", () => {
  const { buscador } = cargar();
  assert.equal(buscador.dibujar([{ titulo: "x", enlace: "https://evil.com" }], {}, contextoVista()), null);
});

test("buscador: el botón abre el diálogo con sugerencias, y Escape devuelve el foco al botón", () => {
  const { parte, opcionesVisibles, document, MiTema } = abrirBuscador({ sugeridas: 3 });
  const disparador = parte("disparador");
  assert.equal(disparador.getAttribute("aria-haspopup"), "dialog");
  assert.match(disparador.textContent, new RegExp(MiTema.idioma.t("es", "buscador.boton")));
  disparador.focus();
  disparador.click();
  assert.equal(parte("dialogo").open, true);
  assert.equal(document.activeElement, parte("campo"));
  assert.equal(opcionesVisibles().length, 3);
  assert.equal(parte("dialogo").getAttribute("aria-labelledby"), parte("titulo").id);

  parte("dialogo").close(); // lo que hace el navegador con Escape
  assert.equal(document.activeElement, disparador);
});

test("buscador: flechas mueven la opción activa (aria-activedescendant) y Enter abre su enlace", () => {
  const { parte, opcionesVisibles, escribir, tecla } = abrirBuscador();
  parte("disparador").click();
  escribir("tarjeta");
  const campo = parte("campo");
  const [primera, segunda] = opcionesVisibles();
  assert.equal(campo.getAttribute("aria-activedescendant"), primera.id);
  assert.equal(primera.getAttribute("aria-selected"), "true");

  assert.equal(tecla("ArrowDown").defaultPrevented, true);
  assert.equal(campo.getAttribute("aria-activedescendant"), segunda.id);
  assert.equal(primera.getAttribute("aria-selected"), "false");
  tecla("ArrowDown"); // da la vuelta
  assert.equal(campo.getAttribute("aria-activedescendant"), primera.id);
  tecla("ArrowUp");
  assert.equal(campo.getAttribute("aria-activedescendant"), segunda.id);

  const enlace = segunda.querySelector("a");
  assert.equal(enlace.getAttribute("href"), "https://www.metro.cl/el-viaje/carga-bip");
  assert.equal(tecla("Enter").defaultPrevented, true);
  assert.equal(enlace.clics, 1);
  assert.match(parte("anuncio").textContent, /2 resultados/);
});

test("buscador: sin resultados muestra el aviso con la consulta y oculta la lista", () => {
  const { parte, escribir, tecla, MiTema } = abrirBuscador();
  parte("disparador").click();
  escribir("xyzzy");
  assert.equal(parte("lista").hidden, true);
  assert.equal(parte("vacio").hidden, false);
  assert.equal(parte("vacio-titulo").textContent, MiTema.idioma.t("es", "buscador.sin-resultados", { consulta: "xyzzy" }));
  assert.equal(parte("campo").hasAttribute("aria-activedescendant"), false);
  assert.equal(tecla("Enter").defaultPrevented, false, "Enter sin opción no hace nada");
});

test("buscador: con `agrupar` cada grupo es un role=group con su título, en el orden de su mejor resultado", () => {
  const { nodo, parte, escribir } = abrirBuscador({ agrupar: true });
  parte("disparador").click();
  escribir("tar");
  const grupos = nodo.querySelectorAll("[role=group]");
  assert.deepEqual(grupos.map((g) => nodo.querySelector(`[id=${g.getAttribute("aria-labelledby")}]`).textContent), ["Tarjeta", "Viaje"]);
  assert.equal(grupos[0].querySelectorAll("[role=option]").length, 2);
});

test("buscador: ⌘K / Ctrl+K y / lo abren, pero / no se roba lo que se escribe en la página", () => {
  const { parte, document } = abrirBuscador();
  const dialogo = parte("dialogo");
  assert.equal(document.tecla({ key: "k", metaKey: true }).defaultPrevented, true);
  assert.equal(dialogo.open, true);
  document.tecla({ key: "k", ctrlKey: true });
  assert.equal(dialogo.open, false, "la misma tecla lo cierra");

  const campoDeLaPagina = new Elemento("input", document);
  campoDeLaPagina.type = "search";
  campoDeLaPagina.focus();
  assert.equal(document.tecla({ key: "/" }).defaultPrevented, false);
  assert.equal(dialogo.open, false);

  document.activeElement = document.body;
  document.tecla({ key: "/" });
  assert.equal(dialogo.open, true);
});

test("buscador: las teclas no hacen nada si la página ya las usó, viendo el original o si la vista se quitó", () => {
  let original = false;
  const { nodo, parte, document } = abrirBuscador({}, { viendoOriginal: () => original });
  const dialogo = parte("dialogo");
  document.tecla({ key: "k", ctrlKey: true, defaultPrevented: true });
  assert.equal(dialogo.open, false);
  original = true;
  document.tecla({ key: "k", ctrlKey: true });
  assert.equal(dialogo.open, false);
  original = false;
  nodo.conectado = false;
  assert.equal(document.tecla({ key: "k", ctrlKey: true }).defaultPrevented, false);
});

test("buscador: con `teclas: false` no escucha atajos globales", () => {
  const { parte, document } = abrirBuscador({ teclas: false });
  document.tecla({ key: "k", ctrlKey: true });
  assert.equal(parte("dialogo").open, false);
  assert.equal(parte("disparador").hasAttribute("aria-keyshortcuts"), false);
});
