// Escena three.js de la telaraña viva: anillos y tramos como cintas (con rayas cortadas en píxeles de pantalla),
// páginas y agentes como puntos con un shader de anillo, y la cámara ortográfica que encuadra la telaraña.
// El estado visual (posiciones animadas, agentes en movimiento) vive aquí; el de los datos, en modelo.js.

import * as THREE from "../vendor/three@0.160.0/three.module.js";
import { anilloFinal, claveDeFinal } from "./modelo.js";
import { acotar, puntoDeTramo, radio, segmentosDeTramo } from "./layout.js";

const TRAZO = 0.75; // s que tarda en dibujarse un tramo nuevo
const VIAJE_MS = 400; // la cámara va al encuadre de un agente elegido
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const salida3 = (t) => 1 - Math.pow(1 - t, 3);
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

/** Los colores de los tokens CSS (oklch) en sRGB 0…1, leyéndolos de un píxel: WebGL no entiende oklch. */
export function leerColores(elemento) {
  const estilo = getComputedStyle(elemento);
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = 1;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  const rgb = (token, respaldo) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = respaldo;
    ctx.fillStyle = estilo.getPropertyValue(token).trim() || respaldo;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255];
  };
  const K = {
    ruta: rgb("--acento", "#66bcff"),
    ok: rgb("--exito", "#44d7b6"),
    mid: rgb("--aviso", "#ff9f43"),
    bad: rgb("--peligro", "#f2643b"),
    neu: rgb("--texto-4", "#73757c"),
    back: rgb("--neutro", "#9a9ca5"),
    agente: rgb("--texto-1", "#f3f3f6"),
    nodo: rgb("--texto-3", "#a6a8af"),
    hilo: rgb("--texto-1", "#ffffff"),
    lienzo: rgb("--lienzo", "#121316"),
  };
  K.warn = K.mid;
  K.final = { success: K.ok, failed: K.bad, abandoned: K.back, unmeasured: K.back, error: K.back };
  return K;
}

function buffer(max, tamanos) {
  const g = new THREE.BufferGeometry();
  const at = {};
  for (const [nombre, n] of Object.entries(tamanos)) {
    at[nombre] = new THREE.BufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(nombre, at[nombre]);
  }
  g.setDrawRange(0, 0);
  return { g, at, max };
}

function subir(b, cuantos) {
  for (const a of Object.values(b.at)) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, cuantos * a.itemSize);
    a.needsUpdate = true;
  }
  b.g.setDrawRange(0, cuantos);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof leerColores>} K
 */
