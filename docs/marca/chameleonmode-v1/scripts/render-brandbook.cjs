// npm install playwright && npx playwright install chromium
// Renders the real extension popup with a deterministic browser API fixture, then the brandbook.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const base = path.resolve(__dirname, '..');
const repo = path.resolve(base, '../../..');
const previews = path.join(base, 'previews');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2'};

const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const prefix = requested.startsWith('/extension/') ? '/extension/' : '/brandbook/';
  const root = prefix === '/extension/' ? path.join(repo, 'extension/src') : base;
  const file = path.resolve(root, requested.slice(prefix.length));
  if (!requested.startsWith(prefix) || !file.startsWith(root + path.sep)) {res.writeHead(404).end(); return;}
  fs.readFile(file, (error, data) => {
    if (error) {res.writeHead(404).end(); return;}
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}).end(data);
  });
});

async function fixture(page, scenario) {
  await page.addInitScript(({active, theme, available, privateWindow}) => {
    const values = {activo:active, idioma:'es', efectos:'sutiles'};
    const listeners = [];
    const get = async keys => {
      if (typeof keys === 'string') return {[keys]:values[keys]};
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(k=>[k,values[k]]));
      return {...keys,...values};
    };
    globalThis.browser = {
      storage: {local:{get, set:async next => {
        const changes = Object.fromEntries(Object.entries(next).map(([key,newValue])=>[key,{oldValue:values[key],newValue}]));
        Object.assign(values,next); for(const listener of listeners) listener(changes,'local');
      }},onChanged:{addListener:fn=>listeners.push(fn)}},
      tabs:{query:async()=>[{id:7,incognito:privateWindow,url:'https://example.com/'}],get:async()=>({id:7,incognito:privateWindow,url:'https://example.com/'}),sendMessage:async()=>{
        if(!available)throw new Error('Restricted tab fixture');
        return {temaId:theme?'youtube':null,temaActivo:active&&theme};
      }},
      runtime:{sendMessage:async message=>message.tipo==='votos:estado'?{pendientes:0}:{ok:true,pendientes:1},getURL:relative=>location.origin+'/extension/'+relative},
      management:{getSelf:async()=>({installType:'development'})},
    };
  }, scenario);
}

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(previews,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const errors=[];
  const screenshots=[];
  for(const [name,active,theme,available,privateWindow] of [
    ['on',true,true,true,false],['off',false,true,true,false],
    ['no-theme',true,false,true,false],['unavailable',true,false,false,false],['private',true,false,false,true],
  ]){
    const page=await browser.newPage({viewport:{width:360,height:800},deviceScaleFactor:2,reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(`${name}: ${error.message}`));
    await fixture(page,{active,theme,available,privateWindow});
    await page.goto(origin+'/extension/popup/popup.html');
    await page.waitForFunction(()=>document.documentElement.dataset.mtIdioma==='es'&&document.body.dataset.activo!=='cargando'&&document.querySelector('#mt-opinion').dataset.modo!=='cargando');
    await page.evaluate(()=>document.fonts.ready);
    const missing=await page.locator('img').evaluateAll(imgs=>imgs.filter(img=>!img.complete||!img.naturalWidth).map(img=>img.src));
    if(missing.length)throw new Error('Missing popup resources: '+missing.join(', '));
    const overflow=await page.evaluate(()=>document.body.scrollWidth>360);
    if(overflow)throw new Error('Popup overflow '+name);
    await page.locator('body').screenshot({path:path.join(previews,`extension-${name}.png`)});
    screenshots.push({state:name,width:360,height:await page.locator('body').evaluate(el=>el.getBoundingClientRect().height),fixture:true});
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:1120,height:850},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/brandbook/brandbook.html');
  await page.evaluate(()=>document.fonts.ready);
  const missing=await page.locator('img').evaluateAll(imgs=>imgs.filter(img=>!img.complete||!img.naturalWidth).map(img=>img.src));
  if(missing.length)throw new Error('Missing brandbook resources: '+missing.join(', '));
  const pages=page.locator('.page');
  for(let i=0;i<await pages.count();i++)await pages.nth(i).screenshot({path:path.join(previews,`brandbook-${String(i+1).padStart(2,'0')}.png`)});
  const overflow=await pages.evaluateAll(pages=>pages.map((page,i)=>{
    const b=page.getBoundingClientRect();return {page:i+1,outside:[...page.querySelectorAll('*')].filter(el=>{
      const x=el.getBoundingClientRect();return x.right>b.right+1||x.bottom>b.bottom+1;
    }).map(el=>el.tagName+'.'+el.className)};
  }).filter(p=>p.outside.length));
  if(overflow.length)throw new Error('Brandbook clipping: '+JSON.stringify(overflow));
  // Print from a fresh page after decoding every image; screenshot scrolling can leave stale paint caches.
  const printPage=await browser.newPage({viewport:{width:1120,height:792}});
  await printPage.goto(origin+'/brandbook/brandbook.html');
  await printPage.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()))});
  await printPage.emulateMedia({media:'print'});
  await printPage.pdf({path:path.join(base,'brandbook.pdf'),printBackground:true,preferCSSPageSize:true});
  await printPage.close();
  const report={pageCount:await pages.count(),popupScreenshots:screenshots,javascriptErrors:errors,missingImages:missing,brandbookOverflow:overflow};
  fs.writeFileSync(path.join(base,'render-validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  await browser.close();server.close();
  if(errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);server.close();process.exit(1)});
