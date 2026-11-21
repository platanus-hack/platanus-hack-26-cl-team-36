// Encontrar los perfiles de Firefox del dev y preparar una copia segura para desarrollo.
// Lo usa scripts/clonar-perfil.js; las funciones puras se testean en test/.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Dónde guarda Firefox profiles.ini según el sistema operativo.
export function candidatosCarpetaFirefox(plataforma = process.platform, home = os.homedir(), env = process.env) {
  if (plataforma === "darwin") return [path.join(home, "Library", "Application Support", "Firefox")];
  if (plataforma === "win32") return [path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Mozilla", "Firefox")];
  return [
    path.join(home, ".mozilla", "firefox"),
    path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "mozilla", "firefox"),
    path.join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
    path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"),
  ];
}

export function carpetaFirefox() {
  return candidatosCarpetaFirefox().find((c) => existsSync(path.join(c, "profiles.ini"))) ?? null;
}

export function parsearIni(texto) {
  const secciones = {};
  let actual = null;
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith(";") || l.startsWith("#")) continue;
    const seccion = l.match(/^\[(.+)\]$/);
    if (seccion) {
      actual = secciones[seccion[1]] ??= {};
    } else if (actual && l.includes("=")) {
      const i = l.indexOf("=");
      actual[l.slice(0, i)] = l.slice(i + 1);
    }
  }
  return secciones;
}

// Firefox (versión 160 o superior) asocia un perfil a su "grupo de perfiles" con estas
// preferencias. Si una copia las conserva, al abrirla Firefox la registra en el grupo y
// reescribe profiles.ini apuntando a la copia. Las quitamos y apagamos la función.
const PREFS_DE_GRUPO = /^user_pref\("(toolkit|browser)\.profiles\./;

export function sanitizarPrefs(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => !PREFS_DE_GRUPO.test(l));
  while (lineas.length && lineas.at(-1) === "") lineas.pop();
  lineas.push('user_pref("browser.profiles.enabled", false);', "");
  return lineas.join("\n");
}

// Nombres visibles de los perfiles del administrador de perfiles nuevo, que viven en
// "Profile Groups/<storeID>.sqlite" y no en profiles.ini. Si node:sqlite no está
// disponible, devolvemos {} y se usan los nombres de profiles.ini.
async function nombresDeGrupos(raiz, storeIDs) {
  if (storeIDs.size === 0) return {};
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    return {};
  }
  const nombres = {};
  for (const id of storeIDs) {
    const archivo = path.join(raiz, "Profile Groups", `${id}.sqlite`);
    if (!existsSync(archivo)) continue;
    let db;
    try {
      db = new DatabaseSync(archivo, { readOnly: true });
      for (const { path: ruta, name } of db.prepare("SELECT path, name FROM Profiles").all()) {
        nombres[path.resolve(raiz, ruta)] = name;
      }
    } catch {
      // Base bloqueada o con otro formato: seguimos sin esos nombres.
    } finally {
      db?.close();
    }
  }
  return nombres;
}

function rutaPerfil(raiz, { Path: ruta, IsRelative: relativa }) {
  return relativa === "0" ? path.resolve(ruta) : path.resolve(raiz, ruta);
}

// Lista los perfiles reales del dev: [{ nombre, ruta, predeterminado }].
export async function listarPerfiles(raiz) {
  const ini = parsearIni(readFileSync(path.join(raiz, "profiles.ini"), "utf8"));
  const installs = existsSync(path.join(raiz, "installs.ini"))
    ? parsearIni(readFileSync(path.join(raiz, "installs.ini"), "utf8"))
    : {};

  const perfiles = new Map(); // ruta → { nombre, ruta }
  const storeIDs = new Set();
  let predeterminado = null;

  for (const [seccion, datos] of Object.entries(ini)) {
    if (seccion.startsWith("Profile") && datos.Path) {
      const ruta = rutaPerfil(raiz, datos);
      perfiles.set(ruta, { nombre: datos.Name ?? path.basename(ruta), ruta });
      if (datos.StoreID) storeIDs.add(datos.StoreID);
      if (datos.Default === "1") predeterminado ??= ruta;
    }
  }

  // El perfil que Firefox abre por defecto: installs.ini o [Install…] en profiles.ini.
  const instalacion = [...Object.values(installs), ...Object.entries(ini)
    .filter(([s]) => s.startsWith("Install")).map(([, d]) => d)].find((d) => d.Default);
  if (instalacion) predeterminado = path.resolve(raiz, instalacion.Default);

  for (const [ruta, nombre] of Object.entries(await nombresDeGrupos(raiz, storeIDs))) {
    perfiles.set(ruta, { nombre, ruta });
  }

  return [...perfiles.values()]
    .filter((p) => existsSync(path.join(p.ruta, "prefs.js"))) // descarta perfiles vacíos o borrados
    .map((p) => ({ ...p, predeterminado: p.ruta === predeterminado }));
}
