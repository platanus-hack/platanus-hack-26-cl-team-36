import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aPorcentaje,
  curvaDelCursor,
  mismaPagina,
  planDelPaso,
  rectanguloDeImagen,
  rutaCorta,
  textoDeTecla,
  vectorDeDesplazamiento,
} from "../public/replay/animacion.js";

const viewport = { ancho: 1024, alto: 768 };

const paso = (datos) => ({
  accion: "left_click",
  firma: { tipo: "clic" },
  coordenadas: null,
  urlAntes: "https://sitio.cl/",
  url: "https://sitio.cl/",
  capturaAntes: "step_00.png",
  captura: "step_01.png",
  ...datos,
});

test("rectanguloDeImagen: object-fit contain, centrado, con la escala de la captura", () => {
  // Caja más ancha que la captura: sobra a los lados.
  assert.deepEqual(rectanguloDeImagen(viewport, { ancho: 800, alto: 300 }), { x: 200, y: 0, ancho: 400, alto: 300, escala: 300 / 768 });
  // Caja más alta: sobra arriba y abajo.
  assert.deepEqual(rectanguloDeImagen(viewport, { ancho: 512, alto: 600 }), { x: 0, y: 108, ancho: 512, alto: 384, escala: 0.5 });
  assert.equal(rectanguloDeImagen({ ancho: null, alto: 768 }, { ancho: 10, alto: 10 }), null);
  assert.equal(rectanguloDeImagen(viewport, { ancho: 0, alto: 10 }), null);
});

test("aPorcentaje: el punto del viewport en % de la captura, acercado al borde si se sale", () => {
  assert.deepEqual(aPorcentaje([512, 192], viewport), { x: 50, y: 25 });
  assert.deepEqual(aPorcentaje([2000, -5], viewport), { x: 100, y: 0 });
  assert.equal(aPorcentaje(null, viewport), null);
  assert.equal(aPorcentaje([1, 2], { ancho: 0, alto: 0 }), null);
  assert.equal(aPorcentaje(["a", 2], viewport), null);
});

test("curvaDelCursor: empieza y termina en los puntos y se arquea hacia arriba", () => {
  const { puntos, control } = curvaDelCursor([100, 500], [700, 400], 10);
  assert.equal(puntos.length, 11);
  assert.deepEqual(puntos[0], [100, 500]);
  assert.deepEqual(puntos.at(-1), [700, 400]);
  assert.ok(control[1] < 400, "el punto de control queda sobre los dos extremos");
  assert.ok(Math.min(...puntos.map((p) => p[1])) < 400);
});

test("mismaPagina y rutaCorta: sin # ni barra final; el rótulo sin protocolo ni www", () => {
  assert.equal(mismaPagina("https://a.cl/x/#arriba", "https://a.cl/x"), true);
  assert.equal(mismaPagina("https://a.cl/x", "https://a.cl/y"), false);
  assert.equal(rutaCorta("https://www.metro.cl/el-viaje/horarios/"), "metro.cl/el-viaje/horarios");
  assert.equal(rutaCorta("https://uchile.cl/"), "uchile.cl");
  assert.equal(rutaCorta("https://a.cl/buscar?q=arancel"), "a.cl/buscar?q=arancel");
  assert.equal(rutaCorta(`https://a.cl/${"x".repeat(80)}`).length, 60);
  assert.equal(rutaCorta(""), null);
});

test("planDelPaso: clic con cursor desde el punto anterior (o el centro) y fundido en la misma página", () => {
  const pasos = [paso({ accion: "scroll", coordenadas: [300, 200] }), paso({ coordenadas: [40, 50] })];
  assert.deepEqual(planDelPaso(pasos, 1, { viewport }), {
    tipo: "clic",
    desde: [300, 200],
    hasta: [40, 50],
    direccion: null,
    texto: null,
    tecla: null,
    destino: null,
    cambio: "fundido",
  });
  const primero = planDelPaso([paso({ coordenadas: [40, 50] })], 0, { viewport });
  assert.deepEqual(primero.desde, [512, 384]);
  assert.equal(planDelPaso([paso({ accion: "double_click", coordenadas: [1, 2] })], 0).tipo, "doble_clic");
});

