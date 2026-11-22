import { test } from "node:test";
import assert from "node:assert/strict";
import { informe } from "../historial.js";

test("historial: una línea alineada por revisión no vigente y el total, sin archivar nada", () => {
  const texto = informe([
    { url: "https://www.metro.cl/", revision: "b", estado: "done", creada: "2026-11-22T03:35:15.123Z" },
    { url: "https://uchile.cl/", revision: "a-1", estado: "failed", creada: null },
  ]);
  assert.equal(
    texto,
    [
      "https://www.metro.cl/  b    done    2026-11-22T03:35:15.123Z",
      "https://uchile.cl/     a-1  failed  ?",
      "2 revisiones no vigentes (dry-run: no se archivó nada)",
    ].join("\n"),
  );
});
