import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildMap,inventory} from './generate.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export function createServer({root=process.cwd(),generate=()=>buildMap(root),html=fs.readFileSync(path.join(here,'index.html'))}={}) {
  root=fs.realpathSync(root);let pending=null;
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    try {
      if(req.method!=='GET')return json(405,{error:'GET required'});
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(url.pathname==='/api/map') {
        // One refresh at a time; never send an old successful map after a failure.
        if(!pending)pending=Promise.resolve().then(generate);
        const task=pending;
        try {return json(200,await task);} finally {if(pending===task)pending=null;}
      }
      if(url.pathname==='/api/source') {
        const file=url.searchParams.get('path');
        if(!file||!inventory(root).includes(file))return json(404,{error:'Source outside the inventory'});
        const real=fs.realpathSync(path.join(root,file));
        if(!real.startsWith(root+path.sep))return json(403,{error:'Source escaped project root'});
        if(fs.statSync(real).size>2*1024*1024)return json(413,{error:'Source too large for text viewer'});
        res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(fs.readFileSync(real));return;
      }
      if(url.pathname==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
      return json(404,{error:'Unknown route'});
    } catch(e){return json(503,{error:`Refresh/read failed: ${e.message}`,stale:true});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const root=path.resolve(process.argv[2]||'.'), offline=process.argv.includes('--offline');
 const server=createServer({root,generate:()=>buildMap(root,{offline})});
 server.listen(Number(process.env.PORT||4179),'127.0.0.1',()=>console.log(`Wiremap http://127.0.0.1:${server.address().port}`));
}
