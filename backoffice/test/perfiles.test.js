// Perfiles (WP5): escalas, orden y destinos en el Replay (public/perfiles/escalas.js). Sin navegador.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  destinoDeCelda,
  destinoDeIntento,
  destinoDeMetrica,
  dominioDe,
  escalaLineal,
  filasDeIntentos,
  fraccionDeCelda,
  mediana,
  ordenarFilas,
  parsearOrden,
  puntosDeMetrica,
  siguienteOrden,
  textoDeOrden,
  unoPorPerfil,
} from "../public/perfiles/escalas.js";

const paso = (numero, pagina, senales = []) => ({ numero, pagina, senales, captura: `step_${String(numero).padStart(2, "0")}.png` });

/** Tanda mínima con la forma de §3.2: sii-like (ruta de 5 pasos) + un perfil con error de la herramienta. */
function tandaDePrueba() {
  const intentos = [
    {
      id: "first_time", perfil: "first_time", nombrePerfil: "Primera vez", resultado: "logrado", logro: "directo",
      duracion: 22.2, costoUsd: 0.05, hitosAlcanzados: 3, seSepara: null,
      pasos: [paso(1, "n2"), paso(2, "n2"), paso(3, "n2"), paso(4, "n2"), paso(5, "n3"), paso(6, "n3")],
    },
    {
      id: "hurried", perfil: "hurried", nombrePerfil: "Apurado", resultado: "logrado", logro: "indirecto",
      duracion: 40.6, costoUsd: null, hitosAlcanzados: 3, seSepara: { tramo: 2, paso: 4, pagina: "n9", seDetuvo: false },
      pasos: Array.from({ length: 12 }, (_, i) => paso(i + 1, i < 10 ? "n2" : "n3", i === 4 ? ["no_effect"] : [])),
    },
    {
      id: "mobile", perfil: "mobile", nombrePerfil: "Móvil", resultado: "error", logro: null,
      duracion: 13.1, costoUsd: 0.02, hitosAlcanzados: 2, seSepara: { tramo: 2, paso: 4, pagina: null, seDetuvo: true },
      pasos: [paso(1, "n1"), paso(2, "n2"), paso(3, "n2"), paso(4, "n2")],
    },
  ];
  const hito = (pagina, alcanzados, de, pasos, extra = {}) => ({ pagina, alcanzados, de, pasos, salen: [], senalDominante: null, ...extra });
  return {
    intentos,
    telarana: { ruta: { paginas: ["n1", "n2", "n3"], pasosIdeales: 5, segundos: 22.2 } },
    perfiles: [
      {
        perfil: "first_time", nombre: "Primera vez", intentos: ["first_time"], validos: 1, errores: 0, logrados: 1,
        hitos: [hito("n1", 1, 1, [{ intento: "first_time", paso: 0 }]), hito("n2", 1, 1, [{ intento: "first_time", paso: 1 }]), hito("n3", 1, 1, [{ intento: "first_time", paso: 5 }])],
      },
      {
        perfil: "hurried", nombre: "Apurado", intentos: ["hurried"], validos: 1, errores: 0, logrados: 1,
        hitos: [
          hito("n1", 1, 1, [{ intento: "hurried", paso: 0 }]),
          hito("n2", 1, 1, [{ intento: "hurried", paso: 1 }], { senalDominante: "no_effect", salen: [{ intento: "hurried", paso: 4 }] }),
          hito("n3", 1, 1, [{ intento: "hurried", paso: 11 }]),
        ],
      },
      {
        perfil: "mobile", nombre: "Móvil", intentos: ["mobile"], validos: 0, errores: 1, logrados: 0,
        hitos: [hito("n1", 0, 0, []), hito("n2", 0, 0, []), hito("n3", 0, 0, [])],
      },
    ],
  };
}

test("mediana ignora null y da null sin números", () => {
  assert.equal(mediana([3, null, 1, 2]), 2);
  assert.equal(mediana([4, 1, 3, 2]), 2.5);
  assert.equal(mediana([null, undefined]), null);
  assert.equal(mediana([]), null);
});