export function crearEscena(canvas, K) {
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  const escena = new THREE.Scene();
  const camara = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);

  // Cintas con largo acumulado: el fragmento corta las rayas en píxeles de pantalla, con cualquier zoom.
  const CINTA = buffer(240000, { position: 3, rgba: 4, sd: 2 });
  const matCinta = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    uniforms: { z: { value: 1 } },
    vertexShader: `attribute vec4 rgba; attribute vec2 sd; varying vec4 vC; varying vec2 vS;
      void main(){ vC=rgba; vS=sd; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float z; varying vec4 vC; varying vec2 vS;
      void main(){ if(vS.y>.5){ float per=vS.y>1.5?10.:7.; float on=vS.y>1.5?6.:3.5; if(mod(vS.x*z,per)>on) discard; } gl_FragColor=vC; }`,
  });
  const cintas = new THREE.Mesh(CINTA.g, matCinta);
  cintas.frustumCulled = false;
  escena.add(cintas);

  // kind: 0 punto lleno, 1 página (anillo con centro del fondo), 2 final (anillo con centro lleno), 3 aro del elegido.
  const matPuntos = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { dpr: { value: dpr }, bg: { value: new THREE.Vector3(...K.lienzo) } },
    vertexShader: `attribute float size; attribute vec4 rgba; attribute float kind; uniform float dpr;
      varying vec4 vC; varying float vK; varying float vS;
      void main(){ vC=rgba; vK=kind; vS=max(size*dpr,1.); gl_PointSize=vS; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 bg; varying vec4 vC; varying float vK; varying float vS;
      void main(){ float d=length(gl_PointCoord-.5)*2.; float aa=2./vS; float o=1.-smoothstep(1.-aa,1.,d); if(o<=0.) discard;
        vec3 c=vC.rgb; float a=vC.a*o;
        if(vK>.5&&vK<2.5){ float th=vK>1.5?.3:.24; c=mix(bg,vC.rgb,smoothstep(1.-th-aa,1.-th,d)); if(vK>1.5) c=mix(c,vC.rgb,1.-smoothstep(.34,.34+aa,d)); }
        if(vK>2.5){ float th=.22; a*=smoothstep(1.-th-aa,1.-th,d); }
        gl_FragColor=vec4(c,a); }`,
  });
  const NODOS = buffer(1024, { position: 3, rgba: 4, size: 1, kind: 1 });
  const AGENTES = buffer(2048, { position: 3, rgba: 4, size: 1, kind: 1 });
  for (const b of [NODOS, AGENTES]) {
    const puntos = new THREE.Points(b.g, matPuntos);
    puntos.frustumCulled = false;
    escena.add(puntos);
  }

  // ── Cintas ──────────────────────────────────────────────────────────
  let nv = 0;
  const cp = CINTA.at.position.array;
  const cc = CINTA.at.rgba.array;
  const cs = CINTA.at.sd.array;
  function vertice(x, y, c, a, s, d) {
    if (nv >= CINTA.max) return;
    cp[nv * 3] = x;
    cp[nv * 3 + 1] = y;
    cp[nv * 3 + 2] = 0;
    cc[nv * 4] = c[0];
    cc[nv * 4 + 1] = c[1];
    cc[nv * 4 + 2] = c[2];
    cc[nv * 4 + 3] = a;
    cs[nv * 2] = s;
    cs[nv * 2 + 1] = d;
    nv++;
  }
  function cinta(pts, np, hw, c, a, d) {
    let pnx = 0;
    let pny = 0;
    let s = 0;
    for (let i = 0; i < np - 1; i++) {
      const x0 = pts[i * 2];
      const y0 = pts[i * 2 + 1];
      const x1 = pts[i * 2 + 2];
      const y1 = pts[i * 2 + 3];
      let dx = x1 - x0;
      let dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1e-6;
      dx /= l;
      dy /= l;
      const nx = -dy * hw;
      const ny = dx * hw;
      const ax = i ? (nx + pnx) / 2 : nx;
      const ay = i ? (ny + pny) / 2 : ny;
      const s1 = s + l;
      pnx = nx;
      pny = ny;
      vertice(x0 + ax, y0 + ay, c, a, s, d);
      vertice(x0 - ax, y0 - ay, c, a, s, d);
      vertice(x1 + nx, y1 + ny, c, a, s1, d);
      vertice(x1 + nx, y1 + ny, c, a, s1, d);
      vertice(x0 - ax, y0 - ay, c, a, s, d);
      vertice(x1 - nx, y1 - ny, c, a, s1, d);
      s = s1;
    }
  }
  const circulo = new Float32Array(2 * 181);

  function colorDeTramo(E, e) {
    if (e.tipo === "b") return K.back;
    if (e.ruta) return K.ruta;
    if (e.term) return e.term === "success" ? K.ok : e.term === "failed" ? K.bad : K.back;
    const d = E.finTramos.get(e.clave);
    if (!d || !d.hechos) return K.neu;
    return d.ok === d.hechos ? K.ok : d.ok === 0 ? K.bad : K.mid;
  }

  function dibujarTramos(E, dt) {
    nv = 0;
    const T = anilloFinal(E.m);
    const px = 1 / E.V.z;
    for (let c = 1; c <= T + 1; c++) {
      const f = acotar((E.anim - E.tAbrir - c * 0.06) / 0.5, 0, 1);
      for (let i = 0; i <= 180; i++) {
        const t = (i / 180) * Math.PI * 2;
        circulo[i * 2] = radio(c) * Math.cos(t);
        circulo[i * 2 + 1] = radio(c) * Math.sin(t);
      }
      cinta(circulo, 181, 0.6 * px, K.hilo, (c <= T ? 0.12 : 0.05) * f, 0);
    }
    const k = 1 - Math.exp(-dt * 4);
    const orden = [...E.m.tramos.values()].sort((x, y) => x.ruta - y.ruta || (x.forma !== "ret") - (y.forma !== "ret") || x.n - y.n);
    for (const e of orden) {
      const v = E.vis.tramos.get(e.clave);
      if (!v) continue;
      const p = acotar((E.anim - v.nace) / TRAZO, 0, 1);
      if (p <= 0) {
        v.np = 0;
        continue;
      }
      const wT = e.tipo === "b" ? 1.4 : (e.ruta ? 2.6 : 1.5) + 5 * Math.sqrt(e.n / E.m.maxN);
      v.w += (wT - v.w) * k;
      const cT = colorDeTramo(E, e);
      for (let i = 0; i < 3; i++) v.c[i] += (cT[i] - v.c[i]) * k;
      const base = e.tipo === "b" ? 0.55 : e.n === 0 && !e.ruta && !e.term ? 0.5 : 0.95;
      const aT = E.hl.on ? (E.hl.tramos.has(e.clave) ? 1 : 0.1) : base;
      v.al += (aT - v.al) * (1 - Math.exp(-dt * 20));
      const A = E.vis.nodos.get(e.a);
      const B = E.vis.nodos.get(e.b);
      const seg = segmentosDeTramo(A, B, e.forma);
      const pe = salida3(p);
      v.np = seg + 1;
      for (let i = 0; i <= seg; i++) {
        const q = puntoDeTramo(A, B, e.forma, e.ladeo, (i / seg) * pe, P);
        v.pts[i * 2] = q.x;
        v.pts[i * 2 + 1] = q.y;
      }
      const raya = e.tipo === "b" ? 1 : e.term === "abandoned" || e.term === "error" || e.term === "unmeasured" ? 2 : 0;
      if (e.ruta) cinta(v.pts, v.np, (v.w / 2 + 5) * px, v.c, 0.07 * v.al, 0);
      cinta(v.pts, v.np, (v.w / 2) * px, v.c, v.al, raya);
    }
    subir(CINTA, nv);
  }

  // ── Páginas y agentes ───────────────────────────────────────────────
  function escribir(b, i, x, y, c, a, tam, tipo) {
    const A = b.at;
    A.position.array[i * 3] = x;
    A.position.array[i * 3 + 1] = y;
    A.position.array[i * 3 + 2] = 0;
    A.rgba.array[i * 4] = c[0];
    A.rgba.array[i * 4 + 1] = c[1];
    A.rgba.array[i * 4 + 2] = c[2];
    A.rgba.array[i * 4 + 3] = a;
    A.size.array[i] = tam;
    A.kind.array[i] = tipo;
  }

  function dibujarNodos(E, dt) {
    let i = 0;
    for (const n of E.m.nodos.values()) {
      const v = E.vis.nodos.get(n.clave);
      const s = salida3(acotar((E.anim - v.nace) / 0.35, 0, 1));
      if (s <= 0 || i >= NODOS.max - 2) continue;
      v.pulso = Math.max(0, v.pulso - dt * 2.2);
      const dim = E.hl.on && !E.hl.nodos.has(n.clave) ? 0.3 : 1;
      const grande = E.marcado(n.clave) ? 1.18 : 1;
      if (n.term) escribir(NODOS, i++, v.x, v.y, K.final[n.term], dim, (14 + 7 * v.pulso) * s * grande, 2);
      else if (n.ruta >= 0) {
        escribir(NODOS, i++, v.x, v.y, K.ruta, 0.16 * dim, 28 * s * grande, 0);
        escribir(NODOS, i++, v.x, v.y, K.ruta, dim, 19 * s * grande, 1);
      } else escribir(NODOS, i++, v.x, v.y, n.atascos ? K.warn : K.nodo, dim, 14 * s * grande, 1);
    }
    subir(NODOS, i);
  }

  function dibujarAgentes(E) {
    let i = 0;
    for (const [run, v] of E.vis.agentes) {
      const a = E.m.agentes.get(run);
      posicionDeAgente(E, a, v);
      const fade = v.llego >= 0 ? 1 - acotar((E.anim - v.llego - 0.6) / 0.9, 0, 1) : acotar((E.anim - v.nace) / 0.3, 0, 1);
      let c = a.agente === "guide" ? K.ruta : K.agente;
      let tam = a.agente === "guide" ? 6.5 : 5.5;
      let al = 0.92;
      if (a.final && v.llego >= 0) c = K.final[a.final];
      if (a.atascado && !a.final) {
        const w = 0.5 + 0.5 * Math.sin(E.anim * 4.2 + v.h * 6);
        c = K.warn;
        tam += 2.2 * w;
        al = 0.65 + 0.35 * w;
      }
      if (E.hl.on) {
        if (E.hl.agentes.has(run)) tam += 1;
        else al *= 0.18;
      }
      if (i >= AGENTES.max - 2) break;
      escribir(AGENTES, i++, v.x, v.y, c, al * fade, tam, 0);
      if (run === E.elegido) escribir(AGENTES, i++, v.x, v.y, K.agente, 0.9 * Math.max(fade, 0.4), 17, 3);
    }
    subir(AGENTES, i);
  }

  // ── Vista ───────────────────────────────────────────────────────────
  function encuadrar(E, dt) {
    const k = 1 - Math.exp(-dt * 4);
    const Rf = radio(anilloFinal(E.m));
    // Con un encuadre (el camino de un agente elegido) la caja parte vacía; sin él, con el primer anillo.
    const r1 = E.V.marco ? 0 : radio(1);
    let x0 = -r1 * 0.7;
    let x1 = r1;
    let y0 = -r1;
    let y1 = r1;
    let etqDer = 0;
    let etqIzq = 0;
    for (const n of E.m.nodos.values()) {
      const v = E.vis.nodos.get(n.clave);
      const tr = n.term ? Rf : radio(n.anillo);
      v.r += (tr - v.r) * k;
      v.a += (n.ang - v.a) * k;
      v.x = v.r * Math.cos(v.a);
      v.y = v.r * Math.sin(v.a);
      const tx = tr * Math.cos(n.ang);
      const ty = tr * Math.sin(n.ang);
      if (E.V.marco && !E.V.marco.has(n.clave)) continue;
      x0 = Math.min(x0, tx);
      x1 = Math.max(x1, tx);
      y0 = Math.min(y0, ty);
      y1 = Math.max(y1, ty);
      if (n.term) {
        if (tx < -1) etqIzq = Math.max(etqIzq, 150);
        else if (tx >= x1 - 1) etqDer = 150;
      }
    }
    const V = E.V;
    if (V.auto) {
      const z = acotar(Math.min((E.W - 72 - etqDer - etqIzq) / (x1 - x0), (E.H - 92) / (y1 - y0)), 0.3, 1.4);
      const cx = (x0 + x1) / 2 + (etqDer - etqIzq) / 2 / z;
      const cy = (y0 + y1) / 2 + 12 / z;
      if (V.viaje) {
        // Del encuadre de antes al nuevo en VIAJE_MS, con la curva de salida; después sigue al encuadre.
        const p = salida3(acotar((performance.now() - V.viaje.t0) / VIAJE_MS, 0, 1));
        V.z = V.viaje.z + (z - V.viaje.z) * p;
        V.cx = V.viaje.cx + (cx - V.viaje.cx) * p;
        V.cy = V.viaje.cy + (cy - V.viaje.cy) * p;
        if (p >= 1) V.viaje = null;
      } else {
        const q = V.init ? 1 - Math.exp(-dt * 3) : 1;
        V.z += (z - V.z) * q;
        V.cx += (cx - V.cx) * q;
        V.cy += (cy - V.cy) * q;
      }
      V.init = true;
    }
    camara.left = V.cx - E.W / 2 / V.z;
    camara.right = V.cx + E.W / 2 / V.z;
    camara.top = V.cy - E.H / 2 / V.z;
    camara.bottom = V.cy + E.H / 2 / V.z;
    camara.updateProjectionMatrix();
    matCinta.uniforms.z.value = V.z;
  }

  return {
    medir(W, H) {
      renderer.setSize(W, H, false);
    },
    /** Un cuadro: encuadre, tramos, páginas y agentes. */
    dibujar(E, dt) {
      encuadrar(E, dt);
      dibujarTramos(E, dt);
      dibujarNodos(E, dt);
      dibujarAgentes(E);
      renderer.render(escena, camara);
    },
    destruir() {
      for (const b of [CINTA, NODOS, AGENTES]) b.g.dispose();
      matCinta.dispose();
      matPuntos.dispose();
      renderer.dispose();
      // dispose() no suelta el contexto: sin esto, entrar y salir de la pestaña acumula contextos WebGL.
      renderer.forceContextLoss();
    },
    /** Tras releer los colores (cambio de tema): el fondo de los puntos vive en un uniforme. */
    actualizarColores() {
      matPuntos.uniforms.bg.value.set(...K.lienzo);
    },
  };
}

