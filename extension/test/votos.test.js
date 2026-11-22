// Tests de los votos: background/votos.js (lógica pura) y la limpieza de content/captura.js
// (content script: se carga en un contexto aislado con un DOM falso mínimo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import {
  MAX_COMENTARIO,
  comprimir,
  crearAdaptadorMemoria,
  crearAlmacenVotos,
  crearRegistroVoto,
  descomprimir,
  falloVoto,
  incrustarCss,
  limpiarUrl,
  obtenerIdUsuario,
  sincronizarVotos,
  validarVoto,
} from "../src/background/votos.js";

// ---------- votos.js ----------

test("validarVoto: acepta los tres votos y recorta el comentario", () => {
  assert.deepEqual(validarVoto({ voto: "mejor" }), { ok: true, voto: "mejor", comentario: "" });
  assert.deepEqual(validarVoto({ voto: "peor", comentario: "  muy oscuro \n" }), { ok: true, voto: "peor", comentario: "muy oscuro" });
  assert.deepEqual(validarVoto({ voto: "comentario", comentario: " hola " }), { ok: true, voto: "comentario", comentario: "hola" });
});

test("validarVoto: rechaza votos desconocidos, comentarios vacíos o muy largos", () => {
  assert.equal(validarVoto({ voto: "genial" }).ok, false);
  assert.equal(validarVoto({}).ok, false);
  assert.equal(validarVoto().ok, false);
  assert.equal(validarVoto({ voto: "comentario", comentario: "   " }).ok, false);
  assert.equal(validarVoto({ voto: "mejor", comentario: 42 }).ok, false);
  assert.equal(validarVoto({ voto: "mejor", comentario: "x".repeat(MAX_COMENTARIO) }).ok, true);
  const largo = validarVoto({ voto: "mejor", comentario: "x".repeat(MAX_COMENTARIO + 1) });
  assert.equal(largo.ok, false);
  assert.match(largo.error, /largo/);
});

test("validarVoto: cada error trae un código que el popup traduce", () => {
  const { TEXTOS } = globalThis.MiTema.idioma;
  const casos = [
    [{ voto: "genial" }, "voto-invalido"],
    [{ voto: "mejor", comentario: 42 }, "comentario-no-texto"],
    [{ voto: "comentario", comentario: " " }, "comentario-vacio"],
    [{ voto: "mejor", comentario: "x".repeat(MAX_COMENTARIO + 1) }, "comentario-largo"],
  ];
  for (const [mensaje, codigo] of casos) {
    const respuesta = validarVoto(mensaje);
    assert.equal(respuesta.codigo, codigo);
    assert.equal(respuesta.error, TEXTOS.es[`error.${codigo}`].replace("{max}", "2.000"));
  }
  assert.deepEqual(validarVoto({ voto: "mejor", comentario: "x".repeat(MAX_COMENTARIO + 1) }).parametros, { max: MAX_COMENTARIO });
});

