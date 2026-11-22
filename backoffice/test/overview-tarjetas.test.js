// Revisiones del Overview (spec §3.4, §3.5): pestañas e insignias, cuadritos y medidores con el filtro de
// dispositivo, etapas, motivo, "Up next", "ver todas" y la pista de arranque vacío. El fixture tiene la forma del
// contrato §2 con casos del mock (los mismos sitios y estados que los artboards).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTADO_EN_REVISIONES,
  avisoDeTarjeta,
  colaDeOverview,
  columnasDePista,
  cuadritosDeTarjeta,
  etapasDeTarjeta,
  hayPista,
  insigniaDePestana,
  leerPestana,
  masDePestana,
  medidorDeGoal,
  medidoresDeTarjeta,
  modeloDeTarjeta,
  ordenarTramos,
  seVeEn,
  tandaDeGoal,
  tandaDeTarjeta,
  tarjetasDePestana,
  tonoDeInsignia,
} from "../public/overview/tarjetas.js";

const AHORA = "2026-11-22T03:36:49.000Z";
const intento = (estado, dispositivo) => ({ estado, dispositivo });
const agente = (rol, estado, dispositivo = null) => ({ rol, estado, dispositivo });
const captura = (tanda, carpeta) => ({ tanda, carpeta, archivo: "step_00.png" });

const MOVILSUR = {
  revision: "mwr9xaz3-e22b64",
  url: "https://www.movilsur.test/",
  host: "movilsur.test",
  ruta: "/",
  sitio: "Móvil Sur",
  estado: "running",
  creada: "2026-11-22T03:25:02.031Z",
  actualizada: "2026-11-22T03:36:47.428Z",
  etapas: { catalog: "hecho", guide: "hecho", visitor: "hecho", improver: "en_curso" },
  agentes: [
    agente("cataloger", "logrado"),
    agente("guide", "logrado"),
    agente("guide", "logrado"),
    agente("guide", "logrado"),
    agente("visitor", "fallido", "desktop"),
    agente("visitor", "logrado", "mobile"),
    agente("visitor", "logrado", "desktop"),
    agente("visitor", "abandonado", "desktop"),
    agente("visitor", "error", "mobile"),
    agente("visitor", "abandonado", "mobile"),
    agente("improver", "en_curso"),
  ],
  goals: [
    {
      goal: "cobertura-5g",
      instruccion: "Revisar si hay cobertura 5G en una comuna",
      intentos: [intento("fallido", "desktop"), intento("logrado", "mobile")],
      espera: false,
      tanda: "movilsur.test/visitor/cobertura-5g/2026-11-22T03-28-29Z",
    },
    {
      goal: "dar-de-baja",
      instruccion: "Encontrar cómo dar de baja un plan móvil",
      intentos: [intento("logrado", "desktop"), intento("abandonado", "desktop"), intento("error", "mobile"), intento("abandonado", "mobile")],
      espera: false,
    },
    { goal: "portabilidad", instruccion: "Cambiarse de compañía manteniendo el número", intentos: [intento("logrado", "desktop"), intento("logrado", "mobile"), intento("logrado", "desktop")], espera: false },
  ],
  capturas: {
    desktop: captura("movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z", "desktop"),
    mobile: captura("movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z", "mobile"),
  },
  acento: null,
  motivo: null,
};

const TIENDA = {
  ...MOVILSUR,
  revision: "mwra2k9l-c6aa7d",
  host: "tiendavolcan.test",
  ruta: "/ofertas",
  sitio: "Tienda Volcán",
  creada: "2026-11-22T03:29:07.353Z",
  etapas: { catalog: "hecho", guide: "en_curso", visitor: "en_curso", improver: "pendiente" },
  agentes: [agente("cataloger", "logrado"), agente("guide", "logrado"), agente("guide", "en_curso"), agente("guide", "en_cola"), agente("visitor", "en_curso", "mobile"), agente("visitor", "en_cola"), agente("improver", "en_cola")],
  goals: [
    { goal: "despacho", instruccion: "Averiguar cuánto cuesta el despacho a regiones", intentos: [intento("en_curso", "mobile"), intento("logrado", "desktop")], espera: false },
    { goal: "garantia", instruccion: "Ver qué cubre la garantía extendida de un notebook", intentos: [intento("en_curso", "desktop")], espera: false },
    { goal: "devolver", instruccion: "Devolver un producto", intentos: [], espera: true },
    { goal: "cuarto", instruccion: "Un cuarto goal", intentos: [], espera: true },
    { goal: "quinto", instruccion: "", intentos: [], espera: true },
  ],
};

