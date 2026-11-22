(window.__libs || Promise.resolve()).then(function () { return document.fonts && document.fonts.load ? Promise.all([document.fonts.load('600 40px Inter'), document.fonts.load('400 40px Inter'), document.fonts.load('400 20px "JetBrains Mono"')]).catch(function () {}) : 0; }).then(function () {
'use strict';
const THREE = window.THREE, gsap = window.gsap;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const C = {
  ink: hex('#F5F5F7'), turq: hex('#2EE6C5'), link: hex('#8C8C9E'), cat: hex('#B4B4C2'),
  amber: hex('#FFB547'), red: hex('#FF5B4D'), deadRed: hex('#FF6B57'),
  spec: ['#B8FF5C', '#2EE6C5', '#4C8DFF', '#8B5CF6', '#F472B6'].map(hex),
};
function spectrum(t) { t = clamp(t, 0, 1) * 4; const i = Math.min(3, Math.floor(t)); return mix3(C.spec[i], C.spec[i + 1], t - i); }

// ─────────────────────────────────────────────── grafo
// Cada nodo vive en polares (anillo r, ranura u ∈ [0,1]). El menú-laberinto es un abanico;
// la telaraña es el mismo abanico abierto a 360°: el «Magic Move» es interpolar origen, radio y apertura.
const NCAT = [12, 15, 13, 14, 11, 16, 13, 14, 12, 15, 13, 14, 13, 12, 15, 14, 13, 12, 13]; // 254 enlaces
const RUTA_CAT = 12;
const UC = (RUTA_CAT + 0.5) / 19;
const nodes = [], edges = [];
function nodo(o) { o.i = nodes.length; o.al = 1; o.el = 1; o.heat = 0; o.x = 0; o.y = 0; o.r = 0; o.a = 0; nodes.push(o); return o; }
function arista(a, b, kind) { edges.push({ a, b, kind }); }

const I = nodo({ k: 'I', ring: 0, u: UC, rm: 0, rw: 0, route: 1, rs: 0 });
const S = nodo({ k: 'S', ring: 1, u: UC, rm: 166, rw: 100, route: 1, rs: 0 });
arista(I, S, 'route');
const CATS = [];
for (let c = 0; c < 19; c++) {
  const n = nodo({ k: 'C' + c, ring: 2, u: (c + 0.5) / 19, rm: c === RUTA_CAT ? 344 : 336 + (c % 2 ? 20 : 0), rw: 205, route: c === RUTA_CAT ? 1 : 0, cat: c, rs: 240 });
  CATS.push(n);
  arista(S, n, c === RUTA_CAT ? 'route' : 'cat');
}
let F22 = null, DJ = null;
const LINKS = [];
for (let c = 0; c < 19; c++) {
  for (let j = 0; j < NCAT[c]; j++) {
    const isF = c === RUTA_CAT && j === 6, isD = c === RUTA_CAT && j === 2;
    const n = nodo({
      k: 'L' + c + '_' + j, ring: 3, u: isD ? UC - 0.045 : (c + (j + 0.5) / NCAT[c]) / 19,
      rm: isF ? 560 : isD ? 590 : 502 + (j % 4) * 27, rw: isF ? 312 : isD ? 334 : 290 + (j % 4) * 24,
      route: isF ? 1 : 0, cat: c, parent: CATS[c], dj: isD ? 1 : 0, rs: 240,
    });
    if (isF) F22 = n; if (isD) DJ = n;
    LINKS.push(n);
    arista(CATS[c], n, isF ? 'route' : 'link');
  }
}
const K = nodo({ k: 'K', ring: 4, u: UC, rm: 718, rw: 430, route: 1, rs: 380 });
const A = nodo({ k: 'A', ring: 5, u: UC, rm: 858, rw: 490, route: 1, rs: 500 });
const P = nodo({ k: 'P', ring: 6, u: UC, rm: 998, rw: 550, route: 1, rs: 500 });
const E = nodo({ k: 'E', ring: 7, u: UC, rm: 1138, rw: 610, route: 1, rs: 610 });
arista(F22, K, 'route'); arista(K, A, 'route'); arista(A, P, 'route'); arista(P, E, 'route');
const C3 = CATS[3], C8 = CATS[8], C12 = CATS[RUTA_CAT];
const ROUTE = [I, S, C12, F22, K, A, P, E];
const RINGS_W = [100, 205, 326, 430, 490, 550, 610];

// Línea de vistas del SII (S1): cada pantalla termina como miniatura en su ranura; en S3 se contrae a su nodo.
const ROW_Y = 330, SLOT0 = -777, SLOT_DX = 222, TW = 176, TH = 110;
const FULL = { x: 300, y: -80, w: 1080, h: 675 };
const VIEWS = [
  { img: 'landing', n: I, slot: 0, num: '01', t: 'Inicio' },
  { img: 'servicios', n: S, slot: 1, num: '02', t: 'Servicios online' },
  { img: 'renta', n: C12, slot: 2, num: '03', t: 'Declaración de renta · 13/19' },
  { img: 'dj', n: DJ, slot: -1, num: '', t: 'Declaraciones juradas de Renta', dead: 1 },
  { img: 'f22', n: F22, slot: 3, num: '04', t: 'Declarar Renta (F22)' },
  { img: 'login', n: K, slot: 4, num: '05', t: 'Clave Tributaria' },
  { gen: 'at', n: A, slot: 5, num: '06', t: 'Año tributario 2026' },
  { gen: 'prop', n: P, slot: 6, num: '07', t: 'Propuesta' },
  { gen: 'env', n: E, slot: 7, num: '08', t: 'Enviar' },
];
function slotXY(V) { return V.slot < 0 ? [SLOT0 + 1.5 * SLOT_DX, ROW_Y - 182] : [SLOT0 + V.slot * SLOT_DX, ROW_Y]; }
for (const V of VIEWS) { const p = slotXY(V); V.n.lx = p[0]; V.n.ly = p[1]; }
for (const n of nodes) if (n.lx === undefined) { n.lx = S.lx; n.ly = S.ly; }

// Encuadres (mundo de diseño 1920×1080, y hacia abajo, origen al centro).
const OM = [-790, 362], THM = -0.36, SPM = 1.6;
const OW = [262, 22], THW = -0.55, SPW = TAU;
const ORBIT_R = 448;
// Al abrirse, la telaraña da un giro: los anillos de adentro rotan más y se desenrollan al llegar.
const SWIRL = -1.25;
// Cámara sobre la telaraña (agentes y refinamiento) y la del plano antes/después (sus etiquetas HTML asumen esta).
const CAMW = { camX: 62, camY: -6, zoom: 1.1 };
const CAMP = { camX: 20, camY: 0, zoom: 1.08 };
// Halo de calor (px) según cuántos agentes se perdieron en el nodo.
const HALO = (h) => 44 + 170 * h;
// Halo de llegada en «Enviar» (px) según la fracción de agentes que llega.
const META = (f) => 36 + 200 * f;

// ─────────────────────────────────────────────── estado de escena (todo lo anima GSAP)
const BASE = {
  spot: 0, open: 0, ringK: 1, ping: 0, g3: 0, g1: 0, g2: 0, v0: 0, v1: 0, v2: 0, v3: 0, v4: 0, v5: 0, v6: 0, v7: 0, v8: 0, thumbK: 0, rowA: 0, lin: 1, routeA: 0, djRed: 0, curX: 300, curY: 120, curA: 0, clk: 0,
  camX: 0, camY: 0, zoom: 1, morph: 0, graphA: 0, dimG: 1, trace: 1e3, traceA: 0, labA: 0, labW: 0, ringsA: 0,
  c3: 0, a3: 0, h3: 0, r1: 0, a1: 0, h1: 0, r2: 0, a2: 0, h2: 0, simp: 0, orbA: 0, orb: 0, planeA: 0, wipe: 0, breathe: 0,
};
const G = Object.assign({}, BASE);

// ─────────────────────────────────────────────── el trazo del slide 1 (camino real, paso a paso)
const SCRIPT = [
  ['f', I, S, 0.45], ['f', S, C12, 0.45], ['w', 0.2], ['f', C12, DJ, 0.45, 'red'], ['w', 0.7, 'blink'], ['b', 0.35],
  ['f', C12, F22, 0.4], ['f', F22, K, 0.38], ['f', K, A, 0.38], ['f', A, P, 0.38], ['f', P, E, 0.38],
];
const ARRIVE = new Map(), LEAVE = new Map();
let TEND = 0;
(function () {
  let t = 0; const st = [];
  for (const ev of SCRIPT) {
    const d = ev[0] === 'f' ? ev[3] : ev[1];
    ev.t0 = t; ev.t1 = t + d; t += d;
    if (ev[0] === 'f') { st.push(ev); if (!ARRIVE.has(ev[2])) ARRIVE.set(ev[2], ev.t1); }
    if (ev[0] === 'b') { const top = st.pop(); ev.edge = top; LEAVE.set(top[2], ev.t1); }
  }
  TEND = t;
  ARRIVE.set(I, 0.1);
})();
BASE.trace = G.trace = TEND;
function traceState(tau) {
  const segs = []; let blink = 0;
  for (const ev of SCRIPT) {
    if (tau < ev.t0) break;
    const p = clamp((tau - ev.t0) / (ev.t1 - ev.t0), 0, 1);
    if (ev[0] === 'f') segs.push({ a: ev[1], b: ev[2], f: p, red: ev[4] === 'red' });
    else if (ev[0] === 'b') { const s = segs[segs.length - 1]; s.f = 1 - p; if (p >= 1) segs.pop(); }
    else if (ev[2] === 'blink' && p < 1) blink = p;
  }
  return { segs, blink };
}

// ─────────────────────────────────────────────── agentes
// Destinos: 'ok' recorre toda la ruta; el resto se queda donde se pierde (ese nodo se calienta).
function agentes(opts) {
  const R = rng(opts.seed), list = [];
  const fates = [];
  for (const [f, n] of opts.mix) for (let i = 0; i < n; i++) fates.push(f);
  for (let i = fates.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = fates[i]; fates[i] = fates[j]; fates[j] = t; }
  const per = Math.ceil(fates.length / opts.bursts);
  fates.forEach((f, i) => {
    const b = Math.floor(i / per);
    const route = opts.route;
    let path;
    if (f === 'ok') path = route;
    else if (f === 'C3') path = [I, S, C3];
    else if (f === 'C8') path = [I, S, C8];
    else if (f === 'DJ') path = [I, S, C12, DJ];
    else path = route.slice(0, route.indexOf(f) + 1);
    const ang = R() * TAU, rad = 5 + 15 * Math.sqrt(R());
    list.push({
      path, ok: f === 'ok', end: path[path.length - 1],
      t0: b * opts.gap + R() * opts.spread, d: opts.dur * (0.82 + 0.36 * R()),
      jx: Math.cos(ang) * rad, jy: Math.sin(ang) * rad,
      col: spectrum((b + 0.15 + R() * 0.7) / opts.bursts),
    });
  });
  list.sort((a, b) => a.t0 - b.t0);
  let end = 0; for (const a of list) end = Math.max(end, a.t0 + a.d * (a.path.length - 1) + (a.ok ? a.d * 2.2 : 0.6));
  // Resultado final de la vuelta: perdidos por nodo y fracción que llega (para dejar su marca en la siguiente).
  const lost = new Map(); let ok = 0;
  for (const a of list) { if (a.ok) ok++; else lost.set(a.end, (lost.get(a.end) || 0) + 1); }
  return { list, end, lost, okF: ok / list.length };
}
// Tres revisiones del mismo sitio: 31 % → 64 % → 88 % llegan.
const SET3 = agentes({ seed: 7, bursts: 8, gap: 0.72, spread: 0.32, dur: 0.3, route: ROUTE,
  mix: [['ok', 159], ['C3', 44], ['C8', 40], ['DJ', 104], [K, 94], [P, 71]] });
const SET1 = agentes({ seed: 11, bursts: 4, gap: 0.42, spread: 0.22, dur: 0.21, route: ROUTE,
  mix: [['ok', 164], [K, 52], [P, 30], [A, 10]] });
const SET2 = agentes({ seed: 23, bursts: 3, gap: 0.32, spread: 0.16, dur: 0.19, route: [I, F22, K, P, E],
  mix: [['ok', 169], [K, 15], [P, 8]] });
// c: reloj de la vuelta · a: agentes visibles · h: su calor · g: su marca fantasma (lo que dejó la vuelta anterior).
const SETS = [
  { s: SET3, c: 'c3', a: 'a3', h: 'h3', g: 'g3' },
  { s: SET1, c: 'r1', a: 'a1', h: 'h1', g: 'g1' },
  { s: SET2, c: 'r2', a: 'a2', h: 'h2', g: 'g2' },
];

// ─────────────────────────────────────────────── three.js
const stage = $('#stage'), canvas = $('#gl');
THREE.ColorManagement.enabled = false;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-960, 960, -540, 540, -10, 10);
let SW = 1920, SH = 1080;
function medir() { const r = stage.getBoundingClientRect(); SW = Math.max(1, r.width); SH = Math.max(1, r.height); renderer.setSize(SW, SH, false); }
new ResizeObserver(medir).observe(stage);
medir();

function buffer(max, sizes) {
  const g = new THREE.BufferGeometry(), at = {};
  for (const name in sizes) {
    at[name] = new THREE.BufferAttribute(new Float32Array(max * sizes[name]), sizes[name]).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, at[name]);
  }
  g.setDrawRange(0, 0);
  return { g, at, max, n: 0 };
}
function subir(b) {
  for (const k in b.at) { const a = b.at[k]; a.clearUpdateRanges(); a.addUpdateRange(0, b.n * a.itemSize); a.needsUpdate = true; }
  b.g.setDrawRange(0, b.n);
}

