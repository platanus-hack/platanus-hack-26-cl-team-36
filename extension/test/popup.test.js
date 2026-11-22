// Tests del popup: lógica pura de src/popup/estado.js y su cableado con el manifest,
// el HTML y el background.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AVISOS, MAX_COMENTARIO, PRIVACIDAD, crearCola, decidirVista, textoPendientes, validarEnvio } from "../src/popup/estado.js";

const { TEXTOS } = globalThis.MiTema.idioma; // lo carga estado.js

const src = new URL("../src/", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, src), "utf8");

// ---------- decidirVista ----------

test("decidirVista: con tema y encendido pregunta Mejor/Peor", () => {
  assert.deepEqual(decidirVista({ activo: true, pagina: { alcanzable: true, temaId: "youtube" } }), {
    modo: "completa",
    aviso: null,
    privacidad: PRIVACIDAD.conCopia,
  });
});

test("decidirVista: sin tema, o apagado, deja solo el comentario y explica por qué", () => {
  // Sin tema el background no copia la página: el pie lo dice.
  assert.deepEqual(decidirVista({ activo: true, pagina: { alcanzable: true, temaId: null } }), {
    modo: "solo-comentario",
    aviso: AVISOS.sinTema,
    privacidad: PRIVACIDAD.sinCopia,
  });
  assert.deepEqual(decidirVista({ activo: false, pagina: { alcanzable: true, temaId: "youtube" } }), {
    modo: "solo-comentario",
    aviso: AVISOS.apagado,
    privacidad: PRIVACIDAD.conCopia,
  });
  // Sin tema manda el aviso de "sin tema" aunque esté apagado: encenderlo no cambiaría nada.
  assert.equal(decidirVista({ activo: false, pagina: { alcanzable: true, temaId: null } }).aviso, AVISOS.sinTema);
});

test("decidirVista: si no se puede hablar con la pestaña no hay formulario", () => {
  for (const pagina of [{ alcanzable: false, temaId: null }, null, undefined]) {
    assert.deepEqual(decidirVista({ activo: true, pagina }), { modo: "no-disponible", aviso: AVISOS.noDisponible, privacidad: null });
  }
});

test("decidirVista: en una ventana privada no hay formulario, tenga tema o no", () => {
  for (const temaId of ["youtube", null]) {
    assert.deepEqual(decidirVista({ activo: true, pagina: { alcanzable: false, privada: true, temaId } }), {
      modo: "no-disponible",
      aviso: AVISOS.privada,
      privacidad: null,
    });
  }
});

// ---------- validarEnvio ----------

test("validarEnvio: en modo completa hay que elegir una opción", () => {
  assert.equal(validarEnvio({ modo: "completa", opcion: null }).ok, false);
  assert.equal(validarEnvio({ modo: "completa", opcion: null }).motivo, "motivo.elegir");
  assert.deepEqual(validarEnvio({ modo: "completa", opcion: "mejor" }), { ok: true, voto: "mejor", comentario: "" });
  assert.deepEqual(validarEnvio({ modo: "completa", opcion: "peor", comentario: "  muy oscuro " }), {
    ok: true,
    voto: "peor",
    comentario: "muy oscuro",
  });
});

test("validarEnvio: 'Solo quiero comentar' exige texto", () => {
  assert.equal(validarEnvio({ modo: "completa", opcion: "comentario", comentario: "   " }).ok, false);
  assert.equal(validarEnvio({ modo: "completa", opcion: "comentario" }).motivo, "motivo.escribir");
  assert.deepEqual(validarEnvio({ modo: "completa", opcion: "comentario", comentario: "hola" }), {
    ok: true,
    voto: "comentario",
    comentario: "hola",
  });
});

test("validarEnvio: en solo-comentario el voto es siempre comentario, aunque quedara otra opción", () => {
  assert.equal(validarEnvio({ modo: "solo-comentario", opcion: null, comentario: "" }).ok, false);
  assert.deepEqual(validarEnvio({ modo: "solo-comentario", opcion: "mejor", comentario: "x" }), {
    ok: true,
    voto: "comentario",
    comentario: "x",
  });
});

test("validarEnvio: nada se envía si la pestaña no está disponible o el comentario es muy largo", () => {
  assert.equal(validarEnvio({ modo: "no-disponible", opcion: "mejor" }).ok, false);
  assert.equal(validarEnvio({ modo: "completa", opcion: "mejor", comentario: "x".repeat(MAX_COMENTARIO) }).ok, true);
  const largo = validarEnvio({ modo: "completa", opcion: "mejor", comentario: "x".repeat(MAX_COMENTARIO + 1) });
  assert.deepEqual(largo, { ok: false, motivo: "motivo.largo", parametros: { max: MAX_COMENTARIO } });
});

test("validarEnvio: rechaza opciones desconocidas", () => {
  assert.equal(validarEnvio({ modo: "completa", opcion: "genial" }).ok, false);
});

// ---------- textoPendientes ----------

test("textoPendientes: singular, plural y vacío, en español por defecto", () => {
  assert.equal(textoPendientes(0), "Aún no hay opiniones guardadas en tu equipo.");
  assert.equal(textoPendientes(null), "Aún no hay opiniones guardadas en tu equipo.");
  assert.equal(textoPendientes(1), "1 opinión guardada en tu equipo.");
  assert.equal(textoPendientes(7), "7 opiniones guardadas en tu equipo.");
  assert.equal(textoPendientes(1500, "es"), "1.500 opiniones guardadas en tu equipo.");
});