const BANCO = {
  revision: "mwr3wz54-abd5a1",
  url: "https://www.bancoandino.test/personas",
  host: "bancoandino.test",
  ruta: "/personas",
  sitio: "Banco Andino",
  estado: "stalled",
  creada: "2026-11-22T00:36:49.000Z",
  actualizada: "2026-11-22T00:36:53.936Z",
  etapas: { catalog: "detenido", guide: "pendiente", visitor: "pendiente", improver: "pendiente" },
  agentes: [agente("cataloger", "detenido")],
  goals: [],
  capturas: { desktop: null, mobile: null },
  acento: null,
  motivo: { tipo: "sin_avance", detalle: null },
};

const UNILITORAL = {
  ...BANCO,
  revision: "mwq9ud02-ba22c7",
  host: "unilitoral.test",
  ruta: "/",
  sitio: "Uni Litoral",
  estado: "failed",
  actualizada: "2026-11-21T10:36:49.000Z",
  etapas: { catalog: "fallido", guide: "pendiente", visitor: "pendiente", improver: "pendiente" },
  agentes: [],
  motivo: { tipo: "limite", detalle: "AgentCore429: ThrottlingException: Rate exceeded" },
};

const CLINICA = {
  ...MOVILSUR,
  revision: "mwqzio79-f9166d",
  host: "clinicaaustral.test",
  ruta: "/nosotros",
  sitio: "Clínica Austral",
  estado: "delivered",
  actualizada: "2026-11-21T22:45:55.471Z",
  etapas: { catalog: "hecho", guide: "hecho", visitor: "hecho", improver: "hecho" },
  agentes: [agente("cataloger", "logrado"), agente("visitor", "logrado", "desktop"), agente("improver", "logrado")],
  goals: [{ goal: "isapre", instruccion: "Revisar si la clínica tiene convenio con una isapre", intentos: [intento("logrado", "desktop"), intento("logrado", "desktop")], espera: false }],
  acento: "#007E86",
};

const OVERVIEW = {
  ahora: AHORA,
  disponible: true,
  umbralDetenidaMin: 30,
  cuentas: { total: 90, running: 5, stalled: 1, queued: 2, live: 7, delivered: 65, failed: 18 },
  pestanas: {
    recent: { ids: [TIENDA.revision, MOVILSUR.revision, BANCO.revision, CLINICA.revision, "falta-la-tarjeta"], total: 88 },
    live: { ids: [TIENDA.revision, MOVILSUR.revision, BANCO.revision], total: 3 },
    delivered: { ids: [CLINICA.revision], total: 65 },
    failed: { ids: [UNILITORAL.revision], total: 18 },
  },
  cola: { ids: ["mwracfin-1fb17c", "mwracgf6-dbc496"], total: 9 },
  tarjetas: {
    [MOVILSUR.revision]: MOVILSUR,
    [TIENDA.revision]: TIENDA,
    [BANCO.revision]: BANCO,
    [CLINICA.revision]: CLINICA,
    [UNILITORAL.revision]: UNILITORAL,
    "mwracfin-1fb17c": { ...BANCO, revision: "mwracfin-1fb17c", estado: "queued", host: "aguasdelmaule.test", ruta: "/", sitio: "Aguas del Maule" },
    "mwracgf6-dbc496": { ...BANCO, revision: "mwracgf6-dbc496", estado: "queued", host: "munilospinos.test", ruta: "/tramites", sitio: "Muni Los Pinos" },
  },
};

