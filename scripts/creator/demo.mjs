// Retain real CLI and MCP protocol results in a caller-owned directory.
import * as fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Creator, kit, sha } from './core.mjs';
const [workspace] = process.argv.slice(2);
if (process.argv.length !== 3) throw new Error('Usage: node scripts/creator/demo.mjs <absolute existing new workspace>');
const creator = new Creator(workspace);
const calls = [];
const run = (name, input) => {
  const raw = execFileSync(process.execPath, [path.join(kit, 'cli.mjs'), name, '--workspace', workspace, '--json', JSON.stringify(input)], { encoding: 'utf8', windowsHide: true });
  const value = JSON.parse(raw); calls.push({ transport: 'cli', name, input, value }); return value;
};
run('init', { id: 'creator-demo', author: 'Afterlife Lease contributor kit', brand: 'Grave-Cola', displayName: 'Night Chiller', flavorText: 'An original green and cream house-brand chiller.' });
const built = run('build', { id: 'creator-demo' });
run('gate', { artifact: built.artifact });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(kit, 'mcp.mjs'), '--workspace', workspace], stderr: 'pipe' });
let stderr = ''; transport.stderr.on('data', bytes => { stderr += bytes; });
const client = new Client({ name: 'creator-kit-demo', version: '1.0.0' });
let server, tools;
try {
  await client.connect(transport);
  server = client.getServerVersion(); tools = await client.listTools();
  for (const [name, input] of [['creator_contract', {}], ['creator_verify', { artifact: built.artifact }], ['creator_gate', { artifact: built.artifact }], ['creator_build', { id: '../escape' }]]) {
    const value = await client.callTool({ name, arguments: input }); calls.push({ transport: 'mcp-stdio', name, input, value });
    if (name !== 'creator_build' && value.isError) throw new Error(JSON.stringify(value));
    if (name === 'creator_build' && !value.isError) throw new Error('Unsafe request was accepted');
  }
} finally { await client.close(); }
if (stderr) throw new Error(`MCP stderr: ${stderr}`);
const record = { at: new Date().toISOString(), node: process.version, platform: process.platform, server, tools, artifact: built,
  provenance: creator.provenance(), calls, stderr };
const bytes = JSON.stringify(record, null, 2) + '\n';
fs.writeFileSync(path.join(workspace, 'demo-evidence.json'), bytes, { flag: 'wx' });
console.log(JSON.stringify({ evidence: 'demo-evidence.json', artifact: built.artifact, packSha256: built.packSha256, evidenceSha256: sha(bytes), calls: calls.length, worked: true }, null, 2));
