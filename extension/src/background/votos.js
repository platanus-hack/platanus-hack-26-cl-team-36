// Votos ("¿la página quedó mejor o peor con el tema?"): lógica pura, sin `browser.*`,
// para poder testearla con Node (ver test/votos.test.js).
//
// Por cada voto se guarda en el equipo del usuario un registro con el voto, el
// comentario, un id aleatorio del usuario (no identifica a la persona) y el HTML de la
// página antes y después del tema, comprimidos con gzip. La captura la hace
// content/captura.js; el background (index.js) arma el registro con crearRegistroVoto y
// lo guarda en IndexedDB (almacen-votos-idb.js).
//
// Forma del registro (versión 1):
//
//   {
//     id: "uuid", version: 1, creadoEn: "2026-11-21T12:00:00.000Z",
//     idUsuario: "uuid", voto: "mejor" | "peor" | "comentario", comentario: "texto" | "",
//     origen: "https://www.youtube.com", url: "https://www.youtube.com/watch" (sin query ni hash),
//     temaId: "youtube" | null, temaActivo: true | false, versionExtension: "0.1.0" | null,
//     compresion: "gzip",
//     original: Uint8Array | null,   // HTML gzip de la página sin lo que agrega Chameleon
//     editado: Uint8Array | null,    // HTML gzip tal como se ve, con el CSS del tema incrustado
//     bytes: { original, originalComprimido, editado, editadoComprimido },  // 0 si se omitió
//     originalOmitido: false, editadoOmitido: false,   // true si se descartó por tamaño
//   }
//
// El `editado` lleva el CSS del tema (y el de las features) dentro de un
// `<style data-mt-css-tema>` al final del <head>: Chameleon lo inyecta con
// scripting.insertCSS, que no deja rastro en el DOM, y así el HTML guardado se ve con el
// tema al abrirlo solo. Si el tema está apagado con el botón (`temaActivo: false`), el
// <html> no tiene la clase `mi-tema` y ese CSS no aplica: el editado es lo que se veía.
//
// Topes (el almacenamiento es local y sin `unlimitedStorage`):
//   - un HTML que comprimido pasa de MAX_BYTES_COMPRIMIDO (o que sin comprimir pasa de
//     MAX_CARACTERES_HTML, para no gastar en comprimirlo) no se guarda: queda en null y
//     se marca `originalOmitido`/`editadoOmitido`. El voto se guarda igual.
//   - como mucho MAX_PENDIENTES votos sin subir: al guardar uno nuevo sobre el tope se
//     borran los más antiguos. Mientras no exista la subida, el equipo guarda los últimos.
//
// ---------- Subida al servidor (PENDIENTE: no se llama desde ningún lado) ----------
//
// `sincronizarVotos({ almacen, subir })` es el punto de enganche. Para implementarla:
//   1. En api.js, un `subirVoto(registro)` que haga `POST {urlDeLaApi()}/votos` (p. ej.
//      multipart con los dos HTML gzip como archivos y el resto como JSON) y lance error
//      si la respuesta no es 2xx (así sincronizarVotos se detiene y reintenta después).
//   2. En index.js, llamar `sincronizarVotos({ almacen: almacenVotos, subir: subirVoto })`
//      al arrancar (runtime.onStartup) y cada cierto tiempo con `browser.alarms` (agregar
//      el permiso "alarms"), y quizás justo después de guardar un voto.
//   3. sincronizarVotos ya borra lo local de cada voto que se sube bien: no guardar
//      copias en otro lado.
//   4. Antes de publicar, declarar en `data_collection_permissions` del manifest lo que
//      sale del equipo: `websiteContent` (el HTML de la página), y revisar si corresponde
//      algo más (p. ej. `websiteActivity`/`browsingActivity` por la URL). Hoy nada de
//      esto sale del equipo y por eso el manifest no lo declara.

export const VERSION_REGISTRO = 1;
export const VOTOS_VALIDOS = ["mejor", "peor", "comentario"];
export const MAX_COMENTARIO = 2000; // caracteres
export const MAX_BYTES_COMPRIMIDO = 1.5 * 1024 * 1024; // por HTML
export const MAX_CARACTERES_HTML = 20 * 1024 * 1024; // por HTML, antes de comprimir
export const MAX_PENDIENTES = 100;
export const CLAVE_ID_USUARIO = "idUsuario";

