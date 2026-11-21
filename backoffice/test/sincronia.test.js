import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VELOCIDADES,
  agruparRepetidos,
  cambiarVelocidad,
  duracionTotal,
  esProblema,
  formatoReloj,
  pasoEnSegundo,
  posicionDelClic,
  saltoSoloPasos,
  segmentosSoloPasos,
  siguienteConProblema,
  ventanasDePasos,
} from "../public/replay/sincronia.js";

// Tiempos como los de wom first_time (pasos 1–4).
const PASOS = [
  { numero: 1, segundos: 6.8, duracion: 6.8 },
  { numero: 2, segundos: 10.26, duracion: 3.46 },
  { numero: 3, segundos: 12.59, duracion: 2.33 },
  { numero: 4, segundos: 15.11, duracion: 2.52 },
];

const cerca = (a, b) => Math.abs(a - b) < 1e-9;

test("ventanasDePasos: desde = segundos − duración (nunca negativo), hasta = segundos", () => {
  const ventanas = ventanasDePasos(PASOS);
  assert.equal(ventanas.length, 4);
  assert.deepEqual(ventanas.map((v) => v.numero), [1, 2, 3, 4]);
  assert.equal(ventanas[0].desde, 0);
  assert.equal(ventanas[0].hasta, 6.8);
  assert.ok(cerca(ventanas[1].desde, 6.8));
  assert.equal(ventanas[3].hasta, 15.11);
  assert.equal(ventanasDePasos([{ numero: 1, segundos: 2, duracion: 5 }])[0].desde, 0);
  assert.deepEqual(ventanasDePasos([]), []);
  assert.deepEqual(ventanasDePasos(null), []);
});

test("ventanasDePasos: un paso sin tiempos hereda el final del anterior", () => {
  const ventanas = ventanasDePasos([{ numero: 1, segundos: 4, duracion: 4 }, { numero: 2, segundos: null, duracion: null }, { numero: 3, segundos: 9, duracion: 2 }]);
  assert.deepEqual(ventanas[1], { numero: 2, desde: 4, hasta: 4 });
  assert.deepEqual(ventanas[2], { numero: 3, desde: 7, hasta: 9 });
});

test("duracionTotal: el mayor entre la duración del intento y el final del último paso", () => {
  assert.equal(duracionTotal({ duracion: 41.3, pasos: PASOS }), 41.3);
  assert.equal(duracionTotal({ duracion: 0, pasos: PASOS }), 15.11);
  assert.equal(duracionTotal({ duracion: null, pasos: PASOS }), 15.11);
  assert.equal(duracionTotal({ duracion: 3, pasos: [] }), 3);
  assert.equal(duracionTotal({}), 0);
});

test("pasoEnSegundo: antes del primero, dentro, en huecos y después del último", () => {
  const ventanas = ventanasDePasos(PASOS);
  assert.equal(pasoEnSegundo(ventanas, -1), 0); // antes del primero
  assert.equal(pasoEnSegundo(ventanas, 0), 0);
  assert.equal(pasoEnSegundo(ventanas, 6.79), 0);
  assert.equal(pasoEnSegundo(ventanas, 6.8), 1); // el paso 2 empieza donde termina el 1
  assert.equal(pasoEnSegundo(ventanas, 11), 2);
  assert.equal(pasoEnSegundo(ventanas, 100), 3); // después del último
  // Con un hueco entre ventanas, el paso anterior se sigue viendo hasta que empieza el siguiente.
  const conHueco = [
    { numero: 1, desde: 0, hasta: 2 },
    { numero: 2, desde: 5, hasta: 6 },
  ];
  assert.equal(pasoEnSegundo(conHueco, 3.5), 0);
  assert.equal(pasoEnSegundo(conHueco, 5), 1);
  assert.equal(pasoEnSegundo([], 3), -1);
});

test("siguienteConProblema: hacia adelante, hacia atrás y sin ninguno", () => {
  // sii hurried: el paso 5 (índice 4) es "sin efecto".
  const pasos = Array.from({ length: 12 }, (_, i) => ({ numero: i + 1, senales: i === 4 ? ["no_effect"] : [], carril: "en-ruta" }));
  assert.equal(siguienteConProblema(pasos, 0, 1), 4);
  assert.equal(siguienteConProblema(pasos, 4, 1), null);
  assert.equal(siguienteConProblema(pasos, 11, -1), 4);
  assert.equal(siguienteConProblema(pasos, 4, -1), null);
  pasos[8].carril = "fuera-de-ruta";
  assert.equal(siguienteConProblema(pasos, 4, 1), 8);
  assert.equal(siguienteConProblema([], 0, 1), null);
  assert.equal(esProblema({ senales: [], carril: "sin-ruta" }), false);
  assert.equal(esProblema({ senales: ["went_back"] }), true);
});

