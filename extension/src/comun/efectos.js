// Efectos del encendido y apagado: «llamativos» (la metamorfosis de la página y el camaleón que despierta o se
// duerme) o «sutiles» (un fundido corto en la página y un cambio tranquilo del camaleón). El usuario lo elige en
// el popup; se guarda en storage.local con la clave `efectos`.
// prefers-reduced-motion manda siempre: con movimiento reducido el cambio es el más tranquilo, elija lo que elija.
//
// Script clásico, como comun/idioma.js: el popup lo importa (`import "../comun/efectos.js"`), los content scripts
// lo cargan desde el manifest (después de content/registro.js) y los tests de Node con `import()`.

(() => {
  // Efectos para quien todavía no eligió. "llamativos": la demo luce la metamorfosis; para que por omisión sea el
  // fundido sutil (lo que suele preferir la gente en el día a día), cambia esto a "sutiles". Es lo único que hay
  // que tocar.
  const EFECTOS_POR_OMISION = "llamativos";

  const CLAVE_EFECTOS = "efectos";
  const EFECTOS = Object.freeze(["llamativos", "sutiles"]);
  const normalizarEfectos = (valor) => (EFECTOS.includes(valor) ? valor : EFECTOS_POR_OMISION);

  (globalThis.MiTema ??= {}).efectos = { EFECTOS_POR_OMISION, CLAVE_EFECTOS, EFECTOS, normalizarEfectos };
})();
