// Componente "buscador": una paleta de comandos (⌘K) para saltar a cualquier tarea de un sitio
// escribiendo lo que se quiere hacer. La vista inserta un botón discreto («Buscar una tarea…»)
// que abre un <dialog> modal con un campo y la lista filtrada. Con `teclas: true` también se abre
// con ⌘K / Ctrl+K o con `/` (este último no, si se está escribiendo en un campo de la página).
//
// Items, una tarea cada uno (en `datos` del tema; típicamente el catálogo de objetivos del sitio):
//   titulo    lo que se busca, por idioma { es, en }
//   enlace    adónde lleva, solo del mismo sitio
//   detalle   (opcional) una línea que lo explica, por idioma
//   palabras  (opcional) sinónimos que también lo encuentran: lista o texto, por idioma
//   grupo     (opcional) sección de la lista con `agrupar`, por idioma
//
// Opciones:
//   max       cuántos resultados mostrar (por defecto 8)
//   sugeridas cuántas tareas mostrar antes de escribir, en el orden del tema (por defecto `max`)
//   agrupar   true: los resultados van bajo el `grupo` de cada tarea
//   teclas    true: suma los atajos globales. Por omisión no, para no quitarle Ctrl+K (la barra
//             de búsqueda) ni `/` (buscar en la página) a Firefox en un sitio que no lo pidió
//   textos    por idioma, para reemplazar los genéricos del diccionario (claves `buscador.*`
//             de comun/idioma.js): { es: { boton, titulo, campo, … }, en: {…} }
//
// El filtrado es difuso y sin dependencias: sin acentos ni mayúsculas, cada palabra escrita debe
// aparecer en el título, las palabras o el detalle (pesan en ese orden); si no, en el título como
// letras en orden («plnr» → «planificador»). Sin tareas válidas no dibuja nada.

