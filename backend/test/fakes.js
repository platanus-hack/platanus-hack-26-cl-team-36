// Fakes en memoria de los clientes de aws.js, con la misma semántica de condiciones.

const id = ({ PK, SK }) => `${PK}|${SK}`;

export function tablaFalsa() {
  const items = new Map();
  return {
    items,
    item: (clave) => items.get(id(clave)),
    async obtener(clave) {
      const item = items.get(id(clave));
      return item ? structuredClone(item) : null;
    },
    async registrar(puts) {
      const cumple = ({ item, reemplaza }) =>
        reemplaza == null ? !items.has(id(item)) : items.get(id(item))?.revision === reemplaza;
      if (!puts.every(cumple)) return false;
      for (const { item } of puts) items.set(id(item), structuredClone(item));
      return true;
    },
    async contarEnCurso(estados, desde) {
      return [...items.values()].filter(
        (item) => item.SK === "META" && estados.includes(item.status) && (item.updated_at ?? "") >= desde,
      ).length;
    },
    async listar(PK) {
      return [...items.values()].filter((item) => item.PK === PK).map((item) => structuredClone(item));
    },
    async actualizar(clave, atributos, { previos, existente = false, hasta = {}, igual = {} } = {}) {
      const actual = items.get(id(clave));
      if (existente && !actual) return false;
      if (previos && actual?.status !== undefined && !previos.includes(actual.status)) return false;
      if (Object.entries(hasta).some(([nombre, valor]) => actual?.[nombre] !== undefined && actual[nombre] > valor)) return false;
      if (Object.entries(igual).some(([nombre, valor]) => actual?.[nombre] !== valor)) return false;
      const definidos = Object.fromEntries(Object.entries(atributos).filter(([, valor]) => valor !== undefined));
      items.set(id(clave), { ...clave, ...actual, ...definidos });
      return true;
    },
  };
}

export function almacenFalso(archivos = {}) {
  const leerTexto = async (clave) => {
    if (!(clave in archivos)) throw Object.assign(new Error(`NoSuchKey ${clave}`), { name: "NoSuchKey" });
    const contenido = archivos[clave];
    return typeof contenido === "string" ? contenido : JSON.stringify(contenido);
  };
  return { archivos, leerTexto, leerJson: async (clave) => JSON.parse(await leerTexto(clave)) };
}

export function agentesFalsos({ falla } = {}) {
  const invocaciones = [];
  return {
    invocaciones,
    async invocar(payload) {
      invocaciones.push(payload);
      if (falla) throw falla;
    },
  };
}
