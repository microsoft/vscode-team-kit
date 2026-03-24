/**
 * validate-rule.mts
 *
 * CLI tool for agents to validate a Tree Sitter ban rule against code snippets.
 *
 * Usage:
 *   node ban-ast/scripts/validate-rule.mts \
 *     --lang ts \
 *     --query '(call_expression function: (identifier) @fn (#eq? @fn "eval"))' \
 *     --should-match 'eval("test")' \
 *     --should-not-match 'foo("test")'
 *
 * Flags:
 *   --lang <ext>              File extension for the language (e.g. ts, js, py). Default: ts
 *   --query <query>           The Tree Sitter S-expression query to validate (required)
 *   --should-match <code>     Code snippet that MUST produce a match (repeatable)
 *   --should-not-match <code> Code snippet that MUST NOT produce a match (repeatable)
 *
 * Exit code: 0 if all tests pass, 1 if any fail or the query is invalid.
 */

import install from '../../common/install-if-necessary.mts';

const LANG_MAP: Record<string, string> = {
  ts: 'tree-sitter-typescript/typescript',
  js: 'tree-sitter-typescript/typescript',
  mjs: 'tree-sitter-typescript/typescript',
  cjs: 'tree-sitter-typescript/typescript',
  jsx: 'tree-sitter-typescript/typescript',
  mts: 'tree-sitter-typescript/typescript',
  cts: 'tree-sitter-typescript/typescript',
  tsx: 'tree-sitter-typescript/tsx',
};

install().then(async () => {
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');
  const require = createRequire(import.meta.url);
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // ---------------------------------------------------------------------------
  // Parse CLI args
  // ---------------------------------------------------------------------------

  const argv = process.argv.slice(2);
  let lang = 'ts';
  let query: string | undefined;
  const shouldMatch: string[] = [];
  const shouldNotMatch: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--lang' && argv[i + 1]) {
      lang = argv[++i].replace(/^\./, ''); // strip leading dot if present
    } else if (arg === '--query' && argv[i + 1]) {
      query = argv[++i];
    } else if (arg === '--should-match' && argv[i + 1]) {
      shouldMatch.push(argv[++i]);
    } else if (arg === '--should-not-match' && argv[i + 1]) {
      shouldNotMatch.push(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!query) {
    console.error('Error: --query is required.\n');
    printUsage();
    process.exit(1);
  }

  if (shouldMatch.length === 0 && shouldNotMatch.length === 0) {
    // No test cases — just validate the query parses correctly.
    console.log('No test cases provided. Checking query syntax only.\n');
  }

  // ---------------------------------------------------------------------------
  // Load tree-sitter
  // ---------------------------------------------------------------------------

  const langPkg = LANG_MAP[lang];
  if (!langPkg) {
    const supported = Object.keys(LANG_MAP).join(', ');
    console.error(`Error: Unknown language "${lang}". Supported: ${supported}`);
    process.exit(1);
  }

  let Parser: any;
  try {
    Parser = require('tree-sitter');
  } catch {
    console.error('Error: tree-sitter is not installed. Run `npm install` in the team-kit root.');
    process.exit(1);
  }

  let language: unknown;
  try {
    language = require(langPkg);
  } catch {
    console.error(`Error: Grammar package "${langPkg}" is not installed. It may need to be added to package.json.`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Validate the query syntax before running tests
  // ---------------------------------------------------------------------------

  try {
    new Parser.Query(language, query);
  } catch (err: any) {
    console.error(`Error: Invalid Tree Sitter query syntax:\n  ${err?.message ?? err}`);
    process.exit(1);
  }

  if (shouldMatch.length === 0 && shouldNotMatch.length === 0) {
    console.log('Query syntax is valid.');
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // Run test cases
  // ---------------------------------------------------------------------------

  const parser = new Parser();
  parser.setLanguage(language);

  let passed = 0;
  let failed = 0;

  function runQuery(code: string): number {
    const tree = parser.parse(code);
    const q = new Parser.Query(language, query);
    return q.matches(tree.rootNode).length;
  }

  for (const code of shouldMatch) {
    const matchCount = runQuery(code);
    if (matchCount > 0) {
      console.log(`PASS [should-match]:     ${JSON.stringify(code)}`);
      passed++;
    } else {
      console.log(`FAIL [should-match]:     ${JSON.stringify(code)} — no match found`);
      failed++;
    }
  }

  for (const code of shouldNotMatch) {
    const matchCount = runQuery(code);
    if (matchCount === 0) {
      console.log(`PASS [should-not-match]: ${JSON.stringify(code)}`);
      passed++;
    } else {
      console.log(`FAIL [should-not-match]: ${JSON.stringify(code)} — unexpected match found`);
      failed++;
    }
  }

  const total = passed + failed;
  console.log(`\n${total} test(s): ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
});

function printUsage() {
  console.log(`Usage: node ban-ast/scripts/validate-rule.mts [options]

Options:
  --lang <ext>              Language extension (default: ts). Supported: ${Object.keys(LANG_MAP).join(', ')}
  --query <query>           Tree Sitter S-expression query (required)
  --should-match <code>     Code that MUST match the query (repeatable)
  --should-not-match <code> Code that MUST NOT match the query (repeatable)
  --help                    Show this message

Examples:
  # Check query syntax only
  node ban-ast/scripts/validate-rule.mts \\
    --query '(call_expression function: (identifier) @fn (#eq? @fn "eval"))'

  # Full rule validation
  node ban-ast/scripts/validate-rule.mts \\
    --lang ts \\
    --query '(call_expression function: (identifier) @fn (#eq? @fn "eval"))' \\
    --should-match 'eval("code")' \\
    --should-not-match 'foo("code")'
`);
}
