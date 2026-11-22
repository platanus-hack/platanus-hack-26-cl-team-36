import assert from "node:assert/strict";
import { test } from "node:test";
import { claveDeUrl, dispositivoDelIntento, evidenciaDeLaTanda, notasDeLaPropuesta, ordenarPorParadas, sufijoDeLaTanda, vistasDeLaPropuesta } from "../public/propuesta/vistas.js";

const URL_DE = { inicio: "https://www.movilsur.test/", soporte: "https://www.movilsur.test/soporte", baja: "https://www.movilsur.test/soporte/dar-de-baja" };
const REQUISITOS = "https://www.movilsur.test/soporte/dar-de-baja/requisitos";

// Tres intentos que se quedan en «Dar de baja» (dos de escritorio y uno móvil) sin tocar «Requisitos».
function intento(id, perfil, ancho) {
  return {
    id,
    perfil,
    viewport: { ancho, alto: 800 },
    resultado: "fallido",
    inicio: { url: URL_DE.inicio, captura: "step_00.png" },
    pasos: [
      { numero: 1, paginaAntes: "inicio", pagina: "soporte", captura: "step_01.png", elemento: "Soporte" },
      { numero: 2, paginaAntes: "soporte", pagina: "baja", captura: "step_02.png", elemento: "Dar de baja" },
      { numero: 3, paginaAntes: "baja", pagina: "equipos", captura: "step_03.png", elemento: "Equipos" },
      { numero: 4, paginaAntes: "equipos", pagina: "baja", captura: "step_04.png", elemento: null },
    ],
  };
}
const TANDA = {
  tarea: "dar-de-baja",
  intentos: [intento("desktop", "desktop", 1024), intento("desktop-2", "desktop", 1024), intento("mobile", "mobile", 390)],
  telarana: {
    paginas: [
      { id: "inicio", titulo: "Inicio - Móvil Sur", tituloCorto: null, tituloTipo: "inicio", url: URL_DE.inicio },
      { id: "soporte", titulo: "Soporte - Móvil Sur", tituloCorto: "Soporte", tituloTipo: "sitio", url: URL_DE.soporte },
      { id: "baja", titulo: "Dar de baja - Móvil Sur", tituloCorto: "Dar de baja", tituloTipo: "sitio", url: URL_DE.baja },
    ],
    ruta: null,
  },
  rutaGuia: {
    paginas: [
      { id: "inicio", url: URL_DE.inicio, accion: null },
      { id: "soporte", url: URL_DE.soporte, accion: "clic «Soporte»" },
      { id: "baja", url: URL_DE.baja, accion: "clic «Dar de baja»" },
      { id: null, url: REQUISITOS, titulo: "Requisitos - Móvil Sur", tituloCorto: "Requisitos", tituloTipo: "sitio", accion: "clic «Requisitos para dar de baja»" },
    ],
  },
};
const CORRIDA = "movilsur.test/improver/2026-11-21T16-23-52Z";
const PROPUESTA = {
  estado: "succeeded",
  cambios: [{ tipo: "texto", porcentaje: 12 }, { tipo: "interlineado", valor: 1.6 }, { tipo: "enlaces" }, { tipo: "objetivos", px: 44 }],
  vistas: [
    {
      url: `${URL_DE.baja}?utm=1`,
      titulo: "Dar de baja - Móvil Sur",
      capturas: { desktop: { antes: `${CORRIDA}/vistas/03-desktop-antes.png`, despues: `${CORRIDA}/vistas/03-desktop-despues.png` }, mobile: { antes: null, despues: null } },
      marcas: [{ tipo: "siguiente", dispositivo: "desktop", caja: [0.1, 0.4, 0.3, 0.6] }],
    },
    {
      url: "https://movilsur.test/planes",
      titulo: "Planes - Móvil Sur",
      capturas: { desktop: { antes: `${CORRIDA}/vistas/09-desktop-antes.png`, despues: null }, mobile: { antes: null, despues: null } },
      marcas: [],
    },
  ],
};

test("claveDeUrl junta la URL de la Guía, la del visitante y la del Diseñador", () => {
  assert.equal(claveDeUrl("https://www.movilsur.test/soporte/?x=1#a"), "movilsur.test/soporte");
  assert.equal(claveDeUrl("http://movilsur.test/Soporte"), "movilsur.test/soporte");
  assert.equal(dispositivoDelIntento({ perfil: "explorador", viewport: { ancho: 390 } }), "mobile");
  assert.equal(dispositivoDelIntento({ perfil: "desktop", viewport: { ancho: 1024 } }), "desktop");
});

