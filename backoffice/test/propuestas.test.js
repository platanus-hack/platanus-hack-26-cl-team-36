import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { armarPropuesta, crearPropuestas, leerTema, SIN_PROPUESTA, vistasDeMejora } from "../lib/propuestas.js";

const TEMA = `/* Tema de Chameleon para movilsur.test. */
html.mi-tema { --mi-acento: #d35609; --mi-fondo: #fbfaf7; --mi-texto: #1f2933; }
html.mi-tema body { background: var(--mi-fondo) !important; color: var(--mi-texto) !important;
  font-size: 112% !important; line-height: 1.6 !important; }
html.mi-tema a { color: var(--mi-acento) !important; text-decoration: underline !important; }
html.mi-tema button, html.mi-tema [role="button"] { min-height: 44px !important; }
`;

test("de tema.css salen los cambios que se pueden mostrar y la paleta, con las variables resueltas", () => {
  const { cambios, paleta } = leerTema(TEMA);
  assert.deepEqual(cambios, [
    { tipo: "texto", porcentaje: 12 },
    { tipo: "interlineado", valor: 1.6 },
    { tipo: "enlaces" },
    { tipo: "objetivos", px: 44 },
  ]);
  assert.deepEqual(paleta, [
    { rol: "fondo", color: "#fbfaf7" },
    { rol: "texto", color: "#1f2933" },
    { rol: "acento", color: "#d35609" },
  ]);
});

test("un tema que no toca nada de eso no inventa cambios; las reglas dentro de @media también cuentan", () => {
  assert.deepEqual(leerTema("html.mi-tema nav { display: none; }"), { cambios: [], paleta: [] });
  const { cambios } = leerTema("@media (max-width: 600px) { html.mi-tema a.boton { min-height: 48px; } }");
  assert.deepEqual(cambios, [{ tipo: "objetivos", px: 48 }]);
  // Una letra más chica o un interlineado apretado no son una mejora que mostrar.
  assert.deepEqual(leerTema("html.mi-tema body { font-size: 90%; line-height: 1; }").cambios, []);
});

test("las vistas de mejora.json solo enlazan capturas vistas/*.png de la misma corrida y marcas válidas", () => {
  const vistas = vistasDeMejora(
    {
      vistas: [
        {
          url: "https://www.movilsur.test/soporte/dar-de-baja",
          titulo: "Dar de baja - Móvil Sur",
          capturas: { desktop: { antes: "vistas/03-desktop-antes.png", despues: "../../otra/tema.png" }, mobile: { antes: "vistas/x.jpg" } },
          marcas: [
            { tipo: "siguiente", dispositivo: "desktop", caja: [0.1, 0.5, 0.4, 0.55] },
            { tipo: "siguiente", dispositivo: "desktop", caja: [0.5, 0.5, 0.4, 0.6] },
            { tipo: "otro", dispositivo: "desktop", caja: [0, 0, 1, 1] },
          ],
        },
        { titulo: "sin url" },
      ],
    },
    "movilsur.test/improver/2026-11-21T16-23-52Z",
  );
  assert.equal(vistas.length, 1);
  assert.deepEqual(vistas[0].capturas, {
    desktop: { antes: "movilsur.test/improver/2026-11-21T16-23-52Z/vistas/03-desktop-antes.png", despues: null },
    mobile: { antes: null, despues: null },
  });
  assert.deepEqual(vistas[0].marcas, [{ tipo: "siguiente", dispositivo: "desktop", caja: [0.1, 0.5, 0.4, 0.55] }]);
});

test("una corrida en curso no trae tema ni vistas; una fallida trae su error", () => {
  const enCurso = armarPropuesta({ runKey: "a.test/improver/2026-11-21T16-23-52Z", manifiesto: { status: "running", started_at: "2026-11-21T16:23:52Z" }, css: TEMA });
  assert.equal(enCurso.estado, "running");
  assert.equal(enCurso.tema, null);
  assert.deepEqual(enCurso.cambios, []);
  const fallida = armarPropuesta({ runKey: "a.test/improver/x", manifiesto: { status: "failed" }, mejora: { error: "TemaVacio: el CSS quedó vacío" } });
  assert.equal(fallida.error, "TemaVacio: el CSS quedó vacío");
});

