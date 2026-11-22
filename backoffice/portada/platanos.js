// Huevo de pascua de la Platanus Hack 26, donde nació el proyecto: al apretar «Platanus Hack 26» en el pie de la portada salen cientos de
// plátanos desde el texto hacia afuera, en ondas concéntricas que se abren como un pulso. En 3D (three.js, cargado
// recién al primer clic: platanos-3d.js) vuelan en hélice, algunos hacia quien mira, girando sobre sí mismos, y van
// pasando por los colores del degradado del camaleón (lima → turquesa → azul → violeta → rosado) hasta desaparecer.
// Este módulo tiene la parte pura (el plan, la posición de cada plátano en cada instante, el color) y la versión 2D
// (SVG + Web Animations API) que queda para prefers-reduced-motion y para navegadores sin WebGL 2: ahí los plátanos
// no viajan, aparecen alrededor del texto y se desvanecen (o, sin WebGL, vuelan en el plano).

const SVG_NS = "http://www.w3.org/2000/svg";
/** Un elemento SVG con sus atributos y sus hijos, armado con el DOM (nada se interpreta como marcado). */
function svg(etiqueta, atributos, ...hijos) {
  const nodo = document.createElementNS(SVG_NS, etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor));
  nodo.append(...hijos);
  return nodo;
}

// Los colores de las paradas del degradado del símbolo (marca/simbolo.svg), de la cola a la punta.
export const COLORES_PLATANO = Object.freeze(["#B8FF5C", "#6DF195", "#2EE6C5", "#4C8DFF", "#8B5CF6", "#D76CC7", "#F472B6"]);

export const ONDAS = 5;
export const POR_ONDA = 12;
/** Pausa entre el arranque de una onda y el de la siguiente. */
export const PAUSA_ENTRE_ONDAS = 150;
const DURACION_VUELO = 2200;
const DURACION_QUIETO = 900;
const PASOS_DE_VUELO = 24;
// Más de tantas explosiones a la vez no se ven mejor y sí cuestan: la siguiente espera a que termine una.
export const MAXIMO_A_LA_VEZ = 3;

// La explosión en 3D: muchas más ondas y plátanos que en 2D (una sola malla instanciada los dibuja a todos).
export const ONDAS_3D = 8;
export const POR_ONDA_3D = 90;
export const PAUSA_ENTRE_ONDAS_3D = 120;
const VIDA_3D = 3300;
const VIDA_ANILLO_3D = 1500;
/**
 * La ola que borra: un frente de transparencia sale del origen cuando los plátanos ya se repartieron y los va borrando
 * a su paso, hasta pasar la esquina más lejana (platanos-3d.js la dibuja; radioDelFrente dice dónde va).
 */
export const BORRADO_3D = Object.freeze({ inicio: 1500, duracion: 1900 });
/** Vueltas completas al degradado por segundo: cada plátano cambia de color mientras vuela. */
export const VELOCIDAD_DEL_COLOR = 0.45;

// Un plátano en una caja de 24 × 24: la cáscara, la arista, un brillo, la punta oscura y el tallo.
const CASCARA =
  "M2.6 8.4C3.4 15.6 8.8 20.2 14.6 19.2C18.7 18.5 21.2 14.6 21.1 9.4L19.1 9.5" +
  "C18.6 13 16.3 14.9 13.4 15C9.4 15.1 5.9 12.4 4.7 7.8Z";
const ARISTA = "M4.1 9.6C5.6 15.3 10.2 17.9 14.4 17.2C17.4 16.7 19.5 14.2 20.1 10.4";
const BRILLO = "M5.2 13.6C7.2 17 10.6 18.6 13.8 18.2C10.6 18.1 7.6 16.4 5.2 13.6Z";
const PUNTA = "M2.6 8.4L4.7 7.8L4.4 6.9L2.4 7.5Z";
const TALLO = "M19.1 9.5L21.1 9.4L21.5 6.1C21.6 5.5 20.8 5.3 20.5 5.8L19.5 7.6Z";
const TAMANO = 36;

