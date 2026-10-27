import { deepStrictEqual, match, notStrictEqual, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const script = fileURLToPath(new URL('./remind-plan-review.mts', import.meta.url));
function run(toolName: string, toolArgs: unknown) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ toolName, toolArgs, cwd: process.cwd() }),
    encoding: 'utf8',
  });
}

describe('Copilot postToolUse plan reminder', () => {
  it('registers one native post-tool command with an anchored edit matcher', () => {
    const config = JSON.parse(readFileSync(new URL('../com.github.copilot/hooks/hooks.json', import.meta.url), 'utf8'));
    strictEqual(config.version, 1);
    deepStrictEqual(Object.keys(config.hooks), ['postToolUse']);
    const [hook] = config.hooks.postToolUse;
    strictEqual(hook.type, 'command');
    strictEqual(hook.command, 'node "${PLUGIN_ROOT}/hooks/remind-plan-review.mts"');
    strictEqual(hook.timeoutSec, 30);
    strictEqual('hooks' in hook, false);
    const matcher = new RegExp(`^(?:${hook.matcher})$`);
    for (const tool of ['create', 'edit', 'apply_patch']) strictEqual(matcher.test(tool), true);
    for (const tool of ['memory', 'view', 'create_file']) strictEqual(matcher.test(tool), false);
  });

  it('injects top-level context after native plan writes on either path platform', () => {
    for (const path of ['plan.md', '/session/plan.md', 'C:\\session\\plan.md']) {
      for (const [tool, args] of [
        ['create', { path, file_text: '# Plan' }],
        ['edit', { path, old_str: '# Old plan', new_str: '# Plan' }],
      ] as const) {
        const result = run(tool, args);
        strictEqual(result.status, 0, result.stderr);
        const output = JSON.parse(result.stdout);
        deepStrictEqual(Object.keys(output), ['additionalContext']);
        match(output.additionalContext, /review-plan/);
      }
    }
    const patch = run('apply_patch', { input: '*** Begin Patch\n*** Add File: /session/plan.md\n+# Plan\n*** End Patch' });
    strictEqual(patch.status, 0, patch.stderr);
    match(JSON.parse(patch.stdout).additionalContext, /review-plan/);
  });

  it('does not trigger for unrelated files, tools, or deleting plan content', () => {
    for (const [tool, args] of [
      ['view', { path: '/session/plan.md' }],
      ['create', { path: '/session/plan-review.md', file_text: '# Review' }],
      ['create', { path: '/session/not-plan.md', file_text: '# Plan' }],
      ['edit', { path: '/session/plan.md', old_str: '# Plan', new_str: '' }],
    ] as const) {
      const result = run(tool, args);
      strictEqual(result.status, 0, result.stderr);
      deepStrictEqual(JSON.parse(result.stdout), {});
    }
  });

  it('surfaces invalid events and arguments as command errors', () => {
    for (const input of ['not-json', '{}', '{"tool_name":"memory","tool_input":{}}']) {
      const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
      notStrictEqual(result.status, 0);
      strictEqual(result.stdout, '');
      match(result.stderr, /Error/);
    }
    const malformed = run('edit', { path: 'plan.md' });
    notStrictEqual(malformed.status, 0);
    strictEqual(malformed.stdout, '');
    match(malformed.stderr, /Error/);
  });
});
