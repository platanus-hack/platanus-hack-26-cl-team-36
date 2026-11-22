// Copia únicamente los recursos de marca que consume la extensión. --check detecta divergencias sin escribir.
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const kit = resolve(raiz, "docs/marca/chameleonmode-v1");
const extension = resolve(raiz, "extension/src");
const archivos = [
  ["assets/symbol-color.svg", "icons/icon.svg"],
  ["assets/symbol-micro-16.svg", "icons/icon-16.svg"],
  ...[48, 96, 128].map((size) => [`assets/extension-on-${size}.png`, `icons/icon-${size}.png`]),
  ...["on", "off"].flatMap((estado) =>
    [16, 32].map((size) => [`assets/extension-${estado}-${size}.png`, `icons/extension-${estado}-${size}.png`]),
  ),
].map(([origen, destino]) => [resolve(kit, origen), resolve(extension, destino)]);

const comprobar = process.argv.includes("--check");
const diferentes = [];
for (const [origen, destino] of archivos) {
  if (comprobar) {
    const [a, b] = await Promise.all([readFile(origen), readFile(destino).catch(() => null)]);
    if (!b || !a.equals(b)) diferentes.push(destino);
  } else {
    await mkdir(dirname(destino), { recursive: true });
    await copyFile(origen, destino);
  }
}
if (diferentes.length) {
  console.error("Recursos de marca distintos del kit. Ejecuta npm --prefix extension run brand:sync\n" + diferentes.join("\n"));
  process.exitCode = 1;
} else console.log(`${archivos.length} recursos de marca ${comprobar ? "verificados" : "sincronizados"}.`);