test("agruparRepetidos: firmas iguales seguidas en la misma página van juntas", () => {
  const desplazar = { tipo: "desplazar", objetivo: null, direccion: "abajo", cantidad: 10, x: 500, y: 509 };
  const pasos = [
    { firma: { tipo: "clic", objetivo: "Exención", x: 500, y: 509 }, pagina: "n2" },
    { firma: desplazar, pagina: "n2" },
    { firma: { ...desplazar, x: 1, y: 2 }, pagina: "n2" }, // el puntero no cuenta en un desplazamiento
    { firma: desplazar, pagina: "n2" },
    { firma: desplazar, pagina: "n3" }, // otra página: otro grupo
    { firma: { tipo: "desplazar", direccion: "arriba", cantidad: 10 }, pagina: "n3" },
  ];
  assert.deepEqual(
    agruparRepetidos(pasos).map(({ desde, hasta }) => [desde, hasta]),
    [[0, 0], [1, 3], [4, 4], [5, 5]],
  );
  assert.equal(agruparRepetidos(pasos)[1].firma, desplazar);
  // Clic en coordenadas: solo se agrupan si son las mismas.
  const enCoordenadas = (x, y) => ({ firma: { tipo: "clic_coordenadas", x, y } });
  assert.equal(agruparRepetidos([enCoordenadas(1, 2), enCoordenadas(1, 2), enCoordenadas(3, 4)]).length, 2);
  assert.deepEqual(agruparRepetidos([]), []);
});

test("segmentosSoloPasos: ventanas ampliadas y unidas cuando se tocan", () => {
  const ventanas = [
    { desde: 0, hasta: 1 },
    { desde: 2, hasta: 3 }, // [1.5, 4.5] toca [0, 2.5]
    { desde: 10, hasta: 11 },
    { desde: 30, hasta: 30 },
  ];
  assert.deepEqual(segmentosSoloPasos(ventanas), [[0, 4.5], [9.5, 12.5], [29.5, 31.5]]);
  assert.deepEqual(segmentosSoloPasos(ventanas, 0, 0), [[0, 1], [2, 3], [10, 11], [30, 30]]);
  assert.deepEqual(segmentosSoloPasos([]), []);
});

test("saltoSoloPasos: dentro se queda, en un hueco salta al tramo siguiente, al final se detiene", () => {
  const segmentos = [[0, 4.5], [9.5, 12.5]];
  assert.equal(saltoSoloPasos(segmentos, 3), 3);
  assert.equal(saltoSoloPasos(segmentos, 5), 9.5);
  assert.equal(saltoSoloPasos(segmentos, 12.5), 12.5);
  assert.equal(saltoSoloPasos(segmentos, 13), null);
  assert.equal(saltoSoloPasos([], 1), null);
});

test("un intento con video y marcas de tiempo: cada segundo del video cae en su paso, con desfase", () => {
  // Intento sintético grabado con --record-video: el video empieza `desfase` segundos antes del intento.
  const intento = {
    video: true,
    duracion: 20,
    pasos: [
      { numero: 1, segundos: 5, duracion: 5, senales: [] },
      { numero: 2, segundos: 9, duracion: 4, senales: ["no_effect"] },
      { numero: 3, segundos: 18, duracion: 3, senales: [] },
    ],
  };
  const desfase = 1.5;
  const ventanas = ventanasDePasos(intento.pasos);
  const enVideo = (segundoDelVideo) => pasoEnSegundo(ventanas, segundoDelVideo - desfase);
  assert.equal(enVideo(0), 0); // la carga inicial, antes del intento
  assert.equal(enVideo(6.6), 1);
  assert.equal(enVideo(15), 1); // hueco entre el paso 2 (termina en 9) y el 3 (empieza en 15)
  assert.equal(enVideo(16.6), 2);
  assert.equal(duracionTotal(intento), 20);
  // Seleccionar un paso lleva el video a su comienzo.
  assert.equal(ventanas[2].desde + desfase, 16.5);
  // "Solo pasos" se salta el hueco largo entre el paso 2 y el 3.
  const segmentos = segmentosSoloPasos(ventanas);
  assert.deepEqual(segmentos, [[0, 10.5], [14.5, 19.5]]);
  assert.equal(saltoSoloPasos(segmentos, 12), 14.5);
  assert.equal(siguienteConProblema(intento.pasos, 0, 1), 1);
});

test("velocidades, reloj y anillo del clic", () => {
  assert.deepEqual(VELOCIDADES, [0.5, 1, 2, 4]);
  assert.equal(cambiarVelocidad(1, 1), 2);
  assert.equal(cambiarVelocidad(4, 1), 4);
  assert.equal(cambiarVelocidad(0.5, -1), 0.5);
  assert.equal(cambiarVelocidad(3, -1), 0.5);
  assert.equal(formatoReloj(13.7), "0:13");
  assert.equal(formatoReloj(65), "1:05");
  assert.equal(formatoReloj(null), "0:00");
  const viewport = { ancho: 1024, alto: 768 };
  assert.deepEqual(posicionDelClic({ firma: { tipo: "clic" }, coordenadas: [512, 192] }, viewport), { x: 50, y: 25 });
  assert.deepEqual(posicionDelClic({ firma: { tipo: "clic_coordenadas" }, coordenadas: [2000, -5] }, viewport), { x: 100, y: 0 });
  assert.equal(posicionDelClic({ firma: { tipo: "desplazar" }, coordenadas: [200, 572] }, viewport), null);
  assert.equal(posicionDelClic({ firma: { tipo: "escribir" }, coordenadas: null }, viewport), null);
  assert.equal(posicionDelClic({ firma: { tipo: "clic" }, coordenadas: null }, viewport), null);
  assert.equal(posicionDelClic({ firma: { tipo: "clic" }, coordenadas: [1, 1] }, null), null);
});
