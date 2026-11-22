// Hallazgos y titulares de una tanda: la frase con que abre cada pantalla. Lógica pura.
//
// Aquí no se arman frases: cada hallazgo es una clave del diccionario `datos` (public/i18n/*/datos.js)
// más sus variables, y public/datos/textos.js las convierte en texto en el idioma de la página.
// Convenciones de las variables: `intento`/`intentos` son ids de intento; `pagina` y las que terminan
// en `Pagina` son ids de página; `senal` es una señal del evaluador; `motivo` un end_reason.

/**
 * @typedef {{ clave: string, vars: Record<string, unknown> }} Texto
 *
 * @typedef {Object} Hallazgo
 * @property {string} id                    "resultado", "errores", "desvio:<intento>", "demora:<intento>:<paso>"…
 * @property {"bien" | "atencion" | "info"} nivel
 * @property {string} clave                 "datos.hallazgo.<tipo>"
 * @property {Record<string, unknown>} vars
 * @property {string | null} intento        a qué intento lleva el enlace
 * @property {number | null} paso
 * @property {string | null} pagina
 *
 * @typedef {Object} Demora   Pasos seguidos en una misma página, más de los que da la ruta ahí.
 * @property {string} pagina
 * @property {number} desdePaso
 * @property {number} hastaPaso             incluye el paso que deja la página, si lo hay
 * @property {number} pasos                 acciones hechas en la página, contando la que la deja
 * @property {number | null} rutaPasos      los pasos del tramo de la ruta que sale de esa página (misma cuenta)
 * @property {Conteos} conteos
 *
 * @typedef {{ clic: number, desplazamiento: number, texto: number, tecla: number, otra: number }} Conteos
 */

const MAXIMO_DE_HALLAZGOS = 8;
const MAXIMO_DE_TROPIEZOS = 3;
const UMBRAL_MINIMO_DE_DEMORA = 4;
const FACTOR_DE_COSTO = 1.5;
const SENALES_DE_TROPIEZO = ["no_effect", "went_back", "visible_error"];

/** Tipo de acción de un paso, para contar qué hizo el usuario en una demora. */
export function tipoDeAccion(accion) {
  if (accion === "left_click" || accion === "double_click" || accion === "triple_click") return "clic";
  if (accion === "scroll") return "desplazamiento";
  if (accion === "type") return "texto";
  if (accion === "key") return "tecla";
  return "otra";
}

/** @returns {Conteos} */
export function contarAcciones(pasos) {
  const conteos = { clic: 0, desplazamiento: 0, texto: 0, tecla: 0, otra: 0 };
  for (const paso of pasos) conteos[tipoDeAccion(paso.accion)] += 1;
  return conteos;
}

/**
 * Tramos de pasos seguidos en una página, cuando son más de lo razonable para la ruta.
 * No cuenta la página final de un intento logrado (ahí lee la respuesta).
 *
 * Los pasos "en una página" son las acciones hechas estando en ella, contando la que la deja: la misma cuenta
 * que los pasos de un tramo de la ruta (la ruta: "3 pasos" bajo Inicio ↔ "da 6 pasos seguidos en «Inicio» (la
 * ruta: 3)"). El umbral se calcula con los pasos que se quedan en la página (diseño §2.6), que es lo mismo
 * con uno menos a cada lado.
 * @param {{ pasos: { numero: number, accion: string, pagina: string | null, salePagina: boolean }[] }} intento
 * @param {{ paginas: string[], tramos: { pasos: number }[] } | null} ruta
 * @param {{ logrado: boolean, paginaFinal: string | null, comoRuta?: (pagina: string) => string }} opciones
 *        `comoRuta`: la página que hace de hito (otra página de inicio cuenta como el inicio de la ruta).
 * @returns {Demora[]}
 */