const P = { x: 0, y: 0 };

/** El estado visual de una página o un tramo nuevos; instantaneo: sin animación de entrada. */
export function sincronizar(E, { instantaneo = false, agentes = [] } = {}) {
  const T = anilloFinal(E.m);
  for (const n of E.m.nodos.values()) {
    if (E.vis.nodos.has(n.clave)) continue;
    const origen = n.origen ? E.vis.nodos.get(n.origen) : null;
    const r = n.term ? radio(T) : radio(n.anillo);
    E.vis.nodos.set(n.clave, {
      r: !instantaneo && origen ? origen.r : r,
      a: !instantaneo && origen && origen.r >= 1 ? origen.a : n.ang,
      anillo: n.anillo,
      x: 0,
      y: 0,
      nace: E.anim + (instantaneo ? 0 : n.term ? TRAZO * 0.6 : origen ? TRAZO * 0.3 : 0),
      pulso: 0,
    });
  }
  for (const e of E.m.tramos.values()) {
    if (E.vis.tramos.has(e.clave)) continue;
    E.vis.tramos.set(e.clave, { nace: E.anim, w: 1.5, c: (e.tipo === "b" ? E.K.back : e.ruta ? E.K.ruta : E.K.neu).slice(), al: 0, pts: new Float32Array(2 * 161), np: 0 });
  }
  for (const a of agentes) {
    let v = E.vis.agentes.get(a.run);
    if (!v) {
      if (instantaneo && a.final) continue;
      v = { x: NaN, y: NaN, mv: null, llego: -1, nace: E.anim, h: hash(a.run), h2: hash(`${a.run}*`), serie: 0 };
      E.vis.agentes.set(a.run, v);
    }
    if (v.serie === a.serie) continue;
    v.serie = a.serie;
    if (instantaneo) {
      v.mv = null;
      if (a.final) E.vis.agentes.delete(a.run);
    } else v.mv = { tramo: a.mov, t0: E.anim, dur: 0.85 / Math.sqrt(E.vel), sx: v.x, sy: v.y };
  }
}