/** Una fuente en memoria: { "<clave>/<relativa>": contenido } y las subcarpetas de cada clave. */
function fuenteFalsa(archivos) {
  const leidos = [];
  return {
    leidos,
    async listarPerfiles(id) {
      const prefijo = `${id}/`;
      return [...new Set(Object.keys(archivos).filter((clave) => clave.startsWith(prefijo)).map((clave) => clave.slice(prefijo.length).split("/")[0]))];
    },
    async leerJson(id, relativa) {
      leidos.push(`${id}/${relativa}`);
      const valor = archivos[`${id}/${relativa}`];
      return valor && typeof valor === "object" ? structuredClone(valor) : null;
    },
    async abrirArchivo(id, relativa) {
      const valor = archivos[`${id}/${relativa}`];
      if (typeof valor !== "string") return null;
      return { cuerpo: Readable.from([Buffer.from(valor)]), tamano: Buffer.byteLength(valor), rango: null };
    },
  };
}

const TANDA = "movilsur.test/visitor/dar-de-baja/2026-11-21T16-15-43Z";

test("la propuesta de una tanda es la corrida del Diseñador más nueva que la lista en sus inputs", async () => {
  const fuente = fuenteFalsa({
    "movilsur.test/improver/2026-11-20T08-17-52Z/manifest.json": { status: "succeeded", inputs: [TANDA] },
    "movilsur.test/improver/2026-11-21T16-23-52Z/manifest.json": {
      status: "succeeded", inputs: ["movilsur.test/cataloger/2026-11-21T16-11-35Z", TANDA], model: "us.anthropic.claude-sonnet-4-6",
      started_at: "2026-11-21T16:23:52Z", finished_at: "2026-11-21T16:24:55Z", revision: "mwqlv44v-08a4d6",
    },
    "movilsur.test/improver/2026-11-21T16-23-52Z/tema.css": TEMA,
    "movilsur.test/improver/2026-11-21T16-23-52Z/mejora.json": { resumen_tema: "Enlaces que se ven como enlaces.", decisiones: ["subrayar enlaces", ""] },
    "movilsur.test/improver/2026-11-22T03-36-47Z/manifest.json": { status: "running", inputs: ["movilsur.test/visitor/dar-de-baja/2026-11-22T03-32-17Z"] },
  });
  const propuestas = crearPropuestas(fuente);
  const propuesta = await propuestas.deTanda(TANDA);
  assert.equal(propuesta.estado, "succeeded");
  assert.equal(propuesta.corrida, "movilsur.test/improver/2026-11-21T16-23-52Z");
  assert.equal(propuesta.resumen, "Enlaces que se ven como enlaces.");
  assert.deepEqual(propuesta.decisiones, ["subrayar enlaces"]);
  assert.equal(propuesta.tema, "movilsur.test/improver/2026-11-21T16-23-52Z/tema.css");
  assert.equal(propuesta.cambios.length, 4);
  assert.ok(!fuente.leidos.includes("movilsur.test/improver/2026-11-20T08-17-52Z/manifest.json"), "no lee corridas más viejas que la que calza");

  // Cerrada: el segundo pedido sale de memoria.
  fuente.leidos.length = 0;
  await propuestas.deTanda(TANDA);
  assert.deepEqual(fuente.leidos.filter((clave) => clave.includes("16-23-52Z")), []);
});

test("sin una corrida del Diseñador que la lea (o con corridas anteriores a la tanda) no hay propuesta", async () => {
  const fuente = fuenteFalsa({
    "movilsur.test/improver/2026-11-20T08-17-52Z/manifest.json": { status: "succeeded", inputs: [TANDA] },
  });
  assert.deepEqual(await crearPropuestas(fuente).deTanda(TANDA), SIN_PROPUESTA);
});

test("si la mejora partió antes de que terminara la tanda, la propuesta es la corrida de su misma revisión", async () => {
  const tarde = "movilsur.test/visitor/planificar/2026-11-21T16-20-00Z";
  const fuente = fuenteFalsa({
    [`${tarde}/manifest.json`]: { status: "succeeded", revision: "mwqlv44v-08a4d6" },
    // Anterior a la tanda y sin listarla: igual es de su revisión.
    "movilsur.test/improver/2026-11-21T16-18-52Z/manifest.json": { status: "succeeded", inputs: [TANDA], revision: "mwqlv44v-08a4d6" },
    "movilsur.test/improver/2026-11-21T16-18-52Z/tema.css": TEMA,
    "movilsur.test/improver/2026-11-22T03-36-47Z/manifest.json": { status: "succeeded", inputs: [], revision: "otra-000000" },
  });
  const propuestas = crearPropuestas(fuente);
  const propuesta = await propuestas.deTanda(tarde);
  assert.equal(propuesta.estado, "succeeded");
  assert.equal(propuesta.corrida, "movilsur.test/improver/2026-11-21T16-18-52Z");

  // La revisión de la tanda se lee una vez.
  fuente.leidos.length = 0;
  await propuestas.deTanda(tarde);
  assert.ok(!fuente.leidos.includes(`${tarde}/manifest.json`));
});
