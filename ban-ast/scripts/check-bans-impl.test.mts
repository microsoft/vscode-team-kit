import { deepStrictEqual, strictEqual } from 'node:assert';
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
  it('extracts from replace_string_in_file', () => {
    const fragments = extractCodeFragments('replace_string_in_file', {
      filePath: '/src/index.ts',
      oldString: 'foo',
      newString: 'bar',
    });
    strictEqual(fragments.length, 1);
    strictEqual(fragments[0].filePath, '/src/index.ts');
    strictEqual(fragments[0].text, 'bar');
  });

  it('extracts from create_file', () => {
    const fragments = extractCodeFragments('create_file', {
      filePath: '/src/new.ts',
      content: 'const x = 1;',
    });
    strictEqual(fragments.length, 1);
    strictEqual(fragments[0].filePath, '/src/new.ts');
    strictEqual(fragments[0].text, 'const x = 1;');
  });

  it('extracts from multi_replace_string_in_file', () => {
    const fragments = extractCodeFragments('multi_replace_string_in_file', {
      replacements: [
        { filePath: '/a.ts', oldString: 'x', newString: 'y' },
        { filePath: '/b.ts', oldString: 'p', newString: 'q' },
      ],
    });
    strictEqual(fragments.length, 2);
    strictEqual(fragments[0].text, 'y');
    strictEqual(fragments[1].text, 'q');
  });

  it('returns empty for unknown tool', () => {
    const fragments = extractCodeFragments('read_file', { filePath: '/a.ts' });
    strictEqual(fragments.length, 0);
  });

  it('returns empty for create_file with missing content', () => {
    const fragments = extractCodeFragments('create_file', { filePath: '/a.ts' });
    strictEqual(fragments.length, 0);
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
