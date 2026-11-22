// La explosión de plátanos en 3D (huevo de pascua de la Platanus Hack 26; el plan y el movimiento son puros y viven
// en platanos.js). Un lienzo WebGL transparente sobre toda la página, que no recibe clics. Estética de holograma: cada
// plátano es una malla facetada de neón (aristas y borde que brillan, el cuerpo casi transparente, una línea de
// barrido que lo recorre), los anillos de cada onda son anillos de HUD segmentados que giran, y al final una ola de
// transparencia sale del origen y los borra a su paso, deshaciéndolos en bloques de píxeles detrás de un frente que
// brilla. Cada explosión es una sola malla instanciada (cientos de plátanos en una llamada de dibujo). El lienzo
// existe solo mientras hay plátanos: al terminar la última explosión se suelta el contexto WebGL y se quita.

// El mismo three.js que ya sirve el backoffice (la portada y el backoffice salen del mismo servidor): una ruta
// absoluta, porque la portada vive en la raíz y solo sirve sus archivos sueltos.
import * as THREE from "/backoffice/vendor/three@0.160.0/three.module.js";
import {
  colorCiclico,
  estadoDelAnillo3D,
  estadoEn3D,
  MAXIMO_A_LA_VEZ,
  planEn3D,
  radioDelFrente,
  VELOCIDAD_DEL_COLOR,
} from "./platanos.js";

const CAMPO_DE_VISION = 45;
const DISTANCIA_DE_LA_CAMARA = 12;
/** El largo de un plátano en el plano del origen, en píxeles (los que vienen hacia quien mira se ven más grandes). */
const LARGO_EN_PIXELES = 44;
// La ola que borra, en píxeles de pantalla: el ancho de la franja donde se deshacen, cuánto ondula el frente y el
// tamaño de los bloques en que se deshacen.
const OLA = { banda: 110, ondulacion: 46, bloque: 5 };

let soportaWebgl = null;
/** true si hay WebGL 2 (three.js 0.160 no dibuja sin él). Se averigua una vez. */
export function puedeDibujar() {
  if (soportaWebgl === null) {
    try {
      soportaWebgl = Boolean(document.createElement("canvas").getContext("webgl2"));
    } catch {
      soportaWebgl = false;
    }
  }
  return soportaWebgl;
}

// ── Geometría ──────────────────────────────────────────────────────────────────────────────────────────────────

// Un camino en arco: el lomo del plátano, de la punta (u = 0) al tallo (u = 1), centrado en el origen.
class Lomo extends THREE.Curve {
  getPoint(u, destino = new THREE.Vector3()) {
    const apertura = (110 * Math.PI) / 180;
    const radio = 0.6;
    const angulo = -apertura / 2 + u * apertura;
    return destino.set(radio * Math.sin(angulo), radio * (1 - Math.cos(angulo)) - (radio * (1 - Math.cos(apertura / 2))) / 2, 0);
  }
}

/**
 * Un plátano de largo ≈ 1: un tubo de cinco caras (los plátanos son pentagonales) que engorda al medio, se afina en la
 * punta y termina en un tallo delgado. `aLargo` (de la punta al tallo, 0 a 1) y `aVuelta` (alrededor, 0 a 1) le
 * dan al sombreador la malla del holograma: las cinco aristas a lo largo y un anillo entre tramos, sin diagonales; la
 * línea de barrido también recorre `aLargo`. El color de vértice oscurece la punta y el tallo.
 */
const TRAMOS = 9;
const CARAS = 5;

