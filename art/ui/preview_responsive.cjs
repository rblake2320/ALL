// Source-art review only: not a game implementation or a social feed.
const fs = require('fs'), path = require('path'), { chromium } = require('playwright');
const root = __dirname;
const social = JSON.parse(fs.readFileSync(path.join(root, 'social.json'), 'utf8')).assets;
const icons = JSON.parse(fs.readFileSync(path.join(root, 'icons.json'), 'utf8')).icons;
const data = file => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, file)).toString('base64');
(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const [width, height] of [[1920,1080],[390,844]]) {
      const page = await browser.newPage({ viewport:{width,height}, deviceScaleFactor:1 });
      const cards = social.filter(a => a.id.startsWith('feed-')).map(a => `<img class="card" alt="${a.id}" src="${data(a.file)}">`).join('');
      const badges = social.filter(a => a.id.startsWith('badge-')).map(a => `<img class="badge" alt="${a.id}" src="${data(a.file)}">`).join('');
      const samples = icons.map(a => `<div class="sample"><span>${a.label}</span><div>${[24,48,96].map(size => `<img width="${size}" height="${size}" alt="" src="${data(a.file)}">`).join('')}</div></div>`).join('');
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#e5dccb;color:#251c2b;font:16px Arial}main{max-width:1200px;margin:auto;padding:15px}h1{font:28px Georgia}h2{font:22px Georgia}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),360px));gap:12px}.card{width:100%;max-width:360px;height:auto}.badges{display:flex;gap:10px}.badge{width:96px;height:96px}.icons{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.sample{padding:12px;border-radius:8px;background:#f6f0e4}.sample div{display:flex;align-items:center;justify-content:space-around;height:105px}.sample img{background:#e8e0c8;padding:3px;filter:none}</style><main><h1>Artwork source review</h1><p>Responsive source-art samples; no live social content.</p><h2>Feed illustrations · 360 × 200</h2><div class="cards">${cards}</div><h2>Collection badges · 96 × 96</h2><div class="badges">${badges}</div><h2>Icons · 24, 48 and 96 px</h2><div class="icons">${samples}</div></main>`);
      await page.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
      await page.screenshot({path:path.join(root,`responsive-${width}.png`),fullPage:true});
      console.log(`PASS ${width}x${height}: ${await page.locator('img').count()} decoded images; no horizontal overflow`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });

