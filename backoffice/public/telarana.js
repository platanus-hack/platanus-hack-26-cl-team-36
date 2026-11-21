// 03 Telaraña: el inicio al centro, un anillo por paso, la ruta recomendada como eje hacia la
// derecha y las demás rutas como ramas. Versión plana en SVG (.specs/backoffice-v0.md, sección 5):
// la escena 3D con three.js es la siguiente iteración y usa estos mismos datos.

import { recortar, svg } from "./dom.js";

const CENTRO = { x: 0, y: 0 };
const PASO_DE_ANILLO = 290; // distancia entre anillos, en unidades del dibujo
const MARGEN = { izquierda: 120, derecha: 120, arriba: 100, abajo: 120 };
const MAX_POR_HOJA = 0.95; // radianes como máximo por rama hoja, para que pocas ramas no se abran en 360°

export const COLORES = { exito: "#5AB0FF", mixto: "#9DB8D3", fallo: "#FF9F43", abandono: "#8C8C94" };

// Árbol de dibujo: cada nodo cuelga del nodo del anillo anterior que más intentos le mandó
// (la ruta recomendada primero). Así se reparten los ángulos sin cruzar ramas de más.
function arbolDeDibujo(nodos, ramas) {
  const porId = new Map(nodos.map((nodo) => [nodo.id, nodo]));
  const inicio = nodos.find((nodo) => nodo.esInicio) ?? nodos[0];
  const padre = new Map();
  for (const nodo of nodos) {
    if (nodo === inicio) continue;
    const candidatas = ramas
      .filter((rama) => rama.destino === nodo.id && rama.origen !== nodo.id)
      .filter((rama) => (porId.get(rama.origen)?.anillo ?? Infinity) === nodo.anillo - 1)
      .sort((a, b) => Number(b.enRuta) - Number(a.enRuta) || b.intentos - a.intentos);
    padre.set(nodo.id, candidatas[0]?.origen ?? inicio.id);
  }
  const hijos = new Map(nodos.map((nodo) => [nodo.id, []]));
  for (const [hijo, suyo] of padre) hijos.get(suyo)?.push(hijo);
  // La ruta recomendada va al medio de sus hermanos: así queda sobre el eje.
  for (const lista of hijos.values()) {
    const eje = lista.findIndex((id) => porId.get(id).enRuta);
    if (eje >= 0) {
      const [id] = lista.splice(eje, 1);
      lista.splice(Math.floor(lista.length / 2), 0, id);
    }
  }
  return { inicio, hijos, porId };
}

export function posiciones(nodos, ramas) {
  if (!nodos.length) return new Map();
  const { inicio, hijos, porId } = arbolDeDibujo(nodos, ramas);
  const hojas = new Map();
  const contar = (id) => {
    const suyos = hijos.get(id);
    const total = suyos.length ? suyos.reduce((suma, hijo) => suma + contar(hijo), 0) : 1;
    hojas.set(id, total);
    return total;
  };
  contar(inicio.id);

  const angulo = new Map([[inicio.id, 0]]);
  const repartir = (id, desde, hasta) => {
    const suyos = hijos.get(id);
    const total = suyos.reduce((suma, hijo) => suma + hojas.get(hijo), 0);
    let cursor = desde;
    for (const hijo of suyos) {
      const ancho = ((hasta - desde) * hojas.get(hijo)) / total;
      angulo.set(hijo, cursor + ancho / 2);
      repartir(hijo, cursor, cursor + ancho);
      cursor += ancho;
    }
  };
  const abertura = Math.min(2 * Math.PI * 0.92, hojas.get(inicio.id) * MAX_POR_HOJA);
  repartir(inicio.id, -abertura / 2, abertura / 2);
  // El eje: la ruta recomendada queda exactamente horizontal, hacia la derecha.
  const eje = nodos.filter((nodo) => nodo.enRuta && nodo !== inicio);
  const giro = eje.length ? angulo.get(eje.sort((a, b) => a.anillo - b.anillo)[0].id) : 0;
  for (const [id, valor] of angulo) angulo.set(id, valor - giro);
  for (const nodo of eje) angulo.set(nodo.id, 0);

  const anilloMaximo = Math.max(1, ...nodos.map((nodo) => nodo.anillo));
  const paso = PASO_DE_ANILLO;
  const resultado = new Map();
  for (const nodo of nodos) {
    const radio = nodo.anillo * paso;
    const a = angulo.get(nodo.id) ?? 0;
    resultado.set(nodo.id, { x: CENTRO.x + radio * Math.cos(a), y: CENTRO.y + radio * Math.sin(a), radio, a });
  }
  resultado.paso = paso;
  resultado.anilloMaximo = anilloMaximo;
  return resultado;
}