test("pestañas: un valor desconocido vale recent; el filtro equivalente en #/revisiones", () => {
  assert.equal(leerPestana("failed"), "failed");
  assert.equal(leerPestana("todas"), "recent");
  assert.equal(leerPestana(undefined), "recent");
  assert.deepEqual(ESTADO_EN_REVISIONES, { recent: null, live: "live", delivered: "done", failed: "failed" });
});

test("insignias: Recent nunca; Live con cuentas.live; Delivered y Failed con su cuenta; con 0, ninguna", () => {
  const { cuentas } = OVERVIEW;
  assert.equal(insigniaDePestana("recent", cuentas), null);
  assert.equal(insigniaDePestana("live", cuentas), 7);
  assert.equal(insigniaDePestana("delivered", cuentas), 65);
  assert.equal(insigniaDePestana("failed", cuentas), 18);
  // Arranque vacío (artboard 5): solo Live lleva insignia.
  const primera = { total: 1, running: 1, stalled: 0, queued: 0, live: 1, delivered: 0, failed: 0 };
  assert.deepEqual(["recent", "live", "delivered", "failed"].map((p) => insigniaDePestana(p, primera)), [null, 1, null, null]);
  assert.equal(insigniaDePestana("live", undefined), null);
});

test("tono de la insignia: Live turquesa siempre; Failed roja solo elegida", () => {
  assert.equal(tonoDeInsignia("live", false), "acento");
  assert.equal(tonoDeInsignia("live", true), "acento");
  assert.equal(tonoDeInsignia("failed", false), "neutro");
  assert.equal(tonoDeInsignia("failed", true), "fallido");
  assert.equal(tonoDeInsignia("delivered", true), "neutro");
});

test("filtro de dispositivo: lo que no tiene dispositivo se ve en todos", () => {
  assert.equal(seVeEn("mobile", { dispositivo: null }), true);
  assert.equal(seVeEn("mobile", {}), true);
  assert.equal(seVeEn("mobile", { dispositivo: "desktop" }), false);
  assert.equal(seVeEn("all", { dispositivo: "desktop" }), true);
  assert.equal(seVeEn("desktop", { dispositivo: "desktop" }), true);
});

test("cuadritos de una tarjeta: ordenados, visitantes filtrados por dispositivo, en cola sin contar", () => {
  assert.deepEqual(cuadritosDeTarjeta(MOVILSUR, "all"), {
    estados: ["logrado", "logrado", "logrado", "logrado", "logrado", "logrado", "fallido", "abandonado", "abandonado", "error", "en_curso"],
    n: 11,
  });
  // Mobile: catalogador, 3 guías y diseñador se ven siempre; de los visitantes, solo los móviles.
  assert.deepEqual(cuadritosDeTarjeta(MOVILSUR, "mobile").estados, ["logrado", "logrado", "logrado", "logrado", "logrado", "abandonado", "error", "en_curso"]);
  assert.equal(cuadritosDeTarjeta(MOVILSUR, "desktop").n, 8);
  // En cola (contorno) al final y fuera de la cifra; el visitante en cola (sin dispositivo) se ve en Mobile.
  const tienda = cuadritosDeTarjeta(TIENDA, "mobile");
  assert.deepEqual(tienda.estados, ["logrado", "logrado", "en_curso", "en_curso", "en_cola", "en_cola", "en_cola"]);
  assert.equal(tienda.n, 4);
  assert.deepEqual(cuadritosDeTarjeta(UNILITORAL, "all"), { estados: [], n: 0 });
});

test("tramos: logrado, fallido, abandonó, sin medir, error, detenido, en curso y al final la espera", () => {
  assert.deepEqual(ordenarTramos(["espera", "en_curso", "error", "logrado", "fallido", "sin_medir", "abandonado", "detenido"]), [
    "logrado",
    "fallido",
    "abandonado",
    "sin_medir",
    "error",
    "detenido",
    "en_curso",
    "espera",
  ]);
  assert.deepEqual(ordenarTramos(["en_cola", "raro", "logrado"]), ["logrado", "raro", "espera"]);
});