// Cintas: el ancho llega en píxeles y el fragmento suaviza el último píxel del borde.
const matCinta = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: 'attribute vec4 col; attribute vec2 ew; varying vec4 vC; varying vec2 vE; void main(){ vC=col; vE=ew; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'varying vec4 vC; varying vec2 vE; void main(){ float d=abs(vE.x)*vE.y; float a=clamp(vE.y-d,0.,1.); if(a*vC.a<.002) discard; gl_FragColor=vec4(vC.rgb,vC.a*a); }',
});
const matPunto = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, uniforms: { dpr: { value: DPR } },
  vertexShader: 'attribute vec4 col; attribute float size; attribute float kind; uniform float dpr; varying vec4 vC; varying float vK; varying float vS; void main(){ vC=col; vK=kind; vS=max(size*dpr,1.); gl_PointSize=vS; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'varying vec4 vC; varying float vK; varying float vS; void main(){ float d=length(gl_PointCoord-.5)*2.; float a; if(vK<.5){ a=clamp((1.-d)*vS*.5+.5,0.,1.); } else if(vK<1.5){ a=exp(-d*d*3.2)*(1.-smoothstep(.8,1.,d)); } else { float e=(1.-d)*vS*.5; a=clamp(e+.5,0.,1.)*clamp(2.6-e,0.,1.); } a*=vC.a; if(a<.003) discard; gl_FragColor=vec4(vC.rgb,a); }',
});
const RIB_A = buffer(150000, { position: 3, col: 4, ew: 2 });
const RIB_B = buffer(30000, { position: 3, col: 4, ew: 2 });
const PTS_A = buffer(1200, { position: 3, col: 4, size: 1, kind: 1 });
const PTS_B = buffer(6000, { position: 3, col: 4, size: 1, kind: 1 });
[[RIB_A, 1, 'm'], [PTS_A, 2, 'p'], [RIB_B, 3, 'm'], [PTS_B, 4, 'p']].forEach(function (x) {
  const o = x[2] === 'm' ? new THREE.Mesh(x[0].g, matCinta) : new THREE.Points(x[0].g, matPunto);
  o.frustumCulled = false; o.renderOrder = x[1]; scene.add(o);
});

let PXW = 1; // unidades de mundo por píxel CSS
function vtx(b, x, y, c, a, e, w) {
  if (b.n >= b.max) return;
  const i = b.n++, P = b.at.position.array, K2 = b.at.col.array, W = b.at.ew.array;
  P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = 0;
  K2[i * 4] = c[0]; K2[i * 4 + 1] = c[1]; K2[i * 4 + 2] = c[2]; K2[i * 4 + 3] = a;
  W[i * 2] = e; W[i * 2 + 1] = w;
}
// pts: Float32Array [x0,y0,x1,y1...]; alphas opcional por punto.
function cinta(b, pts, np, wpx, c, a, alphas) {
  if (a <= 0.002 || np < 2) return;
  const hw = (wpx / 2 + 1) * PXW, wt = wpx / 2 + 1;
  let pnx = 0, pny = 0;
  for (let i = 0; i < np - 1; i++) {
    const x0 = pts[i * 2], y0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], y1 = pts[i * 2 + 3];
    let dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy);
    if (l < 1e-5) continue;
    dx /= l; dy /= l;
    const nx = -dy * hw, ny = dx * hw, ax = i && (pnx || pny) ? (nx + pnx) / 2 : nx, ay = i && (pnx || pny) ? (ny + pny) / 2 : ny;
    pnx = nx; pny = ny;
    const a0 = alphas ? a * alphas[i] : a, a1 = alphas ? a * alphas[i + 1] : a;
    vtx(b, x0 + ax, y0 + ay, c, a0, 1, wt); vtx(b, x0 - ax, y0 - ay, c, a0, -1, wt); vtx(b, x1 + nx, y1 + ny, c, a1, 1, wt);
    vtx(b, x1 + nx, y1 + ny, c, a1, 1, wt); vtx(b, x0 - ax, y0 - ay, c, a0, -1, wt); vtx(b, x1 - nx, y1 - ny, c, a1, -1, wt);
  }
}
function punto(b, x, y, c, a, size, kind) {
  if (a <= 0.003 || b.n >= b.max) return;
  const i = b.n++, P = b.at.position.array, K2 = b.at.col.array;
  P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = 0;
  K2[i * 4] = c[0]; K2[i * 4 + 1] = c[1]; K2[i * 4 + 2] = c[2]; K2[i * 4 + 3] = a;
  b.at.size.array[i] = size; b.at.kind.array[i] = kind;
}