function curva(desde, hasta) {
  // Las ramas que vuelven o quedan en el mismo anillo se curvan hacia afuera.
  if (hasta.radio > desde.radio + 1) return `M ${desde.x} ${desde.y} L ${hasta.x} ${hasta.y}`;
  const medio = { x: (desde.x + hasta.x) / 2, y: (desde.y + hasta.y) / 2 };
  const dx = medio.x - CENTRO.x;
  const dy = medio.y - CENTRO.y;
  const largo = Math.hypot(dx, dy) || 1;
  const empuje = 90;
  return `M ${desde.x} ${desde.y} Q ${medio.x + (dx / largo) * empuje} ${medio.y + (dy / largo) * empuje} ${hasta.x} ${hasta.y}`;
}

function grosor(intentos) {
  return Math.min(18, 2 + intentos * 3);
}

// Dibuja la telaraña. `urlDeCaptura(captura)` da la URL de una captura; `alElegir(nodo)` se llama
// al hacer clic en un nodo. Devuelve el elemento y funciones para filtrar y enfocar.
export function dibujarTelarana(tanda, { urlDeCaptura, alElegir }) {
  const { nodos, ramas, ruta } = tanda.telarana;
  const pos = posiciones(nodos, ramas);
  // El lienzo se ajusta a lo dibujado: los nodos más sus tarjetas y etiquetas.
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const base = {
    x: Math.min(0, ...xs) - MARGEN.izquierda,
    y: Math.min(0, ...ys) - MARGEN.arriba,
  };
  base.ancho = Math.max(0, ...xs) + MARGEN.derecha - base.x;
  base.alto = Math.max(0, ...ys) + MARGEN.abajo - base.y;
  const ANCHO = base.ancho;
  const ALTO = base.alto;
  const porId = new Map(nodos.map((nodo) => [nodo.id, nodo]));

  const raiz = svg("svg", {
    viewBox: `${base.x} ${base.y} ${base.ancho} ${base.alto}`,
    role: "img",
    "aria-label": `Telaraña de rutas: ${nodos.length} páginas y ${ramas.length} ramas. La ruta recomendada va hacia la derecha.`,
  });
  const defs = svg("defs");
  raiz.append(defs);
  const mundo = svg("g");
  raiz.append(mundo);

  // Anillos: uno por paso desde el inicio.
  const capaAnillos = svg("g");
  for (let i = 1; i <= pos.anilloMaximo; i += 1) {
    capaAnillos.append(svg("circle", { class: "anillo", cx: CENTRO.x, cy: CENTRO.y, r: i * pos.paso }));
    capaAnillos.append(
      svg("text", { x: CENTRO.x + 6, y: CENTRO.y - i * pos.paso - 6, fill: "#5C5C63", "font-size": 11, "font-family": "JetBrains Mono, monospace", texto: `paso ${i}` }),
    );
  }
  mundo.append(capaAnillos);

  // Ramas, con partículas que fluyen de origen a destino.
  const capaRamas = svg("g");
  const elementosDeRama = [];
  for (const rama of ramas) {
    if (rama.origen === rama.destino) continue;
    const desde = pos.get(rama.origen);
    const hasta = pos.get(rama.destino);
    if (!desde || !hasta) continue;
    const d = curva(desde, hasta);
    const color = COLORES[rama.resultado];
    const grupo = svg(
      "g",
      { class: "rama" },
      svg("title", {
        texto: `${rama.accion}\n${porId.get(rama.origen)?.titulo ?? ""} → ${porId.get(rama.destino)?.titulo ?? ""}\n${rama.intentos} intento(s): ${rama.exitos} sin problemas, ${rama.fallos} con errores o sin éxito · ${rama.perfiles.join(", ")} · mediana ${rama.medianaSegundos} s`,
      }),
      svg("path", {
        d,
        fill: "none",
        stroke: color,
        "stroke-width": grosor(rama.intentos),
        "stroke-linecap": "round",
        "stroke-opacity": rama.resultado === "mixto" ? 0.75 : 0.9,
        "stroke-dasharray": rama.resultado === "abandono" ? "10 7" : null,
      }),
      svg("path", {
        d,
        class: "rama-flujo",
        fill: "none",
        stroke: "#EDEDED",
        "stroke-opacity": 0.55,
        "stroke-width": Math.max(2, grosor(rama.intentos) / 3),
        "stroke-linecap": "round",
      }),
    );
    // Etiqueta de la acción entre las dos tarjetas, un poco más cerca del destino.
    const medio = { x: desde.x + (hasta.x - desde.x) * 0.55, y: desde.y + (hasta.y - desde.y) * 0.55 };
    grupo.append(
      svg("text", {
        x: medio.x,
        y: medio.y - grosor(rama.intentos) / 2 - 6,
        "text-anchor": "middle",
        fill: "#C8C8CE",
        "font-size": 11,
        "paint-order": "stroke",
        stroke: "#0D0D0F",
        "stroke-width": 4,
        texto: `×${rama.intentos} · ${recortar(rama.accion, 26)}`,
      }),
    );
    capaRamas.append(grupo);
    elementosDeRama.push({ rama, grupo });
  }
  mundo.append(capaRamas);

  // El eje: la ruta recomendada, una línea blanca fina encima de las ramas.
  if (ruta) {
    const puntos = ruta.nodos.map((id) => pos.get(id)).filter(Boolean);
    if (puntos.length > 1) {
      mundo.append(
        svg("polyline", {
          points: puntos.map((p) => `${p.x},${p.y}`).join(" "),
          fill: "none",
          stroke: "#EDEDED",
          "stroke-width": 2,
          "pointer-events": "none",
        }),
      );
      const ultimo = puntos.at(-1);
      mundo.append(
        svg("text", {
          x: ultimo.x,
          y: ultimo.y + 100,
          "text-anchor": "middle",
          fill: "#EDEDED",
          "font-size": 11,
          "font-family": "JetBrains Mono, monospace",
          texto: "fin de la ruta recomendada",
        }),
      );
    }
  }

  // Nodos: la captura de la página, su título y cuántas visitas tuvo.
  const capaNodos = svg("g");
  const elementosDeNodo = [];
  for (const nodo of nodos) {
    const p = pos.get(nodo.id);
    const ancho = nodo.esInicio ? 150 : 120;
    const alto = Math.round(ancho * 0.75);
    const x = p.x - ancho / 2;
    const y = p.y - alto / 2;
    const recorte = `recorte-${nodo.id}`;
    defs.append(svg("clipPath", { id: recorte }, svg("rect", { x, y, width: ancho, height: alto, rx: 6 })));
    const finales = nodo.finales ?? {};
    const terminaron = (finales.success ?? 0) + (finales.failed ?? 0) + (finales.abandoned ?? 0);
    const grupo = svg(
      "g",
      {
        class: `nodo${nodo.enRuta ? " en-ruta" : ""}`,
        tabindex: 0,
        role: "button",
        "aria-label": `${nodo.titulo || nodo.url}: ${nodo.visitas} visitas${terminaron ? `, ${terminaron} intentos terminaron aquí` : ""}`,
        onclick: () => alElegir(nodo),
        onkeydown: (evento) => {
          if (evento.key === "Enter" || evento.key === " ") {
            evento.preventDefault();
            alElegir(nodo);
          }
        },
      },
      svg("title", { texto: `${nodo.titulo}\n${nodo.url}` }),
      svg("rect", { x, y, width: ancho, height: alto, rx: 6, fill: "#121214" }),
      nodo.captura
        ? svg("image", {
            href: urlDeCaptura(nodo.captura),
            x,
            y,
            width: ancho,
            height: alto,
            preserveAspectRatio: "xMidYMin slice",
            "clip-path": `url(#${recorte})`,
          })
        : null,
      svg("rect", { class: "marco", x, y, width: ancho, height: alto, rx: 6 }),
      svg("text", {
        x: p.x,
        y: y + alto + 16,
        "text-anchor": "middle",
        "font-weight": nodo.esInicio ? 600 : 400,
        texto: nodo.esInicio ? `Inicio · ${recortar(nodo.titulo, 24)}` : recortar(nodo.titulo || nodo.url, 30),
      }),
      svg("text", {
        class: "dato",
        x: p.x,
        y: y + alto + 31,
        "text-anchor": "middle",
        texto: `${nodo.visitas} visitas${terminaron ? ` · ${finales.success ?? 0}/${terminaron} terminan con éxito` : ""}`,
      }),
    );
    capaNodos.append(grupo);
    elementosDeNodo.push({ nodo, grupo });
  }
  mundo.append(capaNodos);

  // Cámara: arrastrar para mover, rueda para acercar, y viaje animado al elegir un nodo.
  let vista = { ...base };
  const aplicar = () => raiz.setAttribute("viewBox", `${vista.x} ${vista.y} ${vista.ancho} ${vista.alto}`);
  let animacion = null;
  const viajar = (destino, duracion = 600) => {
    cancelAnimationFrame(animacion);
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origen = { ...vista };
    const t0 = performance.now();
    const paso = (ahora) => {
      const t = reducido ? 1 : Math.min(1, (ahora - t0) / duracion);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      vista = Object.fromEntries(Object.keys(origen).map((k) => [k, origen[k] + (destino[k] - origen[k]) * e]));
      aplicar();
      if (t < 1) animacion = requestAnimationFrame(paso);
    };
    animacion = requestAnimationFrame(paso);
  };
  const zoom = (factor, cx = vista.x + vista.ancho / 2, cy = vista.y + vista.alto / 2) => {
    const ancho = Math.min(ANCHO * 2, Math.max(ANCHO / 5, vista.ancho * factor));
    const alto = (ancho * ALTO) / ANCHO;
    vista = { x: cx - ((cx - vista.x) * ancho) / vista.ancho, y: cy - ((cy - vista.y) * alto) / vista.alto, ancho, alto };
    aplicar();
  };
  const aCoordenadas = (evento) => {
    const caja = raiz.getBoundingClientRect();
    return {
      x: vista.x + ((evento.clientX - caja.left) / caja.width) * vista.ancho,
      y: vista.y + ((evento.clientY - caja.top) / caja.height) * vista.alto,
    };
  };
  // Con Ctrl o ⌘ (o pellizcando el trackpad) la rueda acerca; sin ellos, la página se desplaza.
  raiz.addEventListener(
    "wheel",
    (evento) => {
      if (!evento.ctrlKey && !evento.metaKey) return;
      evento.preventDefault();
      cancelAnimationFrame(animacion);
      const { x, y } = aCoordenadas(evento);
      zoom(evento.deltaY > 0 ? 1.12 : 1 / 1.12, x, y);
    },
    { passive: false },
  );
  let arrastre = null;
  raiz.addEventListener("pointerdown", (evento) => {
    if (evento.target.closest(".nodo")) return;
    cancelAnimationFrame(animacion);
    arrastre = { x: evento.clientX, y: evento.clientY, vista: { ...vista } };
    raiz.setPointerCapture(evento.pointerId);
    raiz.classList.add("arrastrando");
  });
  raiz.addEventListener("pointermove", (evento) => {
    if (!arrastre) return;
    const caja = raiz.getBoundingClientRect();
    vista = {
      ...arrastre.vista,
      x: arrastre.vista.x - ((evento.clientX - arrastre.x) / caja.width) * arrastre.vista.ancho,
      y: arrastre.vista.y - ((evento.clientY - arrastre.y) / caja.height) * arrastre.vista.alto,
    };
    aplicar();
  });
  const soltar = () => {
    arrastre = null;
    raiz.classList.remove("arrastrando");
  };
  raiz.addEventListener("pointerup", soltar);
  raiz.addEventListener("pointercancel", soltar);

  return {
    elemento: raiz,
    filtrar(perfil) {
      for (const { rama, grupo } of elementosDeRama) {
        grupo.style.opacity = !perfil || rama.perfiles.includes(perfil) ? "" : "0.08";
      }
      for (const { nodo, grupo } of elementosDeNodo) {
        grupo.style.opacity = !perfil || nodo.perfiles.includes(perfil) ? "" : "0.18";
      }
    },
    enfocar(idNodo) {
      for (const { nodo, grupo } of elementosDeNodo) grupo.classList.toggle("elegido", nodo.id === idNodo);
      const p = pos.get(idNodo);
      if (!p) return;
      const ancho = ANCHO / 1.7;
      const alto = ALTO / 1.7;
      viajar({ x: p.x - ancho / 2, y: p.y - alto / 2, ancho, alto });
    },
    acercar: () => zoom(1 / 1.3),
    alejar: () => zoom(1.3),
    reiniciar: () => {
      for (const { grupo } of elementosDeNodo) grupo.classList.remove("elegido");
      viajar({ ...base });
    },
  };
}