function geometriaDelPlatano() {
  const [tramos, caras] = [TRAMOS, CARAS];
  const lomo = new Lomo();
  const tubo = new THREE.TubeGeometry(lomo, tramos, 0.125, caras, false);
  const posiciones = tubo.attributes.position;
  const colores = new Float32Array(posiciones.count * 3);
  const largo = new Float32Array(posiciones.count);
  const vuelta = new Float32Array(posiciones.count);
  const centro = new THREE.Vector3();
  const punto = new THREE.Vector3();
  for (let i = 0; i <= tramos; i++) {
    const u = i / tramos;
    lomo.getPointAt(u, centro);
    const cuerpo = Math.sin(Math.PI * Math.min(1, u / 0.86)) ** 0.5;
    const grosor = u > 0.86 ? 0.24 : Math.max(0.1, cuerpo);
    const tinte = u < 0.05 ? [0.35, 0.35, 0.35] : u > 0.84 ? [0.55, 0.6, 0.5] : [1, 1, 1];
    for (let j = 0; j <= caras; j++) {
      const k = i * (caras + 1) + j;
      punto.fromBufferAttribute(posiciones, k).sub(centro).multiplyScalar(grosor).add(centro);
      posiciones.setXYZ(k, punto.x, punto.y, punto.z);
      colores.set(tinte, k * 3);
      largo[k] = u;
      vuelta[k] = j / caras;
    }
  }
  tubo.setAttribute("color", new THREE.BufferAttribute(colores, 3));
  tubo.setAttribute("aLargo", new THREE.BufferAttribute(largo, 1));
  tubo.setAttribute("aVuelta", new THREE.BufferAttribute(vuelta, 1));
  return tubo;
}

// ── Sombreadores ───────────────────────────────────────────────────────────────────────────────────────────────

// La ola que borra, compartida por los tres sombreadores. En píxeles del dispositivo (gl_FragCoord): `detras` es
// cuánto quedó un punto detrás del frente (positivo = ya pasó la ola). El frente ondula como una marea.
const OLA_GLSL = /* glsl */ `
  uniform float uTiempo;
  uniform vec2 uOrigen;
  uniform float uFrente;
  uniform float uBanda;
  uniform float uOndulacion;
  uniform float uBloque;
  float azar2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float detrasDelFrente() {
    vec2 v = gl_FragCoord.xy - uOrigen;
    float a = atan(v.y, v.x);
    float frente = uFrente + uOndulacion * (0.6 * sin(a * 7.0 + uTiempo * 5.0) + 0.4 * sin(a * 13.0 - uTiempo * 8.0));
    return frente - length(v);
  }
  // Detrás del frente se deshace en bloques: cada bloque desaparece a una distancia al azar dentro de la franja.
  bool borrado(float detras) { return detras > azar2(floor(gl_FragCoord.xy / uBloque)) * uBanda; }
  // El brillo del frente: máximo justo en la orilla, se apaga hacia ambos lados.
  float orilla(float detras) { return exp(-abs(detras) / (uBanda * 0.35)); }
`;

const VERTICE_PLATANO = /* glsl */ `
  attribute float aLargo;
  attribute float aVuelta;
  varying vec3 vVista;
  varying vec3 vTinte;
  varying float vLargo;
  varying float vVuelta;
  void main() {
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    vec4 vista = modelViewMatrix * local;
    vVista = vista.xyz;
    vTinte = color;
    #ifdef USE_INSTANCING_COLOR
      vTinte *= instanceColor;
    #endif
    vLargo = aLargo;
    vVuelta = aVuelta;
    gl_Position = projectionMatrix * vista;
  }
`;

const FRAGMENTO_PLATANO = /* glsl */ `
  ${OLA_GLSL}
  varying vec3 vVista;
  varying vec3 vTinte;
  varying float vLargo;
  varying float vVuelta;
  uniform float uTramos;
  uniform float uCaras;
  // Distancia (en píxeles de pantalla) a la línea más cercana de una grilla de n divisiones.
  float lineaDeGrilla(float x, float n, float grosor) {
    float f = abs(fract(x * n + 0.5) - 0.5);
    return 1.0 - smoothstep(0.0, fwidth(x * n) * grosor, f);
  }
  void main() {
    float detras = detrasDelFrente();
    if (borrado(detras)) discard;
    // Normal de la cara (facetado) y cuánto se ve de canto: el borde del holograma brilla.
    vec3 normal = normalize(cross(dFdx(vVista), dFdy(vVista)));
    float canto = pow(1.0 - abs(dot(normal, normalize(-vVista))), 1.6);
    // La malla: las aristas a lo largo, nítidas, y los anillos entre tramos, más tenues; del mismo grosor en
    // pantalla a cualquier distancia.
    float arista = max(lineaDeGrilla(vVuelta, uCaras, 1.2), lineaDeGrilla(vLargo, uTramos, 0.9) * 0.45);
    // Una línea de barrido recorre el plátano de la punta al tallo.
    float barrido = fract(vLargo * 3.0 - uTiempo * 1.6);
    float linea = smoothstep(0.0, 0.08, barrido) * (1.0 - smoothstep(0.08, 0.2, barrido));
    float brillo = orilla(detras);
    vec3 neon = vTinte * (0.28 + canto * 0.6 + linea * 0.45 + arista * 0.75) + vec3(arista * 0.08);
    neon += mix(vTinte, vec3(1.0), 0.5) * brillo * 0.9;
    float alfa = clamp(0.3 + canto * 0.4 + arista * 0.45 + linea * 0.2 + brillo * 0.6, 0.0, 1.0);
    gl_FragColor = vec4(neon * alfa, alfa);
    #include <colorspace_fragment>
  }
`;