/** Generador pseudoaleatorio con semilla (mulberry32): las pruebas fijan la explosión; la página usa Math.random. */
export function azarConSemilla(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` puntos repartidos parejo por toda la ventana (una grilla con un punto al azar dentro de cada celda; las celdas
 * que sobran se eligen al azar), ordenados del más cercano al más lejano del origen, con algo de azar en el orden para
 * que las ondas no sean bandas exactas. `ventana`: `{ ancho, alto, origen: { x, y } }` en las unidades del plan, con el
 * (0, 0) en el centro de la ventana y y hacia abajo. Un margen chico deja que algunos lleguen justo al borde. Puro.
 */
export function puntosEnLaVentana(n, { ancho, alto, origen }, azar = Math.random, margen = 0.04) {
  const [w, h] = [ancho * (1 + 2 * margen), alto * (1 + 2 * margen)];
  const columnas = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
  const filas = Math.max(1, Math.ceil(n / columnas));
  const celdas = Array.from({ length: columnas * filas }, (_, i) => i);
  for (let i = celdas.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [celdas[i], celdas[j]] = [celdas[j], celdas[i]];
  }
  return celdas
    .slice(0, n)
    .map((celda) => {
      const x = -w / 2 + ((celda % columnas) + azar()) * (w / columnas);
      const y = -h / 2 + (Math.floor(celda / columnas) + azar()) * (h / filas);
      const lejos = Math.hypot(x - origen.x, y - origen.y);
      return { x, y, lejos, orden: lejos * (0.9 + azar() * 0.2) };
    })
    .sort((a, b) => a.orden - b.orden)
    .map(({ x, y, lejos }) => ({ x, y, lejos }));
}

/**
 * Plan de la explosión. Puro. Cada onda es un anillo de plátanos que llega más lejos y sale un poco después que la
 * anterior. Sin `ventana`, cada onda reparte sus plátanos alrededor de todo el origen (girada media separación respecto
 * de la anterior, con algo de azar) y la última llega a `alcance` (px). Con `ventana` (la de puntosEnLaVentana, en px),
 * cada plátano va a un punto de la ventana, repartidos parejo por toda la pantalla: los más cercanos al origen en la
 * primera onda y los más lejanos en la última. Devuelve una lista de plátanos y una de anillos (uno por onda).
 */
export function planDeLaExplosion({ alcance, ondas = ONDAS, porOnda = POR_ONDA, ventana = null, azar = Math.random } = {}) {
  const lejos = Math.max(120, Number(alcance) || 0);
  const separacion = (2 * Math.PI) / porOnda;
  const destinos = ventana ? puntosEnLaVentana(ondas * porOnda, ventana, azar) : null;
  const platanos = [];
  const anillos = [];
  for (let onda = 0; onda < ondas; onda++) {
    const color = COLORES_PLATANO[Math.round((onda * (COLORES_PLATANO.length - 1)) / Math.max(1, ondas - 1))];
    const retraso = onda * PAUSA_ENTRE_ONDAS;
    const deLaOnda = destinos?.slice(onda * porOnda, (onda + 1) * porOnda);
    const distanciaDeLaOnda = deLaOnda
      ? Math.max(...deLaOnda.map((destino) => destino.lejos))
      : lejos * (0.3 + (0.7 * (onda + 1)) / ondas);
    anillos.push({ onda, color, retraso, radio: distanciaDeLaOnda });
    for (let i = 0; i < porOnda; i++) {
      const destino = deLaOnda?.[i];
      platanos.push({
        onda,
        color,
        retraso: retraso + Math.round(azar() * 60),
        angulo: destino
          ? Math.atan2(destino.y - ventana.origen.y, destino.x - ventana.origen.x)
          : (i + (onda % 2) / 2 + (azar() - 0.5) * 0.5) * separacion,
        distancia: destino ? destino.lejos : distanciaDeLaOnda * (0.85 + azar() * 0.3),
        // Ondulación perpendicular al camino: amplitud y vueltas propias, para que no se muevan en bloque.
        amplitud: 14 + azar() * 16,
        vueltas: 1.5 + azar() * 1.5,
        fase: azar() < 0.5 ? 0 : Math.PI,
        giro: (azar() < 0.5 ? -1 : 1) * (240 + azar() * 360),
        escala: 0.8 + azar() * 0.6,
      });
    }
  }
  return { platanos, anillos };
}

/**
 * Cuadros clave de un plátano en vuelo (transform y opacity), relativos al origen. Puro. La ondulación es
 * un seno a lo ancho del camino que se apaga al alejarse; la escala crece al salir y el plátano se desvanece al final.
 */
export function vueloDelPlatano(platano, pasos = PASOS_DE_VUELO) {
  const { angulo, distancia, amplitud, vueltas, fase, giro, escala } = platano;
  const [ax, ay] = [Math.cos(angulo), Math.sin(angulo)];
  const cuadros = [];
  for (let paso = 0; paso <= pasos; paso++) {
    const t = paso / pasos;
    const avance = 1 - (1 - t) ** 3; // sale disparado y frena
    const lado = Math.sin(fase + t * vueltas * 2 * Math.PI) * amplitud * (1 - t) * Math.min(1, t * 4);
    const x = ax * distancia * avance - ay * lado;
    const y = ay * distancia * avance + ax * lado;
    const tamano = escala * (0.3 + 0.7 * Math.min(1, t * 5));
    cuadros.push({
      offset: t,
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(giro * avance).toFixed(1)}deg) scale(${tamano.toFixed(3)})`,
      opacity: t < 0.06 ? t / 0.06 : t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1,
    });
  }
  return cuadros;
}