test("medidor: x/y logrados sobre medidos, con su tono (todos verde, ninguno rojo, mixto naranja)", () => {
  const [cobertura, baja, portabilidad] = MOVILSUR.goals.map((goal) => medidorDeGoal(goal, "all"));
  assert.deepEqual(cobertura.tramos, ["logrado", "fallido"]);
  assert.equal(cobertura.texto, "1/2");
  assert.equal(cobertura.tono, "aviso");
  // El error de la herramienta es un tramo pero no cuenta como medido.
  assert.deepEqual(baja.tramos, ["logrado", "abandonado", "abandonado", "error"]);
  assert.equal(baja.texto, "1/3");
  assert.equal(portabilidad.texto, "3/3");
  assert.equal(portabilidad.tono, "logrado");
  const mobile = medidorDeGoal(MOVILSUR.goals[1], "mobile");
  assert.deepEqual(mobile.tramos, ["abandonado", "error"]);
  assert.equal(mobile.texto, "0/1");
  assert.equal(mobile.tono, "fallido");
  assert.equal(medidorDeGoal({ goal: "x", intentos: [intento("sin_medir", "desktop")] }).texto, "—");
});

test("medidor: «…» si no hay medidos y alguno corre; «—» y barra vacía sin intentos en ese dispositivo", () => {
  const corriendo = medidorDeGoal(TIENDA.goals[1], "all");
  assert.deepEqual(corriendo.tramos, ["en_curso"]);
  assert.equal(corriendo.texto, "…");
  assert.equal(corriendo.tono, "acento");
  // Con intentos medidos, el que corre no tapa la cifra (artboard 5: «1/1» con 3 en curso).
  const mezcla = medidorDeGoal({ goal: "g", intentos: [intento("en_curso", "desktop"), intento("logrado", "desktop")] }, "all");
  assert.equal(mezcla.texto, "1/1");
  // En espera: un tramo de espera y «—».
  const espera = medidorDeGoal(TIENDA.goals[2], "mobile");
  assert.deepEqual(espera.tramos, ["espera"]);
  assert.equal(espera.texto, "—");
  // Telco Pacífico en Mobile (artboard 2): sin visitas móviles → barra vacía y «—».
  const sinMoviles = medidorDeGoal(CLINICA.goals[0], "mobile");
  assert.deepEqual(sinMoviles.tramos, []);
  assert.equal(sinMoviles.texto, "—");
  assert.equal(sinMoviles.tono, "neutro");
});

test("medidores: hasta 3 goals y «+N» con el resto; la instrucción cae al id del goal", () => {
  const { visibles, mas } = medidoresDeTarjeta(TIENDA, "all");
  assert.equal(visibles.length, 3);
  assert.equal(mas, 2);
  assert.equal(visibles[0].instruccion, "Averiguar cuánto cuesta el despacho a regiones");
  assert.equal(medidorDeGoal(TIENDA.goals[4]).instruccion, "quinto");
  assert.deepEqual(medidoresDeTarjeta(BANCO), { visibles: [], mas: 0 });
});

test("etapas: Catalog, Routes, Visits, Theme con la línea fuerte tras una etapa hecha, en curso o fallida", () => {
  assert.deepEqual(etapasDeTarjeta(TIENDA), [
    { fase: "catalog", estado: "hecho", linea: null },
    { fase: "guide", estado: "en_curso", linea: "fuerte" },
    { fase: "visitor", estado: "en_curso", linea: "fuerte" },
    { fase: "improver", estado: "pendiente", linea: "tenue" },
  ]);
  assert.deepEqual(etapasDeTarjeta(BANCO).map((e) => [e.estado, e.linea]), [
    ["detenido", null],
    ["pendiente", "tenue"],
    ["pendiente", "tenue"],
    ["pendiente", "tenue"],
  ]);
  assert.deepEqual(etapasDeTarjeta({ etapas: { catalog: "fallido", guide: "raro" } }).map((e) => e.estado), ["fallido", "pendiente", "pendiente", "pendiente"]);
});

