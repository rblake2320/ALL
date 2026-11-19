const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const dir=__dirname, m=JSON.parse(fs.readFileSync(path.join(dir,'surfaces.json'),'utf8'));
(async()=>{const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {const p=await b.newPage({viewport:{width:1200,height:1100},deviceScaleFactor:1});
const cells=[...m.ads,...m.news].map(a=>{const data=fs.readFileSync(path.resolve(dir,a.file)).toString('base64');return '<article><img alt="'+a.id+'" src="data:image/svg+xml;base64,'+data+'"><p>'+a.id+' · '+a.width+' × '+a.height+'</p></article>'}).join('');
await p.setContent('<style>body{background:#d9cfb8;color:#1d1726;font:16px Arial;padding:22px}h1{font:28px Georgia}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:#eee5d4;padding:12px;border-radius:10px}img{width:100%;height:280px;object-fit:contain}p{margin:6px}</style><h1>In-world creatives · source review</h1><div class="grid">'+cells+'</div>');
await p.screenshot({path:path.join(dir,'surfaces-contact.png'),fullPage:true});}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
