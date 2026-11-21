// Qué tema corresponde a cada sitio.
//
// Por ahora la API solo dice el id del tema; el CSS y la configuración viven en la
// extensión (extension/src/temas/<id>/). Cada id de aquí debe existir allá
// (test/temas.test.js lo verifica).

export const SITIOS = [
  // `dominio` también cubre sus subdominios (www.youtube.com, m.youtube.com).
  { dominio: "youtube.com", tema: "youtube" },
  { dominio: "mail.google.com", tema: "gmail" },
];

function coincideDominio(hostname, dominio) {
  return hostname === dominio || hostname.endsWith(`.${dominio}`);
}

// Devuelve el id del tema para una URL, o null si el sitio no tiene tema.
// Lanza TypeError si `url` no es una URL válida.
export function temaParaUrl(url) {
  const { hostname } = new URL(url);
  return SITIOS.find((s) => coincideDominio(hostname.toLowerCase(), s.dominio))?.tema ?? null;
}
