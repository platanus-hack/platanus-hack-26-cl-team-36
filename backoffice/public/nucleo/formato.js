// Formatos por idioma (diseño §5.7). Puro: el idioma entra como parámetro; los objetos Intl se guardan por idioma.

const LOCALES = { es: "es-CL", en: "en-US" };
const cache = new Map();

function aFecha(fechaIso) {
  if (fechaIso instanceof Date) return Number.isNaN(fechaIso.getTime()) ? null : fechaIso;
  if (typeof fechaIso !== "string" || !fechaIso) return null;
  // También acepta el nombre de carpeta de una tanda: 2026-11-21_07-28-42.
  const carpeta = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(fechaIso);
  const texto = carpeta ? `${carpeta[1]}T${carpeta[2]}:${carpeta[3]}:${carpeta[4]}` : fechaIso;
  const fecha = new Date(texto); // sin zona → hora local, como la escribe el evaluador
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function partes(formateador, fecha) {
  const resultado = {};
  for (const { type, value } of formateador.formatToParts(fecha)) resultado[type] = value;
  return resultado;
}

/** @param {"es" | "en"} idioma */
export function crearFormatos(idioma) {
  const clave = LOCALES[idioma] ? idioma : "es";
  if (cache.has(clave)) return cache.get(clave);
  const locale = LOCALES[clave];
  const ingles = clave === "en";

  const fechaHora = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const relativo = new Intl.RelativeTimeFormat(locale, { style: "short", numeric: "auto" });
  const listas = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const numeros = new Map();
  const numeroCon = (opciones) => {
    const llave = JSON.stringify(opciones ?? {});
    if (!numeros.has(llave)) numeros.set(llave, new Intl.NumberFormat(locale, opciones));
    return numeros.get(llave);
  };
  const mes = (p) => p.month.replace(/\.$/, "");

  const fmt = {
    idioma: clave,
    locale,

    /** "21 nov 2026, 07:28" | "Nov 21, 2026, 07:28" */
    fechaLegible(fechaIso) {
      const fecha = aFecha(fechaIso);
      if (!fecha) return "";
      const p = partes(fechaHora, fecha);
      return ingles
        ? `${mes(p)} ${p.day}, ${p.year}, ${p.hour}:${p.minute}`
        : `${p.day} ${mes(p)} ${p.year}, ${p.hour}:${p.minute}`;
    },

    /** "21 nov 07:28" | "Nov 21, 07:28" */
    fechaCorta(fechaIso) {
      const fecha = aFecha(fechaIso);
      if (!fecha) return "";
      const p = partes(fechaHora, fecha);
      return ingles ? `${mes(p)} ${p.day}, ${p.hour}:${p.minute}` : `${p.day} ${mes(p)} ${p.hour}:${p.minute}`;
    },

    /** "hace 32 min" | "32 min ago" */
    tiempoRelativo(fechaIso, ahora = Date.now()) {
      const fecha = aFecha(fechaIso);
      if (!fecha) return "";
      const segundos = (fecha.getTime() - Number(ahora)) / 1000;
      const absoluto = Math.abs(segundos);
      let texto;
      if (absoluto < 45) texto = relativo.format(0, "second");
      else if (absoluto < 3600) texto = relativo.format(Math.round(segundos / 60), "minute");
      else if (absoluto < 86400) texto = relativo.format(Math.round(segundos / 3600), "hour");
      else if (absoluto < 86400 * 30) texto = relativo.format(Math.round(segundos / 86400), "day");
      else if (absoluto < 86400 * 365) texto = relativo.format(Math.round(segundos / (86400 * 30)), "month");
      else texto = relativo.format(Math.round(segundos / (86400 * 365)), "year");
      // en-US abrevia con punto ("32 min. ago"); el diseño pide "32 min ago".
      return ingles ? texto.replace(/(\p{L})\.(?=\s|$)/gu, "$1") : texto;
    },

    /** "41 s", "1 min 5 s"; "" si no es número. */
    duracion(segundos) {
      if (typeof segundos !== "number" || !Number.isFinite(segundos)) return "";
      const total = Math.round(segundos);
      if (total < 60) return `${total} s`;
      const minutos = Math.floor(total / 60);
      const resto = total % 60;
      if (minutos < 60) return resto ? `${minutos} min ${resto} s` : `${minutos} min`;
      const horas = Math.floor(minutos / 60);
      const min = minutos % 60;
      return min ? `${horas} h ${min} min` : `${horas} h`;
    },

    /** Intl.NumberFormat: "0,06" | "0.06". */
    numero(n, opciones) {
      if (typeof n !== "number" || !Number.isFinite(n)) return "";
      return numeroCon(opciones).format(n);
    },

    /** "A, B y C" | "A, B, and C" */
    lista(textos) {
      return listas.format((textos ?? []).map(String));
    },

    /** {n:2,de:3} → "2/3"; null → "—". Con { porcentaje: true } y de > 5: "8/12 · 67 %". */
    conteo(par, { porcentaje = false } = {}) {
      if (!par || typeof par.n !== "number" || typeof par.de !== "number") return "—";
      const base = `${par.n}/${par.de}`;
      if (!porcentaje || par.de <= 5) return base;
      return `${base} · ${numeroCon({ style: "percent", maximumFractionDigits: 0 }).format(par.n / par.de)}`;
    },

    /** Primera oración (o línea), cortada a `largo` con "…". */
    primeraFrase(texto, largo = 160) {
      const limpio = String(texto ?? "").trim();
      if (!limpio) return "";
      const linea = limpio.split(/\n/)[0].trim();
      const fin = /[.!?…](?=\s|$)/u.exec(linea);
      const frase = (fin ? linea.slice(0, fin.index + 1) : linea).replace(/\s+/g, " ");
      return frase.length > largo ? `${frase.slice(0, largo - 1).trimEnd()}…` : frase;
    },

    /** "claude-sonnet-5-5" → "Sonnet 5.5"; un id desconocido vuelve tal cual. */
    modelo(id) {
      const texto = String(id ?? "");
      const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:[-@].*)?$/.exec(texto);
      if (!m) return texto;
      const familia = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      return `${familia} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
    },
  };
  cache.set(clave, fmt);
  return fmt;
}
