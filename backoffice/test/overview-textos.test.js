// Tiempos y textos del Overview (spec §3.5, §3.7): todo se mide contra `ahora` de la API, nunca contra el reloj del
// navegador, y todo texto sale de los diccionarios reales (overview y comun, en y es).

import { test } from "node:test";
import assert from "node:assert/strict";
import { crearFormatos } from "../public/nucleo/formato.js";
import { formatear } from "../public/nucleo/i18n.js";
import comunEn from "../public/i18n/en/comun.js";
import comunEs from "../public/i18n/es/comun.js";
import overviewEn from "../public/i18n/en/overview.js";
import overviewEs from "../public/i18n/es/overview.js";
import { modeloDeAgentes } from "../public/overview/agentes.js";
import { modeloDeTarjeta } from "../public/overview/tarjetas.js";
import {
  CLAVE_DE_ESTADO,
  etiquetaDeTarjeta,
  nombreDeEstado,
  resumenDeFila,
  textoDeAviso,
  textoDeDuracion,
  textoDeTiempo,
} from "../public/overview/textos.js";
import { duracionRedondeada, sinAvance, tiempoDeTarjeta, transcurrido } from "../public/overview/tiempo.js";

const AHORA = "2026-11-22T03:36:49.000Z";
const DICCIONARIOS = { en: { comun: comunEn, overview: overviewEn }, es: { comun: comunEs, overview: overviewEs } };
const contexto = (idioma) => ({
  t: (clave, vars) => formatear(DICCIONARIOS, clave, vars, idioma, (falta) => assert.fail(`falta la clave ${falta} en ${idioma}`)),
  fmt: crearFormatos(idioma),
});
const EN = contexto("en");
const ES = contexto("es");

test("transcurrido: minutos con piso desde `creada` hasta `ahora` (nunca negativo)", () => {
  assert.deepEqual(transcurrido("2026-11-22T03:25:02.031Z", AHORA), { minutos: 11, horas: 0, resto: 11 });
  assert.deepEqual(transcurrido("2026-11-22T00:32:49.000Z", AHORA), { minutos: 184, horas: 3, resto: 4 });
  assert.deepEqual(transcurrido("2026-11-22T03:40:00.000Z", AHORA), { minutos: 0, horas: 0, resto: 0 });
  assert.equal(transcurrido("no es fecha", AHORA), null);
  assert.equal(transcurrido("2026-11-22T03:25:02.031Z", null), null);
});

test("pie de una tarjeta que corre: «N min» con piso; desde 1 h, «H h MM min»; bajo 1 min, «<1 min»", () => {
  const corre = (creada) => tiempoDeTarjeta({ estado: "running", creada }, AHORA);
  assert.equal(textoDeTiempo(corre("2026-11-22T03:25:02.031Z"), EN), "11 min");
  assert.equal(textoDeTiempo(corre("2026-11-22T03:34:08.236Z"), EN), "2 min");
  assert.equal(textoDeTiempo(corre("2026-11-22T00:32:49.000Z"), EN), "3 h 04 min");
  assert.equal(textoDeTiempo(corre("2026-11-22T02:36:49.000Z"), ES), "1 h 00 min");
  assert.equal(textoDeTiempo(corre("2026-11-22T03:36:30.000Z"), EN), "<1 min");
  // Detenida y en cola también llevan el transcurrido.
  assert.equal(textoDeTiempo(tiempoDeTarjeta({ estado: "stalled", creada: "2026-11-22T00:36:49.000Z" }, AHORA), EN), "3 h 00 min");
  assert.equal(tiempoDeTarjeta({ estado: "queued", creada: AHORA }, AHORA).tipo, "transcurrido");
});

