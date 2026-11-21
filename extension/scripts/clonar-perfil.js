// Clona tu perfil real de Firefox en .perfil-dev/ para que `npm run dev:sesion`
// abra con tus sesiones (YouTube, etc.), marcadores y extensiones.
//
// Tu perfil original NO se usa nunca directamente: web-ext le activa preferencias
// inseguras (depuración remota, sin actualizaciones, etc.) y, con los grupos de
// perfiles de Firefox, abrirlo o copiarlo tal cual desconfigura profiles.ini.
//
// Uso:  npm run perfil:clonar [-- --perfil <nombre o ruta>] [--destino <carpeta>] [--si]

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { carpetaFirefox, listarPerfiles, sanitizarPrefs } from "./lib/perfiles-firefox.js";

// node:sqlite imprime un aviso de "experimental" que solo mete ruido.
process.removeAllListeners("warning");
process.on("warning", (w) => w.name !== "ExperimentalWarning" && console.warn(w));

const DESTINO_POR_DEFECTO = fileURLToPath(new URL("../.perfil-dev", import.meta.url));

// Archivos del nivel superior del perfil que no copiamos:
// - candados de "perfil en uso"
// - la sesión (que no se reabran tus pestañas personales)
// - signedInUser.json: sin cuenta de Firefox, Sync no sube las preferencias de
//   desarrollo de web-ext (p. ej. la página de inicio) a tus otros dispositivos
// - cachés y telemetría
const EXCLUIR = new Set([
  ".parentlock", "parent.lock", "lock",
  "sessionstore.jsonlz4", "sessionstore-backups",
  "signedInUser.json",
  "cache2", "startupCache", "shader-cache", "thumbnails",
  "crashes", "minidumps", "datareporting", "saved-telemetry-pings",
]);

const { values: args } = parseArgs({
  options: {
    perfil: { type: "string" },
    destino: { type: "string", default: DESTINO_POR_DEFECTO },
    si: { type: "boolean", default: false },
    ayuda: { type: "boolean", short: "h", default: false },
  },
});

if (args.ayuda) {
  console.log("Uso: npm run perfil:clonar [-- --perfil <nombre o ruta>] [--destino <carpeta>] [--si]");
  process.exit(0);
}

const interactivo = process.stdin.isTTY && !args.si;
const rl = interactivo ? createInterface({ input: process.stdin, output: process.stdout }) : null;
const preguntar = async (texto, porDefecto) => (rl ? (await rl.question(texto)).trim() : "") || porDefecto;

function salir(mensaje) {
  console.error(`\n✖ ${mensaje}`);
  rl?.close();
  process.exit(1);
}

async function elegirOrigen() {
  // Ruta explícita a una carpeta de perfil.
  if (args.perfil && existsSync(path.join(args.perfil, "prefs.js"))) {
    return { nombre: path.basename(args.perfil), ruta: path.resolve(args.perfil) };
  }

  const raiz = carpetaFirefox();
  if (!raiz) salir("No encontré la carpeta de Firefox. Indica la ruta del perfil con --perfil <ruta>.");
  const perfiles = await listarPerfiles(raiz);
  if (perfiles.length === 0) salir(`No encontré perfiles con datos en ${raiz}.`);

  if (args.perfil) {
    const buscado = args.perfil.toLowerCase();
    const perfil = perfiles.find((p) => p.nombre.toLowerCase() === buscado);
    if (!perfil) salir(`No existe el perfil "${args.perfil}". Disponibles: ${perfiles.map((p) => p.nombre).join(", ")}`);
    return perfil;
  }

  const porDefecto = Math.max(0, perfiles.findIndex((p) => p.predeterminado));
  console.log("Perfiles de Firefox encontrados:\n");
  perfiles.forEach((p, i) => console.log(`  ${i + 1}) ${p.nombre}${p.predeterminado ? "  (el que abre Firefox por defecto)" : ""}`));
  const respuesta = await preguntar(`\n¿Cuál clono? [${porDefecto + 1}] `, String(porDefecto + 1));
  const perfil = perfiles[Number(respuesta) - 1];
  if (!perfil) salir(`Opción inválida: ${respuesta}`);
  return perfil;
}

const origen = await elegirOrigen();
const destino = path.resolve(args.destino);

if (destino === origen.ruta) salir("El destino no puede ser el mismo perfil de origen.");

if (existsSync(destino)) {
  console.log(`\n${destino} ya existe y se va a reemplazar. Cierra antes el Firefox de \`npm run dev:sesion\`.`);
  if (!args.si) {
    if (!rl) salir("Usa --si para reemplazarlo sin preguntar.");
    const ok = await preguntar("¿Continuar? [s/N] ", "n");
    if (!/^s/i.test(ok)) salir("Cancelado.");
  }
  rmSync(destino, { recursive: true, force: true });
}
rl?.close();

console.log(`\nClonando "${origen.nombre}" → ${destino}`);
console.log("Si ese perfil está abierto en Firefox, la copia puede salir con datos a medio guardar: mejor ciérralo.");

cpSync(origen.ruta, destino, {
  recursive: true,
  filter: (archivo) => !EXCLUIR.has(path.relative(origen.ruta, archivo)),
});

const prefs = path.join(destino, "prefs.js");
writeFileSync(prefs, sanitizarPrefs(readFileSync(prefs, "utf8")));

console.log("\n✔ Listo. La usan `npm run dev:sesion` y `just local up sesion`.");