test("motivo (solo sin goals): detenida → sin avance con su duración; fallida → el de la API", () => {
  assert.deepEqual(avisoDeTarjeta(BANCO, AHORA), { tipo: "sin_avance", tono: "aviso", detalle: null, duracion: { unidad: "h", n: 3 } });
  assert.deepEqual(avisoDeTarjeta(UNILITORAL, AHORA), { tipo: "limite", tono: "fallido", detalle: "AgentCore429: ThrottlingException: Rate exceeded", duracion: null });
  assert.equal(avisoDeTarjeta({ ...UNILITORAL, motivo: null }, AHORA).tipo, "error");
  assert.equal(avisoDeTarjeta({ ...UNILITORAL, motivo: { tipo: "catalogador", detalle: "x" } }, AHORA).tipo, "catalogador");
  // Con goals van los medidores, no el motivo; corriendo sin goals tampoco hay motivo.
  assert.equal(avisoDeTarjeta({ ...MOVILSUR, estado: "failed", motivo: { tipo: "disenador" } }, AHORA), null);
  assert.equal(avisoDeTarjeta({ ...MOVILSUR, goals: [] }, AHORA), null);
});

test("modelo de tarjeta: key revisión + dispositivo, tiempo contra `ahora`, acento solo en entregadas y si es hex", () => {
  const modelo = modeloDeTarjeta(MOVILSUR, { dispositivo: "mobile", ahora: AHORA });
  assert.equal(modelo.key, "mwr9xaz3-e22b64:mobile");
  assert.equal(modelo.estado, "running");
  assert.deepEqual(modelo.tiempo, { tipo: "transcurrido", minutos: 11, horas: 0, resto: 11 });
  assert.equal(modelo.acento, null);
  assert.equal(modelo.capturas.desktop.carpeta, "desktop");
  assert.equal(modeloDeTarjeta(CLINICA, { ahora: AHORA }).acento, "#007e86");
  assert.equal(modeloDeTarjeta({ ...CLINICA, acento: "red;background:url(x)" }, { ahora: AHORA }).acento, null);
  assert.equal(modeloDeTarjeta({ ...MOVILSUR, acento: "#007e86" }, { ahora: AHORA }).acento, null);
  assert.equal(modeloDeTarjeta({ ...MOVILSUR, estado: "otro" }, { ahora: AHORA }).estado, "queued");
  assert.deepEqual(modeloDeTarjeta({ ...MOVILSUR, capturas: { desktop: { tanda: "x" }, mobile: null } }).capturas, { desktop: null, mobile: null });
  assert.equal(modeloDeTarjeta({ ...BANCO, sitio: "" }).sitio, "bancoandino.test");
});

test("tarjetas de una pestaña: en el orden de la API, sin las que faltan, hasta 6", () => {
  assert.deepEqual(tarjetasDePestana(OVERVIEW, "recent").map((t) => t.revision), [TIENDA.revision, MOVILSUR.revision, BANCO.revision, CLINICA.revision]);
  assert.deepEqual(tarjetasDePestana(OVERVIEW, "inventada").length, 4);
  assert.deepEqual(tarjetasDePestana({}, "live"), []);
});

test("ver todas: solo si la pestaña tiene más de las que trae, con el filtro de #/revisiones", () => {
  assert.deepEqual(masDePestana(OVERVIEW, "recent"), { total: 88, estado: null });
  assert.deepEqual(masDePestana(OVERVIEW, "delivered"), { total: 65, estado: "done" });
  assert.deepEqual(masDePestana(OVERVIEW, "failed"), { total: 18, estado: "failed" });
  assert.equal(masDePestana(OVERVIEW, "live"), null);
});

