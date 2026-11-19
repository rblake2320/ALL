import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { kit } from '../core.mjs';

test('real stdio MCP handshake/list/author/build/verify/gate/error recovery; no extra tools', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'afterlife-creator-mcp-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(kit, 'mcp.mjs'), '--workspace', root], stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', b => { stderr += b.toString(); });
  const client = new Client({ name: 'creator-kit-acceptance', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(t => t.name).sort(), ['creator_build', 'creator_contract', 'creator_gate', 'creator_init', 'creator_verify']);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
      return result.structuredContent;
    };
    assert.equal((await call('creator_contract', {})).futureTask, 'W-084');
    await call('creator_init', { id: 'mcp-night', author: 'MCP creator', brand: 'Grave-Cola', displayName: 'MCP Night Chiller', flavorText: 'Protocol acceptance artwork.' });
    const built = await call('creator_build', { id: 'mcp-night' });
    const checks = await Promise.all([call('creator_verify', { artifact: built.artifact }), call('creator_gate', { artifact: built.artifact })]);
    for (const v of checks) assert.equal(v.registry.resolved[0].objects[0].resolvedSkin, 'mcp_night');
    assert.equal(checks[1].publicationReady, false);
    const bad = await client.callTool({ name: 'creator_build', arguments: { id: '../escape' } });
    assert.equal(bad.isError, true);
    const missing = await client.callTool({ name: 'creator_verify', arguments: { artifact: 'no-such-artifact' } });
    assert.equal(missing.isError, true);
    fs.writeFileSync(path.join(root,'drafts/.private-lock.lock'),'another writer');
    const locked=await client.callTool({name:'creator_init',arguments:{id:'private-lock',author:'Test',brand:'Grave-Cola',displayName:'Test',flavorText:'Test'}});
    assert.equal(locked.isError,true);
    const error=JSON.parse(locked.content[0].text);
    assert.match(error.error,/EEXIST/);
    assert.ok(!error.error.includes(root),'Filesystem root leaked to MCP client');
    assert.equal(fs.readFileSync(path.join(root,'drafts/.private-lock.lock'),'utf8'),'another writer');
    assert.equal((await call('creator_contract', {})).supported[0], 'brandSkins');
    assert.equal(stderr, '');
  } finally { await client.close(); }
});
