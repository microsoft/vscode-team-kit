import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

for (const skill of ['setup-component-explorer', 'setup-component-explorer-full', 'setup-component-explorer-light']) {
  test(`${skill} generates native Copilot workspace MCP configuration`, async () => {
    const source = await readFile(new URL(`./skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.vscode\/mcp\.json/);
    const configs = [...source.matchAll(/```json\n([\s\S]*?)\n```/g)]
      .filter(([, json]) => json.includes('"mcpServers"'));
    assert.equal(configs.length, 1);
    const config = JSON.parse(configs[0][1]);
    assert.deepEqual(Object.keys(config), ['mcpServers']);
    const server = config.mcpServers['component-explorer'];
    assert.equal(server.type, 'stdio');
    assert.deepEqual(server.tools, ['*']);
    assert.ok(['npm', 'npx'].includes(server.command));
    assert.ok(server.args.includes('mcp'));
    assert.equal(server.args.at(-1), './component-explorer.json');
    assert.match(source, /\/mcp show component-explorer/);
  });
}