// ─────────────────────────────────────────────── plano «antes / después» (texturas generadas)
function rr(x, X, y, w, h, r) { x.beginPath(); x.roundRect(X, y, w, h, r); }
function pagina(despues) {
  const W = 1600, H = 1000, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const font = (w, s, f) => { x.font = w + ' ' + s + 'px ' + (f || 'Inter'); };
  if (!despues) {
    x.fillStyle = '#EEF0F3'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#26313F'; x.fillRect(0, 0, W, 74);
    x.fillStyle = 'rgba(255,255,255,.85)'; rr(x, 36, 22, 132, 30, 4); x.fill();
    font(400, 14); x.fillStyle = 'rgba(255,255,255,.72)';
    ['Inicio', 'Servicios online', 'Ayuda', 'Normativa', 'Noticias', 'Contacto', 'Mapa del sitio'].forEach((t, i) => x.fillText(t, 760 + i * 118, 43));
    x.fillStyle = '#DCE1E7'; x.fillRect(0, 74, W, 40);
    font(400, 13); x.fillStyle = '#4A5563';
    ['Personas', 'Empresas', 'Contribuciones', 'Factura electrónica', 'Boletas', 'Herencias', 'IVA', 'Avalúos', 'Certificados', 'Otros trámites'].forEach((t, i) => x.fillText(t, 36 + i * 150, 99));
    x.fillStyle = '#E4E8ED'; x.fillRect(24, 136, 300, 840);
    font(400, 14);
    ['Clave Tributaria', 'RUT e inicio de actividades', 'Factura electrónica', 'Boleta de honorarios', 'Declaraciones juradas', 'Declaración de renta', 'Bienes raíces', 'Situación tributaria', 'Término de giro', 'Contribuciones', 'Herencias', 'IVA y otros impuestos', 'Timbraje', 'Peticiones administrativas', 'Infracciones', 'Certificados', 'Avalúos', 'Libros contables', 'Otros'].forEach((t, i) => {
      x.fillStyle = i === 5 ? '#26313F' : '#3B5F8F'; x.fillText('› ' + t, 42, 170 + i * 41);
      x.fillStyle = '#D3D8DF'; x.fillRect(42, 182 + i * 41, 262, 1);
    });
    font(400, 13); x.fillStyle = '#6B7280'; x.fillText('Inicio › Servicios online › Renta › Declaración › Propuesta', 360, 164);
    font(600, 26); x.fillStyle = '#1F2937'; x.fillText('Declaración de Renta AT 2026', 360, 212);
    for (let i = 0; i < 9; i++) { x.fillStyle = '#C9CED6'; x.fillRect(360, 246 + i * 26, i % 3 === 2 ? 680 : 1160, 10); }
    x.strokeStyle = '#C9CED6'; x.lineWidth = 1;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 5; c++) { x.strokeRect(360 + c * 236, 500 + r * 40, 236, 40); x.fillStyle = r === 0 ? '#AEB5C0' : '#D8DCE2'; x.fillRect(374 + c * 236, 516 + r * 40, r === 0 ? 120 : 70 + ((r * 7 + c * 13) % 90), 9); }
    for (let i = 0; i < 4; i++) { x.fillStyle = '#C9CED6'; x.fillRect(360, 850 + i * 24, i === 3 ? 520 : 1160, 9); }
    x.fillStyle = '#A9B6C6'; rr(x, 1440, 934, 80, 30, 3); x.fill();
    font(500, 13); x.fillStyle = '#F4F6F8'; x.fillText('Enviar', 1458, 954);
    font(400, 12); x.fillStyle = '#3B5F8F'; x.fillText('Volver', 1376, 954);
  } else {
    x.fillStyle = '#F6F7F9'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, 86); x.fillStyle = '#E6E8EC'; x.fillRect(0, 86, W, 2);
    x.fillStyle = '#1C1C24'; rr(x, 64, 28, 120, 30, 6); x.fill();
    font(500, 22); x.fillStyle = '#4B5260'; x.fillText('Paso 3 de 3', 1356, 52);
    font(600, 88); x.fillStyle = '#0E0F14'; x.fillText('Declarar renta', 120, 268);
    font(400, 36); x.fillStyle = '#4B5260'; x.fillText('Tu propuesta está lista. Revísala y envía.', 124, 334);
    x.fillStyle = '#FFFFFF'; rr(x, 120, 400, 1360, 300, 24); x.fill();
    x.strokeStyle = '#E3E6EB'; x.lineWidth = 2; x.stroke();
    [['Contribuyente', 340], ['Año tributario', 260], ['Resultado', 300]].forEach((r, i) => {
      font(400, 30); x.fillStyle = '#5A6170'; x.fillText(r[0], 172, 488 + i * 86);
      x.fillStyle = i === 2 ? '#1A1B22' : '#D5D9E0'; rr(x, 1420 - r[1], 466 + i * 86, r[1], 26, 13); x.fill();
      if (i < 2) { x.fillStyle = '#EEF0F3'; x.fillRect(172, 522 + i * 86, 1256, 2); }
    });
    x.fillStyle = '#007866'; rr(x, 120, 768, 1360, 132, 26); x.fill();
    font(600, 52); x.fillStyle = '#FFFFFF'; x.textAlign = 'center'; x.fillText('Enviar', 800, 852); x.textAlign = 'left';
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// Pantallas después del ingreso (no se pueden capturar sin clave): recreaciones fieles a la estructura.
function pantalla(tipo) {
  const W = 1440, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const font = (w, s) => { x.font = w + ' ' + s + 'px Inter'; };
  const boton = (X, Y, w, h, t, lleno) => {
    rr(x, X, Y, w, h, 4); if (lleno) { x.fillStyle = '#E9511E'; x.fill(); } else { x.strokeStyle = '#1D5FA8'; x.lineWidth = 2; x.stroke(); }
    font(600, 18); x.fillStyle = lleno ? '#fff' : '#1D5FA8'; x.textAlign = 'center'; x.fillText(t, X + w / 2, Y + h / 2 + 6); x.textAlign = 'left';
  };
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#0A2A4A'; x.fillRect(0, 0, W, 64);
  font(600, 19); x.fillStyle = '#fff'; x.fillText('Servicio de Impuestos Internos', 48, 40);
  font(400, 15); x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText('Mi Sii   ·   Salir', 1270, 40);
  x.fillStyle = '#F2F4F7'; x.fillRect(0, 64, W, 54);
  font(500, 16); x.fillStyle = '#1D3E62'; x.fillText('Declaración de Renta  ›  Año Tributario 2026', 48, 98);
  font(400, 14); x.fillStyle = '#8A93A0'; x.textAlign = 'right'; x.fillText('después de ingresar · recreación', W - 48, 98); x.textAlign = 'left';
  const barras = (X, Y, n, w) => { for (let i = 0; i < n; i++) { x.fillStyle = '#DDE2E8'; x.fillRect(X, Y + i * 24, i === n - 1 ? w * 0.55 : w, 10); } };
  if (tipo === 'at') {
    font(600, 34); x.fillStyle = '#0A2A4A'; x.fillText('Selecciona el año tributario', 48, 190);
    barras(48, 220, 2, 760);
    boton(520, 380, 400, 70, 'Año Tributario 2026', true);
    boton(520, 474, 400, 70, 'Año Tributario 2025', false);
    boton(520, 568, 400, 70, 'Año Tributario 2024', false);
  } else if (tipo === 'prop') {
    font(600, 34); x.fillStyle = '#0A2A4A'; x.fillText('Propuesta de declaración · Formulario 22', 48, 190);
    barras(48, 220, 2, 760);
    x.strokeStyle = '#DDE2E8'; x.lineWidth = 1;
    for (let r = 0; r < 10; r++) {
      const y = 290 + r * 44; x.strokeRect(48, y, 1344, 44);
      font(500, 15); x.fillStyle = '#1D3E62'; x.fillText('Código ' + (110 + r * 37), 66, y + 28);
      x.fillStyle = '#C9D0D9'; x.fillRect(220, y + 17, 300 + ((r * 97) % 380), 10);
      x.fillStyle = '#9AA6B4'; x.fillRect(1220, y + 17, 150, 10);
    }
    boton(830, 770, 240, 58, 'Modificar', false);
    boton(1100, 770, 292, 58, 'Aceptar propuesta', true);
  } else {
    font(600, 34); x.fillStyle = '#0A2A4A'; x.fillText('Resumen y envío', 48, 190);
    barras(48, 220, 2, 760);
    x.strokeStyle = '#DDE2E8'; x.lineWidth = 1; x.strokeRect(48, 290, 1344, 220);
    ['Contribuyente', 'Año tributario', 'Resultado de la declaración'].forEach((t, i) => {
      font(500, 17); x.fillStyle = '#1D3E62'; x.fillText(t, 76, 345 + i * 66);
      x.fillStyle = '#C9D0D9'; x.fillRect(1120, 334 + i * 66, 240, 12);
    });
    x.strokeStyle = '#1D5FA8'; x.lineWidth = 2; x.strokeRect(48, 560, 22, 22);
    font(400, 17); x.fillStyle = '#333'; x.fillText('Declaro que la información es fidedigna', 86, 578);
    boton(560, 640, 320, 64, 'Enviar declaración', true);
  }
  return textura(cv);
}
function textura(src) {
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}
function cargar(nombre) {
  const img = new Image(), t = textura(document.createElement('canvas'));
  img.onload = () => { t.image = img; t.needsUpdate = true; };
  img.src = (window.__SII || {})[nombre] || '';
  return { t, img };
}
// «Después»: la misma captura real con la capa de Chameleon (tema que atenúa el ruido, ruta iluminada y lanzador del kit).
function despues(img) {
  const W = 1440, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const font = (w, s) => { x.font = w + ' ' + s + 'px Inter'; };
  const AC = '#0b57d0';
  x.filter = 'blur(6px)'; x.drawImage(img, 0, 0, W, H); x.filter = 'none';
  x.fillStyle = 'rgba(246,247,249,.8)'; x.fillRect(0, 0, W, H);
  x.drawImage(img, 0, 0, W, 104, 0, 0, W, 104);
  x.fillStyle = 'rgba(11,87,208,.10)'; rr(x, 724, 62, 196, 36, 18); x.fill();
  x.strokeStyle = AC; x.lineWidth = 2.5; rr(x, 724, 62, 196, 36, 18); x.stroke();
  const cx = 330, cy = 176, cw = 780;
  x.save(); x.shadowColor = 'rgba(0,0,0,.14)'; x.shadowBlur = 48; x.shadowOffsetY = 16;
  x.fillStyle = '#fff'; rr(x, cx, cy, cw, 520, 22); x.fill(); x.restore();
  x.strokeStyle = '#e3e3e3'; x.lineWidth = 1.5; rr(x, cx, cy, cw, 520, 22); x.stroke();
  font(650, 34); x.fillStyle = '#1b1b1b'; x.fillText('¿Qué vienes a hacer?', cx + 40, cy + 72);
  font(400, 19); x.fillStyle = '#5a5a5a'; x.fillText('Tus trámites del SII, en el orden en que los necesitas', cx + 40, cy + 106);
  const filas = [['Declarar renta', 'Formulario 22 · Año tributario 2026', '3 pasos'], ['Emitir boleta de honorarios', 'Boleta electrónica', ''], ['Pagar contribuciones', 'Bienes raíces', '']];
  filas.forEach((f, i) => {
    const y = cy + 140 + i * 112, on = i === 0;
    rr(x, cx + 32, y, cw - 64, 96, 16);
    x.fillStyle = on ? 'rgba(11,87,208,.06)' : '#fff'; x.fill();
    x.strokeStyle = on ? AC : '#e3e3e3'; x.lineWidth = on ? 2.5 : 1.5; x.stroke();
    x.fillStyle = on ? 'rgba(11,87,208,.12)' : '#f3f3f3'; rr(x, cx + 56, y + 26, 44, 44, 11); x.fill();
    x.fillStyle = on ? AC : '#9a9a9a'; x.fillRect(cx + 68, y + 37, 20, 3); x.fillRect(cx + 68, y + 46, 20, 3); x.fillRect(cx + 68, y + 55, 13, 3);
    font(620, 23); x.fillStyle = on ? '#1b1b1b' : '#3a3a3a'; x.fillText(f[0], cx + 124, y + 44);
    font(400, 17); x.fillStyle = '#5a5a5a'; x.fillText(f[1], cx + 124, y + 72);
    if (f[2]) {
      font(650, 15); const w = x.measureText(f[2]).width + 26;
      x.fillStyle = 'rgba(11,87,208,.10)'; rr(x, cx + cw - 110 - w, y + 34, w, 28, 14); x.fill();
      x.fillStyle = AC; x.fillText(f[2], cx + cw - 110 - w + 13, y + 53);
    }
    x.strokeStyle = on ? AC : '#b5b5b5'; x.lineWidth = 2.5; x.beginPath();
    x.moveTo(cx + cw - 76, y + 38); x.lineTo(cx + cw - 66, y + 48); x.lineTo(cx + cw - 76, y + 58); x.stroke();
  });
  return textura(cv);
}
const PLANE_W = 880, PLANE_H = 550, PLANE_X = 404, PLANE_Y = 22;
const matPlano = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { tA: { value: null }, tB: { value: null }, tC: { value: null }, op: { value: 0 }, spot: { value: 0 }, p: { value: 0 }, al: { value: 0 }, asp: { value: PLANE_W / PLANE_H }, turq: { value: new THREE.Vector3().fromArray(C.turq) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: [
    'uniform sampler2D tA; uniform sampler2D tB; uniform sampler2D tC; uniform float op; uniform float spot; uniform float p; uniform float al; uniform float asp; uniform vec3 turq; varying vec2 vUv;',
    'void main(){',
    ' vec2 uv=vec2(vUv.x,1.-vUv.y);',
    ' vec2 q=(abs(vUv-.5)-.5)*vec2(asp,1.)+vec2(.028); float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-.028;',
    ' float m=1.-smoothstep(-.0012,.0012,sd);',
    ' float d=(uv.x*.78+uv.y*.42)/1.2+.018*sin(uv.y*7.+p*5.);',
    ' float e=p*1.3-.15;',
    ' float k=smoothstep(e-.045,e+.045,d);',
    ' vec3 bb=texture2D(tB,uv).rgb; if(op>0.) bb=mix(bb,texture2D(tC,uv).rgb,op);',
    ' if(spot>0.){ vec2 px=vec2(uv.x*1440.,(1.-uv.y)*900.); vec2 qq=abs(px-vec2(373.,334.))-vec2(236.,100.)+18.; float sd2=length(max(qq,0.))+min(max(qq.x,qq.y),0.)-18.; bb=mix(bb,bb*.34+vec3(.03),smoothstep(0.,26.,sd2)*spot); }',
    ' vec3 c=mix(bb,texture2D(tA,uv).rgb,k);',
    ' float ln=exp(-pow((d-e)/.006,2.))*step(.002,p)*step(p,.998);',
    ' c=mix(c,turq,ln*.9);',
    ' gl_FragColor=vec4(c,al*m);',
    '}'].join('\n'),
});
const plano = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), matPlano);
// Vistas de S1 como planos texturizados: el mismo objeto que en S3 se contrae a nodo.
const geoVista = new THREE.PlaneGeometry(1, 1);
function matVista(tex) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { t: { value: tex }, sz: { value: new THREE.Vector2(1, 1) }, rad: { value: 8 }, al: { value: 0 }, bw: { value: 1 }, bc: { value: new THREE.Vector4(1, 1, 1, 0.2) }, red: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: [
      'uniform sampler2D t; uniform vec2 sz; uniform float rad; uniform float al; uniform float bw; uniform vec4 bc; uniform float red; varying vec2 vUv;',
      'void main(){',
      ' vec2 p=(vUv-.5)*sz; vec2 q=abs(p)-sz*.5+rad; float d=length(max(q,0.))+min(max(q.x,q.y),0.)-rad;',
      ' float aa=max(fwidth(d),1e-4); float m=1.-smoothstep(-aa,aa,d);',
      ' vec3 c=texture2D(t,vec2(vUv.x,1.-vUv.y)).rgb;',
      ' float g=dot(c,vec3(.299,.587,.114)); c=mix(c,mix(vec3(g),vec3(1.,.45,.4),.4),red*.6);',
      ' float b=(1.-smoothstep(bw-aa,bw+aa,-d))*m; c=mix(c,bc.rgb,b*bc.a);',
      ' gl_FragColor=vec4(c,al*m);',
      '}'].join('\n'),
  });
}
const REAL = {};
for (const V of VIEWS) {
  if (V.img) { const c = cargar(V.img); REAL[V.img] = c; V.tex = c.t; } else V.tex = pantalla(V.gen);
  V.mesh = new THREE.Mesh(geoVista, matVista(V.tex)); V.mesh.frustumCulled = false; V.mesh.visible = false; scene.add(V.mesh);
}
matPlano.uniforms.tA.value = REAL.landing.t;
if ((window.__SII || {}).despues) { matPlano.uniforms.tB.value = cargar('despues').t; matPlano.uniforms.tC.value = (window.__SII.abierto ? cargar('abierto') : cargar('despues')).t; }
else (function () {
  const img = REAL.landing.img, listo = () => { matPlano.uniforms.tB.value = despues(img); };
  if (img.complete && img.naturalWidth) listo(); else img.addEventListener('load', listo);
})();
function posada(i) { return sstep(1.7, 2, G['v' + i]); }
function vistas() {
  const k = G.thumbK;
  VIEWS.forEach((V, i) => {
    const v = G['v' + i], m = V.mesh;
    if (v <= 0.001 || k >= 0.999) { m.visible = false; return; }
    const sl = slotXY(V);
    let x, y, w, h, a;
    if (v <= 1 && i === 0) { x = lerp(0, FULL.x, v); y = lerp(30, FULL.y, v); const s2 = 0.55 + 0.45 * v; w = FULL.w * s2; h = FULL.h * s2; a = Math.min(1, v * 1.8); }
    else if (v <= 1) { x = FULL.x + (1 - v) * 180; y = FULL.y; const s2 = 0.94 + 0.06 * v; w = FULL.w * s2; h = FULL.h * s2; a = v; }
    else { const t = v - 1; x = lerp(FULL.x, sl[0], t); y = lerp(FULL.y, sl[1], t); w = lerp(FULL.w, TW, t); h = lerp(FULL.h, TH, t); a = 1; }
    if (k > 0) { x = lerp(x, V.n.x, k); y = lerp(y, V.n.y, k); const s3 = 1 - 0.985 * k; w *= s3; h *= s3; a *= 1 - sstep(0.5, 1, k); }
    a *= G.dimG;
    m.visible = a > 0.003;
    m.position.set(x, y, 0); m.scale.set(w, h, 1);
    m.renderOrder = v < 1.5 ? 8 : 6;
    const u = m.material.uniforms, p = posada(i);
    u.sz.value.set(w, h); u.rad.value = Math.max(2, Math.min(w, h) * 0.045); u.al.value = a;
    u.bw.value = (V.dead ? 2.5 : 1.5) * PXW;
    if (V.dead) { u.bc.value.set(C.red[0], C.red[1], C.red[2], Math.max(G.djRed, p)); u.red.value = Math.max(G.djRed * 0.6, p); }
    else u.bc.value.set(1, 1, 1, 0.08 + 0.22 * p);
  });
}
plano.position.set(PLANE_X, PLANE_Y, 0); plano.renderOrder = 5; plano.frustumCulled = false;
scene.add(plano);

