// Backoffice: punto de entrada. Arma el idioma, el armazón, la paleta, los atajos globales y el enrutador.
// Las pantallas viven en pantallas/<id>.js y se cargan bajo demanda (nucleo/enrutador.js).

import { abrirHojaDeAtajos, registrarAtajos } from "./nucleo/atajos.js";
import { copiarEnlace } from "./nucleo/avisos.js";
import { pedirTandas } from "./nucleo/datos.js";
import { iniciarEnrutador, navegar } from "./nucleo/enrutador.js";
import { cambiarIdioma, fmt, idioma, iniciarI18n, t } from "./nucleo/i18n.js";
import { abrirPaleta, iniciarPaleta, registrarFuenteDePaleta } from "./nucleo/paleta.js";
import { enlaceATanda, extraerIdioma } from "./nucleo/rutas.js";
import { estadoDeTanda, iniciarShell, tandasDelShell } from "./nucleo/shell.js";

const ICONO_DE_ESTADO = { logrado: "logrado", fallido: "fallido", error: "error-herramienta" };

function opcionesDeTandas() {
  return tandasDelShell().map((resumen) => {
    const fecha = resumen.fechaIso ?? resumen.fecha;
    return {
      id: `tandas:${resumen.id}`,
      grupo: "tandas",
      titulo: resumen.tarea ?? resumen.host ?? resumen.id,
      subtitulo: [fmt.fechaCorta(fecha), resumen.host].filter(Boolean).join(" · "),
      palabras: `${resumen.instruccion ?? ""} ${resumen.id}`,
      href: enlaceATanda(resumen.id),
      icono: ICONO_DE_ESTADO[estadoDeTanda(resumen).tipo],
    };
  });
}

function opcionesDeAcciones() {
  const otro = idioma() === "es" ? "en" : "es";
  return [
    { id: "accion:copiar", grupo: "acciones", titulo: t("comun.paleta.copiarEnlace"), icono: "copiar", accion: () => copiarEnlace() },
    { id: "accion:atajos", grupo: "acciones", titulo: t("comun.paleta.verAtajos"), icono: "teclado", accion: () => abrirHojaDeAtajos() },
    { id: "accion:corridas", grupo: "acciones", titulo: t("comun.paleta.irACorridas"), icono: "corridas", href: "#/" },
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
      "g c": { descripcion: () => t("comun.atajos.desc.irACorridas"), accion: () => navegar("#/") },
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
  pedirTandas().catch(() => {});
  await iniciarEnrutador({ raiz: document.getElementById("contenido") });
}

arrancar().catch((error) => console.error("backoffice: no se pudo arrancar", error));