test("el dominio incluye la referencia de la ruta y deja fuera los null", () => {
  assert.deepEqual(dominioDe([6, 12, 8], { referencia: 5 }), [5, 12]);
  assert.deepEqual(dominioDe([9, 11], { referencia: 20 }), [9, 20]);
  assert.deepEqual(dominioDe([null, 7, undefined, 9]), [7, 9]);
  assert.equal(dominioDe([null, null]), null);
  assert.equal(dominioDe([]), null);
  // Solo la referencia ya da escala (la línea de la ruta se dibuja aunque no haya puntos).
  assert.deepEqual(dominioDe([], { referencia: 8 }), [7, 9]);
});

test("conteos desde cero, y un dominio de un solo valor se abre", () => {
  assert.deepEqual(dominioDe([0, 1, 0], { desdeCero: true }), [0, 1]);
  assert.deepEqual(dominioDe([0, 0], { desdeCero: true }), [0, 1]);
  assert.deepEqual(dominioDe([4, 4], { referencia: 4, desdeCero: true }), [0, 4]);
  const [minimo, maximo] = dominioDe([5, 5]);
  assert.ok(minimo < 5 && maximo > 5);
});

test("la escala lineal acota y no inventa valores para null", () => {
  const escala = escalaLineal([5, 12]);
  assert.equal(escala(5), 0);
  assert.equal(escala(12), 1);
  assert.equal(escala(8.5), 0.5);
  assert.equal(escala(20), 1);
  assert.equal(escala(null), null);
  assert.equal(escala(undefined), null);
});

test("sii Apurado: su punto de pasos queda a la derecha de la línea de la ruta (12 contra 5)", () => {
  const { dominio, referencia, filas } = puntosDeMetrica(tandaDePrueba(), "pasos");
  assert.equal(referencia, 5);
  assert.deepEqual(dominio, [5, 12]);
  const escala = escalaLineal(dominio);
  const apurado = filas.find((fila) => fila.perfil === "hurried").puntos[0];
  assert.equal(apurado.valor, 12);
  assert.ok(escala(apurado.valor) > escala(referencia));
});

test("los intentos con error no dan puntos ni entran a la escala, pero se cuentan aparte", () => {
  const { dominio, filas } = puntosDeMetrica(tandaDePrueba(), "tiempo");
  const movil = filas.find((fila) => fila.perfil === "mobile");
  assert.deepEqual(movil.puntos, []);
  assert.equal(movil.errores, 1);
  assert.deepEqual(dominio, [22.2, 40.6]); // 13.1 s del intento con error no está
  const tropiezos = puntosDeMetrica(tandaDePrueba(), "tropiezos");
  assert.deepEqual(tropiezos.dominio, [0, 1]);
  assert.equal(tropiezos.referencia, null);
  const hitos = puntosDeMetrica(tandaDePrueba(), "hitos");
  assert.equal(hitos.referencia, 3);
  assert.deepEqual(hitos.dominio, [0, 3]);
});

test("filas de la tabla: null es «no aplica», nunca 0", () => {
  const filas = filasDeIntentos(tandaDePrueba());
  const movil = filas.find((fila) => fila.id === "mobile");
  assert.equal(movil.error, true);
  for (const campo of ["pasos", "delta", "hitos", "tropiezos", "segundos"]) assert.equal(movil[campo], null, campo);
  assert.equal(movil.motivoDelta, "error");
  assert.equal(movil.costo, 0.02); // el costo sí existe aunque la herramienta haya fallado
  const apurado = filas.find((fila) => fila.id === "hurried");
  assert.equal(apurado.delta, 7);
  assert.equal(apurado.tropiezos, 1);
  assert.deepEqual(apurado.hitos, { n: 3, de: 3 });
  assert.equal(apurado.costo, null);
  const sinRuta = filasDeIntentos({ ...tandaDePrueba(), telarana: { ruta: null } });
  assert.equal(sinRuta[0].delta, null);
  assert.equal(sinRuta[0].motivoDelta, "sinRuta");
  assert.equal(sinRuta[0].hitos, null);
});

