// La barra comunica habilitación global. ON no afirma que haya un tema en la pestaña actual.
import "../comun/idioma.js";

const { t } = globalThis.MiTema.idioma;

export function estadoDelIndicador({ activo = true, idioma } = {}) {
  const variante = activo ? "on" : "off";
  return {
    iconos: Object.fromEntries([16, 32, 48, 96, 128].map((size) => [size, `icons/extension-${variante}-${size}.png`])),
    texto: activo ? "ON" : "OFF",
    fondo: activo ? "#2EE6C5" : "#3E3E4B",
    colorTexto: activo ? "#0B0B10" : "#F5F5F7",
    titulo: t(idioma, activo ? "accion.encendida" : "accion.apagada"),
  };
}

// Serializa las escrituras de las APIs: un cambio lento anterior no puede sobrescribir el último estado.
// Cada actualización lee storage dentro de la cola, también al reactivarse el event page de Firefox.
export function crearActualizadorIndicador({ action, storage }) {
  let pendiente = Promise.resolve();
  return function actualizar() {
    const resultado = pendiente.catch(() => {}).then(async () => {
      const vista = estadoDelIndicador(await storage.get(["activo", "idioma"]));
      const cambios = [
        action.setIcon({ path: vista.iconos }),
        action.setTitle({ title: vista.titulo }),
        action.setBadgeText({ text: vista.texto }),
        action.setBadgeBackgroundColor({ color: vista.fondo }),
      ];
      if (action.setBadgeTextColor) cambios.push(action.setBadgeTextColor({ color: vista.colorTexto }));
      // Esperar todas incluso si una falla antes de admitir la siguiente actualización.
      const resultados = await Promise.allSettled(cambios);
      const fallo = resultados.find((resultado) => resultado.status === "rejected");
      if (fallo) throw fallo.reason;
    });
    pendiente = resultado;
    return resultado;
  };
}
