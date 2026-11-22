// npm install playwright && npx playwright install chromium
// Renderiza las páginas del brandbook y su PDF desde los recursos locales.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const base = path.resolve(__dirname, '..');
const previews = path.join(base, 'previews');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2'};

const server = http.createServer((req, res) => {
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const prefix = '/brandbook/';
  const root = base;
  const file = path.resolve(root, requested.slice(prefix.length));
  if (!requested.startsWith(prefix) || !file.startsWith(root + path.sep)) {res.writeHead(404).end(); return;}
  fs.readFile(file, (error, data) => {
    if (error) {res.writeHead(404).end(); return;}
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}).end(data);
  });
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(previews,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const errors=[];
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
  const report={pageCount:await pages.count(),javascriptErrors:errors,missingImages:missing,brandbookOverflow:overflow};
  fs.writeFileSync(path.join(base,'render-validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  await browser.close();server.close();
  if(errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);server.close();process.exit(1)});