test("Up next: las en cola en orden de llegada y cuántas quedan fuera; sin cola, vacía", () => {
  const cola = colaDeOverview(OVERVIEW);
  assert.deepEqual(cola.tarjetas.map((t) => t.sitio), ["Aguas del Maule", "Muni Los Pinos"]);
  assert.equal(cola.mas, 7);
  assert.deepEqual(colaDeOverview({ cola: { ids: [], total: 0 } }), { tarjetas: [], mas: 0 });
});

test("pista de arranque vacío: solo en Recent con menos de 3 revisiones", () => {
  assert.equal(hayPista(OVERVIEW, "recent"), false);
  const primera = { pestanas: { recent: { ids: ["a"], total: 1 } } };
  assert.equal(hayPista(primera, "recent"), true);
  assert.equal(hayPista(primera, "live"), false);
  assert.equal(hayPista({ pestanas: { recent: { ids: [], total: 0 } } }, "recent"), true);
  assert.equal(hayPista({ pestanas: { recent: { ids: ["a", "b", "c"], total: 3 } } }, "recent"), false);
});

test("ancho de la pista: lo que sobra de la fila (2 columnas con 1 tarjeta) o la fila entera", () => {
  assert.equal(columnasDePista(1, 3), 2);
  assert.equal(columnasDePista(0, 3), 3);
  assert.equal(columnasDePista(2, 3), 1);
  assert.equal(columnasDePista(1, 2), 1);
  assert.equal(columnasDePista(2, 2), 2);
  assert.equal(columnasDePista(0, 2), 2);
  assert.equal(columnasDePista(1, 1), 1);
  assert.equal(columnasDePista(0, 1), 1);
  assert.equal(columnasDePista(1, 0), 1);
});

test("enlace de un goal (contrato §6.5): su tanda si sigue el layout; si no, null", () => {
  assert.equal(tandaDeGoal(MOVILSUR.goals[0]), "movilsur.test/visitor/cobertura-5g/2026-11-22T03-28-29Z");
  assert.equal(tandaDeGoal({ goal: "g" }), null);
  assert.equal(tandaDeGoal({ goal: "g", tanda: null }), null);
  assert.equal(tandaDeGoal({ goal: "g", tanda: "../../etc/passwd" }), null);
  assert.equal(tandaDeGoal({ goal: "g", tanda: "movilsur.test/guide/x/desktop/2026-11-22T03-28-29Z" }), null);
  assert.equal(medidorDeGoal(MOVILSUR.goals[0]).tanda, "movilsur.test/visitor/cobertura-5g/2026-11-22T03-28-29Z");
  assert.equal(medidorDeGoal(MOVILSUR.goals[1]).tanda, null);
});

test("la tarjeta lleva a la telaraña del primer goal con tanda; sin ninguna, al avance (tanda null)", () => {
  const conSegunda = { ...MOVILSUR, goals: [MOVILSUR.goals[1], { ...MOVILSUR.goals[2], tanda: "movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z" }, MOVILSUR.goals[0]] };
  assert.equal(tandaDeTarjeta(conSegunda), "movilsur.test/visitor/portabilidad/2026-11-22T03-35-32Z");
  assert.equal(tandaDeTarjeta(MOVILSUR), "movilsur.test/visitor/cobertura-5g/2026-11-22T03-28-29Z");
  // En curso sin Visitante terminado, detenida o fallida antes de las visitas: sin tanda.
  assert.equal(tandaDeTarjeta(TIENDA), null);
  assert.equal(tandaDeTarjeta(BANCO), null);
  assert.equal(tandaDeTarjeta(UNILITORAL), null);
  assert.equal(modeloDeTarjeta(MOVILSUR, { ahora: AHORA }).tanda, "movilsur.test/visitor/cobertura-5g/2026-11-22T03-28-29Z");
  assert.equal(modeloDeTarjeta(BANCO, { ahora: AHORA }).tanda, null);
});