// ─────────────────────────────────────────────── geometría por cuadro
let OX = 0, OY = 0;
function layout(time) {
  const m = G.morph, s1 = clamp(G.simp, 0, 1), s2 = clamp(G.simp - 1, 0, 1);
  OX = lerp(OM[0], OW[0], m); OY = lerp(OM[1], OW[1], m);
  const th = lerp(THM, THW, m), sp = lerp(SPM, SPW, m);
  const br = 1 + G.breathe * 0.012 * Math.sin(time * 0.9);
  const sc = (1 - 0.06 * s2) * br;
  const sw = SWIRL * 4 * m * (1 - m);
  for (const n of nodes) {
    let r = lerp(n.rm, n.rw, m), u = n.u, al = 1, el = 1;
    if (s1 > 0 || s2 > 0) {
      // s1: se pliegan los callejones sin salida · s2: la ruta se acorta (de 7 pasos a 4) y la telaraña se aquieta.
      if (n.route) {
        r = lerp(r, n.rs, s2);
        if (n === S || n === C12 || n === A) al = 1 - s2;
      } else if (n === C3 || n === C8 || n.dj) {
        u = lerp(u, UC, sstep(0, 1, s1) * 0.85); al = 1 - sstep(0.15, 1, s1); el = al;
      } else if (n.ring === 2) {
        al = (1 - 0.55 * s1) * (1 - 0.3 * s2); el = al;
      } else {
        const hot = n.parent === C3 || n.parent === C8;
        r = lerp(r, n.parent.rw + 40, s1 * 0.4 + s2 * 0.2);
        al = (hot ? 1 - s1 : 1 - 0.5 * s1) * (1 - 0.3 * s2); el = al;
      }
    }
    r *= sc;
    n.r = r; n.a = th + (u - UC) * sp + sw * (1 - n.ring / 8); n.al = al; n.el = el;
    n.px = OX + r * Math.cos(n.a); n.py = OY + r * Math.sin(n.a);
    n.x = lerp(n.px, n.lx, G.lin); n.y = lerp(n.py, n.ly, G.lin);
  }
}
// Punto t ∈ [0,1] del tramo A→B: polares interpoladas; desde el centro, abanico suave.
const PT = [0, 0];
function curva(A2, B, t, out) {
  if (A2.ring <= 1) {
    const r = A2.r + (B.r - A2.r) * t, ca = Math.cos(B.a), sa = Math.sin(B.a), k = (1 - t) * (1 - t);
    out[0] = OX + r * ca + k * (A2.px - (OX + A2.r * ca)); out[1] = OY + r * sa + k * (A2.py - (OY + A2.r * sa));
  } else {
    const r = A2.r + (B.r - A2.r) * t, a = A2.a + (B.a - A2.a) * t;
    out[0] = OX + r * Math.cos(a); out[1] = OY + r * Math.sin(a);
  }
  const L = G.lin;
  if (L > 0) { out[0] = lerp(out[0], lerp(A2.lx, B.lx, t), L); out[1] = lerp(out[1], lerp(A2.ly, B.ly, t), L); }
  return out;
}
const SEGS = new Float32Array(2 * 80);
function muestrear(A2, B, f0, f1, n) {
  for (let i = 0; i <= n; i++) { curva(A2, B, f0 + (f1 - f0) * (i / n), PT); SEGS[i * 2] = PT[0]; SEGS[i * 2 + 1] = PT[1]; }
  return n + 1;
}
function nseg(A2, B) { return A2.ring <= 1 ? 22 : B.ring === 3 && !B.route ? 8 : 12; }

