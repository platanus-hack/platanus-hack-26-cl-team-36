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
 * @property {number} hastaPaso
 * @property {number} pasos
 * @property {number | null} rutaPasos      pasos dentro de esa página que da la ruta recomendada
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
 * Tramos de pasos seguidos que se quedan en una página, cuando son más de lo razonable para la ruta.
 * No cuenta la página final de un intento logrado (ahí lee la respuesta).
 * @param {{ pasos: { numero: number, accion: string, pagina: string | null, salePagina: boolean }[] }} intento
 * @param {{ paginas: string[], tramos: { pasos: number }[] } | null} ruta
 * @param {{ logrado: boolean, paginaFinal: string | null }} opciones
 * @returns {Demora[]}
 */
export function demorasDelIntento(intento, ruta, { logrado, paginaFinal }) {
  const tramos = [];
  let actual = null;
  for (const paso of intento.pasos) {
    if (paso.salePagina || !paso.pagina) {
      actual = null;
      continue;
    }
    if (!actual || actual.pagina !== paso.pagina) {
      actual = { pagina: paso.pagina, pasos: [] };
      tramos.push(actual);
    }
    actual.pasos.push(paso);
  }
  const demoras = [];
  for (const { pagina, pasos } of tramos) {
    if (logrado && pagina === paginaFinal) continue;
    const hito = ruta ? ruta.paginas.indexOf(pagina) : -1;
    const esHitoIntermedio = hito >= 0 && hito < ruta.paginas.length - 1;
    const rutaPasos = esHitoIntermedio ? Math.max(0, ruta.tramos[hito].pasos - 1) : null;
    const umbral = rutaPasos === null
      ? UMBRAL_MINIMO_DE_DEMORA
      : Math.max(UMBRAL_MINIMO_DE_DEMORA, 2 * rutaPasos, rutaPasos + 3);
    if (pasos.length < umbral) continue;
    demoras.push({
      pagina,
      desdePaso: pasos[0].numero,
      hastaPaso: pasos.at(-1).numero,
      pasos: pasos.length,
      rutaPasos,
      conteos: contarAcciones(pasos),
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

/**
 * Los hallazgos de una tanda, en orden: resultado, errores, desvíos (por paso), detenidos, demoras,
 * tropiezos y costo. Máximo 8. Los intentos con error de la herramienta solo aparecen en `errores`.
 * @param {{ intentos: any[], telarana: { ruta: any }, kpis: any }} tanda
 * @returns {Hallazgo[]}
 */
export function hallazgos(tanda) {
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

  for (const intento of validos) {
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

  if (ruta && kpis.pasosMediana !== null && kpis.pasosIdeales && kpis.pasosMediana >= FACTOR_DE_COSTO * kpis.pasosIdeales) {
    lista.push(
      hallazgo("costo", "info", "costo", { pasosMediana: kpis.pasosMediana, pasosIdeales: kpis.pasosIdeales }),
    );
  }

  return lista.slice(0, MAXIMO_DE_HALLAZGOS);
}

const primerValido = (tanda, perfil) =>
  perfil.intentos.find((id) => tanda.intentos.find((intento) => intento.id === id)?.resultado !== "error") ?? null;

const mediana = (numeros) => {
  if (!numeros.length) return null;
  const orden = [...numeros].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};

/**
 * Las frases con que abren Resumen (tanda), Telaraña y Perfiles, como clave + variables.
 * @param {{ intentos: any[], telarana: { ruta: any }, kpis: any, perfiles: any[] }} tanda
 * @param {Hallazgo[]} lista   los hallazgos de la tanda (el primero es `resultado`)
 * @returns {{ tanda: Texto, telarana: Texto, perfiles: Texto }}
 */
export function titulares(tanda, lista) {
  const { kpis, perfiles } = tanda;
  const ruta = tanda.telarana.ruta;
  const [resultado] = lista;

  const telarana = {
    clave: "datos.titular.telarana",
    vars: {
      hayRuta: Boolean(ruta),
      tramos: ruta?.tramos.length ?? 0,
      pasosIdeales: ruta?.pasosIdeales ?? null,
      siguen: kpis.siguenLaRuta,
      validos: kpis.validos,
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

  return {
    tanda: { clave: resultado.clave, vars: resultado.vars },
    telarana,
    perfiles: { clave: "datos.titular.perfiles", vars },
  };
}
