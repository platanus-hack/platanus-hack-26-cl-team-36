// Backoffice: punto de entrada. Arma el idioma, el armazón, los atajos globales y el enrutador.
// Las pantallas viven en pantallas/<id>.js y se cargan bajo demanda (nucleo/enrutador.js).

import { abrirHojaDeAtajos, registrarAtajos } from "./nucleo/atajos.js";
import { iniciarEnrutador, navegar } from "./nucleo/enrutador.js";
import { iniciarI18n, t } from "./nucleo/i18n.js";
import { extraerIdioma, hashDe } from "./nucleo/rutas.js";
import { iniciarShell } from "./nucleo/shell.js";

const IR_AL_OVERVIEW = hashDe({ tipo: "overview" });
const IR_A_CORRIDAS = hashDe({ tipo: "corridas" });

function registrarAtajosGlobales() {
  registrarAtajos(
    {
      "?": { descripcion: () => t("comun.atajos.desc.hoja"), accion: () => abrirHojaDeAtajos() },
      "g o": { descripcion: () => t("comun.atajos.desc.irAOverview"), accion: () => navegar(IR_AL_OVERVIEW) },
      "g c": { descripcion: () => t("comun.atajos.desc.irACorridas"), accion: () => navegar(IR_A_CORRIDAS) },
    },
    { ambito: "global", grupo: "global" },
  );
}

async function arrancar() {
  await iniciarI18n({ parametroDeHash: extraerIdioma(location.hash).idioma });
  iniciarShell();
  registrarAtajosGlobales();
  await iniciarEnrutador({ raiz: document.getElementById("contenido") });
}

arrancar().catch((error) => console.error("backoffice: no se pudo arrancar", error));