// ---------- Validación ----------

// → { ok: true, voto, comentario } | { ok: false, error } (error legible para el usuario).
export function validarVoto({ voto, comentario } = {}) {
  if (!VOTOS_VALIDOS.includes(voto)) {
    return { ok: false, error: "Elige si la página quedó mejor, peor o si solo quieres comentar." };
  }
  if (comentario != null && typeof comentario !== "string") {
    return { ok: false, error: "El comentario debe ser texto." };
  }
  const texto = (comentario ?? "").trim();
  if (voto === "comentario" && !texto) {
    return { ok: false, error: "Escribe tu comentario antes de enviarlo." };
  }
  if (texto.length > MAX_COMENTARIO) {
    return { ok: false, error: `El comentario es muy largo (máximo ${MAX_COMENTARIO} caracteres).` };
  }
  return { ok: true, voto, comentario: texto };
}

// ---------- Compresión (gzip, con las APIs de streams de Firefox y Node) ----------

export async function comprimir(texto) {
  const flujo = new Blob([texto]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

export async function descomprimir(datos) {
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(flujo).text();
}

// ---------- Registro ----------

// URL sin query ni hash (la ruta sí queda: dice qué pantalla del sitio se votó).
export function limpiarUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`URL no soportada: ${u.protocol}`);
  return { origen: u.origin, url: `${u.origin}${u.pathname}` };
}