test("planDelPaso: un clic que cambia de URL anima el cambio de página con el rótulo de destino", () => {
  const plan = planDelPaso([paso({ coordenadas: [1, 2], url: "https://www.sitio.cl/tarifas" })], 0, { viewport });
  assert.equal(plan.cambio, "pagina");
  assert.equal(plan.destino, "sitio.cl/tarifas");
});

test("planDelPaso: desplazar con su dirección; sin coordenadas, desde el centro", () => {
  const plan = planDelPaso([paso({ accion: "scroll", firma: { tipo: "desplazar", direccion: "arriba" }, coordenadas: [10, 20] })], 0, { viewport });
  assert.equal(plan.tipo, "desplazar");
  assert.equal(plan.direccion, "arriba");
  assert.deepEqual(plan.hasta, [10, 20]);
  const sinPunto = planDelPaso([paso({ accion: "scroll", firma: { tipo: "desplazar", direccion: null } })], 0, { viewport });
  assert.equal(sinPunto.direccion, "abajo");
  assert.deepEqual(sinPunto.hasta, [512, 384]);
});

test("planDelPaso: escribir junto al último clic de la misma página; si cambió de página, sin punto", () => {
  const pasos = [
    paso({ coordenadas: [929, 41] }),
    paso({ accion: "scroll", coordenadas: [512, 384] }),
    paso({ accion: "type", firma: { tipo: "escribir", objetivo: "arancel anual" } }),
  ];
  const plan = planDelPaso(pasos, 2, { viewport });
  assert.equal(plan.tipo, "escribir");
  assert.equal(plan.texto, "arancel anual");
  assert.deepEqual(plan.hasta, [929, 41]);
  pasos[1] = paso({ accion: "scroll", url: "https://sitio.cl/otra" });
  pasos[2].urlAntes = "https://sitio.cl/otra";
  assert.equal(planDelPaso(pasos, 2, { viewport }).hasta, null);
});

test("planDelPaso: tecla con su nombre; «volver a» y la tecla atrás son un salto con destino", () => {
  const tecla = planDelPaso([paso({ accion: "key", firma: { tipo: "tecla", objetivo: "Enter" }, url: "https://sitio.cl/buscar?q=x" })], 0, { viewport });
  assert.equal(tecla.tipo, "tecla");
  assert.equal(tecla.tecla, "Enter");
  assert.equal(tecla.cambio, "pagina");
  const volver = planDelPaso([paso({ accion: "volver_a_nodo", firma: { tipo: "volver", objetivo: "Inicio" }, url: "https://sitio.cl/x" })], 0);
  assert.equal(volver.tipo, "volver");
  assert.equal(volver.cambio, "volver");
  assert.equal(volver.destino, "Inicio");
  const atras = planDelPaso([paso({ accion: "key", firma: { tipo: "atras" }, titulo: "Portada" })], 0);
  assert.equal(atras.tipo, "volver");
  assert.equal(atras.destino, "Portada");
});

test("planDelPaso: sin captura de antes no hay cambio que animar; paso inexistente es null", () => {
  assert.equal(planDelPaso([paso({ coordenadas: [1, 2], capturaAntes: null })], 0).cambio, null);
  assert.equal(planDelPaso([], 0), null);
  assert.equal(planDelPaso([paso({ accion: "mouse_move" })], 0).tipo, "ninguna");
});

test("textoDeTecla y vectorDeDesplazamiento", () => {
  assert.equal(textoDeTecla("Enter"), "⏎ Enter");
  assert.equal(textoDeTecla("ctrl+l"), "Ctrl + L");
  assert.equal(textoDeTecla("Home"), "Inicio");
  assert.equal(textoDeTecla("Escape"), "Esc");
  assert.deepEqual(vectorDeDesplazamiento("abajo"), [0, -1]);
  assert.deepEqual(vectorDeDesplazamiento("izquierda"), [1, 0]);
  assert.deepEqual(vectorDeDesplazamiento(undefined), [0, -1]);
});
