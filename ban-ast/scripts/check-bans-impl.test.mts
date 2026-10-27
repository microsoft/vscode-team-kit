import { deepStrictEqual, strictEqual, throws, match, notStrictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  parseFrontmatter,
  parseBannedAstMd,
  escapeRegExp,
  extractCodeFragments,
  checkViolations,
  type BanRule,
} from './check-bans-impl.mts';

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = '---\nname: no-eval\nmessage: Do not use eval\n---\n(query)';
    const result = parseFrontmatter(content);
    strictEqual(result.data.name, 'no-eval');
    strictEqual(result.data.message, 'Do not use eval');
    strictEqual(result.body, '(query)');
  });

  it('strips quotes from values', () => {
    const content = '---\nname: "quoted"\nmessage: \'single\'\n---\nbody';
    const result = parseFrontmatter(content);
    strictEqual(result.data.name, 'quoted');
    strictEqual(result.data.message, 'single');
  });

  it('returns raw body when no frontmatter', () => {
    const content = 'just some text';
    const result = parseFrontmatter(content);
    deepStrictEqual(result.data, {});
    strictEqual(result.body, 'just some text');
  });

  it('handles empty body', () => {
    const content = '---\nname: test\n---\n';
    const result = parseFrontmatter(content);
    strictEqual(result.data.name, 'test');
    strictEqual(result.body, '');
  });

  it('handles windows line endings', () => {
    const content = '---\r\nname: win\r\nmessage: ok\r\n---\r\nbody text';
    const result = parseFrontmatter(content);
    strictEqual(result.data.name, 'win');
    strictEqual(result.data.message, 'ok');
    strictEqual(result.body, 'body text');
  });
});

// ---------------------------------------------------------------------------
// parseBannedAstMd
// ---------------------------------------------------------------------------

describe('parseBannedAstMd', () => {
  it('parses a single rule', () => {
    const content = [
      '---',
      'name: no-eval',
      'message: Do not use eval',
      '---',
      '(call_expression function: (identifier) @fn (#eq? @fn "eval"))',
    ].join('\n');

    const rules = parseBannedAstMd(content);
    strictEqual(rules.length, 1);
    strictEqual(rules[0].name, 'no-eval');
    strictEqual(rules[0].message, 'Do not use eval');
    strictEqual(rules[0].query, '(call_expression function: (identifier) @fn (#eq? @fn "eval"))');
  });

  it('parses multiple rules', () => {
    const content = [
      '---',
      'name: rule-a',
      'message: Ban A',
      '---',
      '(query_a)',
      '',
      '---',
      'name: rule-b',
      'message: Ban B',
      '---',
      '(query_b)',
    ].join('\n');

    const rules = parseBannedAstMd(content);
    strictEqual(rules.length, 2);
    strictEqual(rules[0].name, 'rule-a');
    strictEqual(rules[0].query, '(query_a)');
    strictEqual(rules[1].name, 'rule-b');
    strictEqual(rules[1].query, '(query_b)');
  });

  it('skips rules with missing name or message', () => {
    const content = [
      '---',
      'name: good-rule',
      'message: This is fine',
      '---',
      '(good_query)',
      '',
      '---',
      'name: no-message',
      '---',
      '(bad_query)',
    ].join('\n');

    const rules = parseBannedAstMd(content);
    strictEqual(rules.length, 1);
    strictEqual(rules[0].name, 'good-rule');
  });

  it('returns empty for content without frontmatter', () => {
    const rules = parseBannedAstMd('just some text without any frontmatter markers');
    strictEqual(rules.length, 0);
  });

  it('handles three rules', () => {
    const content = [
      '---',
      'name: r1',
      'message: m1',
      '---',
      '(q1)',
      '',
      '---',
      'name: r2',
      'message: m2',
      '---',
      '(q2)',
      '',
      '---',
      'name: r3',
      'message: m3',
      '---',
      '(q3)',
    ].join('\n');

    const rules = parseBannedAstMd(content);
    strictEqual(rules.length, 3);
    deepStrictEqual(rules.map(r => r.name), ['r1', 'r2', 'r3']);
    deepStrictEqual(rules.map(r => r.query), ['(q1)', '(q2)', '(q3)']);
  });
});

// ---------------------------------------------------------------------------
// escapeRegExp
// ---------------------------------------------------------------------------

describe('escapeRegExp', () => {
  it('escapes special regex chars', () => {
    strictEqual(escapeRegExp('a.b'), 'a\\.b');
    strictEqual(escapeRegExp('a*b'), 'a\\*b');
    strictEqual(escapeRegExp('a(b)'), 'a\\(b\\)');
    strictEqual(escapeRegExp('a[b]'), 'a\\[b\\]');
  });

  it('passes through normal strings', () => {
    strictEqual(escapeRegExp('no-eval'), 'no-eval');
    strictEqual(escapeRegExp('abc123'), 'abc123');
  });
});