/** Con prefers-reduced-motion: el plátano aparece cerca del origen, sin viajar ni girar, y se desvanece. Puro. */
export function quietoDelPlatano(platano) {
  const radio = 64 + platano.onda * 40;
  const x = Math.cos(platano.angulo) * radio;
  const y = Math.sin(platano.angulo) * radio;
  const transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${platano.escala.toFixed(3)})`;
  return [
    { offset: 0, transform, opacity: 0 },
    { offset: 0.3, transform, opacity: 1 },
    { offset: 1, transform, opacity: 0 },
  ];
}

const hexARgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const RGB_PLATANO = COLORES_PLATANO.map(hexARgb);

/**
 * El color del degradado en `posicion` (0 a 1, cíclico: después del rosado vuelve al lima), como [r, g, b] sRGB de
 * 0 a 1, interpolando entre paradas vecinas. Puro.
 */
export function colorCiclico(posicion) {
  const n = RGB_PLATANO.length;
  const p = ((((Number(posicion) || 0) % 1) + 1) % 1) * n;
  const i = Math.floor(p) % n;
  const f = p - Math.floor(p);
  const [a, b] = [RGB_PLATANO[i], RGB_PLATANO[(i + 1) % n]];
  return a.map((c, k) => c + (b[k] - c) * f);
}

function ejeAlAzar(azar) {
  // Un punto uniforme en la esfera.
  const z = azar() * 2 - 1;
  const theta = azar() * 2 * Math.PI;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(theta), r * Math.sin(theta), z];
}

/**
 * Plan de la explosión en 3D. Puro. Unidades del mundo de la escena, con x a la derecha, y hacia abajo (como la
 * pantalla) y z hacia quien mira. `tamano`: el largo de un plátano; `profundidad`: cuánto se acercan los que salen
 * hacia quien mira. Sin `ventana`, cada onda sale alrededor de todo el origen y la última pasa de `alcance`. Con
 * `ventana` (la de puntosEnLaVentana, más `camara`: la distancia de la cámara al plano del origen), cada plátano
 * termina sobre un punto de la ventana, repartidos parejo por toda la pantalla: su destino se corrige por la
 * perspectiva (el que se acerca a quien mira se ve más lejos del centro) y por lo que cae, para que se vea donde toca.
 */
export function planEn3D({
  alcance,
  tamano = 0.3,
  profundidad = 6,
  ondas = ONDAS_3D,
  porOnda = POR_ONDA_3D,
  ventana = null,
  azar = Math.random,
} = {}) {
  const lejos = Math.max(1, Number(alcance) || 0);
  const separacion = (2 * Math.PI) / porOnda;
  const destinos = ventana ? puntosEnLaVentana(ondas * porOnda, ventana, azar) : null;
  const platanos = [];
  const anillos = [];
  let duracion = 0;
  for (let onda = 0; onda < ondas; onda++) {
    const retraso = onda * PAUSA_ENTRE_ONDAS_3D;
    const deLaOnda = destinos?.slice(onda * porOnda, (onda + 1) * porOnda);
    // Sin ventana, la última onda pasa de la esquina más lejana: los plátanos llegan al otro lado de la pantalla.
    const radio = deLaOnda
      ? Math.max(...deLaOnda.map((destino) => destino.lejos))
      : lejos * (0.45 + (0.75 * (onda + 1)) / ondas);
    const tono = onda / ondas;
    anillos.push({ onda, retraso, radio, tono, inclinacion: [(azar() - 0.5) * 0.9, (azar() - 0.5) * 0.9] });
    duracion = Math.max(duracion, retraso + VIDA_ANILLO_3D);
    for (let i = 0; i < porOnda; i++) {
      const platano = {
        onda,
        retraso: retraso + Math.round(azar() * 90),
        angulo: (i + azar() - 0.5) * separacion,
        distancia: radio * (0.75 + azar() * 0.4),
        // Hacia quien mira la mayoría (elevación positiva), algunos hacia el fondo.
        elevacion: -0.45 + azar() * 1.25,
        profundidad: profundidad * (0.4 + azar() * 0.6),
        amplitud: tamano * (0.6 + azar() * 1.2),
        vueltas: 1.5 + azar() * 2,
        fase: azar() * 2 * Math.PI,
        caida: tamano * (1 + azar() * 3),
        eje: ejeAlAzar(azar),
        giro: (azar() < 0.5 ? -1 : 1) * (4 + azar() * 8),
        inicial: [azar() * 2 * Math.PI, azar() * 2 * Math.PI, azar() * 2 * Math.PI],
        escala: tamano * (0.7 + azar() * 0.8),
        tono: tono + (azar() - 0.5) * 0.08,
        vida: VIDA_3D * (0.85 + azar() * 0.3),
      };
      const destino = deLaOnda?.[i];
      if (destino) {
        // Al final de su vida está a z = sin(elevación) · profundidad y cayó `caida`: el punto del mundo que se ve
        // sobre el destino está más cerca del centro en la proporción (cámara − z) / cámara.
        const z = Math.sin(platano.elevacion) * platano.profundidad;
        const cerca = ventana.camara ? Math.max(0.05, (ventana.camara - z) / ventana.camara) : 1;
        const dx = destino.x * cerca - ventana.origen.x;
        const dy = destino.y * cerca - ventana.origen.y - platano.caida;
        platano.angulo = Math.atan2(dy, dx);
        platano.distancia = Math.hypot(dx, dy);
      }
      platanos.push(platano);
      duracion = Math.max(duracion, platano.retraso + platano.vida);
    }
  }
  duracion = Math.max(duracion, BORRADO_3D.inicio + BORRADO_3D.duracion + 80);
  return { platanos, anillos, borrado: BORRADO_3D, duracion: Math.ceil(duracion) };
}

/**
 * Dónde está un plátano `ms` después del clic, relativo al origen (unidades y ejes de planEn3D), o null si todavía no
 * sale o ya terminó. Avanza rápido y frena; ondula en hélice alrededor de su camino, cada vez menos; cae un poco;
 * aparece de golpe y gira sobre su eje. No se desvanece: lo borra la ola (radioDelFrente); solo si la ola no lo
 * alcanzó se achica en el último 3 % de su vida. Puro.
 */
export function estadoEn3D(platano, ms) {
  const t = (ms - platano.retraso) / platano.vida;
  if (!(t >= 0 && t <= 1)) return null;
  const avance = 1 - (1 - t) ** 3;
  const [ax, ay] = [Math.cos(platano.angulo), Math.sin(platano.angulo)];
  const enElPlano = platano.distancia * avance;
  const fase = platano.fase + t * platano.vueltas * 2 * Math.PI;
  const apagado = platano.amplitud * (1 - t) * Math.min(1, t * 4);
  const lado = Math.sin(fase) * apagado;
  return {
    x: ax * enElPlano - ay * lado,
    y: ay * enElPlano + ax * lado + platano.caida * t * t,
    z: Math.sin(platano.elevacion) * platano.profundidad * avance + Math.cos(fase) * apagado * 0.8,
    escala: platano.escala * Math.min(1, t * 7) * (t > 0.97 ? (1 - t) / 0.03 : 1),
    angulo: platano.giro * t,
  };
}

/**
 * Hasta dónde llegó la ola que borra `ms` después del clic (en las unidades de `hasta`, que es adonde llega al final),
 * o null si todavía no sale. Acelera y frena (ease in-out). Puro.
 */
export function radioDelFrente(ms, borrado, hasta) {
  const t = (ms - borrado.inicio) / borrado.duracion;
  if (!(t >= 0)) return null;
  const u = Math.min(1, t);
  return hasta * (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
}

/** El anillo de una onda `ms` después del clic: crece hasta el radio de su onda y se apaga; null fuera de su vida. */
export function estadoDelAnillo3D(anillo, ms) {
  const t = (ms - anillo.retraso) / VIDA_ANILLO_3D;
  if (!(t >= 0 && t <= 1)) return null;
  return { radio: Math.max(1e-3, anillo.radio * (1 - (1 - t) ** 3)), opacidad: 0.6 * (1 - t) };
}

const movimientoReducido = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function dibujoDelPlatano(color) {
  return svg(
    "svg",
    { class: "platano", viewBox: "0 0 24 24", width: TAMANO, height: TAMANO, "aria-hidden": "true", focusable: "false" },
    svg("path", { d: CASCARA, fill: color }),
    svg("path", { d: ARISTA, fill: "none", stroke: "#000000", "stroke-opacity": "0.22", "stroke-width": "0.7", "stroke-linecap": "round" }),
    svg("path", { d: BRILLO, fill: "#FFFFFF", "fill-opacity": "0.4" }),
    svg("path", { d: PUNTA, fill: "#15151D" }),
    svg("path", { d: TALLO, fill: "#3A5A2A" }),
  );
}

let enCurso = 0;
let lienzo = null;

// Una sola capa para todas las explosiones en curso (estilos en estilos.css, «Huevo de pascua»).
function capa() {
  if (!lienzo?.isConnected) {
    lienzo = document.createElement("div");
    lienzo.className = "platanos-lienzo";
    lienzo.setAttribute("aria-hidden", "true");
    document.body.append(lienzo);
  }
  return lienzo;
}

function enElCentro(nodo, centro) {
  nodo.style.setProperty("--x", `${centro.x}px`);
  nodo.style.setProperty("--y", `${centro.y}px`);
  return nodo;
}

// El módulo 3D (y three.js, 1,2 MB) se pide recién al acercarse al texto o al apretarlo, una sola vez.
let modulo3D = null;
/** Empieza a cargar three.js y la escena 3D, sin lanzar nada (al pasar el puntero sobre el texto). */
export function precargarPlatanos() {
  if (movimientoReducido() || typeof document === "undefined") return null;
  modulo3D ??= import("./platanos-3d.js").catch((error) => {
    console.warn("platanos: sin la versión 3D, quedan los plátanos en 2D", error);
    return null;
  });
  return modulo3D;
}

/**
 * Lanza la explosión desde el centro de `origen` (el elemento que se apretó): en 3D si se puede, si no en 2D.
 * Devuelve una promesa que se cumple cuando terminó y se limpió; con demasiadas explosiones a la vez no lanza otra.
 */
export async function lanzarPlatanos(origen, opciones = {}) {
  const en3D = await precargarPlatanos();
  if (en3D?.puedeDibujar()) return en3D.lanzarEn3D(origen, opciones);
  return lanzarEn2D(origen, opciones);
}

async function lanzarEn2D(origen, { azar = Math.random } = {}) {
  if (enCurso >= MAXIMO_A_LA_VEZ || !origen?.getBoundingClientRect || typeof document === "undefined") return;
  const caja = origen.getBoundingClientRect();
  const centro = { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
  // La última onda llega hasta la esquina más lejana de la ventana.
  const alcance = Math.hypot(Math.max(centro.x, innerWidth - centro.x), Math.max(centro.y, innerHeight - centro.y));
  const quieto = movimientoReducido();
  // Los plátanos se reparten por toda la ventana (con el origen medido desde su centro).
  const ventana = { ancho: innerWidth, alto: innerHeight, origen: { x: centro.x - innerWidth / 2, y: centro.y - innerHeight / 2 } };
  const { platanos, anillos } = planDeLaExplosion({ alcance, azar, ventana, ...(quieto ? { ondas: 2, porOnda: 8 } : {}) });

  const destino = capa();
  const nodos = [];
  enCurso++;

  const animaciones = [];
  try {
    if (!quieto) {
      for (const anillo of anillos) {
        const nodo = document.createElement("span");
        nodo.className = "platanos-anillo";
        nodo.style.setProperty("--color", anillo.color);
        destino.append(enElCentro(nodo, centro));
        nodos.push(nodo);
        // Crece en tamaño (no con scale: el borde engordaría con él).
        const diametro = `${Math.round(anillo.radio * 2)}px`;
        animaciones.push(
          nodo.animate(
            [
              { width: "8px", height: "8px", opacity: 0.9 },
              { width: diametro, height: diametro, opacity: 0 },
            ],
            { duration: 1100, delay: anillo.retraso, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
          ),
        );
      }
    }
    for (const platano of platanos) {
      const nodo = dibujoDelPlatano(platano.color);
      destino.append(enElCentro(nodo, centro));
      nodos.push(nodo);
      animaciones.push(
        nodo.animate(quieto ? quietoDelPlatano(platano) : vueloDelPlatano(platano), {
          duration: quieto ? DURACION_QUIETO : DURACION_VUELO,
          delay: platano.retraso,
          easing: "linear",
          fill: "both",
        }),
      );
    }
    await Promise.allSettled(animaciones.map((animacion) => animacion.finished));
  } finally {
    for (const nodo of nodos) nodo.remove();
    enCurso--;
    if (enCurso === 0) destino.remove();
  }
}