(() => {
  const { crear } = MiTema.dom;
  const { enIdioma, textosDe, urlMismoSitio } = MiTema.plantillas;

  const CLAVES = ["boton", "titulo", "campo", "sugerencias", "sin-resultados", "sin-resultados-ayuda", "cerrar", "mover", "abrir", "atajo", "atajo-mac"];
  const MAX_CONSULTA = 100;
  let vistas = 0; // para ids únicos

  // ---------- filtrado ----------

  // Sin acentos, en minúsculas y del mismo largo que el original (un carácter por carácter), así
  // una coincidencia en el texto normalizado marca las mismas posiciones en el original.
  function normalizar(texto) {
    return Array.from(String(texto ?? "").split(""), (c) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()[0] ?? " ").join("");
  }

  const palabrasDe = (consulta) => normalizar(String(consulta ?? "").slice(0, MAX_CONSULTA)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const esLetra = (c) => /[\p{L}\p{N}]/u.test(c ?? "");

  // Posición de la palabra en el texto: primero al comienzo de una palabra del texto, si no en
  // cualquier lado. → { desde, inicio } o null.
  function buscarEn(texto, palabra) {
    let desde = texto.indexOf(palabra);
    let primera = -1;
    while (desde !== -1) {
      if (!esLetra(texto[desde - 1])) return { desde, inicio: true };
      if (primera === -1) primera = desde;
      desde = texto.indexOf(palabra, desde + 1);
    }
    return primera === -1 ? null : { desde: primera, inicio: false };
  }

  // Letras de la palabra en orden dentro del texto, lo más juntas posible → puntaje 0..1.
  function enOrden(texto, palabra) {
    if (palabra.length < 3) return 0;
    let i = texto.indexOf(palabra[0]);
    if (i === -1) return 0;
    const inicio = i;
    for (const letra of palabra.slice(1)) {
      i = texto.indexOf(letra, i + 1);
      if (i === -1) return 0;
    }
    return palabra.length / (i - inicio + 1);
  }

  const PESOS = { titulo: [100, 60], palabras: [45, 30], detalle: [18, 10] };

  // `palabras`: "texto", ["a", "b"], { es: […], en: […] } o [{ es, en }, …].
  function listaPalabras(valor, idioma) {
    if (valor == null) return [];
    if (Array.isArray(valor)) return valor.flatMap((v) => listaPalabras(v, idioma));
    if (typeof valor === "object") return listaPalabras(valor[idioma] ?? valor.es ?? Object.values(valor)[0], idioma);
    return [String(valor)];
  }

  // Textos normalizados de una tarea en el idioma (una vez por dibujo, no por tecla).
  function indexar(item, idioma) {
    const titulo = enIdioma(item.titulo, idioma);
    const detalle = enIdioma(item.detalle, idioma);
    return {
      item,
      titulo,
      detalle,
      grupo: enIdioma(item.grupo, idioma),
      enlace: urlMismoSitio(item.enlace),
      normal: { titulo: normalizar(titulo), palabras: normalizar(listaPalabras(item.palabras, idioma).join(" · ")), detalle: normalizar(detalle) },
    };
  }

  // → { puntaje, marcas: [[desde, hasta]] en el título } o null si alguna palabra no aparece.
  function puntuar(tarea, consulta) {
    const palabras = palabrasDe(consulta);
    if (palabras.length === 0) return { puntaje: 0, marcas: [] };
    let puntaje = 0;
    const marcas = [];
    for (const palabra of palabras) {
      let mejor = 0;
      for (const [campo, [alInicio, adentro]] of Object.entries(PESOS)) {
        const hallada = buscarEn(tarea.normal[campo], palabra);
        if (!hallada) continue;
        const valor = hallada.inicio ? alInicio : adentro;
        if (campo === "titulo") marcas.push([hallada.desde, hallada.desde + palabra.length]);
        mejor = Math.max(mejor, valor);
      }
      if (mejor === 0) mejor = 25 * enOrden(tarea.normal.titulo, palabra);
      if (mejor === 0) return null;
      puntaje += mejor;
    }
    if (tarea.normal.titulo.startsWith(palabras.join(" "))) puntaje += 30;
    return { puntaje, marcas: unirMarcas(marcas) };
  }

  function unirMarcas(marcas) {
    const unidas = [];
    for (const [desde, hasta] of marcas.sort((a, b) => a[0] - b[0])) {
      const ultima = unidas.at(-1);
      if (ultima && desde <= ultima[1]) ultima[1] = Math.max(ultima[1], hasta);
      else unidas.push([desde, hasta]);
    }
    return unidas;
  }

  // Las tareas que calzan, de mejor a peor (a igual puntaje, en el orden del tema).
  function filtrar(tareas, consulta, max = Infinity) {
    return tareas
      .map((tarea, orden) => ({ tarea, orden, puntuado: puntuar(tarea, consulta) }))
      .filter((r) => r.puntuado)
      .map(({ tarea, orden, puntuado }) => ({ tarea, orden, ...puntuado }))
      .sort((a, b) => b.puntaje - a.puntaje || a.orden - b.orden)
      .slice(0, max);
  }

  // Tareas usables: con título y enlace del mismo sitio.
  const tareasDe = (items, idioma) => items.map((item) => indexar(item, idioma)).filter((t) => t.titulo && t.enlace);

  // ---------- teclas globales ----------

  const abiertos = new Set(); // buscadores dibujados: el último conectado responde a las teclas

  function esEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type ?? "");
  }

  let escuchando = false;
  function escucharTeclas() {
    if (escuchando) return;
    escuchando = true;
    document.addEventListener("keydown", (evento) => {
      if (evento.defaultPrevented || evento.altKey || evento.isComposing) return;
      const modK = (evento.metaKey || evento.ctrlKey) && !evento.shiftKey && evento.key?.toLowerCase() === "k";
      const barra = evento.key === "/" && !evento.metaKey && !evento.ctrlKey;
      if (!modK && !barra) return;
      const activo = document.activeElement;
      // `/` se escribe en los campos; ⌘K solo se respeta en editores ricos (suelen usarlo para enlaces).
      if (barra ? esEditable(activo) : activo?.isContentEditable) return;
      for (const buscador of abiertos) if (!buscador.conectado()) abiertos.delete(buscador);
      const buscador = [...abiertos].at(-1);
      if (!buscador || !buscador.disponible()) return;
      evento.preventDefault();
      buscador.alternar();
    }, true);
  }

  const esMac = () => /mac|iphone|ipad/i.test(globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform ?? "");

  // ---------- dibujo ----------

  const tecla = (texto) => crear("kbd", { clase: "mt-buscador__tecla", texto });

  // Título con las coincidencias en <mark>, todo como texto.
  function tituloMarcado(titulo, marcas) {
    const partes = [];
    let previo = 0;
    for (const [desde, hasta] of marcas) {
      if (desde > previo) partes.push(titulo.slice(previo, desde));
      partes.push(crear("mark", { clase: "mt-buscador__marca", texto: titulo.slice(desde, hasta) }));
      previo = hasta;
    }
    if (previo < titulo.length) partes.push(titulo.slice(previo));
    return crear("span", { clase: "mt-buscador__opcion-titulo" }, partes);
  }

  function dibujar(items, opciones, contexto) {
    const idioma = MiTema.idioma.actual();
    const t = textosDe("buscador", CLAVES, opciones.textos, idioma);
    const tareas = tareasDe(items, idioma);
    if (tareas.length === 0) return null;
    const max = opciones.max ?? 8;
    const id = `mt-buscador-${++vistas}`;
    const atajo = esMac() ? t["atajo-mac"] : t.atajo;
    const teclas = opciones.teclas === true;

    const disparador = crear("button", {
      clase: "mt-buscador__disparador",
      type: "button",
      "aria-haspopup": "dialog",
      "aria-controls": `${id}-dialogo`,
      "aria-keyshortcuts": teclas ? "Meta+K Control+K /" : null,
    }, [
      crear("span", { clase: "mt-buscador__lupa", "aria-hidden": "true" }),
      crear("span", { clase: "mt-buscador__disparador-texto", texto: t.boton }),
      teclas && crear("span", { clase: "mt-buscador__teclas", "aria-hidden": "true" }, tecla(atajo)),
    ]);

    const campo = crear("input", {
      clase: "mt-buscador__campo",
      id: `${id}-campo`,
      type: "text",
      role: "combobox",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "go",
      maxlength: String(MAX_CONSULTA),
      placeholder: t.campo,
      "aria-label": t.campo,
      "aria-expanded": "true",
      "aria-controls": `${id}-lista`,
      "aria-autocomplete": "list",
    });
    const cerrar = crear("button", { clase: "mt-buscador__cerrar", type: "button", "aria-label": t.cerrar }, tecla("Esc"));
    const lista = crear("ul", { clase: "mt-buscador__lista", id: `${id}-lista`, role: "listbox", "aria-label": t.titulo });
    const tituloVacio = crear("p", { clase: "mt-buscador__vacio-titulo" });
    const vacio = crear("div", { clase: "mt-buscador__vacio", hidden: "hidden" }, [
      tituloVacio,
      crear("p", { clase: "mt-buscador__vacio-ayuda", texto: t["sin-resultados-ayuda"] }),
    ]);
    const anuncio = crear("p", { clase: "mt-buscador__anuncio", role: "status", "aria-live": "polite" });
    const pie = crear("footer", { clase: "mt-buscador__pie", "aria-hidden": "true" }, [
      crear("span", { clase: "mt-buscador__ayuda" }, [tecla("↑"), tecla("↓"), crear("span", { texto: t.mover })]),
      crear("span", { clase: "mt-buscador__ayuda" }, [tecla("↵"), crear("span", { texto: t.abrir })]),
    ]);
    const dialogo = crear("dialog", { clase: "mt-buscador__dialogo", id: `${id}-dialogo`, "aria-labelledby": `${id}-titulo` }, [
      crear("div", { clase: "mt-buscador__panel" }, [
        crear("h2", { clase: "mt-buscador__titulo", id: `${id}-titulo`, texto: t.titulo }),
        crear("div", { clase: "mt-buscador__barra" }, [crear("span", { clase: "mt-buscador__lupa", "aria-hidden": "true" }), campo, cerrar]),
        crear("div", { clase: "mt-buscador__resultados" }, [lista, vacio]),
        pie,
        anuncio,
      ]),
    ]);

    let opcionesVisibles = []; // [{ li, enlace }]
    let activa = -1;

    function activar(i) {
      opcionesVisibles[activa]?.li.setAttribute("aria-selected", "false");
      activa = opcionesVisibles.length ? (i + opcionesVisibles.length) % opcionesVisibles.length : -1;
      const elegida = opcionesVisibles[activa];
      if (!elegida) return campo.removeAttribute("aria-activedescendant");
      elegida.li.setAttribute("aria-selected", "true");
      campo.setAttribute("aria-activedescendant", elegida.li.id);
      elegida.li.scrollIntoView?.({ block: "nearest" });
    }

    function opcion(resultado, n) {
      const { tarea, marcas = [] } = resultado;
      const enlace = crear("a", { clase: "mt-buscador__enlace", href: tarea.enlace, tabindex: "-1" }, [
        crear("span", { clase: "mt-buscador__opcion-textos" }, [
          tituloMarcado(tarea.titulo, marcas),
          tarea.detalle && crear("span", { clase: "mt-buscador__opcion-detalle", texto: tarea.detalle }),
        ]),
        crear("span", { clase: "mt-buscador__flecha", "aria-hidden": "true" }),
      ]);
      enlace.addEventListener("click", (evento) => contexto?.abrir?.(tarea.item, evento));
      const li = crear("li", { clase: "mt-buscador__opcion", id: `${id}-opcion-${n}`, role: "option", "aria-selected": "false" }, enlace);
      li.addEventListener("pointermove", () => activa !== n && activar(n));
      opcionesVisibles.push({ li, enlace });
      return li;
    }

    // Con `agrupar`, los grupos en el orden de su mejor resultado; si no, una lista corrida.
    function pintar() {
      const consulta = campo.value.trim();
      const resultados = consulta ? filtrar(tareas, consulta, max) : tareas.slice(0, opciones.sugeridas ?? max).map((tarea, orden) => ({ tarea, orden, marcas: [] }));
      opcionesVisibles = [];
      activa = -1;
      let n = 0;
      let hijos;
      if (opciones.agrupar) {
        const grupos = new Map();
        for (const r of resultados) {
          const nombre = r.tarea.grupo;
          if (!grupos.has(nombre)) grupos.set(nombre, []);
          grupos.get(nombre).push(r);
        }
        hijos = [...grupos].map(([nombre, rs], g) => {
          const idGrupo = `${id}-grupo-${g}`;
          return crear("li", { clase: "mt-buscador__grupo", role: "presentation" }, [
            nombre && crear("div", { clase: "mt-buscador__grupo-titulo", id: idGrupo, role: "presentation", texto: nombre }),
            crear("ul", { clase: "mt-buscador__grupo-lista", role: "group", "aria-labelledby": nombre ? idGrupo : null }, rs.map((r) => opcion(r, n++))),
          ]);
        });
      } else {
        hijos = resultados.map((r) => opcion(r, n++));
      }
      if (!consulta && !opciones.agrupar) {
        hijos.unshift(crear("li", { clase: "mt-buscador__grupo-titulo", role: "presentation", texto: t.sugerencias }));
      }
      lista.replaceChildren(...hijos);
      const sinResultados = resultados.length === 0;
      lista.hidden = sinResultados;
      vacio.hidden = !sinResultados;
      tituloVacio.textContent = sinResultados ? t["sin-resultados"].replaceAll("{consulta}", consulta) : "";
      anuncio.textContent = consulta ? MiTema.idioma.t(idioma, "buscador.resultados", { n: resultados.length }) : "";
      campo.setAttribute("aria-expanded", String(!sinResultados));
      activar(0);
    }

    let foco = null; // a dónde devolver el foco al cerrar
    function abrir() {
      if (dialogo.open) return;
      foco = document.activeElement;
      campo.value = "";
      pintar();
      dialogo.showModal();
      campo.focus();
    }
    function alternar() {
      if (dialogo.open) dialogo.close();
      else abrir();
    }

    disparador.addEventListener("click", abrir);
    cerrar.addEventListener("click", () => dialogo.close());
    dialogo.addEventListener("close", () => {
      const volver = foco?.isConnected ? foco : disparador;
      foco = null;
      volver.focus?.();
    });
    // Clic en el fondo (fuera del panel) cierra.
    dialogo.addEventListener("click", (evento) => {
      if (evento.target === dialogo) dialogo.close();
    });
    campo.addEventListener("input", pintar);
    campo.addEventListener("keydown", (evento) => {
      if (evento.isComposing) return;
      const pasos = { ArrowDown: 1, ArrowUp: -1 };
      if (evento.key in pasos) {
        evento.preventDefault();
        activar(activa + pasos[evento.key]);
      } else if (evento.key === "Enter") {
        const elegida = opcionesVisibles[activa];
        if (!elegida) return;
        evento.preventDefault();
        elegida.enlace.click();
      }
    });

    const raiz = crear("div", { clase: "mt-buscador" }, [disparador, dialogo]);
    if (teclas) {
      abiertos.add({
        conectado: () => raiz.isConnected,
        disponible: () => !contexto?.viendoOriginal?.() && document.documentElement.classList.contains("mi-tema"),
        alternar,
      });
      escucharTeclas();
    }
    return raiz;
  }

  MiTema.registrarComponente("buscador", { dibujar, normalizar, filtrar, puntuar, tareasDe });
})();