// ---------------------------------------------------------------------------
// extractCodeFragments
// ---------------------------------------------------------------------------

describe('extractCodeFragments', () => {
  it('extracts from edit', () => {
    const fragments = extractCodeFragments('edit', {
      path: '/src/index.ts',
      old_str: 'foo',
      new_str: 'bar',
    });
    strictEqual(fragments.length, 1);
    strictEqual(fragments[0].filePath, '/src/index.ts');
    strictEqual(fragments[0].text, 'bar');
  });

  it('extracts from create', () => {
    const fragments = extractCodeFragments('create', {
      path: '/src/new.ts',
      file_text: 'const x = 1;',
    });
    strictEqual(fragments.length, 1);
    strictEqual(fragments[0].filePath, '/src/new.ts');
    strictEqual(fragments[0].text, 'const x = 1;');
  });

  it('extracts all files from apply_patch', () => {
    const fragments = extractCodeFragments('apply_patch', {
      input: '*** Begin Patch\n*** Update File: /a.ts\n-x\n+y\n*** Update File: /b.ts\n-p\n+q\n*** End Patch',
    });
    strictEqual(fragments.length, 2);
    strictEqual(fragments[0].text, 'y');
    strictEqual(fragments[1].text, 'q');
  });

  it('returns empty for unknown tool', () => {
    const fragments = extractCodeFragments('read_file', { filePath: '/a.ts' });
    strictEqual(fragments.length, 0);
  });

  it('rejects create with missing content', () => {
    throws(() => extractCodeFragments('create', { path: '/a.ts' }));
  });

  it('preserves intentional empty content', () => {
    deepStrictEqual(extractCodeFragments('create', { path: '/a.ts', file_text: '' }), [
      { filePath: '/a.ts', text: '' },
    ]);
  });
});

describe('Copilot preToolUse command contract', () => {
  it('registers a flat native command for every supported edit tool', () => {
    const config = JSON.parse(readFileSync(new URL('../com.github.copilot/hooks/hooks.json', import.meta.url), 'utf8'));
    strictEqual(config.version, 1);
    deepStrictEqual(Object.keys(config.hooks), ['preToolUse']);
    const [hook] = config.hooks.preToolUse;
    strictEqual(hook.type, 'command');
    strictEqual(hook.command, 'node "${PLUGIN_ROOT}/scripts/check-bans.mts"');
    strictEqual(hook.timeoutSec, 30);
    strictEqual('hooks' in hook, false);
    const matcher = new RegExp(`^(?:${hook.matcher})$`);
    for (const tool of ['create', 'edit', 'apply_patch']) strictEqual(matcher.test(tool), true);
    for (const tool of ['view', 'Edit', 'create_file', 'multi_replace_string_in_file']) strictEqual(matcher.test(tool), false);
  });

  it('denies violations, preserves normal permissions, and rejects invalid input', t => {
    const directory = mkdtempSync(join(tmpdir(), 'ban-ast-hook-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, 'home'));
    writeFileSync(join(directory, 'BANNED_AST.md'), [
      '---', 'name: no-eval', 'message: Do not use eval()', '---',
      '(call_expression function: (identifier) @fn (#eq? @fn "eval"))',
    ].join('\n'));
    const script = new URL('./check-bans-impl.mts', import.meta.url).href;
    const run = (input: unknown) => spawnSync(process.execPath, [
      '--input-type=module', '-e', `import { main } from ${JSON.stringify(script)}; await main();`,
    ], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, HOME: join(directory, 'home'), USERPROFILE: join(directory, 'home') },
    });
    const event = (toolName: string, toolArgs: unknown) => ({ toolName, toolArgs, cwd: directory });
    for (const [tool, args] of [
      ['create', { path: 'index.ts', file_text: 'eval(value);' }],
      ['edit', { path: 'index.ts', old_str: 'safe(value);', new_str: 'eval(value);' }],
      ['apply_patch', { input: '*** Begin Patch\n*** Add File: index.ts\n+eval(value);\n*** End Patch' }],
    ] as const) {
      const result = run(event(tool, args));
      strictEqual(result.status, 0, result.stderr);
      const decision = JSON.parse(result.stdout);
      strictEqual(decision.permissionDecision, 'deny');
      match(decision.permissionDecisionReason, /no-eval/);
      deepStrictEqual(Object.keys(decision).sort(), ['permissionDecision', 'permissionDecisionReason']);
    }
    for (const source of ['safe(value);', '// no-eval justification: test fixture\neval(value);', '']) {
      const result = run(event('create', { path: 'index.ts', file_text: source }));
      strictEqual(result.status, 0, result.stderr);
      deepStrictEqual(JSON.parse(result.stdout), {});
    }
    const unrelated = run(event('view', { path: 'index.ts' }));
    strictEqual(unrelated.status, 0, unrelated.stderr);
    deepStrictEqual(JSON.parse(unrelated.stdout), {});
    for (const invalid of ['not-json', '{}', event('edit', { path: 'index.ts' }),
      { tool_name: 'create', tool_input: { path: 'index.ts', file_text: 'eval(value);' }, cwd: directory }]) {
      const result = run(invalid);
      notStrictEqual(result.status, 0);
      strictEqual(result.stdout, '');
      match(result.stderr, /Error/);
    }
  });
});