export function demorasDelIntento(intento, ruta, { logrado, paginaFinal, comoRuta = (pagina) => pagina }) {
  const tramos = [];
  let actual = null;
  for (const paso of intento.pasos) {
    if (paso.salePagina || !paso.pagina) {
      // El paso que deja la página se hizo en ella: cuenta en su tramo.
      if (actual && paso.salePagina) actual.salida = paso;
      actual = null;
      continue;
    }
    if (!actual || actual.pagina !== paso.pagina) {
      actual = { pagina: paso.pagina, pasos: [], salida: null };
      tramos.push(actual);
    }
    actual.pasos.push(paso);
  }
  const demoras = [];
  for (const { pagina, pasos, salida } of tramos) {
    if (logrado && pagina === paginaFinal) continue;
    const hito = ruta ? ruta.paginas.indexOf(comoRuta(pagina)) : -1;
    const esHitoIntermedio = hito >= 0 && hito < ruta.paginas.length - 1;
    const seQuedanEnRuta = esHitoIntermedio ? Math.max(0, ruta.tramos[hito].pasos - 1) : null;
    const umbral = seQuedanEnRuta === null
      ? UMBRAL_MINIMO_DE_DEMORA
      : Math.max(UMBRAL_MINIMO_DE_DEMORA, 2 * seQuedanEnRuta, seQuedanEnRuta + 3);
    if (pasos.length < umbral) continue;
    const enLaPagina = salida ? [...pasos, salida] : pasos;
    demoras.push({
      pagina,
      desdePaso: pasos[0].numero,
      hastaPaso: enLaPagina.at(-1).numero,
      pasos: enLaPagina.length,
      rutaPasos: esHitoIntermedio ? ruta.tramos[hito].pasos : null,
      conteos: contarAcciones(enLaPagina),
    });
  }
  return demoras;
}

const hallazgo = (id, nivel, tipo, vars, { intento = null, paso = null, pagina = null } = {}) => ({
  id,
  nivel,
  clave: `datos.hallazgo.${tipo}`,
  vars,
  intento,
  paso,
  pagina,
});

/** La señal que convierte un paso en tropiezo (la primera de las que cuentan). */
const senalDeTropiezo = (paso) => SENALES_DE_TROPIEZO.find((senal) => paso.senales.includes(senal)) ?? null;

// Al recortar la lista nunca se pierden el resultado ni los tropiezos (el titular y la cifra de tropiezos dependen de
// ellos); se cortan primero los desvíos (uno por intento: los que sobran ya se ven en la telaraña).
const QUE_NO_SE_CORTAN = new Set(["resultado", "tropiezos"]);
const tipoDe = (h) => h.id.split(":")[0];

/** La lista recortada a `maximo`: primero se van los últimos desvíos; después, los últimos que no sean protegidos. */
export function recortarHallazgos(lista, maximo = MAXIMO_DE_HALLAZGOS) {
  const quedan = [...lista];
  const quitarUltimo = (puede) => {
    for (let i = quedan.length - 1; i >= 0; i -= 1) {
      if (puede(quedan[i])) {
        quedan.splice(i, 1);
        return true;
      }
    }
    return false;
  };
  while (quedan.length > maximo) {
    if (!quitarUltimo((h) => tipoDe(h) === "desvio") && !quitarUltimo((h) => !QUE_NO_SE_CORTAN.has(tipoDe(h)))) break;
  }
  return quedan;
}

/**
 * Los hallazgos de una tanda, en orden: resultado, errores, desvíos (por paso), detenidos, demoras,
 * tropiezos y costo. Máximo 8 (recortarHallazgos: el resultado y los tropiezos nunca se cortan). Los intentos con
 * error de la herramienta solo aparecen en `errores`.
 * @param {{ intentos: any[], telarana: { ruta: any }, kpis: any }} tanda
 * @param {{ maximo?: number }} [opciones]
 * @returns {Hallazgo[]}
 */
