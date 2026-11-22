import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarUrl } from "../urls.js";

test("esquema y host en minúsculas, sin www., sin / final, sin query ni hash", () => {
  assert.deepEqual(normalizarUrl("HTTPS://WWW.Ejemplo.CL/Ruta/Uno/?q=1#arriba"), {
    url: "https://ejemplo.cl/Ruta/Uno",
    host: "ejemplo.cl",
    pagina: "https://www.ejemplo.cl/Ruta/Uno/",
  });
  assert.equal(normalizarUrl("https://ejemplo.cl/").url, "https://ejemplo.cl");
  assert.equal(normalizarUrl("https://ejemplo.cl").url, "https://ejemplo.cl");
  assert.equal(normalizarUrl("http://ejemplo.cl//").url, "http://ejemplo.cl");
});

test("puerto: el por defecto se omite, otro queda en url y host", () => {
  assert.equal(normalizarUrl("https://ejemplo.cl:443/a").url, "https://ejemplo.cl/a");
  assert.deepEqual(normalizarUrl("http://ejemplo.cl:8080/a/"), {
    url: "http://ejemplo.cl:8080/a",
    host: "ejemplo.cl:8080",
    pagina: "http://ejemplo.cl:8080/a/",
  });
});

test("pagina conserva www y path, sin credenciales, query ni hash", () => {
  assert.equal(normalizarUrl("https://user:clave@WWW.ejemplo.cl/reset/?token=secreto#x").pagina, "https://www.ejemplo.cl/reset/");
});

test("rechaza hosts que no son un sitio público con nombre y URLs demasiado largas", () => {
  for (const url of [
    "http://localhost:8080/a",
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1",
    "http://[::1]/",
    "http://10.0.0.1.",
    "https://mi_sitio.cl",
  ]) {
    assert.throws(() => normalizarUrl(url), TypeError, url);
  }
  assert.throws(() => normalizarUrl(`https://ejemplo.cl/${"a".repeat(2000)}`), TypeError);
});

test("host internacional en punycode, sin credenciales", () => {
  assert.deepEqual(normalizarUrl("https://user:clave@www.ñandú.cl/"), {
    url: "https://xn--and-6ma2c.cl",
    host: "xn--and-6ma2c.cl",
    pagina: "https://www.xn--and-6ma2c.cl/",
  });
});

test("rechaza lo que no es una URL http(s)", () => {
  assert.throws(() => normalizarUrl("no es una url"), TypeError);
  assert.throws(() => normalizarUrl("ftp://ejemplo.cl"), TypeError);
  assert.throws(() => normalizarUrl("javascript:alert(1)"), TypeError);
});