/**
 * Entrada de la telaraña al abrirla: anillos, páginas y tramos aparecen del centro hacia afuera.
 */
export function introducir(E) {
  const T = anilloFinal(E.m);
  const anillo = (n) => (n.term ? T : n.anillo);
  E.tAbrir = E.anim;
  for (const n of E.m.nodos.values()) {
    const v = E.vis.nodos.get(n.clave);
    v.r = n.term ? radio(T) : radio(n.anillo);
    v.a = n.ang;
    v.anillo = n.anillo;
    v.nace = E.anim + 0.08 * anillo(n);
  }
  for (const e of E.m.tramos.values()) {
    const v = E.vis.tramos.get(e.clave);
    v.nace = E.anim + 0.08 * Math.min(anillo(E.m.nodos.get(e.a)), anillo(E.m.nodos.get(e.b)));
    v.al = 0;
  }
}

/** Termina los movimientos cumplidos; devuelve los finales a los que acaba de llegar alguien (para el tic). */
export function avanzarAgentes(E) {
  const llegadas = [];
  for (const [run, v] of E.vis.agentes) {
    const a = E.m.agentes.get(run);
    if (v.mv && E.anim - v.mv.t0 >= v.mv.dur) {
      v.mv = null;
      if (a.final && v.llego < 0) {
        v.llego = E.anim;
        const fin = claveDeFinal(a.final);
        E.vis.nodos.get(fin).pulso = 1;
        llegadas.push(fin);
      }
    }
    if (v.llego >= 0 && E.anim - v.llego > 1.6 && run !== E.elegido) E.vis.agentes.delete(run);
  }
  return llegadas;
}