test("pie de una tarjeta terminada: relativo a `actualizada` contra `ahora` (fmt.tiempoRelativo)", () => {
  const entregada = tiempoDeTarjeta({ estado: "delivered", creada: "2026-11-21T22:33:43.173Z", actualizada: "2026-11-21T22:45:55.471Z" }, AHORA);
  assert.equal(entregada.tipo, "relativo");
  assert.equal(textoDeTiempo(entregada, EN), "5 hr ago");
  assert.equal(textoDeTiempo(entregada, ES), "hace 5 h");
  const fallida = tiempoDeTarjeta({ estado: "failed", actualizada: "2026-11-21T03:30:00.000Z" }, AHORA);
  assert.equal(textoDeTiempo(fallida, EN), "yesterday");
  assert.equal(tiempoDeTarjeta({ estado: "failed" }, AHORA), null);
  assert.equal(textoDeTiempo(null, EN), "");
});

test("«No progress for …» redondeado: minutos bajo 60, horas bajo 24, si no días", () => {
  assert.deepEqual(duracionRedondeada(45 * 60_000), { unidad: "min", n: 45 });
  assert.deepEqual(duracionRedondeada(59.6 * 60_000), { unidad: "h", n: 1 });
  assert.deepEqual(duracionRedondeada((2 * 60 + 59) * 60_000 + 55_000), { unidad: "h", n: 3 });
  assert.deepEqual(duracionRedondeada(23.6 * 3_600_000), { unidad: "d", n: 1 });
  assert.deepEqual(duracionRedondeada(50 * 3_600_000), { unidad: "d", n: 2 });
  assert.deepEqual(duracionRedondeada(-5), { unidad: "min", n: 0 });
  // Banco Andino /personas en el mock: actualizada hace 2 h 59 min 55 s → «No progress for 3 h».
  const banco = { estado: "stalled", goals: [], actualizada: "2026-11-22T00:36:53.936Z" };
  assert.deepEqual(sinAvance(banco, AHORA), { unidad: "h", n: 3 });
  const aviso = modeloDeTarjeta(banco, { ahora: AHORA }).aviso;
  assert.equal(textoDeAviso(aviso, EN.t), "No progress for 3 h");
  assert.equal(textoDeAviso(aviso, ES.t), "Sin avance hace 3 h");
  assert.equal(textoDeDuracion({ unidad: "d", n: 2 }, EN.t), "2 d");
});

test("motivos de falla: cada tipo tiene su texto en en y es; el error crudo no se muestra", () => {
  const fallida = (tipo) => modeloDeTarjeta({ estado: "failed", goals: [], motivo: { tipo, detalle: "AgentCore429: ThrottlingException" } }, { ahora: AHORA }).aviso;
  assert.equal(textoDeAviso(fallida("limite"), EN.t), "Rate limited · AgentCore 429");
  assert.equal(textoDeAviso(fallida("catalogador"), EN.t), "Cataloger failed");
  assert.equal(textoDeAviso(fallida("disenador"), EN.t), "Designer failed");
  for (const tipo of ["limite", "catalogador", "guia", "disenador", "error"]) {
    for (const { t } of [EN, ES]) {
      const texto = textoDeAviso(fallida(tipo), t);
      assert.ok(texto && !texto.startsWith("overview."), `${tipo}: ${texto}`);
      assert.ok(!texto.includes("Throttling"));
    }
  }
});

test("leyenda: Succeeded, Failed, Gave up, Unmeasured, Tool error, Running, Queued (los términos de comun)", () => {
  const estados = ["logrado", "fallido", "abandonado", "sin_medir", "error", "en_curso", "en_cola"];
  assert.deepEqual(estados.map((e) => nombreDeEstado(e, EN.t)), ["Succeeded", "Failed", "Gave up", "Unmeasured", "Tool error", "Running", "Queued"]);
  assert.deepEqual(estados.map((e) => nombreDeEstado(e, ES.t)), ["Logrado", "Fallido", "Abandonado", "Sin medir", "Error de la herramienta", "En curso", "En cola"]);
  assert.equal(CLAVE_DE_ESTADO.abandonado, "comun.resultado.abandonado");
  assert.equal(nombreDeEstado("detenido", EN.t), "Stalled");
  assert.equal(EN.t("overview.leyenda.escala", { k: 3, cifra: "3" }), "1 square = 3 runs");
});

