// Reglas de los diccionarios (diseño §5.13), sobre todas las secciones que existan:
//   1. cada public/i18n/es/<sección>.js tiene su par en en/ con exactamente el mismo árbol de claves;
//   2. cada valor función devuelve un texto no vacío para n = 0, 1, 2;
//   3. el código de las pantallas no tiene textos visibles escritos a mano (todo pasa por t()/fmt/textos.js).
//
// Para (2) las funciones reciben un objeto de variables donde toda variable vale n. Si una función necesita otra
// forma (un arreglo, un texto), la sección puede exportar `ejemplos`: { "<clave relativa>": vars | (n) => vars }.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crearFormatos } from "../public/nucleo/formato.js";

const PUBLICO = fileURLToPath(new URL("../public/", import.meta.url));
const I18N = path.join(PUBLICO, "i18n");
const IDIOMAS = ["es", "en"];
const LOCALES = { es: "es-CL", en: "en-US" };

const secciones = (idioma) =>
  existsSync(path.join(I18N, idioma))
    ? readdirSync(path.join(I18N, idioma)).filter((archivo) => archivo.endsWith(".js")).sort()
    : [];

const cargar = (idioma, archivo) => import(pathToFileURL(path.join(I18N, idioma, archivo)).href);

function hojas(objeto, prefijo = "") {
  const resultado = new Map();
  for (const [clave, valor] of Object.entries(objeto ?? {})) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if (valor !== null && typeof valor === "object" && !Array.isArray(valor)) {
      for (const [hija, tipo] of hojas(valor, ruta)) resultado.set(hija, tipo);
    } else {
      resultado.set(ruta, typeof valor);
    }
  }
  return resultado;
}

test("hay secciones en español y la sección comun existe", () => {
  assert.ok(secciones("es").includes("comun.js"));
});

test("cada sección en español tiene su par en inglés con el mismo árbol de claves", async () => {
  assert.deepEqual(secciones("en"), secciones("es"), "los archivos de i18n/es e i18n/en deben ser los mismos");
  for (const archivo of secciones("es")) {
    const es = hojas((await cargar("es", archivo)).default);
    const en = hojas((await cargar("en", archivo)).default);
    const soloEs = [...es.keys()].filter((clave) => !en.has(clave));
    const soloEn = [...en.keys()].filter((clave) => !es.has(clave));
    assert.deepEqual(soloEs, [], `${archivo}: claves que faltan en en/`);
    assert.deepEqual(soloEn, [], `${archivo}: claves que sobran en en/`);
    for (const [clave, tipo] of es) {
      assert.ok(tipo === "string" || tipo === "function", `${archivo}: «${clave}» debe ser texto o función (es ${tipo})`);
      assert.equal(en.get(clave), tipo, `${archivo}: «${clave}» es ${tipo} en es y ${en.get(clave)} en en`);
    }
  }
});

function valorEn(objeto, clave) {
  return clave.split(".").reduce((nodo, parte) => nodo?.[parte], objeto);
}

function variables(n, ejemplo) {
  const base = typeof ejemplo === "function" ? ejemplo(n) : (ejemplo ?? {});
  return new Proxy(base, {
    get: (objetivo, propiedad) => (typeof propiedad !== "string" ? undefined : propiedad in objetivo ? objetivo[propiedad] : n),
    has: () => true,
  });
}

test("cada valor función devuelve un texto no vacío para n = 0, 1, 2", async () => {
  for (const idioma of IDIOMAS) {
    const reglas = new Intl.PluralRules(LOCALES[idioma]);
    const ayudas = {
      plural: (n, formas) => formas[reglas.select(Number(n))] ?? formas.other ?? "",
      fmt: crearFormatos(idioma),
    };
    for (const archivo of secciones(idioma)) {
      const modulo = await cargar(idioma, archivo);
      for (const [clave, tipo] of hojas(modulo.default)) {
        if (tipo !== "function") continue;
        const funcion = valorEn(modulo.default, clave);
        for (const n of [0, 1, 2]) {
          let texto;
          try {
            texto = funcion(variables(n, modulo.ejemplos?.[clave]), ayudas);
          } catch (error) {
            assert.fail(`${idioma}/${archivo}: «${clave}» lanzó con n = ${n}: ${error.message}`);
          }
          assert.equal(typeof texto, "string", `${idioma}/${archivo}: «${clave}» con n = ${n} no devuelve texto`);
          assert.ok(texto.trim().length > 0, `${idioma}/${archivo}: «${clave}» con n = ${n} devuelve un texto vacío`);
        }
      }
    }
  }
});

// ── 3. Sin textos a mano en el código de las pantallas ───────────────────

const CARPETAS_DE_PANTALLAS = ["pantallas", "corridas", "telarana", "replay", "perfiles"];

function archivosJs(carpeta) {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = path.join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivosJs(ruta);
    return nombre.endsWith(".js") ? [ruta] : [];
  });
}

const LITERAL = String.raw`(["'\x60])((?:\\.|(?!\1)[^\\])*)\1`;
const PATRONES = [
  new RegExp(String.raw`(?:\btexto|"aria-label"|'aria-label'|\btitle|\bplaceholder|\balt)\s*:\s*${LITERAL}`, "g"),
  new RegExp(String.raw`\b(?:avisar|anunciar)\(\s*${LITERAL}`, "g"),
];

/** ¿Es un texto visible escrito a mano? (claves, URLs y textos sin letras no cuentan) */
export function esTextoAMano(literal) {
  const sinInterpolar = literal.replace(/\$\{[^}]*\}/g, "");
  if (!/\p{L}/u.test(sinInterpolar)) return false;
  if (/^[a-z][\w-]*(?:\.[\w-]+)+$/.test(sinInterpolar)) return false; // clave del diccionario
  if (/^(?:https?:\/\/|#\/|\/|\.\/)/.test(sinInterpolar)) return false; // URL o ruta
  return true;
}

test("el detector de textos a mano distingue claves, URLs y textos", () => {
  assert.equal(esTextoAMano("Esperaba"), true);
  assert.equal(esTextoAMano("comun.vista.noLista"), false);
  assert.equal(esTextoAMano("#/t/x"), false);
  assert.equal(esTextoAMano("${t('replay.paso')} · ${n}"), false);
  assert.equal(esTextoAMano("${n} pasos"), true);
  assert.equal(esTextoAMano(" · "), false);
});

test("las pantallas no escriben textos visibles a mano", () => {
  const hallados = [];
  for (const carpeta of CARPETAS_DE_PANTALLAS) {
    for (const archivo of archivosJs(path.join(PUBLICO, carpeta))) {
      const lineas = readFileSync(archivo, "utf8").split("\n");
      lineas.forEach((linea, indice) => {
        const recortada = linea.trim();
        if (recortada.startsWith("//") || recortada.startsWith("*") || recortada.startsWith("/*")) return;
        for (const patron of PATRONES) {
          for (const coincidencia of linea.matchAll(patron)) {
            if (esTextoAMano(coincidencia[2])) {
              hallados.push(`${path.relative(PUBLICO, archivo)}:${indice + 1}: ${coincidencia[0].trim()}`);
            }
          }
        }
      });
    }
  }
  assert.deepEqual(hallados, [], `textos a mano (usa t()):\n${hallados.join("\n")}`);
});