const VERTICE_ANILLO = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENTO_ANILLO = /* glsl */ `
  ${OLA_GLSL}
  uniform vec3 uColor;
  uniform float uOpacidad;
  uniform float uGiro;
  uniform float uSegmentos;
  varying vec2 vLocal;
  void main() {
    float detras = detrasDelFrente();
    if (borrado(detras)) discard;
    // Segmentos de HUD: tramos encendidos y huecos, que giran.
    float vuelta = atan(vLocal.y, vLocal.x) / 6.2831853 + uGiro;
    float tramo = fract(vuelta * uSegmentos);
    if (tramo > 0.64) discard;
    float marca = step(fract(vuelta * uSegmentos * 0.25), 0.04);
    vec3 color = uColor * (1.0 + marca * 1.5) + vec3(orilla(detras) * 0.6);
    gl_FragColor = vec4(color * uOpacidad, uOpacidad);
    #include <colorspace_fragment>
  }
`;

// El frente mismo, a pantalla completa: una línea de luz que ondula y, detrás, bloques que parpadean al deshacerse.
const VERTICE_OLA = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAGMENTO_OLA = /* glsl */ `
  ${OLA_GLSL}
  uniform vec3 uColor;
  uniform float uIntensidad;
  void main() {
    float detras = detrasDelFrente();
    float linea = exp(-pow(detras / (uBanda * 0.05), 2.0)) * 0.85 + exp(-pow(detras / (uBanda * 0.3), 2.0)) * 0.07;
    float bloques = step(0.0, detras) * step(detras, uBanda * 1.4) * step(0.9, azar2(floor(gl_FragCoord.xy / (uBloque * 3.0)) + floor(uTiempo * 12.0)));
    float luz = (linea + bloques * 0.16) * uIntensidad;
    if (luz < 0.004) discard;
    vec3 color = mix(uColor, vec3(1.0), linea * 0.4);
    gl_FragColor = vec4(color * luz, luz);
    #include <colorspace_fragment>
  }
`;

// ── Escena ─────────────────────────────────────────────────────────────────────────────────────────────────────

let motor = null;
let cuadro = 0;
const explosiones = new Set();

function encender() {
  const lienzo = document.createElement("canvas");
  lienzo.className = "platanos-lienzo";
  lienzo.setAttribute("aria-hidden", "true");
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(CAMPO_DE_VISION, 1, 0.1, 100);
  camara.position.set(0, 0, DISTANCIA_DE_LA_CAMARA);
  document.body.append(lienzo);
  motor = {
    lienzo,
    renderer,
    escena,
    camara,
    ancho: 0,
    alto: 0,
    geometria: geometriaDelPlatano(),
    geometriaDelAnillo: new THREE.RingGeometry(0.992, 1, 256),
    geometriaDeLaOla: new THREE.PlaneGeometry(2, 2),
  };
  ajustarTamano();
}

function ajustarTamano() {
  const [ancho, alto] = [innerWidth, innerHeight];
  if (ancho === motor.ancho && alto === motor.alto) return;
  Object.assign(motor, { ancho, alto });
  motor.renderer.setSize(ancho, alto);
  motor.camara.aspect = ancho / alto;
  motor.camara.updateProjectionMatrix();
}

/** Cuántas unidades del mundo mide un píxel en el plano z = 0 (el del origen). */
const unidadesPorPixel = () => (2 * DISTANCIA_DE_LA_CAMARA * Math.tan((CAMPO_DE_VISION * Math.PI) / 360)) / innerHeight;