test("orden: parsear, alternar y volver a texto", () => {
  assert.deepEqual(parsearOrden("-pasos"), { columna: "pasos", descendente: true });
  assert.deepEqual(parsearOrden("costo"), { columna: "costo", descendente: false });
  assert.equal(parsearOrden("radar"), null);
  assert.equal(parsearOrden(""), null);
  assert.equal(parsearOrden(undefined), null);
  assert.deepEqual(siguienteOrden(null, "pasos"), { columna: "pasos", descendente: false });
  assert.deepEqual(siguienteOrden({ columna: "pasos", descendente: false }, "pasos"), { columna: "pasos", descendente: true });
  assert.deepEqual(siguienteOrden({ columna: "pasos", descendente: true }, "tiempo"), { columna: "tiempo", descendente: false });
  assert.equal(textoDeOrden({ columna: "pasos", descendente: true }), "-pasos");
  assert.equal(textoDeOrden(null), null);
});

test("ordenar es estable y deja los null al final en ambas direcciones", () => {
  const filas = filasDeIntentos(tandaDePrueba());
  const ids = (orden) => ordenarFilas(filas, orden).map((fila) => fila.id);
  assert.deepEqual(ids(null), ["first_time", "hurried", "mobile"]);
  assert.deepEqual(ids({ columna: "pasos", descendente: false }), ["first_time", "hurried", "mobile"]);
  assert.deepEqual(ids({ columna: "pasos", descendente: true }), ["hurried", "first_time", "mobile"]);
  assert.deepEqual(ids({ columna: "costo", descendente: true }), ["first_time", "mobile", "hurried"]);
  assert.deepEqual(ids({ columna: "resultado", descendente: false }), ["first_time", "hurried", "mobile"]);
  // Empates: se conserva el orden de la API.
  const iguales = filas.map((fila) => ({ ...fila, pasos: 4 }));
  assert.deepEqual(ordenarFilas(iguales, { columna: "pasos", descendente: true }).map((fila) => fila.id), ["first_time", "hurried", "mobile"]);
  // No muta la lista recibida.
  const copia = [...filas];
  ordenarFilas(filas, { columna: "pasos", descendente: true });
  assert.deepEqual(filas, copia);
});

test("cada intento abre el Replay en un paso con sentido", () => {
  const [primera, apurado, movil] = tandaDePrueba().intentos;
  assert.deepEqual(destinoDeIntento(primera), { intento: "first_time", paso: 6 }); // la respuesta
  assert.deepEqual(destinoDeIntento(apurado), { intento: "hurried", paso: 4 }); // donde deja la ruta
  assert.deepEqual(destinoDeIntento(movil), { intento: "mobile", paso: 4 }); // donde falló la herramienta
  assert.deepEqual(destinoDeIntento({ id: "x", pasos: [] }), { intento: "x", paso: 1 });
});

test("cada celda del mapa lleva a dónde sale, a la señal o a la llegada", () => {
  const tanda = tandaDePrueba();
  const [primera, apurado, movil] = tanda.perfiles;
  assert.deepEqual(destinoDeCelda(primera, 0, tanda), { intento: "first_time", paso: 1, modo: "antes" }); // empieza ahí
  assert.deepEqual(destinoDeCelda(primera, 2, tanda), { intento: "first_time", paso: 5 });
  assert.deepEqual(destinoDeCelda(apurado, 1, tanda), { intento: "hurried", paso: 4 }); // sale aquí
  const sinSalida = structuredClone(tanda);
  sinSalida.perfiles[1].hitos[1].salen = [];
  assert.deepEqual(destinoDeCelda(sinSalida.perfiles[1], 1, sinSalida), { intento: "hurried", paso: 5 }); // la señal
  assert.deepEqual(destinoDeCelda(movil, 1, tanda), { intento: "mobile", paso: 4 }); // solo error: su último paso
  assert.equal(fraccionDeCelda(movil.hitos[1]), null);
  assert.equal(fraccionDeCelda(primera.hitos[1]), 1);
});

