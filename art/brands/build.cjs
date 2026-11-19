// Rebuild the transparent PNG decals from the checked-in, editable SVG originals.
// Requires Playwright (set NODE_PATH to its installation) and a local Chrome install.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const dir = __dirname;
const names = ['mulch-master','grave-cola','volt-hearse','brain-bran','rot-pop','coffin-coffee','crypt-kicks','necro-tech'];
(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const name of names) {
      const page = await browser.newPage({ viewport:{width:1024,height:1024}, deviceScaleFactor:1 });
      const svg = fs.readFileSync(path.join(dir, name+'.svg'), 'utf8');
      await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:1024px;height:1024px;display:block}</style>'+svg);
      await page.screenshot({path:path.join(dir,name+'.png'),omitBackground:true});
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