export function hallazgos(tanda, { maximo = MAXIMO_DE_HALLAZGOS } = {}) {
  const { intentos, kpis } = tanda;
  const ruta = tanda.telarana.ruta;
  const validos = intentos.filter((intento) => intento.resultado !== "error");
  const errados = intentos.filter((intento) => intento.resultado === "error");
  const lista = [];

  const noLogrados = validos.filter((intento) => intento.resultado !== "logrado");
  lista.push(
    hallazgo(
      "resultado",
      validos.length && !noLogrados.length ? "bien" : "atencion",
      "resultado",
      {
        total: intentos.length,
        validos: validos.length,
        logrados: kpis.logrados,
        directos: kpis.directos,
        siguen: kpis.siguenLaRuta,
        errores: errados.length,
        intentos: noLogrados.map((intento) => intento.id),
      },
    ),
  );

  if (errados.length) {
    lista.push(
      hallazgo("errores", "info", "errores", { intentos: errados.map((intento) => intento.id) }, {
        intento: errados[0].id,
      }),
    );
  }

  const desvios = validos
    .filter((intento) => intento.seSepara && !intento.seSepara.seDetuvo)
    .sort((a, b) => a.seSepara.paso - b.seSepara.paso);
  for (const intento of desvios) {
    const { tramo, paso, pagina } = intento.seSepara;
    lista.push(
      hallazgo(
        `desvio:${intento.id}`,
        intento.vuelveALaRuta ? "info" : "atencion",
        "desvio",
        {
          intento: intento.id,
          desdePagina: ruta?.paginas[Math.max(0, tramo - 1)] ?? intento.camino[0] ?? null,
          haciaPagina: pagina,
          paso,
          vuelveEnPaso: intento.vuelveEnPaso,
        },
        { intento: intento.id, paso, pagina },
      ),
    );
  }

  for (const intento of noLogrados) {
    const pagina = intento.camino.at(-1) ?? null;
    const paso = intento.pasos.at(-1)?.numero ?? 0;
    lista.push(
      hallazgo(
        `detenido:${intento.id}`,
        "atencion",
        "detenido",
        { intento: intento.id, pagina, pasos: intento.pasos.length, motivo: intento.motivoDeFin },
        { intento: intento.id, paso: paso || null, pagina },
      ),
    );
  }

  // Exploradores: se quedan en una página a propósito (hacen inventario del inicio y vuelven a él), así que una
  // demora no dice que el sitio les cueste (como el costo en pasos). Sus demoras siguen marcando la telaraña.
  for (const intento of tanda.exploradores ? [] : validos) {
    for (const demora of intento.demoras) {
      lista.push(
        hallazgo(
          `demora:${intento.id}:${demora.desdePaso}`,
          "atencion",
          "demora",
          {
            intento: intento.id,
            pagina: demora.pagina,
            pasos: demora.pasos,
            rutaPasos: demora.rutaPasos,
            conteos: demora.conteos,
          },
          { intento: intento.id, paso: demora.desdePaso, pagina: demora.pagina },
        ),
      );
    }
  }

  const tropiezos = validos.flatMap((intento) =>
    intento.pasos
      .filter((paso) => paso.estado !== "sin_evaluar")
      .map((paso) => ({ intento: intento.id, paso: paso.numero, senal: senalDeTropiezo(paso), pagina: paso.pagina })),
  );
  if (tropiezos.length) {
    const [primero] = tropiezos;
    lista.push(
      hallazgo(
        "tropiezos",
        "atencion",
        "tropiezos",
        {
          pasos: tropiezos.length,
          casos: tropiezos.slice(0, MAXIMO_DE_TROPIEZOS).map(({ intento, paso, senal }) => ({ intento, paso, senal })),
        },
        { intento: primero.intento, paso: primero.paso, pagina: primero.pagina },
      ),
    );
  }

  if (!tanda.exploradores && ruta && kpis.pasosMediana !== null && kpis.pasosIdeales && kpis.pasosMediana >= FACTOR_DE_COSTO * kpis.pasosIdeales) {
    lista.push(
      hallazgo("costo", "info", "costo", { pasosMediana: kpis.pasosMediana, pasosIdeales: kpis.pasosIdeales }),
    );
  }

  return recortarHallazgos(lista, maximo);
}

const primerValido = (tanda, perfil) =>
  perfil.intentos.find((id) => tanda.intentos.find((intento) => intento.id === id)?.resultado !== "error") ?? null;

const mediana = (numeros) => {
  if (!numeros.length) return null;
  const orden = [...numeros].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};

const TIPOS_DE_DIFICULTAD = new Set(["demora", "costo", "tropiezos"]);

/**
 * Cuando todos llegan pero alguien lo pasó mal (hay demora, costo o tropiezos), qué contar en el titular: el
 * intento que más se alejó de la ruta en pasos; si ninguno dio más pasos que la ruta, la demora o los tropiezos.
 * El hallazgo principal del producto es la distancia entre la ruta y lo que hicieron: el titular no la esconde.
 * @returns {Record<string, unknown> | null}
 */
