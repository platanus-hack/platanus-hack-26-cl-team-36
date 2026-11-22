// Arma chameleon-pitch.html (offline, todo inline) y chameleon-pitch-cdn.html (three y GSAP por jsDelivr).
// Rutas relativas a este directorio (docs/pitch): la marca vive en ../marca y las librerías se bajan a pkgs/.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const marca = process.env.MARCA || path.resolve(here, '../marca');
const kit = path.join(marca, 'chameleonmode-v1');
const pkgs = path.join(here, 'pkgs');

const read = (p) => fs.readFileSync(p, 'utf8');
const b64 = (p) => fs.readFileSync(p).toString('base64');

// three r160 y GSAP 3.13.0 desde npm (se descargan una vez a pkgs/, que no va al repo).
function paquete(nombre, version, archivo) {
  const destino = path.join(pkgs, nombre);
  if (!fs.existsSync(path.join(destino, archivo))) {
    fs.mkdirSync(destino, { recursive: true });
    const tgz = execSync(`npm pack ${nombre}@${version} --silent`, { cwd: destino }).toString().trim().split('\n').pop();
    execSync(`tar xzf ${tgz} --strip-components=1`, { cwd: destino });
  }
  return read(path.join(destino, archivo));
}

// Los SVG se insertan dos veces (portada y cierre): cada copia lleva sus propios ids.
function prefijar(svg, pre) {
  return svg
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<title>[^<]*<\/title>/g, '')
    .replace(/id="([^"]+)"/g, `id="${pre}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${pre}$1)`);
}
const logo = read(path.join(marca, 'logo.svg'));
const wordmark = read(path.join(kit, 'assets/wordmark-on-dark.svg'));

const fonts = `
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,${b64(path.join(kit, 'fonts/InterVariable.woff2'))}) format('woff2');}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${b64(path.join(kit, 'fonts/JetBrainsMono-Regular.woff2'))}) format('woff2');}`;

// three r160 como script clásico: el `export {a as B}` final pasa a window.THREE = {B: a}.
function threeClasico() {
  const src = paquete('three', '0.160.0', 'build/three.module.min.js');
  const i = src.lastIndexOf('export{');
  if (i < 0) throw new Error('no encontré el export de three');
  const fin = src.indexOf('};', i);
  const lista = src.slice(i + 7, fin).split(',').map((x) => {
    const [a, b] = x.split(' as ');
    return b ? `${b.trim()}:${a.trim()}` : `${a.trim()}:${a.trim()}`;
  });
  return `(function(){${src.slice(0, i)}window.THREE=Object.freeze({${lista.join(',')}});})();`;
}

// Capturas reales del SII (sii/*.jpg). El landing de S1 es el mismo «antes» de S4: el barrido calza píxel a píxel.
const sii = {};
const mapa = {
  landing: 'antes-landing', servicios: '2-servicios', renta: '3-renta', dj: '3b-dj', f22: '4-f22', login: '5-login',
  despues: 'despues-landing', abierto: 'despues-abierto', video: 'video-renta',
};
for (const [k, f] of Object.entries(mapa)) sii[k] = 'data:image/jpeg;base64,' + b64(path.join(here, 'sii', f + '.jpg'));

const gsapMin = paquete('gsap', '3.13.0', 'dist/gsap.min.js');
const plantilla = read(path.join(here, 'src/deck.html'));
const js = read(path.join(here, 'src/deck.js'));
const svgData = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');

function armar(libs) {
  return plantilla
    .replace('/*@@FONTS@@*/', () => fonts)
    .replace('<!--@@LOGO_A@@-->', () => prefijar(logo, 'la-'))
    .replace('<!--@@LOGO_B@@-->', () => prefijar(logo, 'lb-'))
    .replaceAll('@@WM_SRC@@', () => svgData(wordmark))
    .replaceAll('@@LOGO_SRC@@', () => svgData(logo))
    .replaceAll('@@VIDEO_SRC@@', () => sii.video)
    .replace('<!--@@SII@@-->', () => '<script>window.__SII=' + JSON.stringify(sii) + ';</script>')
    .replace('<!--@@LIBS@@-->', () => libs)
    .replace('/*@@DECK@@*/', () => js);
}

const offline = armar(
  `<script>${threeClasico()}</script>\n<script>${gsapMin}</script>\n<script>window.__libs=Promise.resolve();</script>`,
);
const cdn = armar(
  `<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
<script>window.__libs=new Promise(function(r){window.__threeOk=r;});</script>
<script type="module">import * as T from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';window.THREE=T;window.__threeOk();</script>`,
);

fs.writeFileSync(path.join(here, 'chameleon-pitch.html'), offline);
fs.writeFileSync(path.join(here, 'chameleon-pitch-cdn.html'), cdn);
for (const f of ['chameleon-pitch.html', 'chameleon-pitch-cdn.html']) {
  console.log(f, (fs.statSync(path.join(here, f)).size / 1048576).toFixed(2), 'MB');
}
