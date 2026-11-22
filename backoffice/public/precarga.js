// Precarga lo que la vista de la URL va a pedir, sin esperar a que app.js y el enrutador lo descubran nivel por nivel:
// los módulos y la hoja de la pantalla (la lista la escribe el servidor en <meta name="precarga:<pantalla>">, ver
// lib/estaticos.js) y, en una tanda, sus datos (pedirTanda los guarda: el enrutador recibe la misma promesa).

import { pedirTanda } from "./nucleo/datos.js";
import { extraerIdioma, parsearHash } from "./nucleo/rutas.js";

const PANTALLA_DE_VISTA = { overview: "overview", corridas: "corridas", revisiones: "revisiones" };

const ruta = parsearHash(extraerIdioma(location.hash || "#/").hash);
const pantalla = ruta.tipo === "tanda" ? ruta.pestana : PANTALLA_DE_VISTA[ruta.tipo];
const lista = pantalla ? document.querySelector(`meta[name="precarga:${CSS.escape(pantalla)}"]`)?.content : "";

for (const href of (lista ?? "").split(" ").filter(Boolean)) {
  const enlace = document.createElement("link");
  if (href.endsWith(".css")) {
    enlace.rel = "preload";
    enlace.as = "style";
  } else {
    enlace.rel = "modulepreload";
  }
  enlace.href = href;
  document.head.append(enlace);
}

if (ruta.tipo === "tanda") pedirTanda(ruta.tandaId).catch(() => {});