test("las vistas siguen la ruta de la Guía; el antes es del Diseñador si lo capturó y si no, de un visitante al llegar", () => {
  const vistas = vistasDeLaPropuesta(TANDA, PROPUESTA);
  // «Requisitos» no tiene captura de nadie: no es una vista. «Planes» solo la capturó el Diseñador: va al final.
  assert.deepEqual(vistas.map((vista) => vista.id), ["inicio", "soporte", "baja", "movilsur.test/planes"]);
  const [inicio, soporte, baja, planes] = vistas;
  assert.deepEqual(inicio.capturas.desktop.antes, { tipo: "intento", intento: "desktop", archivo: "step_00.png" });
  assert.deepEqual(soporte.capturas.mobile.antes, { tipo: "intento", intento: "mobile", archivo: "step_01.png" });
  assert.deepEqual(baja.capturas.desktop, {
    antes: { tipo: "propuesta", clave: `${CORRIDA}/vistas/03-desktop-antes.png` },
    despues: { tipo: "propuesta", clave: `${CORRIDA}/vistas/03-desktop-despues.png` },
  });
  assert.deepEqual(baja.capturas.mobile.antes, { tipo: "intento", intento: "mobile", archivo: "step_02.png" }, "sin captura móvil del Diseñador, la del visitante");
  assert.equal(baja.paradas, 3);
  assert.equal(baja.marcas.length, 1);
  assert.equal(planes.pagina, null);
  assert.equal(planes.datos.tituloCorto, "Planes", "sin el sufijo del sitio");
});

test("la evidencia: dónde se quedaron y cuántos clics le dieron al paso siguiente de la ruta", () => {
  const vistas = vistasDeLaPropuesta(TANDA, PROPUESTA);
  const evidencia = evidenciaDeLaTanda(TANDA, vistas);
  assert.equal(evidencia.vista, "baja");
  assert.equal(evidencia.paradas, 3);
  assert.equal(evidencia.de, 3);
  assert.equal(evidencia.siguiente.texto, "Requisitos para dar de baja");
  assert.equal(evidencia.siguiente.clics, 0);
  const llegaron = { ...TANDA, intentos: TANDA.intentos.map((cada) => ({ ...cada, resultado: "logrado" })) };
  assert.equal(evidenciaDeLaTanda(llegaron, vistasDeLaPropuesta(llegaron, PROPUESTA)), null);
});

test("las notas van en el orden de sus marcas: evidencia (con los enlaces), letra, botones", () => {
  const notas = notasDeLaPropuesta(PROPUESTA, { vista: "baja" });
  assert.deepEqual(notas.map((nota) => [nota.n, nota.tipo, nota.marca]), [[1, "evidencia", "siguiente"], [2, "texto", "texto"], [3, "objetivos", "objetivos"]]);
  assert.deepEqual(notas[0].cambios, [{ tipo: "enlaces" }]);
  // Sin evidencia, los enlaces subrayados son su propia nota; en curso (sin cambios), solo la evidencia.
  assert.deepEqual(notasDeLaPropuesta(PROPUESTA, null).map((nota) => nota.tipo), ["texto", "objetivos", "enlaces"]);
  assert.deepEqual(notasDeLaPropuesta({ estado: "running", cambios: [] }, { vista: "baja" }).map((nota) => nota.tipo), ["evidencia"]);
});

test("el sufijo del sitio sale de una página con título corto", () => {
  assert.equal(sufijoDeLaTanda(TANDA), " - Móvil Sur");
  assert.equal(sufijoDeLaTanda({ telarana: { paginas: [] } }), "");
});

test("el riel de la Propuesta ordena las páginas por cuántos se quedaron, y a igual cifra por la ruta", () => {
  const vistas = [
    { id: "inicio", paradas: 0 },
    { id: "ayuda", paradas: 1 },
    { id: "horario", paradas: 0 },
    { id: "contacto", paradas: 2 },
  ];
  assert.deepEqual(ordenarPorParadas(vistas).map((v) => v.id), ["contacto", "ayuda", "inicio", "horario"]);
  assert.deepEqual(vistas.map((v) => v.id), ["inicio", "ayuda", "horario", "contacto"], "no cambia el arreglo");
});