test("falloVoto: los códigos que usa el background existen en ambos idiomas", () => {
  const { TEXTOS } = globalThis.MiTema.idioma;
  const background = readFileSync(new URL("../src/background/index.js", import.meta.url), "utf8");
  const codigos = [...background.matchAll(/falloVoto\("([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(codigos.length >= 4);
  for (const codigo of codigos) {
    for (const idioma of ["es", "en"]) assert.ok(TEXTOS[idioma][`error.${codigo}`], `falta error.${codigo} en ${idioma}`);
  }
  assert.deepEqual(falloVoto("sin-tema"), {
    ok: false,
    codigo: "sin-tema",
    error: "Esta página no tiene un tema de Chameleon: no hay con qué comparar.",
  });
});

test("comprimir y descomprimir: ida y vuelta, con tildes y emojis", async () => {
  const texto = "<p>Canción del camaleón 🦎</p>".repeat(500);
  const datos = await comprimir(texto);
  assert.ok(datos instanceof Uint8Array);
  assert.equal(datos[0], 0x1f); // cabecera gzip
  assert.equal(datos[1], 0x8b);
  assert.ok(datos.byteLength < texto.length / 10);
  assert.equal(await descomprimir(datos), texto);
});

test("limpiarUrl: quita query y hash; solo http(s)", () => {
  assert.deepEqual(limpiarUrl("https://www.youtube.com/watch?v=abc&t=3#comentarios"), {
    origen: "https://www.youtube.com",
    url: "https://www.youtube.com/watch",
  });
  assert.deepEqual(limpiarUrl("http://localhost:8000/"), { origen: "http://localhost:8000", url: "http://localhost:8000/" });
  assert.throws(() => limpiarUrl("about:blank"));
  assert.throws(() => limpiarUrl(undefined));
});

test("incrustarCss: al final del <head>, o tras <html>, y escapa </style", () => {
  assert.equal(incrustarCss("<html><head><title>t</title></head><body></body></html>", "a{}"),
    "<html><head><title>t</title><style data-mt-css-tema>\na{}\n</style></head><body></body></html>");
  assert.equal(incrustarCss('<html lang="es"><body></body></html>', "a{}"),
    '<html lang="es"><style data-mt-css-tema>\na{}\n</style><body></body></html>');
  assert.match(incrustarCss("<head></head>", "a{content:'</style><script>'}"), /<\\\/style><script>/);
  assert.equal(incrustarCss("<html></html>", ""), "<html></html>");
});

const captura = {
  url: "https://www.youtube.com/results?search_query=privado#x",
  temaId: "youtube",
  temaActivo: true,
  original: "<!DOCTYPE html>\n<html><head></head><body>original</body></html>",
  editado: '<!DOCTYPE html>\n<html class="mi-tema" data-mt-tema="youtube"><head></head><body>editado</body></html>',
};

test("crearRegistroVoto: arma el registro con los HTML comprimidos", async () => {
  const registro = await crearRegistroVoto({
    idUsuario: "usuario-1",
    voto: "mejor",
    comentario: "  me gusta  ",
    captura,
    cssTema: "html.mi-tema { color: red }",
    versionExtension: "0.1.0",
    ahora: new Date("2026-11-21T12:00:00Z"),
    crearId: () => "voto-1",
  });
  const { original, editado, ...resto } = registro;
  assert.deepEqual(resto, {
    id: "voto-1",
    version: 1,
    creadoEn: "2026-11-21T12:00:00.000Z",
    idUsuario: "usuario-1",
    voto: "mejor",
    comentario: "me gusta",
    origen: "https://www.youtube.com",
    url: "https://www.youtube.com/results",
    temaId: "youtube",
    temaActivo: true,
    versionExtension: "0.1.0",
    compresion: "gzip",
    bytes: {
      original: captura.original.length,
      originalComprimido: original.byteLength,
      editado: resto.bytes.editado,
      editadoComprimido: editado.byteLength,
    },
    originalOmitido: false,
    editadoOmitido: false,
  });
  assert.equal(await descomprimir(original), captura.original);
  const html = await descomprimir(editado);
  assert.equal(html, incrustarCss(captura.editado, "html.mi-tema { color: red }"));
  assert.equal(resto.bytes.editado, new TextEncoder().encode(html).length);
  assert.ok(!JSON.stringify(resto).includes("privado"), "la query no se guarda");
});

test("crearRegistroVoto: omite y marca los HTML que pasan el tope", async () => {
  const base = { idUsuario: "u", voto: "peor", comentario: "", crearId: () => "v" };
  const grande = await crearRegistroVoto({ ...base, captura: { ...captura, editado: "x".repeat(300) }, maxCaracteres: 200 });
  assert.equal(grande.editado, null);
  assert.equal(grande.editadoOmitido, true);
  assert.equal(grande.bytes.editadoComprimido, 0);
  assert.equal(grande.originalOmitido, false);
  assert.ok(grande.original instanceof Uint8Array);

  const comprimidoGrande = await crearRegistroVoto({ ...base, captura, maxBytes: 10 });
  assert.equal(comprimidoGrande.original, null);
  assert.equal(comprimidoGrande.editado, null);
  assert.equal(comprimidoGrande.originalOmitido, true);
  assert.equal(comprimidoGrande.editadoOmitido, true);

  // Página sin tema: el background no la captura. Sin HTML, y no es "omitido" (no se descartó por tamaño).
  const sinHtml = await crearRegistroVoto({ ...base, voto: "comentario", comentario: "más contraste", captura: { url: captura.url } });
  assert.equal(sinHtml.original, null);
  assert.equal(sinHtml.editado, null);
  assert.equal(sinHtml.originalOmitido, false);
  assert.equal(sinHtml.editadoOmitido, false);
  assert.equal(sinHtml.temaId, null);
  assert.equal(sinHtml.temaActivo, false);
});

test("crearRegistroVoto: lanza si el voto o la URL no son válidos", async () => {
  await assert.rejects(crearRegistroVoto({ idUsuario: "u", voto: "otro", captura }));
  await assert.rejects(crearRegistroVoto({ idUsuario: "u", voto: "mejor", captura: { ...captura, url: "file:///x" } }));
  await assert.rejects(crearRegistroVoto({ voto: "mejor", captura }));
});

const registroFalso = (n) => ({ id: `v${n}`, creadoEn: new Date(Date.UTC(2026, 10, 21, 0, 0, n)).toISOString(), voto: "mejor" });

test("almacén en memoria: guarda, lista del más antiguo al más nuevo, borra y cuenta", async () => {
  const almacen = crearAlmacenVotos(crearAdaptadorMemoria());
  for (const n of [3, 1, 2]) await almacen.guardar(registroFalso(n));
  assert.equal(await almacen.contar(), 3);
  assert.deepEqual((await almacen.listarPendientes()).map((r) => r.id), ["v1", "v2", "v3"]);
  await almacen.borrar("v2");
  assert.deepEqual(await almacen.listarIds(), ["v1", "v3"]);
  assert.equal(await almacen.contar(), 2);
});

test("almacén: sobre el tope borra los más antiguos y nunca el recién guardado", async () => {
  const almacen = crearAlmacenVotos(crearAdaptadorMemoria());
  for (let n = 1; n <= 101; n++) await almacen.guardar(registroFalso(n));
  assert.equal(await almacen.contar(), 100);
  const ids = await almacen.listarIds();
  assert.equal(ids[0], "v2");
  assert.equal(ids.at(-1), "v101");

  // Un voto con fecha más vieja que todos (reloj atrasado) igual se queda.
  const chico = crearAlmacenVotos(crearAdaptadorMemoria(), { maxPendientes: 2 });
  await chico.guardar(registroFalso(5));
  await chico.guardar(registroFalso(6));
  await chico.guardar(registroFalso(1));
  assert.deepEqual(await chico.listarIds(), ["v1", "v6"]);
});

test("almacén: con el disco lleno, borra los antiguos antes de guardar y el voto nuevo entra", async () => {
  // Un adaptador que, como IndexedDB sin cuota, rechaza guardar cuando ya tiene `capacidad` registros.
  const memoria = crearAdaptadorMemoria();
  const capacidad = 3;
  const lleno = {
    ...memoria,
    async poner(registro) {
      if ((await memoria.contar()) >= capacidad) throw new DOMException("cuota", "QuotaExceededError");
      return memoria.poner(registro);
    },
  };
  const almacen = crearAlmacenVotos(lleno, { maxPendientes: capacidad });
  for (let n = 1; n <= 5; n++) await almacen.guardar(registroFalso(n));
  assert.deepEqual(await almacen.listarIds(), ["v3", "v4", "v5"]);
});

test("sincronizarVotos: sube en orden y borra lo subido", async () => {
  const almacen = crearAlmacenVotos(crearAdaptadorMemoria());
  for (const n of [2, 1, 3]) await almacen.guardar(registroFalso(n));
  const subidos = [];
  const resultado = await sincronizarVotos({ almacen, subir: async (r) => subidos.push(r.id) });
  assert.deepEqual(subidos, ["v1", "v2", "v3"]);
  assert.deepEqual(resultado, { subidos: 3, pendientes: 0 });
  assert.equal(await almacen.contar(), 0);
});

test("sincronizarVotos: si falla el segundo se detiene y deja el segundo y los siguientes", async () => {
  const almacen = crearAlmacenVotos(crearAdaptadorMemoria());
  for (const n of [1, 2, 3]) await almacen.guardar(registroFalso(n));
  const intentados = [];
  const error = new Error("servidor caído");
  const resultado = await sincronizarVotos({
    almacen,
    subir: async (r) => {
      intentados.push(r.id);
      if (r.id === "v2") throw error;
    },
  });
  assert.deepEqual(intentados, ["v1", "v2"]);
  assert.deepEqual(resultado, { subidos: 1, pendientes: 2, error });
  assert.deepEqual(await almacen.listarIds(), ["v2", "v3"]);
});

function areaFalsa(inicial = {}) {
  const datos = { ...inicial };
  let escrituras = 0;
  return {
    datos,
    escrituras: () => escrituras,
    async get(clave) {
      return clave in datos ? { [clave]: datos[clave] } : {};
    },
    async set(valores) {
      escrituras++;
      Object.assign(datos, valores);
    },
  };
}

test("obtenerIdUsuario: lo genera una vez (aunque se pida dos veces seguidas) y lo reutiliza", async () => {
  const area = areaFalsa();
  let n = 0;
  const crearId = () => `id-${++n}`;
  const [a, b] = await Promise.all([obtenerIdUsuario(area, { crearId }), obtenerIdUsuario(area, { crearId })]);
  assert.equal(a, "id-1");
  assert.equal(b, "id-1");
  assert.equal(await obtenerIdUsuario(area, { crearId }), "id-1");
  assert.equal(area.escrituras(), 1);
  assert.equal(area.datos.idUsuario, "id-1");

  const yaGuardado = areaFalsa({ idUsuario: "existente" });
  assert.equal(await obtenerIdUsuario(yaGuardado, { crearId }), "existente");
  assert.equal(yaGuardado.escrituras(), 0);

  const real = await obtenerIdUsuario(areaFalsa());
  assert.match(real, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ---------- content/captura.js ----------

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");

let listener = null;
const contexto = {
  MiTema: {},
  browser: { runtime: { onMessage: { addListener: (fn) => (listener = fn) } } },
};
vm.runInNewContext(leer("content/captura.js"), contexto);
const {
  IDS_INSERTADOS,
  limpiarClases,
  quitarPropiedades,
  recortarDataUris,
  quitarQuery,
  quitarQuerySrcset,
  quitarQueryEnCss,
  limpiar,
  serializarDoctype,
} = contexto.MiTema.captura;

// Elemento falso con lo justo que usa limpiar(): atributos, hijos, textContent, remove() y
// replaceChildren(). Un <template> trae `content` (sus hijos no están en `children`, como en el DOM).
function el(localName, atributos = {}, hijos = [], texto = "") {
  const nodo = {
    localName,
    atributos: new Map(Object.entries(atributos)),
    hijos: [],
    padre: null,
    texto,
    get children() {
      return this.hijos;
    },
    get textContent() {
      return this.texto;
    },
    set textContent(valor) {
      this.texto = valor;
    },
    getAttributeNames() {
      return [...this.atributos.keys()];
    },
    getAttribute(nombre) {
      return this.atributos.get(nombre) ?? null;
    },
    hasAttribute(nombre) {
      return this.atributos.has(nombre);
    },
    setAttribute(nombre, valor) {
      this.atributos.set(nombre, String(valor));
    },
    removeAttribute(nombre) {
      this.atributos.delete(nombre);
    },
    remove() {
      if (this.padre) this.padre.hijos = this.padre.hijos.filter((h) => h !== this);
      this.padre = null;
    },
    replaceChildren() {
      this.hijos = [];
      this.texto = "";
    },
  };
  if (localName === "template") {
    nodo.texto = "";
    nodo.content = el("#fragmento", {}, hijos, texto);
    return nodo;
  }
  for (const hijo of hijos) {
    hijo.padre = nodo;
    nodo.hijos.push(hijo);
  }
  return nodo;
}

// Serializa el DOM falso para comparar fácil (el contenido de un <template> va adentro, como outerHTML).
function html(nodo) {
  const atributos = [...nodo.atributos].map(([k, v]) => ` ${k}="${v}"`).join("");
  const plantilla = nodo.content ? nodo.content.texto + nodo.content.hijos.map(html).join("") : "";
  return `<${nodo.localName}${atributos}>${nodo.texto}${plantilla}${nodo.hijos.map(html).join("")}</${nodo.localName}>`;
}

const URI_LARGA = `data:image/png;base64,${"A".repeat(3000)}`;
const URI_CORTA = "data:image/gif;base64,R0lGOD";

function paginaConTema() {
  return el("html", { class: "mi-tema mi-tema-foco mt-vista-original otra", "data-mt-tema": "youtube", "data-mt-transicion": "entrada", style: "color: red; --mt-f-0: 0.5; --mt-a-0: 30; --mt-acento: #f00" }, [
    el("head", {}, [
      el("script", { src: "/app.js", nonce: "abc" }),
      el("script", {}, [], "window.secreto = 'token'"),
      el("style", {}, [], `body { background: url(${URI_LARGA}) } i { background: url(${URI_CORTA}) }`),
      el("meta", { name: "csrf-token", content: "s3cr3t0" }),
      el("meta", { name: "description", content: "Un sitio" }),
    ]),
    el("body", { class: "mt-3 mi-tema-x" }, [
      el("section", { class: "mt-vista mt-cartelera", "data-mt-vista": "inicio" }, [el("h2", {}, [], "Vista")]),
      el("div", { id: "contenido", "data-mt-oculto": "", "data-mt-pieza": "3" }, [
        el("input", { type: "text", value: "lo que escribí" }),
        el("input", { type: "password", value: "clave" }),
        el("input", { type: "hidden", value: "token-oculto" }),
        el("input", { type: "submit", value: "Buscar" }),
        el("textarea", {}, [], "borrador privado"),
        el("img", { src: URI_LARGA, alt: "foto" }),
        el("img", { src: URI_CORTA }),
      ]),
      el("button", { id: "mt-foco", class: "mt-flotante" }, [], "🎯 Modo foco"),
      el("div", { id: "mt-frente" }, [el("div", { class: "mt-brillo" })]),
    ]),
  ]);
}

test("captura: limpiarClases quita mi-tema* en todos y mt-* solo en <html>", () => {
  assert.equal(limpiarClases("mi-tema mi-tema-foco mt-vista-original otra", true), "otra");
  assert.equal(limpiarClases("mt-3 mi-tema-x mi-temario", false), "mt-3 mi-temario");
});

test("captura: quitarPropiedades quita solo las propiedades que cumplen el patrón", () => {
  assert.equal(quitarPropiedades("color: red; --mt-f-0: 0.5; --mt-a-12: 30; --mt-acento: #f00", /^--mt-[fa]-\d+$/), "color: red; --mt-acento: #f00");
  assert.equal(quitarPropiedades("--mt-f-0: 0.5; --mt-a-0: 30;", /^--mt-/), "");
  assert.equal(quitarPropiedades("--otro: 1; --mt-x: 2", /^--mt-/), "--otro: 1;");
});

test("captura: recortarDataUris deja la cabecera de las URIs largas y no toca las cortas", () => {
  assert.equal(recortarDataUris(`url(${URI_LARGA}) url(${URI_CORTA})`), `url(data:image/png;base64,) url(${URI_CORTA})`);
  assert.equal(recortarDataUris("sin uris"), "sin uris");
});

test("captura: el original no tiene nada de Chameleon y sí la sección que ocultaba la vista", () => {
  const raiz = limpiar(paginaConTema(), { modo: "original" });
  const texto = html(raiz);
  assert.doesNotMatch(texto, /mi-tema|data-mt-|--mt-|mt-vista|mt-foco|mt-frente|mt-brillo|Modo foco/);
  assert.match(texto, /<html class="otra" style="color: red;">/);
  assert.match(texto, /<div id="contenido">/, "la sección original queda visible");
  assert.match(texto, /<body class="mt-3">/, "las mt-* del sitio (Bootstrap/Tailwind) se respetan");
});

test("captura: el editado conserva lo de Chameleon salvo los restos de la transición", () => {
  const texto = html(limpiar(paginaConTema(), { modo: "editado" }));
  assert.match(texto, /<html class="mi-tema mi-tema-foco mt-vista-original otra" data-mt-tema="youtube" style="color: red; --mt-acento: #f00">/);
  assert.match(texto, /data-mt-vista="inicio"/);
  assert.match(texto, /<div id="contenido" data-mt-oculto="">/);
  assert.match(texto, /id="mt-foco"/);
  assert.doesNotMatch(texto, /mt-frente|mt-brillo|data-mt-pieza|data-mt-transicion|--mt-[fa]-/);
});

for (const modo of ["original", "editado"]) {
  test(`captura (${modo}): quita scripts, valores, nonce, tokens y URIs data: largas`, () => {
    const texto = html(limpiar(paginaConTema(), { modo }));
    assert.match(texto, /<script src="\/app.js"><\/script><script><\/script>/);
    assert.doesNotMatch(texto, /secreto|nonce|s3cr3t0|lo que escribí|clave|token-oculto|borrador privado/);
    assert.match(texto, /<input type="submit" value="Buscar">/);
    assert.match(texto, /<input type="password">/);
    assert.match(texto, /<meta name="description" content="Un sitio">/);
    assert.match(texto, /<img src="data:image\/png;base64," alt="foto">/);
    assert.ok(texto.includes(`<img src="${URI_CORTA}">`));
    assert.ok(texto.includes(`url(data:image/png;base64,) } i { background: url(${URI_CORTA}) }`));
  });
}

test("captura: quitarQuery, quitarQuerySrcset y quitarQueryEnCss quitan la query y dejan el resto", () => {
  assert.equal(quitarQuery("https://s3.example/a.png?X-Amz-Security-Token=abc&X-Amz-Signature=x"), "https://s3.example/a.png");
  assert.equal(quitarQuery("/watch?v=123#t=10"), "/watch#t=10");
  assert.equal(quitarQuery("/sin-query#ancla"), "/sin-query#ancla");
  assert.equal(quitarQuery("data:image/svg+xml,<svg>?</svg>"), "data:image/svg+xml,<svg>?</svg>");
  // Una URL con comas (Cloudinary) se parte en el split pero vuelve a quedar entera.
  assert.equal(
    quitarQuerySrcset("a.jpg?s=1 1x, https://c.example/w_100,h_100/b.jpg?s=2 2x"),
    "a.jpg 1x, https://c.example/w_100,h_100/b.jpg 2x",
  );
  assert.equal(
    quitarQueryEnCss(`background: url("https://x.example/y.png?token=1"), url(z.png?a=b); color: red`),
    `background: url("https://x.example/y.png"), url(z.png); color: red`,
  );
  assert.equal(quitarQueryEnCss("color: red"), "color: red");
});

// Lo que la primera versión dejaba pasar: editores, <template>, srcdoc, URLs con tokens, on*,
// javascript:, <meta> con datos de la cuenta y estado de la app en JSON.
function paginaConDatos() {
  const estadoApp = JSON.stringify({ props: { auth: { user: { email: "persona@example.com" } } } });
  return el("html", {}, [
    el("head", {}, [
      el("meta", { name: "user-login", content: "usuario-123" }),
      el("meta", { name: "visitor-hmac", content: "hmac-secreto" }),
      el("meta", { property: "og:url", content: "https://www.youtube.com/watch?v=video-privado" }),
      el("link", { rel: "canonical", href: "https://www.youtube.com/watch?v=video-privado" }),
      el("style", {}, [], "i { background: url('https://s3.example/i.png?X-Amz-Security-Token=sts-secreto') }"),
    ]),
    el("body", { onload: "iniciar('sesion-123')" }, [
      el("div", { contenteditable: "true", role: "textbox" }, [el("p", {}, [], "te mando la clave del banco")], "borrador"),
      el("div", { contenteditable: "false" }, [], "texto fijo del sitio"),
      el("template", {}, [
        el("form", {}, [el("input", { type: "hidden", name: "authenticity_token", value: "tok-template" })]),
        el("script", {}, [], "window.x = 'script-template'"),
      ]),
      el("iframe", { srcdoc: "<p>srcdoc-privado</p>" }),
      el("a", { href: "https://mail.example/reset?token=enlace-magico", onclick: "medir('clic-123')" }, [], "Restablecer"),
      el("a", { href: "javascript:alert('url-js')" }, [], "Abrir"),
      el("img", {
        src: "https://s3.example/foto.jpg?X-Amz-Signature=firma-src",
        srcset: "https://s3.example/f.jpg?sig=firma-srcset 2x",
        style: "background: url(https://s3.example/b.png?sig=firma-estilo)",
      }),
      el("div", { id: "app", "data-page": estadoApp }),
      el("div", { "data-state": "open", "data-react-props": "[]" }),
    ]),
  ]);
}

for (const modo of ["original", "editado"]) {
  test(`captura (${modo}): vacía editores y <template>, quita srcdoc, on*, javascript:, queries, metas de la cuenta y JSON`, () => {
    const texto = html(limpiar(paginaConDatos(), { modo }));
    assert.doesNotMatch(
      texto,
      /usuario-123|hmac-secreto|video-privado|sts-secreto|sesion-123|clave del banco|borrador|tok-template|script-template|srcdoc|enlace-magico|clic-123|url-js|firma-|persona@example/,
    );
    assert.match(texto, /<div contenteditable="true" role="textbox"><\/div>/);
    assert.match(texto, /<div contenteditable="false">texto fijo del sitio<\/div>/, "lo no editable no se toca");
    assert.match(texto, /<template><\/template>/);
    assert.match(texto, /<iframe><\/iframe>/);
    assert.match(texto, /<a href="https:\/\/mail.example\/reset">Restablecer<\/a>/);
    assert.match(texto, /<a>Abrir<\/a>/);
    assert.match(texto, /<meta name="user-login">/);
    assert.match(texto, /<meta property="og:url" content="https:\/\/www.youtube.com\/watch">/);
    assert.match(texto, /<link rel="canonical" href="https:\/\/www.youtube.com\/watch">/);
    assert.match(texto, /<img src="https:\/\/s3.example\/foto.jpg" srcset="https:\/\/s3.example\/f.jpg 2x" style="background: url\(https:\/\/s3.example\/b.png\)">/);
    assert.match(texto, /<div id="app"><\/div>/);
    assert.match(texto, /<div data-state="open" data-react-props="\[\]">/, "atributos cortos (que el CSS del sitio usa) quedan");
  });
}

test("captura: serializarDoctype", () => {
  assert.equal(serializarDoctype(null), "");
  assert.equal(serializarDoctype({ name: "html", publicId: "", systemId: "" }), "<!DOCTYPE html>\n");
  assert.equal(
    serializarDoctype({ name: "html", publicId: "-//W3C//DTD XHTML 1.0 Strict//EN", systemId: "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd" }),
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n',
  );
});

test("captura: solo responde a voto:capturar y estado:pagina", () => {
  assert.equal(typeof listener, "function");
  assert.equal(listener({ tipo: "tema:aplicar" }), undefined);
  assert.equal(listener(undefined), undefined);
});

test("captura: estado:pagina devuelve el tema y si está activo, sin capturar HTML", async () => {
  const html = (atributos, clases) => ({
    getAttribute: (nombre) => atributos[nombre] ?? null,
    classList: { contains: (clase) => clases.includes(clase) },
    get outerHTML() {
      throw new Error("estado:pagina no debe serializar la página");
    },
  });
  contexto.document = { documentElement: html({ "data-mt-tema": "youtube" }, ["mi-tema"]) };
  assert.deepEqual({ ...(await listener({ tipo: "estado:pagina" })) }, { temaId: "youtube", temaActivo: true });
  contexto.document = { documentElement: html({}, []) };
  assert.deepEqual({ ...(await listener({ tipo: "estado:pagina" })) }, { temaId: null, temaActivo: false });
  delete contexto.document;
});

test("captura: conoce los ids de todos los nodos que inserta Chameleon", () => {
  const archivos = ["content", "features", "componentes"].flatMap((carpeta) =>
    readdirSync(new URL(`${carpeta}/`, src))
      .filter((archivo) => archivo.endsWith(".js") && archivo !== "captura.js")
      .map((archivo) => `${carpeta}/${archivo}`),
  );
  const ids = archivos.flatMap((archivo) => [...leer(archivo).matchAll(/\bID_[A-Z_]+ = "(mt-[\w-]+)"/g)].map((m) => m[1]));
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(IDS_INSERTADOS.includes(id), `falta "${id}" en IDS_INSERTADOS de content/captura.js`);
});

test("captura.js se carga después de content/registro.js y antes del motor", () => {
  const scripts = JSON.parse(leer("manifest.json")).content_scripts.flatMap((cs) => cs.js ?? []);
  const posicion = (archivo) => scripts.indexOf(archivo);
  assert.ok(posicion("content/captura.js") > posicion("content/registro.js"));
  assert.ok(posicion("content/captura.js") < posicion("content/motor.js"));
});
