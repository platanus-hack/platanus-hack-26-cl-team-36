// Graba respaldo.webm: recorrido completo con avance automático según el guion.
// Uso: node record.mjs [ancho] [alto] [segundos por slide, separados por coma]
// Requiere Playwright (npm i -D playwright o PW_PATH=<ruta a node_modules/playwright>). Usa la GPU con ANGLE Metal.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, 'video-tmp');
const W = +(process.argv[2] || 1920), H = +(process.argv[3] || 1080);
// Portada, pregunta (pausa del narrador), problema, nace, agentes, antes/después, refinamiento, cierre.
const tiempos = (process.argv[4] || '2,4,13,4,13,12,8,8').split(',').map(Number);
const b = await chromium.launch({ args: (process.env.GLARGS || '--use-angle=metal,--ignore-gpu-blocklist').split(',') });
const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
const pg = await ctx.newPage();
await pg.goto('file://' + path.join(here, 'chameleon-pitch.html'));
await pg.waitForFunction(() => window.__deck);
await pg.mouse.move(W - 2, H - 2);
await pg.evaluate(() => { document.querySelector('.hud').style.display = 'none'; window.__deck.go(0, 'play'); });
for (let i = 0; i < tiempos.length; i++) {
  await pg.waitForTimeout(tiempos[i] * 1000);
  if (i < tiempos.length - 1) await pg.keyboard.press('ArrowRight');
}
const v = pg.video();
await ctx.close();
fs.copyFileSync(await v.path(), path.join(here, 'respaldo.webm'));
fs.rmSync(dir, { recursive: true, force: true });
await b.close();
console.log('ok', (fs.statSync(path.join(here, 'respaldo.webm')).size / 1048576).toFixed(1), 'MB');