test("textoPendientes: en inglés", () => {
  assert.equal(textoPendientes(0, "en"), "No feedback saved on this device yet.");
  assert.equal(textoPendientes(1, "en"), "1 response saved on this device.");
  assert.equal(textoPendientes(1500, "en"), "1,500 responses saved on this device.");
});

test("avisos y motivos son claves del diccionario en ambos idiomas", () => {
  const claves = [
    ...Object.values(AVISOS),
    ...Object.values(PRIVACIDAD),
    "motivo.noDisponible",
    "motivo.elegir",
    "motivo.escribir",
    "motivo.largo",
  ];
  for (const idioma of ["es", "en"]) {
    for (const clave of claves) assert.ok(TEXTOS[idioma][clave], `falta "${clave}" en ${idioma}`);
  }
});

// ---------- crearCola ----------

const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));

test("crearCola: dos clics rápidos cuentan como dos (no leen el mismo valor viejo)", async () => {
  let activo = true;
  const alternar = async () => {
    const leido = activo;
    await esperar(5); // storage.local.get/set son asíncronos
    activo = !leido;
  };
  const encolar = crearCola();
  await Promise.all([encolar(alternar), encolar(alternar), encolar(alternar)]);
  assert.equal(activo, false); // tres cambios: true → false → true → false
  await Promise.all([encolar(alternar), encolar(alternar)]);
  assert.equal(activo, false);
});

test("crearCola: respeta el orden y un error no corta la cola", async () => {
  const orden = [];
  const encolar = crearCola();
  const primera = encolar(async () => {
    await esperar(10);
    orden.push(1);
  });
  const falla = encolar(async () => {
    orden.push(2);
    throw new Error("falló");
  });
  const tercera = encolar(async () => orden.push(3));
  await primera;
  await assert.rejects(falla, /falló/);
  await tercera;
  assert.deepEqual(orden, [1, 2, 3]);
});

// ---------- Cableado ----------

test("el ícono abre el popup y el background ya no usa action.onClicked", () => {
  const manifest = JSON.parse(leer("manifest.json"));
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  assert.ok(existsSync(new URL(manifest.action.default_popup, src)));
  const background = leer("background/index.js");
  assert.doesNotMatch(background, /action\.onClicked/, "con default_popup, action.onClicked no se dispara");
  assert.match(background, /storage\.onChanged/, "el badge se sincroniza escuchando storage");
});

test("popup.html: sin scripts inline, recursos existentes e ids con prefijo mt-", () => {
  const html = leer("popup/popup.html");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, atributos, contenido] of scripts) {
    assert.match(atributos, /\bsrc="/, "la CSP de las extensiones no permite scripts inline");
    assert.equal(contenido.trim(), "");
  }
  assert.doesNotMatch(html, /\son[a-z]+="/, "sin manejadores inline");
  assert.doesNotMatch(html, /\sstyle="/, "sin estilos inline: todo en popup.css");
  for (const [, ruta] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    assert.ok(existsSync(new URL(ruta, new URL("popup/", src))), `no existe ${ruta}`);
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) assert.match(id, /^mt-/);
  for (const [, clases] of html.matchAll(/\bclass="([^"]+)"/g)) {
    for (const clase of clases.split(/\s+/)) assert.match(clase, /^mt-/);
  }
});

test("popup.js: los ids que busca existen en el HTML, sin innerHTML ni estilos inline", () => {
  const html = leer("popup/popup.html");
  const js = leer("popup/popup.js");
  for (const [, id] of js.matchAll(/\$\("([^"]+)"\)/g)) assert.match(html, new RegExp(`id="${id}"`), `falta #${id} en popup.html`);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|\.style\b/);
});

test("popup.html: cada data-mt-texto* existe en el diccionario y el HTML trae el texto en español", () => {
  const html = leer("popup/popup.html");
  const usados = [...html.matchAll(/data-mt-texto(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(usados.length >= 7); // el texto de privacidad lo pone popup.js (depende de si hay tema)
  for (const clave of usados) assert.ok(TEXTOS.es[clave] && TEXTOS.en[clave], `falta "${clave}" en el diccionario`);
  // El texto del HTML es el de español (lo que se ve si el JS no alcanzara a correr).
  for (const [, clave, texto] of html.matchAll(/data-mt-texto="([^"]+)"[^>]*>([^<]+)</g)) {
    assert.equal(texto.trim().replace(/\s+/g, " "), TEXTOS.es[clave], `el HTML de "${clave}" no coincide con el diccionario`);
  }
});

test("selector de idioma: listbox accesible con una opción por idioma", () => {
  const html = leer("popup/popup.html");
  assert.match(html, /id="mt-idioma-boton"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /role="listbox"/);
  const opciones = [...html.matchAll(/role="option" data-idioma="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(opciones.sort(), Object.keys(TEXTOS).sort());
});

test("popup y textos visibles: ningún texto suelto en español en popup.js", () => {
  const js = leer("popup/popup.js");
  // Los textos van por el diccionario: popup.js no asigna cadenas con letras a textContent/placeholder.
  assert.doesNotMatch(js, /(?:textContent|placeholder)\s*=\s*["'`][^"'`]*[a-zA-Záéíóúñ]{3}/);
});
