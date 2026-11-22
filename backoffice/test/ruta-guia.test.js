import assert from "node:assert/strict";
import { test } from "node:test";
import { rutaDeLaGuia } from "../lib/derivar.js";

const IDS = new Map([
  ["https://www.movilsur.test/", "n1"],
  ["https://www.movilsur.test/soporte", "n5"],
  ["https://www.movilsur.test/soporte/dar-de-baja", "n6"],
]);
const paginaDe = (url) => IDS.get(url) ?? null;
const DE_LA_TANDA = [{ titulo: "Inicio - Móvil Sur" }, { titulo: "Planes - Móvil Sur" }, { titulo: "Soporte - Móvil Sur" }];

const ROUTE = {
  status: "verified",
  start: { url: "https://www.movilsur.test/", title: "Inicio - Móvil Sur" },
  steps: [
    { label: "clic «Soporte»", url_before: "https://www.movilsur.test/", url_after: "https://www.movilsur.test/soporte", title_after: "Soporte - Móvil Sur" },
    { label: "scroll", url_after: "https://www.movilsur.test/soporte", title_after: "Soporte - Móvil Sur" },
    { label: "clic «Dar de baja»", url_after: "https://www.movilsur.test/soporte/dar-de-baja", title_after: "Dar de baja - Móvil Sur" },
    { label: "clic «Requisitos para dar de baja»", url_after: "https://www.movilsur.test/soporte/dar-de-baja/requisitos?x=1", title_after: "Requisitos para dar de baja - Móvil Sur" },
  ],
};

test("las páginas de la ruta de la Guía, sin repetidos seguidos, con la acción que lleva a cada una", () => {
  const ruta = rutaDeLaGuia(ROUTE, paginaDe, DE_LA_TANDA);
  assert.equal(ruta.verificada, true);
  assert.deepEqual(ruta.paginas.map((pagina) => pagina.id), ["n1", "n5", "n6", null]);
  assert.deepEqual(ruta.paginas.map((pagina) => pagina.accion), [null, "clic «Soporte»", "clic «Dar de baja»", "clic «Requisitos para dar de baja»"]);
  assert.equal(ruta.paginas[0].tituloTipo, "inicio");
  // La que ningún intento visitó se nombra con su título, sin el sufijo del sitio.
  assert.equal(ruta.paginas[3].tituloCorto, "Requisitos para dar de baja");
  assert.equal(ruta.paginas[3].tituloTipo, "sitio");
});

test("los route.json viejos traen url y title en vez de url_after y title_after", () => {
  const viejo = {
    verified: true,
    start: { url: "https://www.movilsur.test/", title: "Inicio - Móvil Sur" },
    steps: [{ action: "clic «Soporte»", url: "https://www.movilsur.test/soporte", title: "Soporte - Móvil Sur" }],
  };
  const ruta = rutaDeLaGuia(viejo, paginaDe, DE_LA_TANDA);
  assert.deepEqual(ruta.paginas.map((pagina) => [pagina.id, pagina.accion]), [["n1", null], ["n5", "clic «Soporte»"]]);
  assert.equal(ruta.verificada, true);
});

test("sin route.json, sin inicio o sin salir de la página inicial no hay ruta", () => {
  assert.equal(rutaDeLaGuia(null, paginaDe), null);
  assert.equal(rutaDeLaGuia({ steps: [] }, paginaDe), null);
  assert.equal(rutaDeLaGuia({ start: { url: "https://www.movilsur.test/" }, steps: [] }, paginaDe), null);
});
