// Lectura de agents/.runs/: cada tanda es una carpeta <tarea>/<fecha-hora>/ (o <fecha-hora>/ sin tarea)
// con route_tree.json, criteria.json y una carpeta por perfil con run.json y sus capturas.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { armarTanda, resumirTanda } from "./derivar.js";

const NOMBRE_DE_TANDA = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
const NOMBRE_SEGURO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
// Solo estos archivos de un perfil se sirven al navegador.
export const ARCHIVO_DE_PERFIL = /^(step_\d{2,3}\.png|video\.webm)$/;

async function leerJson(ruta) {
  try {
    return JSON.parse(await readFile(ruta, "utf8"));
  } catch {
    return null;
  }
}

async function subcarpetas(carpeta) {
  try {
    const entradas = await readdir(carpeta, { withFileTypes: true });
    return entradas.filter((e) => e.isDirectory() && NOMBRE_SEGURO.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

// Ids de las tandas, de la más nueva a la más vieja: "wom-baja-fibra/2026-11-21_07-16-33".
export async function idsDeTandas(raiz) {
  const ids = [];
  for (const nombre of await subcarpetas(raiz)) {
    if (NOMBRE_DE_TANDA.test(nombre)) {
      if (existsSync(path.join(raiz, nombre, "route_tree.json"))) ids.push(nombre);
      continue;
    }
    for (const fecha of await subcarpetas(path.join(raiz, nombre))) {
      if (NOMBRE_DE_TANDA.test(fecha) && existsSync(path.join(raiz, nombre, fecha, "route_tree.json"))) {
        ids.push(`${nombre}/${fecha}`);
      }
    }
  }
  const fechaDe = (id) => id.split("/").at(-1);
  return ids.sort((a, b) => (fechaDe(a) < fechaDe(b) ? 1 : fechaDe(a) > fechaDe(b) ? -1 : a < b ? -1 : 1));
}

// Un id solo vale si es una tanda que existe: así ninguna ruta pedida sale de la raíz.
export async function carpetaDeTanda(raiz, id) {
  const ids = await idsDeTandas(raiz);
  return ids.includes(id) ? path.join(raiz, ...id.split("/")) : null;
}

export async function leerTanda(raiz, id) {
  const carpeta = await carpetaDeTanda(raiz, id);
  if (!carpeta) return null;
  const arbol = await leerJson(path.join(carpeta, "route_tree.json"));
  const criterio = await leerJson(path.join(carpeta, "criteria.json"));
  const intentos = [];
  for (const perfil of await subcarpetas(carpeta)) {
    const run = await leerJson(path.join(carpeta, perfil, "run.json"));
    if (!run) continue;
    intentos.push({ perfil, run, video: existsSync(path.join(carpeta, perfil, "video.webm")) });
  }
  // El orden de los perfiles en el evaluador: first_time, hurried, mobile; los demás, por nombre.
  const orden = ["first_time", "hurried", "mobile"];
  const posicion = (perfil) => (orden.includes(perfil) ? orden.indexOf(perfil) : orden.length);
  intentos.sort((a, b) => posicion(a.perfil) - posicion(b.perfil) || (a.perfil < b.perfil ? -1 : 1));
  return armarTanda({ id, arbol, criterio, intentos });
}

export async function listarTandas(raiz) {
  const resumenes = [];
  for (const id of await idsDeTandas(raiz)) {
    const tanda = await leerTanda(raiz, id);
    if (tanda) resumenes.push(resumirTanda(tanda));
  }
  return resumenes;
}

// Ruta en disco de un archivo de un perfil, o null si lo pedido no es una captura o un video de una tanda.
export async function rutaDeArchivo(raiz, id, perfil, archivo) {
  if (!NOMBRE_SEGURO.test(perfil) || !ARCHIVO_DE_PERFIL.test(archivo)) return null;
  const carpeta = await carpetaDeTanda(raiz, id);
  if (!carpeta) return null;
  const ruta = path.join(carpeta, perfil, archivo);
  return existsSync(ruta) ? ruta : null;
}