test("nota de honestidad: todos los perfiles con a lo sumo 1 intento válido", () => {
  assert.equal(unoPorPerfil(tandaDePrueba()), true);
  const dos = tandaDePrueba();
  dos.perfiles[0].validos = 2;
  assert.equal(unoPorPerfil(dos), false);
  assert.equal(unoPorPerfil({ perfiles: [] }), false);
});

test("cada punto de una métrica abre el paso que la explica, no el último", () => {
  const intento = {
    id: "mobile",
    resultado: "logrado",
    pasos: Array.from({ length: 12 }, (_, i) => ({ numero: i + 1, senales: i === 3 ? ["no_effect"] : [] })),
    demoras: [{ desdePaso: 1, pasos: 6 }],
  };
  assert.deepEqual(destinoDeMetrica(intento, "tropiezos"), { intento: "mobile", paso: 4 });
  assert.deepEqual(destinoDeMetrica(intento, "pasos"), { intento: "mobile", paso: 1 });
  assert.deepEqual(destinoDeMetrica(intento, "tiempo"), { intento: "mobile", paso: 1 });
  assert.deepEqual(destinoDeMetrica(intento, "hitos"), { intento: "mobile", paso: 12 });
  assert.deepEqual(destinoDeMetrica({ ...intento, demoras: [], pasos: intento.pasos.map((p) => ({ ...p, senales: [] })) }, "tropiezos"), {
    intento: "mobile", paso: 12,
  });
});

// ── Nombres cortos: el nivel nunca es lo que se corta ──────────────────────────────────────────────────────────

test("etiquetas de perfiles: el nivel va aparte y se quitan las palabras que comparten todos", async () => {
  const { etiquetasDePerfiles, partirNombre } = await import("../public/perfiles/nombres.js");
  assert.deepEqual(partirNombre("Explorador del pie (conoce el tema)"), { base: "Explorador del pie", nivel: "conoce el tema" });
  assert.deepEqual(partirNombre("Apurado"), { base: "Apurado", nivel: null });
  const nombres = ["buscador", "contenido", "menu", "pie"].flatMap((lugar) => {
    const base = { buscador: "Explorador buscador", contenido: "Explorador del contenido", menu: "Explorador del menú", pie: "Explorador del pie" }[lugar];
    return [`${base} (conoce el tema)`, `${base} (sin contexto)`];
  });
  const etiquetas = etiquetasDePerfiles(nombres);
  assert.deepEqual(etiquetas.get("Explorador del contenido (sin contexto)"), { completo: "Explorador del contenido (sin contexto)", base: "Contenido", nivel: "sin contexto" });
  assert.equal(etiquetas.get("Explorador buscador (conoce el tema)").base, "Buscador");
  // Ningún par de perfiles queda con la misma etiqueta visible.
  const visibles = nombres.map((nombre) => `${etiquetas.get(nombre).base} · ${etiquetas.get(nombre).nivel}`);
  assert.equal(new Set(visibles).size, nombres.length);
  // Sin nada en común (los perfiles de siempre), los nombres quedan como están.
  const comunes = etiquetasDePerfiles(["Primera vez", "Apurado", "Móvil"]);
  assert.deepEqual([...comunes.values()].map((e) => e.base), ["Primera vez", "Apurado", "Móvil"]);
  // Un solo perfil, o uno que quedaría vacío: tampoco se recorta.
  assert.equal(etiquetasDePerfiles(["Explorador del pie (sin contexto)"]).get("Explorador del pie (sin contexto)").base, "Explorador del pie");
  assert.equal(etiquetasDePerfiles(["Explorador", "Explorador del pie"]).get("Explorador").base, "Explorador");
});