// Calor: cuántos agentes perdidos llegaron a cada nodo (cada set pesa según su alfa de calor).
// Llegada: fracción del set que alcanzó «Enviar». Fantasma: el resultado final de una vuelta anterior.
let META_F = 0, META_G = 0;
function calor() {
  for (const n of nodes) { n.heat = 0; n.ghost = 0; }
  META_F = 0; META_G = 0;
  for (const S2 of SETS) {
    const gw = G[S2.g];
    if (gw > 0) { for (const [n, k] of S2.s.lost) n.ghost += gw * k / 105; META_G += gw * S2.s.okF; }
    const w = G[S2.h]; if (w <= 0) continue;
    const clock = G[S2.c], tot = S2.s.list.length;
    for (const a of S2.s.list) {
      const tArr = a.t0 + a.d * (a.path.length - 1);
      if (clock < tArr) continue;
      const k = sstep(0, 0.5, clock - tArr);
      if (a.ok) META_F += w * k / tot; else a.end.heat += w * k / 105;
    }
  }
}
const LIT = new Set();
function render(time) {
  const zoom = G.zoom;
  camera.left = G.camX - 960 / zoom; camera.right = G.camX + 960 / zoom;
  camera.top = G.camY - 540 / zoom; camera.bottom = G.camY + 540 / zoom;
  camera.updateProjectionMatrix();
  PXW = 1920 / (SW * zoom);
  layout(time);
  calor();
  RIB_A.n = RIB_B.n = PTS_A.n = PTS_B.n = 0;
  const gA = G.graphA * G.dimG, gR = Math.max(G.graphA, G.routeA) * G.dimG;

  // telaraña de fondo: persistente detrás de todas las slides; el centro se apaga cuando aparece la telaraña real
  {
    const ox = OW[0], oy = OW[1], res = 1 + 0.008 * Math.sin(time * 0.5);
    const base = 0.034 + 0.01 * Math.sin(time * 0.6);
    for (let k = 0; k < 15; k++) {
      const R = (90 + k * 92) * res;
      const a = base * (R < 640 ? 1 - G.ringsA : 1) * (1 - 0.6 * G.planeA);
      if (a < 0.003) continue;
      for (let h = 0; h < 2; h++) {
        for (let i = 0; i <= 79; i++) { const t = (h * 79 + i) / 158 * TAU; SEGS[i * 2] = ox + R * Math.cos(t); SEGS[i * 2 + 1] = oy + R * Math.sin(t); }
        cinta(RIB_A, SEGS, 80, 1.5, C.ink, a);
      }
    }
    for (let k = 0; k < 24; k++) {
      const t = THW + (k / 24) * TAU, r0 = 90 * res, r1 = 1400;
      SEGS[0] = ox + r0 * Math.cos(t); SEGS[1] = oy + r0 * Math.sin(t); SEGS[2] = ox + r1 * Math.cos(t); SEGS[3] = oy + r1 * Math.sin(t);
      cinta(RIB_A, SEGS, 2, 1.5, C.ink, base * 0.7 * (1 - 0.6 * G.planeA));
    }
  }
  // hilos de la telaraña
  const ringA = G.ringsA * G.dimG * (0.075 + G.breathe * 0.03 * Math.sin(time * 1.1));
  if (ringA > 0.002) {
    const sc = (1 - 0.06 * clamp(G.simp - 1, 0, 1)) * (1 + G.breathe * 0.012 * Math.sin(time * 0.9)) * lerp(0.3, 1, G.ringK);
    for (const R0 of RINGS_W) {
      const R = R0 * sc;
      // dos mitades de 79 segmentos (SEGS guarda 80 puntos)
      for (let h = 0; h < 2; h++) {
        for (let i = 0; i <= 79; i++) { const t = (h * 79 + i) / 158 * TAU; SEGS[i * 2] = OX + R * Math.cos(t); SEGS[i * 2 + 1] = OY + R * Math.sin(t); }
        cinta(RIB_A, SEGS, 80, 2, C.ink, ringA);
      }
    }
    const r0 = RINGS_W[0] * sc, r1 = RINGS_W[RINGS_W.length - 1] * sc;
    for (let k = 0; k < 16; k++) {
      const t = THW + (k / 16) * TAU + TAU / 32;
      SEGS[0] = OX + r0 * Math.cos(t); SEGS[1] = OY + r0 * Math.sin(t); SEGS[2] = OX + r1 * Math.cos(t); SEGS[3] = OY + r1 * Math.sin(t);
      cinta(RIB_A, SEGS, 2, 2, C.ink, ringA * 0.7);
    }
  }
  // tramos del grafo
  if (gR > 0.002) {
    for (const e of edges) {
      const al = Math.min(e.a.el, e.b.el);
      const base = e.kind === 'link' ? 0.085 : e.kind === 'cat' ? 0.2 : 0.26;
      const a = (e.kind === 'route' ? gR : gA) * base * al;
      if (a < 0.003) continue;
      const n = muestrear(e.a, e.b, 0, 1, nseg(e.a, e.b));
      cinta(RIB_A, SEGS, n, 2, e.kind === 'route' ? C.cat : C.link, a);
      if (e.b.dj && G.morph < 1) cinta(RIB_A, SEGS, n, 2.5, C.red, gR * 0.85 * (1 - G.morph) * al);
    }
  }
  // trazo (camino real) y su cabeza
  LIT.clear();
  const ts = traceState(G.trace);
  const trA = G.traceA * G.dimG;
  let head = null;
  if (trA > 0.002) {
    for (const s of ts.segs) {
      if (s.f <= 0) continue;
      const n = muestrear(s.a, s.b, 0, s.f, nseg(s.a, s.b));
      const red = s.red, blinkA = red && ts.blink > 0 ? 0.45 + 0.55 * Math.abs(Math.cos(ts.blink * Math.PI * 3)) : 1;
      const col = red ? C.red : C.turq;
      cinta(RIB_B, SEGS, n, 10, col, trA * 0.1 * blinkA);
      cinta(RIB_B, SEGS, n, 3, col, trA * 0.95 * blinkA);
      LIT.add(s.a); if (s.f >= 1) LIT.add(s.b);
      head = { x: SEGS[(n - 1) * 2], y: SEGS[(n - 1) * 2 + 1], red, blinkA };
    }
  }
  // línea fina entre miniaturas, con el desvío sin salida en rojo
  const ra = G.rowA * G.dimG * (1 - G.thumbK);
  if (ra > 0.002) {
    const bySlot = [];
    VIEWS.forEach((V, i) => { if (V.slot >= 0) bySlot[V.slot] = i; });
    for (let k = 0; k < 7; k++) {
      const a = ra * Math.min(posada(bySlot[k]), posada(bySlot[k + 1]));
      if (a < 0.003) continue;
      const x0 = SLOT0 + k * SLOT_DX + TW / 2 + 6, x1 = SLOT0 + (k + 1) * SLOT_DX - TW / 2 - 6;
      SEGS[0] = x0; SEGS[1] = ROW_Y; SEGS[2] = x1; SEGS[3] = ROW_Y;
      cinta(RIB_B, SEGS, 2, 2, C.ink, a * 0.5);
    }
    const dj = ra * posada(3);
    if (dj > 0.003) {
      const d = slotXY(VIEWS[3]);
      SEGS[0] = SLOT0 + 2 * SLOT_DX - 30; SEGS[1] = ROW_Y - TH / 2 - 6; SEGS[2] = d[0] + 20; SEGS[3] = d[1] + TH / 2 + 6;
      cinta(RIB_B, SEGS, 2, 2, C.red, dj * 0.9);
    }
  }
  vistas();
  // órbita (ritmo del refinamiento)
  if (G.orbA > 0.002) {
    const R = ORBIT_R;
    for (let h = 0; h < 2; h++) {
      for (let i = 0; i <= 79; i++) { const t = (h * 79 + i) / 158 * TAU; SEGS[i * 2] = OX + R * Math.cos(t); SEGS[i * 2 + 1] = OY + R * Math.sin(t); }
      cinta(RIB_B, SEGS, 80, 2, C.ink, 0);
    }
    const al = new Float32Array(48);
    for (let i = 0; i < 48; i++) { const t = G.orb - 0.9 + (i / 47) * 0.9 - Math.PI / 2; SEGS[i * 2] = OX + R * Math.cos(t); SEGS[i * 2 + 1] = OY + R * Math.sin(t); al[i] = Math.pow(i / 47, 1.6); }
    cinta(RIB_B, SEGS, 48, 2.5, C.turq, G.orbA * 0.55, al);
    const t = G.orb - Math.PI / 2;
    punto(PTS_B, OX + R * Math.cos(t), OY + R * Math.sin(t), C.turq, G.orbA * 0.8, 6, 0);
  }

  // nodos: halos de calor, enlaces, categorías
  if (gA > 0.002) {
    for (const n of nodes) {
      const h = clamp(n.heat, 0, 1);
      if (h > 0.01) {
        const hc = h < 0.5 ? C.amber : mix3(C.amber, C.red, (h - 0.5) * 2);
        punto(PTS_A, n.x, n.y, hc, gA * 0.62 * sstep(0, 0.4, h) * Math.max(n.al, 0.25), HALO(h), 1);
        // «Mide»: un pulso sale de cada foco
        if (G.ping > 0 && G.ping < 1) punto(PTS_B, n.x, n.y, hc, gA * 0.9 * (1 - G.ping) * sstep(0.05, 0.3, h) * n.al, HALO(h) * (0.45 + 0.9 * G.ping), 2);
      }
      // marca de la vuelta anterior: el borde del foco que había; el foco nuevo se ve más chico adentro
      const gh = clamp(n.ghost, 0, 1);
      if (gh > 0.01) {
        const gc = gh < 0.5 ? C.amber : mix3(C.amber, C.red, (gh - 0.5) * 2);
        punto(PTS_A, n.x, n.y, gc, gA * 0.5 * sstep(0, 0.25, gh) * n.al, HALO(gh) * 0.62, 2);
      }
      if (n.route) continue;
      const isLink = n.ring === 3;
      let col = isLink ? C.link : C.cat, size = isLink ? 3.2 : 6, a = gA * (isLink ? 0.42 : 0.8) * n.al;
      if (n.dj && LIT.has(n)) { col = C.red; a = gA; size = 7; }
      else if (n.dj && G.morph < 0.6) { col = C.red; a = gR * (1 - G.morph); size = 7; }
      if (h > 0.01) { col = h < 0.5 ? mix3(col, C.amber, h * 2) : mix3(C.amber, C.red, (h - 0.5) * 2); size += 7 * h; a = Math.max(a, gA * h * Math.max(n.al, 0.3)); }
      punto(PTS_A, n.x, n.y, col, a, size, 0);
    }
  }
  if (gR > 0.002) {
    // llegada: halo turquesa en «Enviar» que crece con la fracción que llega; el anillo marca la vuelta anterior
    if (META_F > 0.003) {
      punto(PTS_A, E.x, E.y, C.turq, gA * 0.42 * sstep(0, 0.12, META_F), META(META_F), 1);
      if (G.ping > 0 && G.ping < 1) punto(PTS_B, E.x, E.y, C.turq, gA * 0.9 * (1 - G.ping), META(META_F) * (0.45 + 0.9 * G.ping), 2);
    }
    if (META_G > 0.003) punto(PTS_A, E.x, E.y, C.turq, gA * 0.55 * sstep(0, 0.12, META_G), META(META_G) * 0.62, 2);
    for (const n of ROUTE) {
      const h = clamp(n.heat, 0, 1);
      const lit = LIT.has(n) || G.morph > 0.5;
      let col = lit ? C.ink : C.cat, size = n === E ? 9 : n === I ? 9 : 7, a = gR * n.al * (lit ? 1 : 0.8);
      if (n === E && (lit || G.morph > 0)) col = C.turq;
      if (h > 0.01) { col = h < 0.5 ? mix3(col, C.amber, h * 2) : mix3(C.amber, C.red, (h - 0.5) * 2); size += 7 * h; }
      punto(PTS_B, n.x, n.y, col, a, size, 0);
    }
  }
  if (head && G.trace < TEND - 0.02) {
    const col = head.red ? C.red : C.turq;
    punto(PTS_B, head.x, head.y, col, trA * 0.35 * head.blinkA, 30, 1);
    punto(PTS_B, head.x, head.y, col, trA * head.blinkA, 9, 0);
  }

  // agentes
  for (const S2 of SETS) {
    const av = G[S2.a] * G.dimG;
    if (av <= 0.003) continue;
    const clock = G[S2.c];
    for (const a of S2.s.list) {
      if (clock < a.t0) break;
      const L = a.path.length - 1;
      const s = (clock - a.t0) / a.d;
      if (s >= L) {
        const q = s - L;
        if (a.ok) {
          const al = 1 - q / 2.2; if (al <= 0) continue;
          punto(PTS_B, a.end.x + a.jx * 0.6 * q, a.end.y + a.jy * 0.6 * q, a.col, av * al, 4.8, 0);
        } else {
          const k = sstep(0, 1.2, q);
          punto(PTS_B, a.end.x + a.jx * 1.3 * k, a.end.y + a.jy * 1.3 * k, a.col, av * 0.9 * Math.max(a.end.al, 0.15), 4.4, 0);
        }
        continue;
      }
      for (let tr = 3; tr >= 0; tr--) {
        const ss = Math.max(0, s - tr * 0.09), k = Math.min(L - 1, Math.floor(ss)), f = ss - k;
        curva(a.path[k], a.path[k + 1], Math.min(1, f), PT);
        punto(PTS_B, PT[0], PT[1], a.col, av * (tr ? 0.5 - tr * 0.13 : 1), tr ? 4.8 - tr * 0.7 : 5.8, 0);
      }
    }
  }

  // plano
  matPlano.uniforms.al.value = G.planeA; matPlano.uniforms.p.value = G.wipe; matPlano.uniforms.op.value = (window.__SII || {}).abierto ? G.open : 0; matPlano.uniforms.spot.value = (window.__SII || {}).despues ? G.spot : 0;
  plano.visible = G.planeA > 0.002;
  const ps = 0.965 + 0.035 * G.planeA; plano.scale.set(ps, ps, 1);

  subir(RIB_A); subir(RIB_B); subir(PTS_A); subir(PTS_B);
  renderer.render(scene, camera);
  etiquetas();
  hudScene();
}

