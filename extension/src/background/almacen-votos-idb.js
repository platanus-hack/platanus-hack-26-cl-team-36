// Adaptador de IndexedDB para el almacén de votos (ver crearAlmacenVotos en votos.js).
// Base `chameleon-votos`, store `votos` (keyPath `id`) con un índice por `creadoEn`.
//
// Por qué IndexedDB y no storage.local: cada voto trae el HTML de la página (hasta
// ~1,5 MB por versión). `storage.onChanged` reparte el valor nuevo completo a todos los
// content scripts de todas las pestañas (content/motor.js escucha ese evento), así que
// guardar MB ahí costaría en cada pestaña abierta. IndexedDB del background no avisa a
// nadie y guarda Uint8Array sin pasarlos a texto.
//
// Delgado a propósito: la lógica (topes, orden, subida) está en votos.js y se testea con
// Node usando crearAdaptadorMemoria, que cumple el mismo contrato.

const NOMBRE_BASE = "chameleon-votos";
const VERSION_BASE = 1;
const STORE = "votos";
const INDICE_FECHA = "creadoEn";

const esperar = (peticion) =>
  new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });

let base = null; // Promise<IDBDatabase>

function abrir() {
  base ??= new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(NOMBRE_BASE, VERSION_BASE);
    peticion.onupgradeneeded = () => {
      const store = peticion.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex(INDICE_FECHA, "creadoEn");
    };
    peticion.onsuccess = () => {
      const db = peticion.result;
      db.onversionchange = () => {
        db.close();
        base = null;
      };
      resolver(db);
    };
    peticion.onerror = () => rechazar(peticion.error);
  });
  base.catch(() => (base = null)); // reintentar en la próxima llamada
  return base;
}

// Corre `operacion(store)` en una transacción y espera a que se confirme.
async function enStore(modo, operacion) {
  const db = await abrir();
  const transaccion = db.transaction(STORE, modo);
  const resultado = esperar(operacion(transaccion.objectStore(STORE)));
  await new Promise((resolver, rechazar) => {
    transaccion.oncomplete = resolver;
    transaccion.onerror = () => rechazar(transaccion.error);
    transaccion.onabort = () => rechazar(transaccion.error ?? new Error("Transacción abortada"));
  });
  return resultado;
}

export function crearAdaptadorIndexedDB() {
  return {
    poner: (registro) => enStore("readwrite", (store) => store.put(registro)).then(() => undefined),
    obtener: (id) => enStore("readonly", (store) => store.get(id)),
    borrar: (id) => enStore("readwrite", (store) => store.delete(id)).then(() => undefined),
    contar: () => enStore("readonly", (store) => store.count()),
    // En el orden del índice (creadoEn; empates por id), del más antiguo al más nuevo.
    listarIds: () => enStore("readonly", (store) => store.index(INDICE_FECHA).getAllKeys()),
  };
}