test("vocabulario (spec §3.7): roles, etapas, estados de revisión y dispositivos en en y es", () => {
  const lista = (ctx, grupo, claves) => claves.map((clave) => ctx.t(`overview.${grupo}.${clave}`));
  const ROLES = ["cataloger", "guide", "visitor", "improver"];
  assert.deepEqual(lista(EN, "rol", ROLES), ["Cataloger", "Guide", "Visitors", "Designer"]);
  assert.deepEqual(lista(ES, "rol", ROLES), ["Catalogador", "Guía", "Visitantes", "Diseñador"]);
  const ETAPAS = ["catalog", "guide", "visitor", "improver"];
  assert.deepEqual(lista(EN, "etapa", ETAPAS), ["Catalog", "Routes", "Visits", "Theme"]);
  assert.deepEqual(lista(ES, "etapa", ETAPAS), ["Catálogo", "Rutas", "Visitas", "Tema"]);
  const ESTADOS = ["running", "stalled", "queued", "delivered", "failed"];
  assert.deepEqual(lista(EN, "estado", ESTADOS), ["Running", "Stalled", "Queued", "Delivered", "Failed"]);
  assert.deepEqual(lista(ES, "estado", ESTADOS), ["En curso", "Detenida", "En cola", "Entregada", "Fallida"]);
  const DISPOSITIVOS = ["all", "desktop", "mobile"];
  assert.deepEqual(lista(EN, "dispositivo", DISPOSITIVOS), ["All", "Desktop", "Mobile"]);
  assert.deepEqual(lista(ES, "dispositivo", DISPOSITIVOS), ["Todos", "Escritorio", "Móvil"]);
  assert.equal(EN.t("overview.agentes.unidad", { n: 1286 }), "agents");
  assert.equal(EN.t("overview.agentes.unidad", { n: 1 }), "agent");
});

test("resumen accesible de una fila: «922 visitors: 595 succeeded, 128 failed…»", () => {
  const resumen = {
    roles: {
      cataloger: { logrado: 72, fallido: 9, en_curso: 1 },
      visitor: { all: { logrado: 595, fallido: 128, abandonado: 128, sin_medir: 49, error: 22, en_curso: 0, en_cola: 6 } },
      improver: { en_cola: 1 },
    },
  };
  const filas = Object.fromEntries(modeloDeAgentes(resumen, "all").filas.map((fila) => [fila.rol, fila]));
  assert.equal(
    resumenDeFila(filas.visitor, EN),
    "922 visitors: 595 succeeded, 128 failed, 128 gave up, 49 unmeasured, 22 tool errors, 6 queued. 70% succeeded.",
  );
  assert.equal(resumenDeFila(filas.cataloger, EN), "82 cataloger runs: 72 succeeded, 9 failed, 1 running. 89% succeeded.");
  assert.equal(resumenDeFila(filas.improver, EN), "0 designer runs: 1 queued. Nothing measured yet.");
  assert.equal(resumenDeFila(filas.guide, EN), "0 guide runs: no runs yet. Nothing measured yet.");
  assert.match(
    resumenDeFila(filas.visitor, ES),
    /^922 visitantes: 595 logrados, 128 fallidos, 128 abandonaron, 49 sin medir, 22 con error de la herramienta, 6 en cola\. 70\s?% logrados\.$/u,
  );
});

test("etiqueta accesible de una tarjeta: sitio · dirección · estado · tiempo", () => {
  const modelo = modeloDeTarjeta(
    { revision: "r", host: "movilsur.test", ruta: "/", sitio: "Móvil Sur", estado: "running", creada: "2026-11-22T03:25:02.031Z" },
    { ahora: AHORA },
  );
  assert.equal(etiquetaDeTarjeta(modelo, EN), "Móvil Sur · movilsur.test/ · Running · 11 min");
  assert.equal(etiquetaDeTarjeta(modelo, ES), "Móvil Sur · movilsur.test/ · En curso · 11 min");
});