// ─────────────────────────────────────────────── etiquetas HTML sobre la escena
const LABS = [
  { n: I, t: 'Inicio', pos: 'l' }, { n: S, t: 'Servicios online', pos: 'br' },
  { n: C12, t: 'Declaración de renta · 13/19', pos: 'br' }, { n: DJ, t: 'Declaraciones juradas de Renta', pos: 'al', red: 1 },
  { n: F22, t: 'Declarar Renta (F22)', pos: 'br' }, { n: K, t: 'Clave Tributaria', pos: 'br' },
  { n: A, t: 'Año tributario 2026', pos: 'br' }, { n: P, t: 'Propuesta', pos: 'br' }, { n: E, t: 'Enviar', pos: 'r', end: 1 },
];
const HOT = [
  { n: DJ, t: 'Declaraciones juradas de Renta', pos: 'al' }, { n: K, t: 'Clave Tributaria', pos: 'br' },
];
for (const H2 of HOT) { H2.hot = 1; H2.k = 0; LABS.push(H2); }
const capa = $('#labels');
for (const V of VIEWS) {
  V.elN = document.createElement('div'); V.elN.className = 'rnum m'; V.elN.textContent = V.dead ? 'sin salida' : V.num;
  V.elT = document.createElement('div'); V.elT.className = 'rname m' + (V.dead ? ' rname--dead' : ''); V.elT.textContent = V.t;
  if (V.dead) V.elN.classList.add('rnum--dead');
  capa.appendChild(V.elN); capa.appendChild(V.elT);
}
const cursor = document.createElement('div');
cursor.className = 'cursor';
cursor.innerHTML = '<i></i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6.2 1.6L10 19z" fill="#F5F5F7" stroke="#0B0B10" stroke-width="1.4" stroke-linejoin="round"/></svg>';
capa.appendChild(cursor);
function fila(kx, ky) {
  const ra = G.rowA * G.dimG;
  for (let i = 0; i < VIEWS.length; i++) {
    const V = VIEWS[i], a = ra * posada(i);
    if (a < 0.01) { if (V.vis !== 0) { V.elN.style.opacity = '0'; V.elT.style.opacity = '0'; V.vis = 0; } continue; }
    const sl = slotXY(V), sx = (sl[0] - G.camX) * kx + SW / 2, sy = (sl[1] - G.camY) * ky + SH / 2, ks = 1 - 0.8 * G.thumbK;
    const hw = TW / 2 * kx * ks, hh = TH / 2 * ky * ks, wmax = (SLOT_DX - 16) * kx;
    V.elT.style.width = wmax + 'px';
    const nh = V.elN.offsetHeight, th = V.elT.offsetHeight;
    if (V.dead) {
      V.elN.style.transform = 'translate(' + (sx - hw).toFixed(1) + 'px,' + (sy - hh - nh - th - 10).toFixed(1) + 'px)';
      V.elT.style.transform = 'translate(' + (sx - hw).toFixed(1) + 'px,' + (sy - hh - th - 6).toFixed(1) + 'px)';
      V.elT.style.width = '';
    } else {
      V.elN.style.transform = 'translate(' + (sx - hw).toFixed(1) + 'px,' + (sy - hh - nh - 6).toFixed(1) + 'px)';
      V.elT.style.transform = 'translate(' + (sx - wmax / 2).toFixed(1) + 'px,' + (sy + hh + 8).toFixed(1) + 'px)';
    }
    V.elN.style.opacity = V.elT.style.opacity = a.toFixed(3);
    V.vis = 1;
  }
  const ca = G.curA * (G.planeA > 0.5 ? 1 : G.dimG);
  cursor.style.opacity = ca.toFixed(3);
  if (ca > 0.01) {
    const cx = (G.curX - G.camX) * kx + SW / 2, cy = (G.curY - G.camY) * ky + SH / 2;
    cursor.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)';
    const ring = cursor.firstChild, c = G.clk;
    ring.style.opacity = (c > 0 && c < 1 ? (1 - c) * 0.9 : 0).toFixed(3);
    ring.style.transform = 'translate(-50%,-50%) scale(' + (0.4 + c * 1.6).toFixed(3) + ')';
  }
}
for (const L of LABS) { L.el = document.createElement('div'); L.el.className = 'lab'; L.el.textContent = L.t; capa.appendChild(L.el); L.vis = -1; }
function etiquetaCaliente(L, kx, ky, gap) {
  let k = 0;
  for (const a of SET3.list) if (!a.ok && a.end === L.n && G.c3 >= a.t0 + a.d * (a.path.length - 1)) k++;
  const a = G.h3 * G.a3 * G.dimG * (1 - G.planeA) * sstep(4, 14, k);
  if (a < 0.01) { if (L.vis !== 0) { L.el.style.opacity = '0'; L.vis = 0; } return; }
  if (k !== L.k) { L.k = k; L.el.textContent = L.t + '\nse pierden ' + k; }
  const sx = (L.n.x - G.camX) * kx + SW / 2, sy = (L.n.y - G.camY) * ky + SH / 2;
  const w = L.el.offsetWidth, h = L.el.offsetHeight;
  const x = L.pos === 'al' ? sx - w - gap * 1.6 : sx + gap * 1.6, y = L.pos === 'al' ? sy - h - gap * 0.6 : sy + gap * 0.6;
  L.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
  L.el.style.opacity = a.toFixed(3);
  if (L.el.dataset.k !== 'hot') L.el.dataset.k = 'hot';
  L.vis = 1;
}
function etiquetas() {
  const kx = SW / 1920 * G.zoom, ky = SH / 1080 * G.zoom, gap = 0.009 * SW;
  fila(kx, ky);
  for (const L of LABS) {
    if (L.hot) { etiquetaCaliente(L, kx, ky, gap); continue; }
    let a = 0, kind = '';
    const arr = ARRIVE.get(L.n);
    if (arr !== undefined) a = sstep(arr - 0.12, arr + 0.12, G.trace);
    if (L.doubt && LEAVE.has(L.n)) a *= 1 - sstep(LEAVE.get(L.n), LEAVE.get(L.n) + 0.35, G.trace);
    if (L.red) { if (LEAVE.has(L.n) && G.trace >= LEAVE.get(L.n)) { a *= 0.85; kind = 'red'; } else if (a > 0) kind = 'red'; }
    if (L.end && G.trace >= TEND - 0.01) kind = 'end';
    a *= G.labA * G.graphA * (1 - G.morph) * Math.max(G.dimG, G.labA);
    if ((L.n === I || L.n === E) && G.labW > 0) { a = Math.max(a, G.labW * G.dimG); kind = L.n === E ? 'end' : 'dim'; }
    a *= 1 - G.planeA;
    if (a < 0.01) { if (L.vis !== 0) { L.el.style.opacity = '0'; L.vis = 0; } continue; }
    const sx = (L.n.x - G.camX) * kx + SW / 2, sy = (L.n.y - G.camY) * ky + SH / 2;
    const w = L.el.offsetWidth, h = L.el.offsetHeight;
    let x = sx - w / 2, y = sy - h / 2;
    switch (L.pos) {
      case 'a': y = sy - h - gap; break;
      case 'b': y = sy + gap; break;
      case 'l': x = sx - w - gap; break;
      case 'r': x = sx + gap; break;
      case 'br': x = sx + gap * 0.5; y = sy + gap * 0.6; break;
      case 'al': x = sx - w + w * 0.15; y = sy - h - gap; break;
    }
    if (G.morph > 0.5 && L.n === I) { x = sx - w / 2; y = sy + gap * 1.2; }
    L.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    L.el.style.opacity = a.toFixed(3);
    if (L.el.dataset.k !== kind) L.el.dataset.k = kind;
    L.vis = 1;
  }
}
const c3el = $('#c3');
let c3last = -1;
function hudScene() {
  if (index !== 4) return;
  let n = 0; for (const a of SET3.list) { if (a.t0 <= G.c3) n++; else break; }
  if (G.c3 >= SET3.end - 0.01) n = SET3.list.length;
  if (n !== c3last) { c3el.textContent = String(n); c3last = n; }
}

