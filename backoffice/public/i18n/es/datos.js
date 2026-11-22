// Sección `datos` (español): los textos de lo que la API entrega como clave + variables (hallazgos,
// titulares, lo que pasó en un paso, motivos de fin, errores de la herramienta, firmas de acciones).
// Dueño: WP0. public/datos/textos.js resuelve antes las variables (ids → nombres, páginas → nombres,
// señales y motivos → etiquetas, conteos → texto), así que aquí llegan listas para escribir.
// Mismo árbol de claves que i18n/en/datos.js.

const LISTA = new Intl.ListFormat("es-CL", { style: "long", type: "conjunction" });
const unir = (nombres) => LISTA.format((Array.isArray(nombres) ? nombres : []).map(String));
const n = (valor) => Number(valor ?? 0) || 0;
const segun = (cuenta, uno, varios) => (cuenta === 1 ? uno : varios);
const pasos = (cuenta) => `${cuenta} ${segun(cuenta, "paso", "pasos")}`;
const conNota = (frase, nota) => (nota ? frase.replace(/\.$/, ` ${nota}.`) : frase);

export default {
  pagina: {
    inicio: "Inicio",
    // Cuando la tanda tiene más de una página de inicio (sitio.cl y m.sitio.cl).
    inicioDe: "Inicio · {sitio}",
  },

  error: {
    internal_error: "Falló el navegador del evaluador",
    api_error: "Falló la API del modelo",
    no_response: "El modelo no respondió",
    refusal: "El modelo se negó a seguir",
    juez: "El juez no pudo dar veredicto",
    sin_inicio: "No se pudo abrir la página",
  },

  motivo: {
    done: "terminó y respondió",
    blocked: "se declaró bloqueado",
    gave_up: "se rindió",
    step_limit: "agotó las acciones",
    time_limit: "agotó el tiempo",
    refusal: "el modelo se negó",
    api_error: "error de la API",
    no_response: "el modelo no respondió",
    internal_error: "error interno",
    desconocido: "sin motivo registrado",
  },

  firma: {
    clic: "clic «{objetivo}»",
    clic_coordenadas: "clic en ({x}, {y})",
    doble_clic: ({ objetivo, x, y }) => (objetivo ? `doble clic «${objetivo}»` : `doble clic en (${x ?? "?"}, ${y ?? "?"})`),
    triple_clic: ({ objetivo, x, y }) => (objetivo ? `triple clic «${objetivo}»` : `triple clic en (${x ?? "?"}, ${y ?? "?"})`),
    desplazar: ({ flecha, cantidad }) => ["desplazar", flecha, cantidad ? `×${cantidad}` : ""].filter(Boolean).join(" "),
    escribir: "escribir «{objetivo}»",
    atras: "volver atrás",
    volver: ({ objetivo }) => (objetivo ? `volver a «${objetivo}»` : "volver a una página ya vista"),
    tecla: "tecla {objetivo}",
    otra: ({ original }) => String(original ?? "") || "otra acción",
  },

  loQuePaso: {
    volvio: "Volvió a la página anterior.",
    cambioUrl: "Pasó de {de} a {a}.",
    cambioTitulo: "La página se llama «{titulo}».",
    sinCambio: "La pantalla no cambió.",
    cambioParcial: "Cambió el {porcentaje} % de la pantalla, en la misma página.",
    errorVisible: "Apareció un error en pantalla.",
    bloqueoSeguridad: "El evaluador bloqueó el envío de un formulario.",
    detalle: "Detalle: {texto}",
    sinRegistro: "Sin cambios registrados.",
  },

  conteos: {
    clic: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "clic", "clics")}`,
    desplazamiento: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "desplazamiento", "desplazamientos")}`,
    texto: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "texto", "textos")}`,
    tecla: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "tecla", "teclas")}`,
    otra: ({ n: cuenta }) => `${n(cuenta)} ${segun(n(cuenta), "otra acción", "otras acciones")}`,
  },

  hallazgo: {
    resultado: ({ total, validos, logrados, directos, errores, intentos }) => {
      const [t, v, l, d, e] = [n(total), n(validos), n(logrados), n(directos), n(errores)];
      if (t === 0) return "La tanda no tiene intentos registrados.";
      if (v === 0) {
        return `Ningún intento válido: ${t === 1 ? "el único intento falló" : `los ${t} fallaron`} por un error de la herramienta.`;
      }
      if (l === v) {
        const sujeto = v === 1
          ? (e > 0 ? "El único intento válido llega" : "El único intento llega")
          : (e > 0 ? `Los ${v} intentos válidos llegan` : `Los ${v} llegan`);
        let como = " por la ruta recomendada.";
        if (directos === null || directos === undefined) como = "."; // sin ruta recomendada
        else if (d === 0) como = v === 1 ? ", pero no por la ruta recomendada." : ", ninguno por la ruta recomendada.";
        else if (d < l) como = `; ${l - d} por otro camino.`;
        return `${sujeto} a la respuesta${como}`;
      }
      if (l === 0) {
        return v === 1 ? "El único intento válido no llega a la respuesta." : `Ninguno de los ${v} llega a la respuesta.`;
      }
      const faltan = Array.isArray(intentos) ? intentos : [];
      return `${l} de ${v} ${segun(l, "llega", "llegan")} a la respuesta. ${segun(faltan.length, "No llega", "No llegan")}: ${unir(faltan)}.`;
    },
    errores: ({ intentos }) => {
      const nombres = Array.isArray(intentos) ? intentos : [];
      const sujeto = nombres.length === 1 ? "Un intento no cuenta" : `${nombres.length} intentos no cuentan`;
      return `${sujeto}: error de la herramienta (${unir(nombres)}).`;
    },
    desvio: ({ intento, desdePagina, haciaPagina, paso, vuelveEnPaso }) =>
      `${intento ?? ""} deja la ruta en «${desdePagina ?? ""}» hacia «${haciaPagina ?? ""}» (paso ${n(paso)}) y ` +
      `${vuelveEnPaso === null || vuelveEnPaso === undefined ? "no vuelve" : `vuelve en el paso ${vuelveEnPaso}`}.`,
    detenido: ({ intento, pagina, pasos: cuenta, motivo }) =>
      `${intento ?? ""} termina en «${pagina ?? ""}» tras ${pasos(n(cuenta))}: ${motivo ?? ""}.`,
    demora: ({ intento, pasos: cuenta, pagina, rutaPasos, conteos }) =>
      `${intento ?? ""} da ${n(cuenta)} pasos seguidos en «${pagina ?? ""}»` +
      `${rutaPasos === null || rutaPasos === undefined ? "" : ` (la ruta: ${rutaPasos})`}: ${conteos ?? ""}.`,
    tropiezos: ({ pasos: cuenta, casos }) => {
      const lista = Array.isArray(casos) ? casos : [];
      const detalle = lista.map((caso) => `${caso.intento}, paso ${caso.paso} (${String(caso.senal ?? "").toLocaleLowerCase("es")})`);
      const resto = n(cuenta) - lista.length;
      if (resto > 0) detalle.push(`${resto} más`);
      return `${pasos(n(cuenta))} con tropiezos${detalle.length ? `: ${detalle.join("; ")}` : ""}.`;
    },
    costo: ({ pasosMediana, pasosIdeales }) =>
      `La mediana es de ${pasos(n(pasosMediana))}; la ruta recomendada usa ${n(pasosIdeales)}.`,
  },

  titular: {
    // Todos llegan, pero alguien lo pasó mal: el titular de Resumen y Corridas no lo esconde.
    tanda: ({ validos, errores, caso, intento, pagina, pasos: cuenta, pasosIdeales }) => {
      const [v, e] = [n(validos), n(errores)];
      const sujeto = v === 1
        ? (e > 0 ? "El único intento válido llega" : "El único intento llega")
        : (e > 0 ? `Los ${v} intentos válidos llegan` : `Los ${v} llegan`);
      if (caso === "masPasos") {
        return `${sujeto} a la respuesta, pero ${intento ?? ""} tarda ${pasos(n(cuenta))} (la ruta: ${n(pasosIdeales)}).`;
      }
      if (caso === "demora") return `${sujeto} a la respuesta, pero ${intento ?? ""} da ${n(cuenta)} pasos seguidos en «${pagina ?? ""}».`;
      return `${sujeto} a la respuesta, pero hay ${pasos(n(cuenta))} con tropiezos.`;
    },
    telarana: ({ hayRuta, tramos, pasosIdeales, siguen, validos, logrados }) => {
      if (!hayRuta && n(logrados) > 0) return "No hay una ruta recomendada que seguir: el eje es el camino más transitado.";
      if (!hayRuta) return "Nadie llegó a la respuesta: el eje es el camino más transitado.";
      const [s, v] = [n(siguen), n(validos)];
      let quienes;
      if (s === v) quienes = v === 1 ? "el único intento la sigue" : `los ${v} la siguen`;
      else quienes = `${s} de ${v} la ${segun(s, "sigue", "siguen")}`;
      return `La ruta recomendada tiene ${n(tramos)} ${segun(n(tramos), "tramo", "tramos")} y ${pasos(n(pasosIdeales))}; ${quienes}.`;
    },
    perfiles: ({ caso, intentos, pasos: cuenta, pasosIdeales, perfiles, unoPorPerfil }) => {
      const nombres = Array.isArray(intentos) ? intentos : [];
      const nota = unoPorPerfil ? "(1 intento por perfil)" : "";
      if (caso === "sinValidos") return "Ningún perfil tiene intentos válidos.";
      if (caso === "noLlegan") {
        return conNota(`${unir(nombres)} no ${segun(nombres.length, "llega", "llegan")} a la respuesta.`, nota);
      }
      if (caso === "masPasos") {
        return conNota(`${nombres[0] ?? ""} necesita ${pasos(n(cuenta))}; la ruta, ${n(pasosIdeales)}.`, nota);
      }
      const total = n(perfiles);
      const sujeto = total === 1 ? "El único perfil llega" : `Los ${total} perfiles llegan`;
      if (caso === "llegan") return conNota(`${sujeto} a la respuesta.`, nota);
      return conNota(`${sujeto} con un costo parecido al de la ruta.`, nota);
    },
  },
};