// Inserta `<style data-mt-css-tema>` al final del <head> (o al principio si no hay).
// `</style` dentro del CSS cerraría la etiqueta antes de tiempo: se escapa (en CSS,
// `\/` es solo una barra).
export function incrustarCss(html, css) {
  if (!css) return html;
  const estilo = `<style data-mt-css-tema>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
  const cierreHead = html.search(/<\/head\s*>/i);
  if (cierreHead >= 0) return html.slice(0, cierreHead) + estilo + html.slice(cierreHead);
  const aperturaHtml = html.match(/<html\b[^>]*>/i);
  if (aperturaHtml) {
    const fin = aperturaHtml.index + aperturaHtml[0].length;
    return html.slice(0, fin) + estilo + html.slice(fin);
  }
  return estilo + html;
}

const bytesDeTexto = (texto) => new TextEncoder().encode(texto).length;

// Comprime un HTML respetando los topes → { datos, bytes, bytesComprimido, omitido }.
async function empaquetar(html, { maxBytes, maxCaracteres }) {
  if (typeof html !== "string" || html.length === 0) return { datos: null, bytes: 0, bytesComprimido: 0, omitido: true };
  if (html.length > maxCaracteres) return { datos: null, bytes: 0, bytesComprimido: 0, omitido: true };
  const datos = await comprimir(html);
  if (datos.byteLength > maxBytes) return { datos: null, bytes: 0, bytesComprimido: 0, omitido: true };
  return { datos, bytes: bytesDeTexto(html), bytesComprimido: datos.byteLength, omitido: false };
}

// `captura` es lo que responde content/captura.js: { url, temaId, temaActivo, original, editado }.
// `cssTema`: CSS a incrustar en el editado. Lanza si el voto o la URL no son válidos.
export async function crearRegistroVoto({
  idUsuario,
  voto,
  comentario,
  captura,
  cssTema = "",
  versionExtension = null,
  ahora = new Date(),
  crearId = () => crypto.randomUUID(),
  maxBytes = MAX_BYTES_COMPRIMIDO,
  maxCaracteres = MAX_CARACTERES_HTML,
}) {
  const validacion = validarVoto({ voto, comentario });
  if (!validacion.ok) throw new Error(validacion.error);
  if (typeof idUsuario !== "string" || !idUsuario) throw new Error("Falta el id del usuario.");
  const { origen, url } = limpiarUrl(captura?.url);

  const topes = { maxBytes, maxCaracteres };
  const editadoHtml = typeof captura.editado === "string" ? incrustarCss(captura.editado, cssTema) : null;
  const [original, editado] = await Promise.all([empaquetar(captura.original, topes), empaquetar(editadoHtml, topes)]);

  return {
    id: crearId(),
    version: VERSION_REGISTRO,
    creadoEn: ahora.toISOString(),
    idUsuario,
    voto: validacion.voto,
    comentario: validacion.comentario,
    origen,
    url,
    temaId: typeof captura.temaId === "string" && captura.temaId ? captura.temaId : null,
    temaActivo: captura.temaActivo === true,
    versionExtension,
    compresion: "gzip",
    original: original.datos,
    editado: editado.datos,
    bytes: {
      original: original.bytes,
      originalComprimido: original.bytesComprimido,
      editado: editado.bytes,
      editadoComprimido: editado.bytesComprimido,
    },
    originalOmitido: original.omitido,
    editadoOmitido: editado.omitido,
  };
}

// ---------- Almacén ----------

// Un adaptador guarda registros por `id` y los lista por `creadoEn` (empates por `id`):
//   poner(registro), obtener(id) → registro | undefined, borrar(id), contar() → n,
//   listarIds() → ids, del más antiguo al más nuevo.
// Implementaciones: crearAdaptadorMemoria (tests) y almacen-votos-idb.js (IndexedDB).

const compararRegistros = (a, b) =>
  a.creadoEn < b.creadoEn ? -1 : a.creadoEn > b.creadoEn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function crearAdaptadorMemoria() {
  const registros = new Map();
  return {
    async poner(registro) {
      registros.set(registro.id, structuredClone(registro));
    },
    async obtener(id) {
      const registro = registros.get(id);
      return registro && structuredClone(registro);
    },
    async borrar(id) {
      registros.delete(id);
    },
    async contar() {
      return registros.size;
    },
    async listarIds() {
      return [...registros.values()].sort(compararRegistros).map((r) => r.id);
    },
  };
}

export function crearAlmacenVotos(adaptador, { maxPendientes = MAX_PENDIENTES } = {}) {
  return {
    // Guarda el voto y, si quedan más de `maxPendientes`, borra los más antiguos.
    async guardar(registro) {
      await adaptador.poner(registro);
      const sobran = (await adaptador.contar()) - maxPendientes;
      if (sobran > 0) {
        const ids = (await adaptador.listarIds()).filter((id) => id !== registro.id).slice(0, sobran);
        for (const id of ids) await adaptador.borrar(id);
      }
    },
    // Del más antiguo al más nuevo. Ojo: carga todos los HTML en memoria.
    async listarPendientes() {
      const registros = [];
      for (const id of await adaptador.listarIds()) {
        const registro = await adaptador.obtener(id);
        if (registro) registros.push(registro);
      }
      return registros;
    },
    listarIds: () => adaptador.listarIds(),
    obtener: (id) => adaptador.obtener(id),
    borrar: (id) => adaptador.borrar(id),
    contar: () => adaptador.contar(),
  };
}

// ---------- Subida (punto de enganche, ver arriba) ----------

// Sube los votos pendientes del más antiguo al más nuevo con `subir(registro)` y borra
// cada uno del equipo apenas se sube. Si una subida falla, se detiene ahí y deja ese y
// los siguientes para la próxima vez. → { subidos, pendientes, error? }
export async function sincronizarVotos({ almacen, subir }) {
  let subidos = 0;
  for (const id of await almacen.listarIds()) {
    const registro = await almacen.obtener(id);
    if (!registro) continue; // se borró mientras tanto (p. ej. por el tope)
    try {
      await subir(registro);
    } catch (error) {
      return { subidos, pendientes: await almacen.contar(), error };
    }
    await almacen.borrar(id);
    subidos++;
  }
  return { subidos, pendientes: await almacen.contar() };
}

// ---------- Id del usuario ----------

// Id aleatorio (crypto.randomUUID) guardado en `area` (browser.storage.local) con la clave
// `idUsuario`. Se genera una sola vez; no dice nada de la persona ni del equipo.
const idsEnCurso = new WeakMap(); // área → Promise<id>, para que dos llamadas seguidas no generen dos

export function obtenerIdUsuario(area, { crearId = () => crypto.randomUUID() } = {}) {
  if (!idsEnCurso.has(area)) {
    const promesa = (async () => {
      const { [CLAVE_ID_USUARIO]: guardado } = await area.get(CLAVE_ID_USUARIO);
      if (typeof guardado === "string" && guardado) return guardado;
      const nuevo = crearId();
      await area.set({ [CLAVE_ID_USUARIO]: nuevo });
      return nuevo;
    })();
    promesa.catch(() => idsEnCurso.delete(area)); // reintentar en la próxima llamada
    idsEnCurso.set(area, promesa);
  }
  return idsEnCurso.get(area);
}
