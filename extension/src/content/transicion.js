// Transición al activar/desactivar Chameleon con el botón: la "metamorfosis".
//
// Un estallido con el espectro de la marca sale de la esquina superior derecha (donde
// está el botón) y la página entera se sacude en 3D. Cada bloque visible ("pieza", como
// las escamas del camaleón) se levanta, da una vuelta en 3D alejándose del botón, se
// tiñe del color del espectro que le toca y aterriza con rebote ya transformado. Al
// desactivar, las piezas vuelven a girar hacia el botón y la onda se recoge en él.
// Corre en cualquier sitio, tenga tema o no: sin cambios, las piezas giran igual.
//
// Cómo funciona (JS marca y mide; todo lo visual está en transicion.css):
//   - Con View Transitions (Firefox ≥ 144): se eligen hasta MAX_PIEZAS bloques visibles
//     (y hasta MAX_PIEZAS_NUEVAS que aparecen con el cambio; en total MAX_NOMBRES) y se
//     marcan con `data-mt-pieza="<i>"`; el CSS le da a cada uno el nombre `mt-p<i>`.
//     Sus parámetros van como propiedades personalizadas en <html> (`--mt-f-<i>`: qué tan
//     lejos está del botón, de 0 a 1; `--mt-a-<i>`: hacia dónde, en grados), que los
//     pseudoelementos de la transición heredan. El cambio de clase va dentro de
//     `document.startViewTransition`.
//   - Sin View Transitions: se aplica el tema al instante y una versión liviana (el
//     frente encima de la página y un destello por pieza). Al desactivar, sin efecto.
//   - Con los efectos «sutiles» (comun/efectos.js, el interruptor «Efectos» del popup): un fundido de 220 ms
//     de la página entera, sin piezas ni frente (o nada, sin View Transitions).
//   - Con `prefers-reduced-motion`: un fundido de 150 ms (o nada, sin View Transitions), elija los efectos que
//     elija.
//
// Solo corre cuando el usuario aprieta el botón (motor.js la llama desde el cambio de
// `activo` en storage), nunca al cargar ni al navegar. Siempre deja la página limpia:
// al terminar, al interrumpirse o si se vuelve a apretar el botón a mitad de camino.