function dificultad(tanda, lista) {
  const [resultado] = lista;
  if (resultado?.nivel !== "bien" || !lista.some((h) => TIPOS_DE_DIFICULTAD.has(h.id.split(":")[0]))) return null;
  const ruta = tanda.telarana.ruta;
  const logrados = tanda.intentos.filter((intento) => intento.resultado === "logrado");
  let peor = null;
  for (const intento of tanda.exploradores ? [] : logrados) {
    if (!ruta?.pasosIdeales || intento.pasos.length <= ruta.pasosIdeales) continue;
    if (!peor || intento.pasos.length > peor.pasos.length) peor = intento;
  }
  if (peor) return { caso: "masPasos", intento: peor.id, pasos: peor.pasos.length, pasosIdeales: ruta.pasosIdeales };
  const demora = lista.find((h) => h.id.startsWith("demora:"));
  if (demora) return { caso: "demora", intento: demora.vars.intento, pagina: demora.vars.pagina, pasos: demora.vars.pasos };
  const tropiezos = lista.find((h) => h.id === "tropiezos");
  if (tropiezos) return { caso: "tropiezos", pasos: tropiezos.vars.pasos };
  return null;
}

/**
 * Las frases con que abren la cabecera de la tanda (la tanda y sus intentos) y Telaraña, como clave + variables.
 * `tanda` lleva además `nivel`: "bien" (todos llegan sin dificultad), "dificultad" (todos llegan, pero alguien
 * tarda o tropieza: datos.titular.tanda) o el nivel del hallazgo `resultado`.
 * @param {{ intentos: any[], telarana: { ruta: any }, kpis: any, perfiles: any[] }} tanda
 * @param {Hallazgo[]} lista   los hallazgos de la tanda (el primero es `resultado`)
 * @returns {{ tanda: Texto & { nivel: string }, telarana: Texto, perfiles: Texto }}
 */
export function titulares(tanda, lista) {
  const { kpis, perfiles } = tanda;
  const ruta = tanda.telarana.ruta;
  const [resultado] = lista;

  const telarana = {
    clave: "datos.titular.telarana",
    vars: {
      hayRuta: Boolean(ruta),
      enInicio: Boolean(tanda.telarana.rutaEnInicio),
      probabilidad: tanda.telarana.rutaEnInicio?.probabilidad ?? null,
      tramos: ruta?.tramos.length ?? 0,
      pasosIdeales: ruta?.pasosIdeales ?? null,
      siguen: kpis.siguenLaRuta,
      validos: kpis.validos,
      logrados: kpis.logrados,
    },
  };

  const conValidos = perfiles.filter((perfil) => perfil.validos > 0);
  const base = {
    intentos: [],
    pasos: null,
    pasosIdeales: ruta?.pasosIdeales ?? null,
    perfiles: conValidos.length,
    unoPorPerfil: perfiles.every((perfil) => perfil.validos <= 1),
  };
  let vars;
  const quedanCortos = conValidos.filter((perfil) => perfil.logrados < perfil.validos);
  if (!conValidos.length) {
    vars = { ...base, caso: "sinValidos" };
  } else if (quedanCortos.length) {
    const intentos = quedanCortos.map((perfil) =>
      perfil.intentos.find((id) => {
        const intento = tanda.intentos.find((otro) => otro.id === id);
        return intento && intento.resultado !== "logrado" && intento.resultado !== "error";
      }),
    );
    vars = { ...base, caso: "noLlegan", intentos };
  } else if (tanda.exploradores || !ruta?.pasosIdeales) {
    // Sin ruta no hay costo con qué comparar; los exploradores dan pasos de más a propósito.
    vars = { ...base, caso: "llegan" };
  } else {
    let peor = null;
    for (const perfil of conValidos) {
      const pasos = mediana(perfil.metricas.pasos.valores);
      if (!ruta?.pasosIdeales || pasos === null) continue;
      const razon = pasos / ruta.pasosIdeales;
      if (!peor || razon > peor.razon) peor = { perfil, pasos, razon };
    }
    vars = peor && peor.razon >= FACTOR_DE_COSTO
      ? { ...base, caso: "masPasos", intentos: [primerValido(tanda, peor.perfil)], pasos: peor.pasos }
      : { ...base, caso: "parecido" };
  }

  const conDificultad = dificultad(tanda, lista);
  return {
    tanda: conDificultad
      ? {
          clave: "datos.titular.tanda",
          nivel: "dificultad",
          vars: { validos: resultado.vars.validos, errores: resultado.vars.errores, ...conDificultad },
        }
      : { clave: resultado.clave, nivel: resultado.nivel, vars: resultado.vars },
    telarana,
    perfiles: { clave: "datos.titular.perfiles", vars },
  };
}
