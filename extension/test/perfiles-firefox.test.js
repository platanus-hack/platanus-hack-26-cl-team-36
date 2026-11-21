// Tests de scripts/lib/perfiles-firefox.js (lo que usa `npm run perfil:clonar`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  candidatosCarpetaFirefox,
  listarPerfiles,
  parsearIni,
  sanitizarPrefs,
} from "../scripts/lib/perfiles-firefox.js";

test("parsearIni lee secciones y claves", () => {
  const ini = parsearIni("[General]\nVersion=2\n\n[Profile0]\nName=default-release\nPath=Profiles/a.b=c\n");
  assert.deepEqual(ini, {
    General: { Version: "2" },
    Profile0: { Name: "default-release", Path: "Profiles/a.b=c" },
  });
});

test("sanitizarPrefs quita la asociación al grupo de perfiles y apaga la función", () => {
  const original = [
    'user_pref("browser.profiles.created", true);',
    'user_pref("toolkit.profiles.storeID", "8eb28e81");',
    'user_pref("browser.startup.page", 3);',
    "",
  ].join("\n");
  const limpio = sanitizarPrefs(original);
  assert.ok(!limpio.includes("storeID"));
  assert.ok(!limpio.includes("browser.profiles.created"));
  assert.ok(limpio.includes('user_pref("browser.startup.page", 3);'));
  assert.ok(limpio.endsWith('user_pref("browser.profiles.enabled", false);\n'));
});

test("candidatosCarpetaFirefox según sistema operativo", () => {
  assert.equal(
    candidatosCarpetaFirefox("darwin", "/Users/x")[0],
    path.join("/Users/x", "Library", "Application Support", "Firefox"),
  );
  assert.equal(
    candidatosCarpetaFirefox("win32", "C:\\Users\\x", { APPDATA: "C:\\AppData" })[0],
    path.join("C:\\AppData", "Mozilla", "Firefox"),
  );
  assert.ok(candidatosCarpetaFirefox("linux", "/home/x", {}).includes(path.join("/home/x", ".mozilla", "firefox")));
});

test("listarPerfiles usa profiles.ini, marca el predeterminado y descarta perfiles vacíos", async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "mt-firefox-"));
  try {
    for (const dir of ["Profiles/aaa.default-release", "Profiles/bbb.otro"]) {
      mkdirSync(path.join(raiz, dir), { recursive: true });
      writeFileSync(path.join(raiz, dir, "prefs.js"), "");
    }
    mkdirSync(path.join(raiz, "Profiles/ccc.vacio"), { recursive: true }); // sin prefs.js
    writeFileSync(
      path.join(raiz, "profiles.ini"),
      [
        "[Profile0]", "Name=default-release", "IsRelative=1", "Path=Profiles/aaa.default-release",
        "[Profile1]", "Name=otro", "IsRelative=1", "Path=Profiles/bbb.otro", "Default=1",
        "[Profile2]", "Name=vacio", "IsRelative=1", "Path=Profiles/ccc.vacio",
      ].join("\n"),
    );
    writeFileSync(path.join(raiz, "installs.ini"), "[ABC]\nDefault=Profiles/aaa.default-release\n");

    const perfiles = await listarPerfiles(raiz);
    assert.deepEqual(
      perfiles.map(({ nombre, predeterminado }) => ({ nombre, predeterminado })),
      [
        { nombre: "default-release", predeterminado: true },
        { nombre: "otro", predeterminado: false },
      ],
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