(() => {
  const MAX_PIEZAS = 40; // del estado de antes
  const MAX_PIEZAS_NUEVAS = 16; // las que solo aparecen después del cambio
  const MAX_NOMBRES = MAX_PIEZAS + MAX_PIEZAS_NUEVAS; // reglas mt-p0 … mt-p55 en el CSS
  const MAX_VISITAS = 800; // tope del recorrido del DOM
  const AREA_MINIMA = 1600; // px² visibles (≈ 40 × 40)
  const LADO_MINIMO = 16; // px
  const FRACCION_CONTENEDOR = 0.28; // más del viewport que esto, con hijos: se baja a ellos
  const FRACCION_LADO = 0.6; // más ancho o alto que esto del viewport, con hijos: también
  const FRACCION_MAXIMA = 0.6; // una hoja más grande que esto queda con el fondo
  const DESPLAZAMIENTO_MAXIMO = 24; // px que puede moverse el centro de una pieza y seguir siendo la misma
  const ESCALA_MAXIMA = 1.25; // cuánto puede crecer o achicarse (ancho o alto)

  // Duración del modo ligero (ms): ahí no hay View Transition que avise que terminó.
  const DURACION_LIGERA = 1300;

  const ATRIBUTO_MODO = "data-mt-transicion"; // en <html>, mientras dura
  const ATRIBUTO_PIEZA = "data-mt-pieza"; // en cada pieza: su índice
  const ID_FRENTE = "mt-frente";
  const XHTML = "http://www.w3.org/1999/xhtml";
  const HOJAS = new Set(["img", "video", "canvas", "iframe", "svg", "picture", "input", "textarea", "select", "button"]);

  // ---------- Lógica pura (se testea con Node) ----------

  // Distancia desde `origen` al punto más cercano del rectángulo (o al más lejano).
  function distancia(rect, origen, lejano = false) {
    if (lejano) {
      const dx = Math.max(Math.abs(rect.left - origen.x), Math.abs(rect.right - origen.x));
      const dy = Math.max(Math.abs(rect.top - origen.y), Math.abs(rect.bottom - origen.y));
      return Math.hypot(dx, dy);
    }
    const dx = Math.max(rect.left - origen.x, 0, origen.x - rect.right);
    const dy = Math.max(rect.top - origen.y, 0, origen.y - rect.bottom);
    return Math.hypot(dx, dy);
  }

  // Dónde está una pieza respecto del botón (esquina superior derecha):
  //   f      cuándo la alcanza el frente, de 0 (junto al botón) a 1 (esquina opuesta). El
  //          radio máximo del frente es la diagonal del viewport. Al activar crece y toca
  //          primero el punto más cercano de la pieza; al desactivar se encoge hacia el
  //          botón y la toca primero por el más lejano (`lejano`).
  //   angulo dirección del botón al centro de la pieza, en grados (90 = hacia abajo,
  //          180 = hacia la izquierda). El CSS hace girar la pieza alejándose del botón.
  function posicion(rect, viewport, lejano = false) {
    const origen = { x: viewport.ancho, y: 0 };
    const maxima = Math.hypot(viewport.ancho, viewport.alto);
    const f = maxima > 0 ? Math.min(1, distancia(rect, origen, lejano) / maxima) : 0;
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const angulo = (Math.atan2(cy - origen.y, cx - origen.x) * 180) / Math.PI;
    return { f: Math.round(f * 1000) / 1000, angulo: Math.round(angulo) };
  }

  function areaVisible(rect, viewport) {
    const ancho = Math.min(rect.right, viewport.ancho) - Math.max(rect.left, 0);
    const alto = Math.min(rect.bottom, viewport.alto) - Math.max(rect.top, 0);
    return ancho > 0 && alto > 0 ? ancho * alto : 0;
  }

  // Recorre el árbol por niveles (lo grande primero) y elige las piezas: bloques
  // visibles y medianos. Un contenedor grande no es pieza: se baja a sus hijos, así las
  // piezas cubren la pantalla como mosaico sin anidarse.
  //   hijos(nodo)  → lista de hijos elemento
  //   medir(nodo)  → null (no se dibuja o no se puede capturar: se ignora con sus hijos)
  //                  | { soloHijos: true } (display: contents: se baja a sus hijos)
  //                  | { rect, hoja } (rect: left/top/right/bottom/width/height)
  //   omitir(nodo) → true para saltar el nodo y sus hijos (p. ej. ya elegido)
  //   lejano       ver posicion()
  function elegirPiezas(raiz, { hijos, medir, viewport, maximo = MAX_PIEZAS, omitir = () => false, lejano = false }) {
    const areaViewport = viewport.ancho * viewport.alto;
    const cola = [...hijos(raiz)];
    const piezas = [];
    for (let i = 0; i < cola.length && i < MAX_VISITAS && piezas.length < maximo; i++) {
      const nodo = cola[i];
      if (omitir(nodo)) continue;
      const medida = medir(nodo);
      if (!medida) continue;
      if (medida.soloHijos) {
        cola.push(...hijos(nodo));
        continue;
      }

      const { rect, hoja } = medida;
      const conHijos = !hoja && hijos(nodo).length > 0;
      // Envoltorios sin tamaño (alto 0 con hijos flotando): se mira adentro.
      if ((rect.width === 0 || rect.height === 0) && conHijos) {
        cola.push(...hijos(nodo));
        continue;
      }

      const visible = areaVisible(rect, viewport);
      if (visible === 0) continue;
      const grande =
        visible / areaViewport > FRACCION_CONTENEDOR ||
        rect.width > viewport.ancho * FRACCION_LADO ||
        rect.height > viewport.alto * FRACCION_LADO;
      if (grande && conHijos) {
        cola.push(...hijos(nodo));
        continue;
      }
      if (visible / areaViewport > FRACCION_MAXIMA) continue;
      if (visible < AREA_MINIMA || rect.width < LADO_MINIMO || rect.height < LADO_MINIMO) continue;
      piezas.push({ nodo, rect, ...posicion(rect, viewport, lejano) });
    }
    return piezas;
  }

  // ¿El tema movió la pieza o le cambió mucho el tamaño? Entonces no conviene que su
  // captura viaje de un lugar a otro.
  function seMovio(antes, despues) {
    const centro = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const [x1, y1] = centro(antes);
    const [x2, y2] = centro(despues);
    const escala = (a, b) => Math.max(a, b) / Math.max(1, Math.min(a, b));
    return (
      Math.hypot(x2 - x1, y2 - y1) > DESPLAZAMIENTO_MAXIMO ||
      escala(antes.width, despues.width) > ESCALA_MAXIMA ||
      escala(antes.height, despues.height) > ESCALA_MAXIMA
    );
  }

  // Qué versión de la transición corre. null = cambio instantáneo. El movimiento reducido manda sobre los efectos.
  function elegirModo(activar, { visible, conTransiciones, conClases, reducirMovimiento, sutil = false }) {
    if (!visible) return null; // pestañas de fondo: el navegador no anima y nadie mira
    if (reducirMovimiento) return conTransiciones ? "suave" : null;
    if (sutil) return conTransiciones ? "sutil" : null;
    if (conTransiciones && conClases) return activar ? "entrada" : "salida";
    return activar ? "ligera" : null;
  }

  // ---------- Con la página ----------

  // `entorno` = { documento, ventana, programar(fn, ms), cancelar(id) }. En la extensión
  // son los globales; los tests pasan uno falso.
  function crear(entorno) {
    const { documento, ventana } = entorno;
    // Corrida en curso: { modo, vt, piezas (nodo → rect de antes), indices (cuántos nombres
    // se usaron), frente, temporizador, limpia }.
    let actual = null;

    const viewport = () => ({ ancho: ventana.innerWidth, alto: ventana.innerHeight });

    function medir(nodo) {
      if (nodo.id === ID_FRENTE) return null;
      const esSvg = nodo.localName === "svg";
      if (nodo.namespaceURI !== XHTML && !esSvg) return null; // dentro de SVG/MathML
      const estilo = ventana.getComputedStyle(nodo);
      if (estilo.display === "contents") return { soloHijos: true };
      if (estilo.display === "none" || estilo.display === "inline" || estilo.visibility !== "visible") return null;
      // Algo partido en varios fragmentos no se puede capturar (la transición se cancelaría).
      const rects = nodo.getClientRects();
      if (rects.length !== 1) return null;
      const r = rects[0];
      const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      return { rect, hoja: esSvg || HOJAS.has(nodo.localName) };
    }

    const hijos = (nodo) => [...nodo.children];

    // Lee todo primero (elegirPiezas) y recién después escribe: el índice de cada pieza
    // en su atributo y sus parámetros en <html>, de donde los heredan los pseudoelementos.
    function marcar(corrida, piezas) {
      const estilo = documento.documentElement.style;
      for (const { nodo, rect, f, angulo } of piezas) {
        if (corrida.indices >= MAX_NOMBRES) break;
        const i = corrida.indices++;
        nodo.setAttribute(ATRIBUTO_PIEZA, String(i));
        estilo.setProperty(`--mt-f-${i}`, String(f));
        estilo.setProperty(`--mt-a-${i}`, String(angulo));
        corrida.piezas.set(nodo, rect);
      }
    }

    function buscarPiezas(opciones) {
      const cuerpo = documento.body;
      const lejano = actual?.modo === "salida";
      return cuerpo ? elegirPiezas(cuerpo, { hijos, medir, viewport: viewport(), lejano, ...opciones }) : [];
    }

    // Ya con el tema cambiado (dentro de la transición). Primero lee todo:
    //   - piezas que el tema movió o cambió mucho de tamaño: se sueltan, así la captura
    //     vieja se va en su lugar y la nueva aparece con la ola (en vez de cruzar volando
    //     la pantalla); también las que quedaron partidas en fragmentos;
    //   - piezas que solo existen ahora (p. ej. una vista del tema).
    // Después escribe.
    function remarcar(corrida) {
      const sueltas = new Set();
      for (const [nodo, antes] of corrida.piezas) {
        const rects = nodo.getClientRects();
        if (rects.length > 1 || (rects.length === 1 && seMovio(antes, rects[0]))) sueltas.add(nodo);
      }
      const nuevas = buscarPiezas({
        maximo: MAX_PIEZAS_NUEVAS,
        omitir: (nodo) => corrida.piezas.has(nodo),
      });
      for (const nodo of sueltas) {
        nodo.removeAttribute(ATRIBUTO_PIEZA);
        corrida.piezas.delete(nodo);
      }
      marcar(corrida, nuevas.filter(({ nodo }) => !sueltas.has(nodo)));
    }

    function ponerFrente(corrida) {
      const frente = documento.createElement("div");
      frente.id = ID_FRENTE;
      frente.setAttribute("aria-hidden", "true");
      const brillo = documento.createElement("div");
      brillo.className = "mt-brillo";
      frente.append(brillo);
      documento.documentElement.append(frente);
      corrida.frente = frente;
    }

    // Idempotente: se llama al terminar, al interrumpirse y desde el temporizador.
    function limpiar(corrida) {
      if (!corrida || corrida.limpia) return;
      corrida.limpia = true;
      entorno.cancelar(corrida.temporizador);
      for (const nodo of corrida.piezas.keys()) nodo.removeAttribute(ATRIBUTO_PIEZA);
      corrida.piezas.clear();
      const estilo = documento.documentElement?.style;
      for (let i = 0; i < corrida.indices; i++) {
        estilo?.removeProperty(`--mt-f-${i}`);
        estilo?.removeProperty(`--mt-a-${i}`);
      }
      corrida.indices = 0;
      corrida.frente?.remove();
      corrida.frente = null;
      if (actual === corrida) {
        actual = null;
        documento.documentElement?.removeAttribute(ATRIBUTO_MODO);
      }
    }

    function soporte() {
      const css = ventana.CSS;
      return {
        visible: documento.visibilityState === "visible",
        conTransiciones: typeof documento.startViewTransition === "function",
        conClases: !!css?.supports("view-transition-class", "mt-pieza"),
        reducirMovimiento: !!ventana.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      };
    }

    // Pasa de un estado al otro animando. `aplicar` hace el cambio real (en el motor:
    // poner o quitar la clase `mi-tema`); se llama siempre, una vez, haya animación o no.
    // `sutil`: los efectos que eligió el usuario son los sutiles (un fundido, sin piezas).
    function animar(activar, aplicar, { sutil = false } = {}) {
      // Otro clic a mitad de camino: la corrida anterior salta a su final y se limpia ya,
      // antes de marcar nada nuevo (sus piezas podrían repetirse en esta).
      const anterior = actual;
      if (anterior) {
        limpiar(anterior);
        anterior.vt?.skipTransition();
      }

      const modo = elegirModo(activar, { ...soporte(), sutil });
      if (!modo) return aplicar();

      const corrida = { modo, vt: null, piezas: new Map(), indices: 0, frente: null, temporizador: null, limpia: false };
      actual = corrida;
      documento.documentElement.setAttribute(ATRIBUTO_MODO, modo);

      if (modo === "ligera") {
        corrida.temporizador = entorno.programar(() => limpiar(corrida), DURACION_LIGERA);
        aplicar();
        marcar(corrida, buscarPiezas({}));
        ponerFrente(corrida);
        return;
      }

      // Los fundidos (suave y sutil) cambian la página entera, sin piezas ni frente.
      const fundido = modo === "suave" || modo === "sutil";
      if (!fundido) marcar(corrida, buscarPiezas({}));
      try {
        corrida.vt = documento.startViewTransition(() => {
          aplicar();
          if (fundido || corrida.limpia) return;
          remarcar(corrida);
          ponerFrente(corrida);
        });
      } catch (error) {
        console.warn("[mi-tema] No se pudo animar el cambio:", error);
        limpiar(corrida);
        return aplicar();
      }
      // `finished` siempre se resuelve: al terminar, al saltarse (otro clic, pestaña
      // oculta, el sitio empieza su propia transición) o si algo falla.
      corrida.vt.ready.catch(() => {}); // si se salta, `ready` se rechaza: no es un error
      corrida.vt.finished.then(
        () => limpiar(corrida),
        () => limpiar(corrida),
      );
    }

    return { animar, enCurso: () => actual?.modo ?? null };
  }

  let instancia = null;

  globalThis.MiTema.transicion = {
    // El motor llama a esto. Se crea al primer uso: la mayoría de las páginas nunca lo usa.
    animar(activar, aplicar, opciones) {
      instancia ??= crear({
        documento: document,
        ventana: window,
        programar: (fn, ms) => setTimeout(fn, ms),
        cancelar: (id) => clearTimeout(id),
      });
      instancia.animar(activar, aplicar, opciones);
    },
    // Para los tests.
    MAX_NOMBRES,
    distancia,
    posicion,
    elegirPiezas,
    seMovio,
    elegirModo,
    crear,
  };
})();
