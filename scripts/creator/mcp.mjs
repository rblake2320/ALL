import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import os from 'node:os';
import { Creator, contract, initSchema, draftSchema, artifactSchema, repo } from './core.mjs';
import { publicCreatorError } from './privacy.mjs';

if (process.argv.length !== 4 || process.argv[2] !== '--workspace') throw new Error('Usage: node mcp.mjs --workspace <absolute existing directory>');
const creator = new Creator(process.argv[3]);
const server = new McpServer({ name: 'afterlife-creator-kit', version: '0.1.0' });
let queue = Promise.resolve();
const tools = [
  ['creator_contract', 'Read current pack support, limits and admission restrictions.', z.strictObject({}), () => contract(), true],
  ['creator_init', 'Create a new original house-brand skin draft. Refuses existing ids. No generation or paid services.', initSchema, input => creator.init(input), false],
  ['creator_build', 'Build an immutable unsigned artifact from a draft; hashes assets and runs real game verification plus static SVG checks.', draftSchema, input => creator.build(input), false],
  ['creator_verify', 'Read artifact and demonstrate actual PackRegistry + brandSkinFor resolution in this process; verify unsigned production rejection.', artifactSchema, input => creator.verify(input), true],
  ['creator_gate', 'Verify artifact and write an immutable hash-bound local receipt. Repository CI remains pending; this does not authorize publication.', artifactSchema, input => creator.gate(input), false],
];
for (const [name, description, inputSchema, handler, readOnlyHint] of tools) {
  server.registerTool(name, { description, inputSchema,
    annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false } }, input => {
    // The real registry has process-global state; serialize tools through cleanup.
    const task = queue.then(async () => {
      try {
        const value = await handler(input);
        return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
      } catch (error) {
        const message=publicCreatorError(error,[{path:creator.root,label:'workspace'},{path:repo,label:'repo'},{path:os.homedir(),label:'home'}]);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error:message }) }] };
      }
    });
    queue = task.catch(() => {});
    return task;
  });
}
await server.connect(new StdioServerTransport());
