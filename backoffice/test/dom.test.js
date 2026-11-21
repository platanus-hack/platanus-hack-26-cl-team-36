import { test } from "node:test";
import assert from "node:assert/strict";
import { esUrlWeb } from "../public/nucleo/dom.js";

test("solo http(s) se vuelve enlace", () => {
  assert.equal(esUrlWeb("https://wom.cl/centro-de-ayuda"), true);
  assert.equal(esUrlWeb("http://ejemplo.test/"), true);
  for (const url of ["javascript:alert(1)", "data:text/html,hola", "JaVaScRiPt:alert(1)", "/relativa", "", null, "file:///etc/passwd"]) {
    assert.equal(esUrlWeb(url), false, String(url));
  }
});
