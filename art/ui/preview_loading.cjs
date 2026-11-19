const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = __dirname;
const assets = JSON.parse(fs.readFileSync(path.join(root, 'loading.json'), 'utf8')).images;
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
    const cells = assets.map(a => `<article><img alt="${a.title}" src="data:image/png;base64,${fs.readFileSync(path.join(root,a.file)).toString('base64')}"><p>${a.title}</p></article>`).join('');
    await page.setContent(`<style>body{background:#e0d5c2;color:#211c29;font:16px Arial;padding:20px}h1{font:28px Georgia}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}article{background:#f5eddf;padding:10px;border-radius:8px}img{width:100%;display:block}p{margin:8px 0 2px}</style><h1>Loading illustrations · source review</h1><div class="grid">${cells}</div>`);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await page.screenshot({ path: path.join(root, 'loading-contact.png'), fullPage: true });
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