// ---------------------------------------------------------------------------
// checkViolations (integration with tree-sitter)
// ---------------------------------------------------------------------------

describe('checkViolations', () => {
  const noEvalRule: BanRule = {
    name: 'no-eval',
    message: 'Do not use eval()',
    query: '(call_expression function: (identifier) @fn (#eq? @fn "eval"))',
  };

  it('detects a banned pattern in TypeScript', async () => {
    const fragments = [{ filePath: '/src/index.ts', text: 'const x = eval("code");' }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 1);
    strictEqual(violations[0].rule.name, 'no-eval');
    strictEqual(violations[0].filePath, '/src/index.ts');
  });

  it('allows code without banned patterns', async () => {
    const fragments = [{ filePath: '/src/index.ts', text: 'const x = foo("code");' }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 0);
  });

  it('allows banned pattern with justification comment', async () => {
    const code = [
      '// <no-eval> justification: required for dynamic plugin loading',
      'const x = eval("code");',
    ].join('\n');
    const fragments = [{ filePath: '/src/index.ts', text: code }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 0);
  });

  it('rejects banned pattern with empty justification on last line', async () => {
    // justification marker with only whitespace/EOF after it is not valid
    const code = '// <no-eval> justification: ';
    const fragments = [{ filePath: '/src/index.ts', text: code }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    // no eval call in this snippet, so no violation from the query itself
    strictEqual(violations.length, 0);
  });

  it('rejects when justification marker is absent', async  () => {
    const code = 'const x = eval("code"); // no justification here';
    const fragments = [{ filePath: '/src/index.ts', text: code }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 1);
  });

  it('skips files with unknown extensions', async () => {
    const fragments = [{ filePath: '/src/data.xyz', text: 'eval("code")' }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 0);
  });

  it('returns no violations when no rules apply', async () => {
    const fragments = [{ filePath: '/src/index.ts', text: 'eval("code")' }];
    const violations = await checkViolations(fragments, () => []);
    strictEqual(violations.length, 0);
  });

  it('detects multiple violations across files', async () => {
    const fragments = [
      { filePath: '/a.ts', text: 'eval("a")' },
      { filePath: '/b.ts', text: 'eval("b")' },
    ];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 2);
    deepStrictEqual(violations.map(v => v.filePath), ['/a.ts', '/b.ts']);
  });

  it('handles multiple rules independently', async () => {
    const noConsoleRule: BanRule = {
      name: 'no-console-log',
      message: 'No console.log',
      query: `(call_expression
        function: (member_expression
          object: (identifier) @obj
          property: (property_identifier) @prop)
        (#eq? @obj "console")
        (#eq? @prop "log"))`,
    };
    const code = 'console.log("hello"); eval("code");';
    const fragments = [{ filePath: '/src/index.ts', text: code }];
    const violations = await checkViolations(fragments, () => [noEvalRule, noConsoleRule]);
    strictEqual(violations.length, 2);
    deepStrictEqual(
      violations.map(v => v.rule.name).sort(),
      ['no-console-log', 'no-eval'],
    );
  });

  it('applies per-file rules correctly', async () => {
    const fragments = [
      { filePath: '/src/main.ts', text: 'eval("a")' },
      { filePath: '/test/test.ts', text: 'eval("b")' },
    ];
    // Only ban eval in src/, not test/
    const violations = await checkViolations(fragments, (fp) =>
      fp.startsWith('/src') ? [noEvalRule] : [],
    );
    strictEqual(violations.length, 1);
    strictEqual(violations[0].filePath, '/src/main.ts');
  });

  it('skips empty text fragments', async () => {
    const fragments = [{ filePath: '/src/index.ts', text: '' }];
    const violations = await checkViolations(fragments, () => [noEvalRule]);
    strictEqual(violations.length, 0);
  });

  it('gracefully handles invalid query syntax', async () => {
    const badRule: BanRule = {
      name: 'bad-query',
      message: 'This query is broken',
      query: '(((not_valid_syntax',
    };
    const fragments = [{ filePath: '/src/index.ts', text: 'const x = 1;' }];
    const violations = await checkViolations(fragments, () => [badRule]);
    strictEqual(violations.length, 0);
  });
});
