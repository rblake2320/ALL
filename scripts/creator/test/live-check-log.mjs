// Explicit local acceptance driver, not an MCP tool and not automatically run by the dedicated kit CI.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Creator,repo,sha } from '../core.mjs';
import { runRepositoryCommand } from '../checks.mjs';
const [workspace]=process.argv.slice(2);
if(!workspace || process.argv.length!==3)throw Error('Supply a fresh private workspace');
fs.mkdirSync(workspace,{recursive:false});const creator=new Creator(workspace);
const file=path.join(creator.root,'receipts','real-vitest.txt'),fd=fs.openSync(file,'wx');
let result;
try{result=await runRepositoryCommand(['node_modules/vitest/vitest.mjs','run','tests/unit/creator','--maxWorkers=1','--fileParallelism=false'],fd,60000,[creator.root]);}
finally{fs.closeSync(fd);}
const text=fs.readFileSync(file,'utf8');
if(result.code!==0||result.error||result.timedOut)throw Error('Real Vitest child failed');
if(!text.includes('[repo]')||!text.includes('3 passed'))throw Error('Expected real runner root and three completed tests');
for(const root of [repo.replace(/[\\/]+$/,''),creator.root,os.homedir()])for(const form of [root,root.replaceAll('\\','/'),root.replaceAll('/','\\')])if(text.includes(form))throw Error('Host root leaked into persisted runner log');
const receipt={format:'creator-live-log-check-v1',result,tests:3,log:'receipts/real-vitest.txt',logSha256:sha(fs.readFileSync(file)),provenance:creator.provenance(),status:'Worked'};
fs.writeFileSync(path.join(creator.root,'result.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,tests:receipt.tests,logSha256:receipt.logSha256}));