// ─────────────────────────────────────────────── láminas y líneas de tiempo
const deck = $('#deck'), slides = $$('.slide'), hud = $('#hud');
const EASE = 'power3.out';
function entra(tl, el, at, o) {
  o = o || {};
  tl.fromTo(el, { autoAlpha: 0, y: o.y === undefined ? 22 : o.y }, { autoAlpha: 1, y: 0, duration: o.d || 0.9, ease: o.ease || EASE, stagger: o.stagger || 0 }, at);
}
const END = [];
const BUILD = [
  // 0 · portada: la baldosa, luego el espectro recorre el cuerpo de la cabeza (lima) a la cola.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    const svg = $('#sym0 svg'), segs = $$('g[clip-path] > path', svg), tile = svg.querySelector(':scope > path'), eye = $$('circle', svg);
    const wm = $('#wm0 img');
    tl.fromTo(tile, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out' }, 0);
    tl.fromTo(segs, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'none', stagger: 0.026 }, 0.3);
    tl.fromTo(eye, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.3);
    tl.fromTo(wm, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, ease: EASE }, 1.35);
    return tl;
  },
  // pausa · pregunta quieta: el narrador contextualiza con el público; solo una entrada suave.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    entra(tl, $('.t', s), 0.2, { d: 1.4, y: 14 });
    return tl;
  },
  // 1 · problema: el recorrido real por el sitio del SII, pantalla por pantalla, queda como una línea de vistas.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    const a = $('.swap-a', s), b = $('.swap-b', s), vids = $$('.vid', s), cap = $$('.vt, .cap', s);
    tl.set(b, { autoAlpha: 0 }, 0).set(vids, { autoAlpha: 0 }, 0).set(cap, { autoAlpha: 0 }, 0);
    tl.set(G, { rowA: 1, curX: 520, curY: 180 }, 0);
    tl.set(a, { autoAlpha: 0 }, 0);
    tl.to(G, { v0: 1, duration: 0.8, ease: 'power3.out' }, 0);
    const Px = (px, py) => [FULL.x - FULL.w / 2 + px * FULL.w / 1440, FULL.y - FULL.h / 2 + py * FULL.h / 900];
    let t = 0.8;
    const clic = (xy, r) => {
      tl.to(G, { curX: xy[0], curY: xy[1], curA: 1, duration: r ? 0.22 : 0.5, ease: 'power2.inOut' }, t); t += r ? 0.22 : 0.5;
      tl.fromTo(G, { clk: 0 }, { clk: 1, duration: 0.35, ease: 'power1.out', immediateRender: false }, t); t += 0.08;
    };
    const pasa = (de, a2, r) => {
      const d = r ? 0.45 : 0.75;
      tl.to(G, { ['v' + de]: 2, duration: d, ease: 'power3.inOut' }, t);
      tl.to(G, { ['v' + a2]: 1, duration: d * 0.8, ease: 'power3.out' }, t + 0.08);
      t += r ? 0.22 : 0.72;
    };
    clic(Px(820, 80)); pasa(0, 1);          // Servicios online
    clic(Px(218, 640)); pasa(1, 2);         // Declaración de renta (13/19)
    clic(Px(214, 612)); pasa(2, 3);         // Declaraciones juradas: callejón sin salida
    tl.to(G, { djRed: 1, duration: 0.18, yoyo: true, repeat: 3, ease: 'power1.inOut' }, t); t += 0.85;
    tl.to(G, { v3: 2, duration: 0.65, ease: 'power3.inOut' }, t);   // vuelve atrás
    tl.to(G, { v2: 1, duration: 0.65, ease: 'power3.inOut' }, t + 0.08); t += 0.75;
    clic(Px(530, 286)); pasa(2, 4);         // Declarar Renta (F22)
    clic(Px(580, 214), 1); pasa(4, 5, 1);   // Clave Tributaria
    clic(Px(570, 353), 1); pasa(5, 6, 1);   // Ingresar
    clic(Px(720, 415), 1); pasa(6, 7, 1);   // Año tributario 2026
    clic(Px(1246, 799), 1); pasa(7, 8, 1);  // Aceptar propuesta
    t += 0.25;
    clic(Px(720, 672), 1);                  // Enviar declaración
    tl.to(G, { curA: 0, duration: 0.3 }, t + 0.1);
    tl.to(G, { v8: 2, duration: 0.7, ease: 'power3.inOut' }, t + 0.2); t += 0.8;
    entra(tl, a, t);                        // «3,5 millones cada abril»
    const t2 = t + 1.5;
    tl.fromTo(a, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -16, duration: 0.4, ease: 'power2.in', immediateRender: false }, t2);
    entra(tl, b, t2 + 0.3);
    tl.fromTo(vids, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE }, t2 + 0.4);
    entra(tl, cap, t2 + 0.7, { y: 10, stagger: 0.1 });
    const play = $('.vid .play', s), barra = $('.vid .bar b', s);
    tl.fromTo(play, { scale: 1 }, { scale: 1.14, duration: 0.22, ease: 'power2.out', yoyo: true, repeat: 1 }, t2 + 1.1);
    tl.fromTo(play, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.35, immediateRender: false }, t2 + 1.6);
    tl.fromTo(barra, { width: '0%' }, { width: '18%', duration: 2.4, ease: 'none' }, t2 + 1.5);
    return tl;
  },
  // 2 · nace Chameleon: la línea de vistas queda tenue detrás, intacta.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    tl.to(G, { dimG: 0.3, duration: 0.9, ease: 'power2.inOut' }, 0);
    entra(tl, $('.nlogo', s), 0.2, { y: 12 });
    entra(tl, $('.t', s), 0.45);
    entra(tl, $('.s', s), 1.6, { y: 14 });
    return tl;
  },
  // 3 · análisis: cada vista se contrae a su nodo, la línea pasa a ser la ruta, se despliega el grafo y luego la telaraña.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    entra(tl, $('.t', s), 0.3);
    tl.to(G, { dimG: 1, duration: 0.6, ease: 'power2.inOut' }, 0);
    tl.to(G, { thumbK: 1, duration: 1.1, ease: 'power3.inOut', stagger: 0 }, 0.1);
    tl.to(G, { routeA: 1, traceA: 1, duration: 0.5 }, 0.6);
    tl.to(G, { rowA: 0, duration: 0.5 }, 1.6);
    tl.to(G, { lin: 0, graphA: 1, duration: 1.5, ease: 'power3.inOut' }, 1.6);
    tl.to(G, Object.assign({ morph: 1, duration: 2.0, ease: 'power3.inOut' }, CAMW), 2.8);
    tl.to(G, { traceA: 0.5, duration: 1.0 }, 3.6);
    tl.to(G, { ringsA: 1, duration: 1.2, ease: 'power2.out' }, 3.8);
    tl.fromTo(G, { ringK: 0 }, { ringK: 1, duration: 1.8, ease: 'expo.out' }, 3.8);
    tl.to(G, { labW: 1, duration: 0.6 }, 4.4);
    entra(tl, $('.ctr', s), 4.2, { y: 10 });
    tl.set(G, { a3: 1, h3: 1 }, 4.5);
    tl.to(G, { c3: SET3.end, duration: SET3.end, ease: 'none' }, 4.6);
    return tl;
  },
  // 4 · antes / después: el plano con la página, barrido con shader.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    const num = $('#m4', s), dots = $$('#dots4 i', s), v = { n: 3 };
    const pinta = () => { const n = Math.round(v.n); num.textContent = n; dots.forEach((d, i) => { if (i < n) d.setAttribute('data-on', ''); else d.removeAttribute('data-on'); }); };
    tl.set(v, { n: 3, onComplete: pinta }, 0);
    entra(tl, $('.t', s), 0.1);
    tl.to(G, Object.assign({ dimG: 0.13, duration: 0.8, ease: 'power2.inOut' }, CAMP), 0);
    tl.to(G, { planeA: 1, duration: 0.8, ease: 'power3.out' }, 0.1);
    tl.fromTo('#tagA', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.4);
    tl.to(G, { wipe: 1, duration: 1.8, ease: 'power2.inOut' }, 1.0);
    tl.fromTo('#tagA', { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3, immediateRender: false }, 1.3);
    tl.fromTo('#tagB', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 2.8);
    const Q = (px, py) => [PLANE_X - PLANE_W / 2 + px * PLANE_W / 1440, PLANE_Y - PLANE_H / 2 + py * PLANE_H / 900];
    const q0 = Q(900, 420), q1 = Q(1140, 162);
    tl.set(G, { curX: q0[0], curY: q0[1] }, 0);
    tl.to(G, { spot: 1, duration: 0.7, ease: 'power2.inOut' }, 3.0);
    tl.to(G, { curA: 1, duration: 0.3 }, 4.2);
    tl.to(G, { curX: q1[0], curY: q1[1], duration: 0.55, ease: 'power2.inOut' }, 4.3);
    tl.fromTo(G, { clk: 0 }, { clk: 1, duration: 0.4, ease: 'power1.out', immediateRender: false }, 4.85);
    tl.to(G, { open: 1, spot: 0, duration: 0.45, ease: 'power2.out' }, 4.9);
    tl.to(G, { curA: 0, duration: 0.4 }, 5.9);
    entra(tl, $('.met', s), 6.2, { y: 16 });
    tl.to(v, { n: 6, duration: 1.4, ease: 'power2.inOut', onUpdate: pinta, onComplete: pinta }, 7.2);
    tl.fromTo($('.note', s), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 8.0);
    return tl;
  },
  // 5 · mide · rediseña · repite: tres revisiones del mismo sitio. Parte de lo que midieron los agentes (revisión 1)
  // y cada vuelta deja la marca de la anterior: los focos se achican dentro de su borde viejo y la llegada crece.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    const num = $('#m5', s), w = $$('.t5 span', s), v = { n: 31 };
    const revs = $$('.rev', s), barra = revs.map((r) => $('i', r)), val = revs.map((r) => $('b', r)), dif = revs.map((r) => $('em', r));
    const pinta = () => { num.textContent = Math.round(v.n); };
    const DIM = 'rgba(245,245,247,.28)', VIEJA = 'rgba(245,245,247,.2)';
    tl.set(v, { n: 31, onComplete: pinta }, 0);
    tl.set(w, { color: DIM }, 0);
    tl.set(revs.concat(val, dif.filter(Boolean)), { autoAlpha: 0 }, 0);
    tl.set(barra, { scaleY: 0 }, 0);
    tl.to(G, Object.assign({ planeA: 0, dimG: 1, duration: 0.7, ease: 'power2.inOut' }, CAMW), 0);
    entra(tl, [$('.tag', s), $('.t', s)], 0.05, { stagger: 0.08 });
    entra(tl, $('.pct', s), 0.2, { y: 16 });
    entra(tl, $('.sitio-a', s), 0.3, { y: 8 });
    tl.to(G, { orbA: 1, duration: 0.6 }, 0.1);
    tl.to(G, { orb: TAU, duration: 4.0, ease: 'none' }, 0);
    tl.to(G, { orb: TAU * 2, duration: 3.1, ease: 'none' }, 4.0);
    const on = (i, at) => { tl.to(w, { color: (k) => (k === i ? '#F5F5F7' : DIM), duration: 0.2 }, at); };
    const mide = (at) => { tl.fromTo(G, { ping: 0 }, { ping: 1, duration: 0.9, ease: 'power1.out', immediateRender: false }, at); };
    // La barra de cada revisión sube con el contador; la anterior queda atenuada al lado para comparar.
    const revision = (i, at, d) => {
      tl.to(revs[i], { autoAlpha: 1, duration: 0.25 }, at);
      tl.to(barra[i], { scaleY: 1, duration: d, ease: 'power1.inOut' }, at);
      tl.to(val[i], { autoAlpha: 1, duration: 0.3 }, at + d - 0.15);
      if (dif[i]) tl.fromTo(dif[i], { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: 'back.out(2)', immediateRender: false }, at + d - 0.05);
      if (i > 0) {
        tl.to(barra[i - 1], { backgroundColor: VIEJA, duration: 0.4 }, at);
        tl.to(val[i - 1], { color: 'rgba(245,245,247,.5)', duration: 0.4 }, at);
        if (dif[i - 1]) tl.to(dif[i - 1], { autoAlpha: 0, duration: 0.3 }, at);
      }
    };
    // revisión 1: lo que dejaron los agentes en la lámina anterior (focos, «se pierden», 31 %)
    revision(0, 0.35, 0.6);
    on(0, 0.3); mide(0.6);
    // rediseña: se pliegan los callejones sin salida; el foco viejo queda como borde
    on(1, 1.45); tl.to(G, { simp: 1, h3: 0, g3: 1, a3: 0, duration: 0.9, ease: 'power2.inOut' }, 1.45);
    // repite: revisión 2
    on(2, 2.35);
    tl.set(G, { a1: 1, h1: 1 }, 2.3);
    tl.to(G, { r1: SET1.end, duration: 1.7, ease: 'none' }, 2.35);
    tl.to(v, { n: 64, duration: 1.4, ease: 'power1.inOut', onUpdate: pinta, onComplete: pinta }, 2.45);
    revision(1, 2.45, 1.4);
    on(0, 4.05); mide(4.1);
    // rediseña: la ruta se acorta de 7 pasos a 4
    on(1, 4.7); tl.to(G, { simp: 2, h1: 0, g1: 1, g3: 0, a1: 0, duration: 0.9, ease: 'power2.inOut' }, 4.7);
    // repite: revisión 3
    on(2, 5.6);
    tl.set(G, { a2: 1, h2: 1 }, 5.55);
    tl.to(G, { r2: SET2.end, duration: 1.5, ease: 'none' }, 5.6);
    tl.to(v, { n: 88, duration: 1.2, ease: 'power1.inOut', onUpdate: pinta, onComplete: pinta }, 5.7);
    revision(2, 5.7, 1.2);
    tl.to(w, { color: '#F5F5F7', duration: 0.4 }, 7.0);
    return tl;
  },
  // 6 · cierre: la telaraña respira, muy tenue.
  function (s) {
    const tl = gsap.timeline({ paused: true });
    tl.to(G, { dimG: 0.3, graphA: 0, routeA: 0, orbA: 0, a2: 0, h2: 0, g1: 0, traceA: 0, labW: 0, camX: OW[0], camY: OW[1], zoom: 1.08, breathe: 1, duration: 1.6, ease: 'power2.inOut' }, 0);
    const sym = $('.sym', s), wm = $('.wm', s), tg = $('.tagline', s), url = $('.url', s);
    entra(tl, sym, 0.3, { y: 12 });
    entra(tl, wm, 0.5, { y: 12 });
    entra(tl, tg, 0.95, { y: 12 });
    entra(tl, url, 1.4, { y: 8 });
    return tl;
  },
];
// Estado final de escena de cada lámina (la siguiente parte de aquí).
(function () {
  let st = Object.assign({}, BASE);
  const deltas = [
    {},
    {},
    { v0: 2, v1: 2, v2: 2, v3: 2, v4: 2, v5: 2, v6: 2, v7: 2, v8: 2, rowA: 1, curA: 0, clk: 1, djRed: 0 },
    { dimG: 0.3 },
    { thumbK: 1, rowA: 0, lin: 0, routeA: 1, graphA: 1, morph: 1, ...CAMW, dimG: 1, traceA: 0.5, ringsA: 1, labW: 1, a3: 1, h3: 1, c3: SET3.end },
    { dimG: 0.13, ...CAMP, planeA: 1, wipe: 1, open: 1, curA: 0, clk: 1 },
    { planeA: 0, dimG: 1, ...CAMW, orbA: 1, orb: TAU * 2, simp: 2, ping: 1, a3: 0, h3: 0, g3: 0, a1: 0, h1: 0, g1: 1, r1: SET1.end, a2: 1, h2: 1, r2: SET2.end },
    { dimG: 0.3, graphA: 0, routeA: 0, orbA: 0, a2: 0, h2: 0, g1: 0, traceA: 0, labW: 0, camX: OW[0], camY: OW[1], zoom: 1.08, breathe: 1 },
  ];
  for (const d of deltas) { st = Object.assign({}, st, d); END.push(st); }
})();

