// Backoffice: punto de entrada. Arma el idioma, el armazón, la paleta, los atajos globales y el enrutador.
// Las pantallas viven en pantallas/<id>.js y se cargan bajo demanda (nucleo/enrutador.js).

import { abrirHojaDeAtajos, registrarAtajos } from "./nucleo/atajos.js";
import { copiarEnlace } from "./nucleo/avisos.js";
import { pedirTandas } from "./nucleo/datos.js";
import { EVENTO_RUTA, iniciarEnrutador, navegar } from "./nucleo/enrutador.js";
import { cambiarIdioma, fmt, idioma, iniciarI18n, t } from "./nucleo/i18n.js";
import { abrirPaleta, iniciarPaleta, registrarFuenteDePaleta } from "./nucleo/paleta.js";
import { enlaceARevisiones, enlaceATanda, extraerIdioma, hashDe } from "./nucleo/rutas.js";
import { iniciarShell } from "./nucleo/shell.js";

const ICONO_DE_ESTADO = { logrado: "logrado", fallido: "fallido", sin_medir: "sin-medir", error: "error-herramienta" };
const IR_AL_OVERVIEW = hashDe({ tipo: "overview" });
const IR_A_CORRIDAS = hashDe({ tipo: "corridas" });

/** Las tandas que conoce la paleta: la última lista que dio pedirTandas() (que guarda su propia caché). */
let tandas = [];

function recordarTandas() {
  pedirTandas()
    .then((datos) => {
      tandas = datos.tandas;
    })
    .catch(() => {});
}

/** Estado de una tanda para su ícono en la paleta, con respaldo para la forma anterior de la API. */
function estadoDeTanda(resumen) {
  const intentos = typeof resumen.intentos === "number" ? resumen.intentos : 0;
  const errores = resumen.errores ?? 0;
  const validos = resumen.validos ?? intentos - errores;
  const medidos = resumen.medidos ?? validos;
  const logrados = resumen.logrados ?? resumen.exitos ?? 0;
  if (validos === 0) return "error";
  if (medidos === 0) return "sin_medir";
  return medidos > logrados ? "fallido" : errores ? "error" : "logrado";
}

function opcionesDeTandas() {
  return tandas.map((resumen) => {
    const fecha = resumen.fechaIso ?? resumen.fecha;
    return {
      id: `tandas:${resumen.id}`,
      grupo: "tandas",
      titulo: resumen.tarea ?? resumen.host ?? resumen.id,
      subtitulo: [fmt.fechaCorta(fecha), resumen.host].filter(Boolean).join(" · "),
      palabras: `${resumen.instruccion ?? ""} ${resumen.id}`,
      href: enlaceATanda(resumen.id),
      icono: ICONO_DE_ESTADO[estadoDeTanda(resumen)],
    };
  });
}

function opcionesDeAcciones() {
  const otro = idioma() === "es" ? "en" : "es";
  return [
    { id: "accion:overview", grupo: "acciones", titulo: t("comun.paleta.irAOverview"), palabras: "overview home inicio resumen", icono: "marca", href: IR_AL_OVERVIEW },
    { id: "accion:revisiones", grupo: "acciones", titulo: t("comun.paleta.irARevisiones"), palabras: "reviews revisiones", icono: "check", href: enlaceARevisiones() },
    { id: "accion:corridas", grupo: "acciones", titulo: t("comun.paleta.irACorridas"), palabras: "batches corridas tandas runs", icono: "corridas", href: IR_A_CORRIDAS },
    { id: "accion:copiar", grupo: "acciones", titulo: t("comun.paleta.copiarEnlace"), icono: "copiar", accion: () => copiarEnlace() },
    { id: "accion:atajos", grupo: "acciones", titulo: t("comun.paleta.verAtajos"), icono: "teclado", accion: () => abrirHojaDeAtajos() },
    {
      id: "accion:idioma",
      grupo: "acciones",
      titulo: t("comun.paleta.cambiarIdioma"),
      palabras: "idioma language english español",
      icono: "idioma",
      accion: () => cambiarIdioma(otro),
    },
  ];
}

function registrarAtajosGlobales() {
  registrarAtajos(
    {
      "Mod+k": { descripcion: () => t("comun.atajos.desc.paleta"), accion: () => abrirPaleta(), enCampos: true },
      "?": { descripcion: () => t("comun.atajos.desc.hoja"), accion: () => abrirHojaDeAtajos() },
      "g o": { descripcion: () => t("comun.atajos.desc.irAOverview"), accion: () => navegar(IR_AL_OVERVIEW) },
      "g c": { descripcion: () => t("comun.atajos.desc.irACorridas"), accion: () => navegar(IR_A_CORRIDAS) },
      "/": { descripcion: () => t("comun.atajos.desc.buscar"), accion: () => abrirPaleta() },
    },
    { ambito: "global", grupo: "global" },
  );
}

async function arrancar() {
  await iniciarI18n({ parametroDeHash: extraerIdioma(location.hash).idioma });
  iniciarShell();
  iniciarPaleta({ navegar });
  registrarFuenteDePaleta(opcionesDeTandas);
  registrarFuenteDePaleta(opcionesDeAcciones);
  registrarAtajosGlobales();
  // La lista de tandas se pide una vez al arrancar (la paleta la usa); cada navegación recoge la última, que
  // cambia si una vista la volvió a pedir (Reintentar).
  recordarTandas();
  addEventListener(EVENTO_RUTA, recordarTandas);
  await iniciarEnrutador({ raiz: document.getElementById("contenido") });
}

arrancar().catch((error) => console.error("backoffice: no se pudo arrancar", error));
