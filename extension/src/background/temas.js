// Lógica pura de temas: sin APIs del navegador, para poder testearla con Node
// (ver test/). No uses `browser.*` aquí.
//
// Un tema normalizado tiene esta forma, venga de src/temas/ o (a futuro) de la API:
//
//   {
//     id: "youtube",
//     nombre: "YouTube morado",
//     dominios: ["youtube.com"],          // también aplica a subdominios (www., m.)
//     css: "html.mi-tema { ... }",        // contenido CSS, todo bajo html.mi-tema
//     features: { "modo-foco": { ... } }, // id de feature → opciones
//     eventosNavegacion: ["yt-navigate-finish"], // eventos del sitio que re-ejecutan las features
//   }

export function normalizarTema(datos) {
  const { id, nombre = id, dominios, css, features = {}, eventosNavegacion = [] } = datos ?? {};

  if (typeof id !== "string" || id === "") {
    throw new Error("Tema inválido: falta `id`");
  }
  if (!Array.isArray(dominios) || dominios.length === 0) {
    throw new Error(`Tema "${id}": \`dominios\` debe ser una lista no vacía`);
  }
  if (typeof css !== "string") {
    throw new Error(`Tema "${id}": falta \`css\``);
  }
  if (typeof features !== "object" || features === null || Array.isArray(features)) {
    throw new Error(`Tema "${id}": \`features\` debe ser un objeto { id: opciones }`);
  }

  return {
    id,
    nombre,
    dominios: dominios.map((d) => d.toLowerCase()),
    css,
    features,
    eventosNavegacion,
  };
}

// "youtube.com" coincide con youtube.com, www.youtube.com y m.youtube.com,
// pero no con notyoutube.com.
export function coincideDominio(hostname, dominio) {
  return hostname === dominio || hostname.endsWith(`.${dominio}`);
}

// Prueba los proveedores en orden y devuelve el primer tema que encuentre.
// Si un proveedor falla (ej. el backend está caído), avisa y sigue con el siguiente.
export async function buscarEnProveedores(proveedores, url, avisar = console.warn) {
  for (const proveedor of proveedores) {
    try {
      const tema = await proveedor.buscar(url);
      if (tema) return tema;
    } catch (error) {
      avisar(`[mi-tema] Falló el proveedor "${proveedor.nombre}", sigo con el siguiente:`, error);
    }
  }
  return null;
}

export function temaParaUrl(temas, url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return temas.find((t) => t.dominios.some((d) => coincideDominio(hostname, d))) ?? null;
}