let index = 0, tl = null;
function go(i, modo) {
  i = clamp(i, 0, slides.length - 1);
  if (tl) { tl.progress(1); tl.kill(); tl = null; }
  index = i;
  Object.assign(G, i ? END[i - 1] : BASE);
  const s = slides[i];
  s.setAttribute('data-reset', '');
  gsap.killTweensOf(s.querySelectorAll('*'));
  gsap.set(s.querySelectorAll('*'), { clearProps: 'opacity,visibility,transform,translate,color,backgroundColor' });
  tl = BUILD[i](s);
  if (modo === 'full' || REDUCED) tl.progress(1); else { tl.progress(0); tl.play(); }
  void s.offsetWidth;
  s.removeAttribute('data-reset');
  slides.forEach((o, k) => { if (k === i) o.setAttribute('data-active', ''); else o.removeAttribute('data-active'); });
  hud.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
  c3last = -1;
}
let apurando = false;
function next() {
  const ultimo = index >= slides.length - 1;
  if (tl && tl.progress() < 1 && !REDUCED && !apurando) {
    // Termina la animación en curso a velocidad alta (0,6 s como máximo) y recién entonces avanza.
    apurando = true;
    const resto = (1 - tl.progress()) * tl.duration();
    tl.timeScale(Math.max(6, resto / 0.6));
    tl.eventCallback('onComplete', () => { apurando = false; if (!ultimo) go(index + 1, 'play'); });
    return;
  }
  apurando = false;
  if (!ultimo) go(index + 1, 'play'); else if (tl) tl.progress(1);
}
function prev() { apurando = false; go(index - 1, 'full'); }

function pantallaCompleta() {
  if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen().catch(() => {}); return; }
  const el = document.documentElement;
  el.requestFullscreen && el.requestFullscreen().catch(() => {});
}
let idle = null;
function despierta() { deck.removeAttribute('data-idle'); clearTimeout(idle); idle = setTimeout(() => deck.setAttribute('data-idle', ''), 2200); }
document.addEventListener('mousemove', despierta);
despierta();
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': case ' ': case 'Enter': next(); break;
    case 'ArrowLeft': case 'PageUp': case 'Backspace': prev(); break;
    case 'Home': go(0, 'play'); break;
    case 'End': go(slides.length - 1, 'full'); break;
    case 'f': case 'F': pantallaCompleta(); break;
    default: return;
  }
  e.preventDefault();
});
deck.addEventListener('click', (e) => { if (e.button === 0) next(); });

// Bucle de render: la escena es una función pura del estado G (y del reloj solo para respirar).
const t0 = performance.now();
function loop() { render((performance.now() - t0) / 1000); requestAnimationFrame(loop); }
go(0, 'play');
requestAnimationFrame(() => { deck.setAttribute('data-ready', ''); loop(); });

// Para capturas y el video de respaldo.
window.__deck = {
  G, go, next, prev,
  seek(i, p) { go(i, 'play'); tl.pause(); tl.progress(p); },
  dur() { return tl ? tl.duration() : 0; },
  get index() { return index; },
};
});
