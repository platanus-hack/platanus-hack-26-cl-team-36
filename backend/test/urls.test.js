import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarUrl } from "../urls.js";

test("esquema y host en minúsculas, sin www., sin / final, sin query ni hash", () => {
  assert.deepEqual(normalizarUrl("HTTPS://WWW.Ejemplo.CL/Ruta/Uno/?q=1#arriba"), {
    url: "https://ejemplo.cl/Ruta/Uno",
    host: "ejemplo.cl",
  });
  assert.equal(normalizarUrl("https://ejemplo.cl/").url, "https://ejemplo.cl");
  assert.equal(normalizarUrl("https://ejemplo.cl").url, "https://ejemplo.cl");
  assert.equal(normalizarUrl("http://ejemplo.cl//").url, "http://ejemplo.cl");
});

test("puerto: el por defecto se omite, otro queda en url y host", () => {
  assert.equal(normalizarUrl("https://ejemplo.cl:443/a").url, "https://ejemplo.cl/a");
  assert.deepEqual(normalizarUrl("http://localhost:8080/a/"), { url: "http://localhost:8080/a", host: "localhost:8080" });
});

test("host internacional en punycode, sin credenciales", () => {
  assert.deepEqual(normalizarUrl("https://user:clave@www.ñandú.cl/"), {
    url: "https://xn--and-6ma2c.cl",
    host: "xn--and-6ma2c.cl",
  });
});

test("rechaza lo que no es una URL http(s)", () => {
  assert.throws(() => normalizarUrl("no es una url"), TypeError);
  assert.throws(() => normalizarUrl("ftp://ejemplo.cl"), TypeError);
  assert.throws(() => normalizarUrl("javascript:alert(1)"), TypeError);
});