function apagar() {
  cancelAnimationFrame(cuadro);
  cuadro = 0;
  if (!motor) return;
  motor.geometria.dispose();
  motor.geometriaDelAnillo.dispose();
  motor.geometriaDeLaOla.dispose();
  motor.renderer.dispose();
  motor.renderer.forceContextLoss();
  motor.lienzo.remove();
  motor = null;
}

function quitar(explosion) {
  for (const objeto of [explosion.malla, explosion.ola, ...explosion.anillos.map(({ malla }) => malla)]) {
    motor.escena.remove(objeto);
    objeto.material.dispose();
  }
  explosion.malla.dispose();
  explosiones.delete(explosion);
  explosion.terminar();
}

const matriz = new THREE.Matrix4();
const posicion = new THREE.Vector3();
const escala = new THREE.Vector3();
const giro = new THREE.Quaternion();
const orientacion = new THREE.Quaternion();
const eje = new THREE.Vector3();
const color = new THREE.Color();
const NADA = new THREE.Matrix4().makeScale(0, 0, 0);

const pintar = (destino, posicionEnElDegradado) =>
  destino.setRGB(...colorCiclico(posicionEnElDegradado), THREE.SRGBColorSpace);

function animar() {
  cuadro = 0;
  if (!motor) return;
  ajustarTamano();
  const ahora = performance.now();
  for (const explosion of [...explosiones]) {
    const ms = ahora - explosion.inicio;
    if (ms > explosion.plan.duracion) {
      quitar(explosion);
      continue;
    }
    const { malla, plan, ola } = explosion;
    const tono = (ms / 1000) * VELOCIDAD_DEL_COLOR;
    // La ola: compartida (los mismos objetos de uniform) por los plátanos, los anillos y el frente de esta explosión.
    const frente = radioDelFrente(ms, plan.borrado, explosion.hasta);
    explosion.uniformes.uTiempo.value = ms / 1000;
    explosion.uniformes.uFrente.value = frente ?? -1e6;
    ola.visible = frente !== null && frente < explosion.hasta;
    pintar(ola.material.uniforms.uColor.value, tono);
    ola.material.uniforms.uIntensidad.value = frente === null ? 0 : Math.min(1, frente / (OLA.banda * 4));

    plan.platanos.forEach((platano, i) => {
      const estado = estadoEn3D(platano, ms);
      if (!estado || estado.escala <= 0) {
        malla.setMatrixAt(i, NADA);
        return;
      }
      // La pantalla tiene y hacia abajo; el mundo de three.js, hacia arriba.
      posicion.set(estado.x, -estado.y, estado.z);
      giro.setFromAxisAngle(eje.fromArray(platano.eje), estado.angulo);
      orientacion.multiplyQuaternions(giro, explosion.orientaciones[i]);
      matriz.compose(posicion, orientacion, escala.setScalar(estado.escala));
      malla.setMatrixAt(i, matriz);
      malla.setColorAt(i, pintar(color, platano.tono + tono));
    });
    malla.instanceMatrix.needsUpdate = true;
    malla.instanceColor.needsUpdate = true;
    for (const anillo of explosion.anillos) {
      const estado = estadoDelAnillo3D(anillo.datos, ms);
      anillo.malla.visible = Boolean(estado);
      if (!estado) continue;
      const uniformes = anillo.malla.material.uniforms;
      anillo.malla.scale.setScalar(estado.radio);
      uniformes.uOpacidad.value = estado.opacidad;
      uniformes.uGiro.value = anillo.sentido * (ms / 1000) * 0.12;
      pintar(uniformes.uColor.value, anillo.datos.tono + tono);
    }
  }
  if (explosiones.size === 0) return apagar();
  motor.renderer.render(motor.escena, motor.camara);
  cuadro = requestAnimationFrame(animar);
}

function materialNeon(fragmentShader, vertexShader, uniforms, opciones = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    // Color ya multiplicado por alfa y sumado: el neón se enciende donde se cruzan.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    ...opciones,
  });
}

/**
 * Lanza una explosión desde el centro de `origen`. Devuelve una promesa que se cumple cuando la ola terminó de
 * borrar sus plátanos; con MAXIMO_A_LA_VEZ explosiones en el aire no lanza otra.
 */
