// Recorre cada misión de misiones.json en un sitio real, con clics, y comprueba su criterio de éxito.
//
// Uso: node misiones/validar.mjs [id ...] [--visible]
//
// Usa el Chrome instalado (Playwright, canal "chrome") con un user-agent de navegador normal: varios sitios .cl
// bloquean al navegador sin interfaz por defecto. Guarda una captura por paso en misiones/capturas/<id>/.
// Sale con código 1 si alguna misión falla.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ESPERA_MS = 3500;
const LIMITE_MS = 15000;

const args = process.argv.slice(2);
const visible = args.includes('--visible');
const filtro = args.filter(a => !a.startsWith('--'));
const { misiones } = JSON.parse(await readFile(join(AQUI, 'misiones.json'), 'utf8'));

async function cerrarPopups(pagina) {
  await pagina.keyboard.press('Escape');
  for (const nombre of [/^aceptar$/i, /^(×|x|cerrar|close)$/i]) {
    const boton = pagina.getByRole('button', { name: nombre }).filter({ visible: true });
    if (await boton.count()) await boton.first().click({ timeout: 3000 }).catch(() => {});
  }
  const cruces = pagina
    .locator('.modal.show .close, .modal.in .close, [aria-label*=lose i], [class*=close i]')
    .filter({ visible: true });
  const n = Math.min(await cruces.count(), 3);
  for (let i = 0; i < n; i++) await cruces.nth(i).click({ timeout: 2000 }).catch(() => {});
}

async function ejecutar(pagina, paso) {
  if (paso.accion === 'cerrar_popups') return cerrarPopups(pagina);
  const objetivo = pagina
    .getByRole(paso.rol, { name: new RegExp(paso.nombre, 'i') })
    .filter({ visible: true })
    .first();
  if (paso.accion === 'clic') return objetivo.click({ timeout: LIMITE_MS });
  if (paso.accion === 'pasar_encima') return objetivo.hover({ timeout: LIMITE_MS });
  throw new Error(`acción desconocida: ${paso.accion}`);
}

async function validar(navegador, mision) {
  const contexto = await navegador.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 }, locale: 'es-CL' });
  let pagina = await contexto.newPage();
  contexto.on('page', nueva => { pagina = nueva; }); // algunos enlaces abren otra pestaña
  const carpeta = join(AQUI, 'capturas', mision.id);
  await mkdir(carpeta, { recursive: true });
  let n = 0;
  const capturar = () => pagina.screenshot({ path: join(carpeta, `paso-${n}.png`) }).catch(() => {});
  try {
    await pagina.goto(mision.inicio, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pagina.waitForTimeout(ESPERA_MS);
    await capturar();
    console.log(`  0 inicio → ${pagina.url()}`);
    for (const paso of mision.pasos) {
      n++;
      await ejecutar(pagina, paso);
      await pagina.waitForTimeout(1500);
      await pagina.waitForLoadState('domcontentloaded').catch(() => {});
      await pagina.waitForTimeout(ESPERA_MS);
      await capturar();
      console.log(`  ${n} ${paso.accion}${paso.nombre ? ` «${paso.nombre}»` : ''} → ${pagina.url()}`);
    }
    const texto = await pagina.evaluate(() => document.body.innerText);
    const okUrl = pagina.url().includes(mision.exito.url_contiene);
    const okTexto = texto.includes(mision.exito.texto);
    return { ok: okUrl && okTexto, detalle: `url ${okUrl ? 'ok' : 'NO'} · texto «${mision.exito.texto}» ${okTexto ? 'ok' : 'NO'}` };
  } catch (e) {
    await capturar();
    return { ok: false, detalle: `falla en el paso ${n}: ${e.message.split('\n')[0]}` };
  } finally {
    await contexto.close();
  }
}

const navegador = await chromium.launch({ channel: 'chrome', headless: !visible });
let fallas = 0;
for (const mision of misiones.filter(m => !filtro.length || filtro.includes(m.id))) {
  console.log(`\n${mision.id} — ${mision.descripcion}`);
  const r = await validar(navegador, mision);
  console.log(`  ${r.ok ? '✅ ÉXITO' : '❌ FALLA'} en ${mision.pasos.length} pasos (${r.detalle})`);
  if (!r.ok) fallas++;
}
await navegador.close();
process.exit(fallas ? 1 : 0);