/** Dónde dibujar un agente: alrededor de su página, o sobre el tramo que recorre. */
function posicionDeAgente(E, a, v) {
  const n = E.m.nodos.get(a.nodo);
  const vn = E.vis.nodos.get(a.nodo);
  const ang = n.term ? vn.a + Math.PI + (v.h - 0.5) * 1.6 : v.h * Math.PI * 2;
  const r = (n.term ? 14 : 13) + v.h2 * (n.term ? 10 : 6);
  const ox = Math.cos(ang) * r;
  const oy = Math.sin(ang) * r;
  const e = v.mv && E.m.tramos.get(v.mv.tramo);
  if (e) {
    const t = ease(acotar((E.anim - v.mv.t0) / v.mv.dur, 0, 1));
    const A = E.vis.nodos.get(e.a);
    const B = E.vis.nodos.get(e.b);
    const c0 = puntoDeTramo(A, B, e.forma, e.ladeo, 0, P);
    const c0x = c0.x;
    const c0y = c0.y;
    const sx = Number.isNaN(v.mv.sx) ? c0x : v.mv.sx;
    const sy = Number.isNaN(v.mv.sy) ? c0y : v.mv.sy;
    const q = puntoDeTramo(A, B, e.forma, e.ladeo, t, P);
    v.x = q.x + (sx - c0x) * (1 - t) + ox * t;
    v.y = q.y + (sy - c0y) * (1 - t) + oy * t;
  } else {
    v.x = vn.x + ox;
    v.y = vn.y + oy;
  }
}