export function lanzarEn3D(origen, { azar = Math.random } = {}) {
  if (explosiones.size >= MAXIMO_A_LA_VEZ || !origen?.getBoundingClientRect) return Promise.resolve();
  if (!motor) encender();
  const caja = origen.getBoundingClientRect();
  const centro = { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
  const porPixel = unidadesPorPixel();
  const alcancePx = Math.hypot(Math.max(centro.x, innerWidth - centro.x), Math.max(centro.y, innerHeight - centro.y));
  const plan = planEn3D({
    alcance: alcancePx * porPixel,
    tamano: LARGO_EN_PIXELES * porPixel,
    azar,
    // Repartidos por toda la ventana, en unidades del mundo y con el origen medido desde su centro.
    ventana: {
      ancho: innerWidth * porPixel,
      alto: innerHeight * porPixel,
      origen: { x: (centro.x - innerWidth / 2) * porPixel, y: (centro.y - innerHeight / 2) * porPixel },
      camara: DISTANCIA_DE_LA_CAMARA,
    },
  });

  // La ola trabaja en píxeles del dispositivo, con y hacia arriba (gl_FragCoord), y termina pasada la esquina más
  // lejana con toda su franja y su ondulación.
  const densidad = motor.renderer.getPixelRatio();
  const uniformes = {
    uTiempo: { value: 0 },
    uOrigen: { value: new THREE.Vector2(centro.x * densidad, (innerHeight - centro.y) * densidad) },
    uFrente: { value: -1e6 },
    uBanda: { value: OLA.banda * densidad },
    uOndulacion: { value: OLA.ondulacion * densidad },
    uBloque: { value: OLA.bloque * densidad },
  };
  const hasta = (alcancePx + OLA.banda + OLA.ondulacion) * densidad;

  const desdeElLogo = new THREE.Vector3((centro.x - innerWidth / 2) * porPixel, -(centro.y - innerHeight / 2) * porPixel, 0);
  const malla = new THREE.InstancedMesh(
    motor.geometria,
    // Los plátanos se tapan entre sí (sobre, no sumados): en un racimo denso conservan su color en vez de quemarse a
    // blanco. Los anillos y el frente sí se suman.
    materialNeon(
      FRAGMENTO_PLATANO,
      VERTICE_PLATANO,
      { ...uniformes, uTramos: { value: TRAMOS }, uCaras: { value: CARAS } },
      { vertexColors: true, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.FrontSide },
    ),
    plan.platanos.length,
  );
  malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  malla.frustumCulled = false;
  malla.position.copy(desdeElLogo);
  const orientaciones = plan.platanos.map((platano, i) => {
    malla.setMatrixAt(i, NADA);
    malla.setColorAt(i, pintar(color, platano.tono));
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(...platano.inicial));
  });
  motor.escena.add(malla);

  const anillos = plan.anillos.map((datos, i) => {
    const anillo = new THREE.Mesh(
      motor.geometriaDelAnillo,
      materialNeon(FRAGMENTO_ANILLO, VERTICE_ANILLO, {
        ...uniformes,
        uColor: { value: new THREE.Color() },
        uOpacidad: { value: 0 },
        uGiro: { value: 0 },
        uSegmentos: { value: 24 + 8 * (i % 3) },
      }),
    );
    anillo.position.copy(desdeElLogo);
    anillo.rotation.set(datos.inclinacion[0], datos.inclinacion[1], 0);
    anillo.visible = false;
    motor.escena.add(anillo);
    return { datos, malla: anillo, sentido: i % 2 ? -1 : 1 };
  });

  const ola = new THREE.Mesh(
    motor.geometriaDeLaOla,
    materialNeon(FRAGMENTO_OLA, VERTICE_OLA, { ...uniformes, uColor: { value: new THREE.Color() }, uIntensidad: { value: 0 } }, { depthTest: false }),
  );
  ola.frustumCulled = false;
  ola.renderOrder = 10;
  ola.visible = false;
  motor.escena.add(ola);

  return new Promise((terminar) => {
    explosiones.add({ inicio: performance.now(), plan, malla, orientaciones, anillos, ola, uniformes, hasta, terminar });
    if (!cuadro) cuadro = requestAnimationFrame(animar);
  });
}
