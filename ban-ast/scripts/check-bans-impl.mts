import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEditInputs, isEditTool, type EditInput } from '../../common/edit-tools.mts';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Language map: file extension → tree-sitter grammar package
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, string> = {
  '.js': 'tree-sitter-typescript/typescript',
  '.mjs': 'tree-sitter-typescript/typescript',
  '.cjs': 'tree-sitter-typescript/typescript',
  '.jsx': 'tree-sitter-typescript/typescript',
  '.ts': 'tree-sitter-typescript/typescript',
  '.mts': 'tree-sitter-typescript/typescript',
  '.cts': 'tree-sitter-typescript/typescript',
  '.tsx': 'tree-sitter-typescript/tsx',
  '.py': 'tree-sitter-python',
  '.rs': 'tree-sitter-rust',
  '.go': 'tree-sitter-go',
  '.c': 'tree-sitter-c',
  '.h': 'tree-sitter-c',
  '.cpp': 'tree-sitter-cpp',
  '.cc': 'tree-sitter-cpp',
  '.cs': 'tree-sitter-c-sharp',
  '.java': 'tree-sitter-java',
  '.rb': 'tree-sitter-ruby',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BanRule {
  name: string;
  message: string;
  query: string;
}

export interface Violation {
  rule: BanRule;
  filePath: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser (avoids gray-matter dependency)
// ---------------------------------------------------------------------------

export function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      data[key] = val;
    }
  }
  return { data, body: match[2].trim() };
}

// ---------------------------------------------------------------------------
// Load global ban rules from $HOME/.BANNED_AST.md
// ---------------------------------------------------------------------------

function loadGlobalBanRules(): BanRule[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (!home) return [];
  const globalFile = join(home, '.BANNED_AST.md');
  if (!existsSync(globalFile)) return [];
  const content = readFileSync(globalFile, 'utf-8');
  return parseBannedAstMd(content);
}

// ---------------------------------------------------------------------------
// Parse a BANNED_AST.md with multiple rules separated by `---`
//
// Format:
//   ---
//   name: rule-name
//   message: Rejection reason
//   ---
//   (query ...)
//
//   ---
//   name: another-rule
//   message: Another reason
//   ---
//   (query ...)
// ---------------------------------------------------------------------------

export function parseBannedAstMd(content: string): BanRule[] {
  const rules: BanRule[] = [];

  // Split on frontmatter boundaries: each rule starts with ---\n...\n---
  const rulePattern = /---\r?\n([\s\S]*?)\r?\n---\r?\n/g;
  let match: RegExpExecArray | null;
  const boundaries: { dataStr: string; endIndex: number }[] = [];

  while ((match = rulePattern.exec(content)) !== null) {
    boundaries.push({ dataStr: match[1], endIndex: match.index + match[0].length });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const { dataStr, endIndex } = boundaries[i];
    // Body runs from end of this frontmatter to start of the next, or EOF
    const nextStart = i + 1 < boundaries.length
      ? content.lastIndexOf('---', boundaries[i + 1].endIndex - boundaries[i + 1].dataStr.length - 6)
      : content.length;
    const body = content.slice(endIndex, nextStart).trim();

    const data: Record<string, string> = {};
    for (const line of dataStr.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
        data[key] = val;
      }
    }

    if (data.name && data.message && body) {
      rules.push({ name: data.name, message: data.message, query: body });
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Walk parent directories of a file looking for BANNED_AST.md
// ---------------------------------------------------------------------------

function loadBanRulesFromParents(filePath: string): BanRule[] {
  const rules: BanRule[] = [];
  const seen = new Set<string>();
  let dir = dirname(resolve(filePath));

  while (true) {
    const candidate = resolve(dir, 'BANNED_AST.md');
    if (!seen.has(candidate) && existsSync(candidate)) {
      seen.add(candidate);
      const content = readFileSync(candidate, 'utf-8');
      rules.push(...parseBannedAstMd(content));
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Load all ban rules for a given set of file paths
// ---------------------------------------------------------------------------

function loadAllBanRules(filePaths: string[]): Map<string, BanRule[]> {
  const globalRules = loadGlobalBanRules();
  const result = new Map<string, BanRule[]>();

  for (const fp of filePaths) {
    const perFile = loadBanRulesFromParents(fp);
    // Deduplicate by rule name, per-file rules take precedence
    const seen = new Set<string>();
    const merged: BanRule[] = [];
    for (const r of perFile) {
      if (!seen.has(r.name)) { seen.add(r.name); merged.push(r); }
    }
    for (const r of globalRules) {
      if (!seen.has(r.name)) { seen.add(r.name); merged.push(r); }
    }
    result.set(fp, merged);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Load a tree-sitter language grammar (returns null if not installed)
// ---------------------------------------------------------------------------

function loadLanguage(ext: string): unknown | null {
  const pkg = LANG_MAP[ext];
  if (!pkg) return null;
  try {
    return require(pkg);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read stdin
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

// ---------------------------------------------------------------------------
// Escape special regex characters
// ---------------------------------------------------------------------------

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------// Check ban violations against parsed code
// ---------------------------------------------------------------------------

export async function checkViolations(
  fragments: CodeFragment[],
  rulesForFile: (filePath: string) => BanRule[],
): Promise<Violation[]> {
  let Parser: typeof import('tree-sitter');
  try {
    Parser = await import('tree-sitter').then(m => (m as any).default);
  } catch {
    return [];
  }

  const violations: Violation[] = [];

  for (const { filePath, text } of fragments) {
    if (!text) continue;

    const rules = rulesForFile(filePath);
    if (rules.length === 0) continue;

    const ext = extname(filePath).toLowerCase();
    const language = loadLanguage(ext);
    if (!language) continue;

    const parser = new Parser();
    parser.setLanguage(language);

    let tree: any;
    try {
      tree = parser.parse(text);
    } catch {
      continue;
    }
    if (!tree) continue;

    for (const rule of rules) {
      try {
        const query = new Parser.Query(language, rule.query);
        const matches = query.matches(tree.rootNode);
        if (matches.length > 0) {
          const justificationRe = new RegExp(
            `<?${escapeRegExp(rule.name)}>?\\s*justification:\\s*\\S`,
            'i',
          );
          if (!justificationRe.test(text)) {
            violations.push({ rule, filePath });
          }
        }
      } catch (e) {
        console.warn(`Error processing rule "${rule.name}" in ${filePath}:`, e);
        // Query parse error or tree-sitter issue — skip this rule
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------// Extract edits from event, handling both edit tools and create_file
// ---------------------------------------------------------------------------

export interface CodeFragment {
  filePath: string;
  text: string;
}

export function extractCodeFragments(toolName: string, toolInput: Record<string, unknown>): CodeFragment[] {
  if (isEditTool(toolName)) {
    return extractEditInputs(toolName, toolInput).map((e: EditInput) => ({
      filePath: e.filePath,
      text: e.newString,
    }));
  }

  if (toolName === 'create_file') {
    const filePath = toolInput.filePath as string | undefined;
    const content = toolInput.content as string | undefined;
    if (filePath && content) {
      return [{ filePath, text: content }];
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main() {
  const input = await readStdin();
  const event = JSON.parse(input);
  const toolName: string = event.tool_name;
  const toolInput: Record<string, unknown> = event.tool_input ?? {};

  const fragments = extractCodeFragments(toolName, toolInput);
  if (fragments.length === 0) {
    process.exit(0);
  }

  const allRules = loadAllBanRules(fragments.map((f) => f.filePath));
  // Check if there are any rules at all
  let hasAnyRules = false;
  for (const rules of allRules.values()) {
    if (rules.length > 0) { hasAnyRules = true; break; }
  }
  if (!hasAnyRules) {
    process.exit(0);
  }

  const violations = await checkViolations(fragments, (fp) => allRules.get(fp) ?? []);

  if (violations.length > 0) {
    const details = violations
      .map((v) => `• **${v.rule.name}** in \`${v.filePath}\`: ${v.rule.message}`)
      .join('\n');

    const hint =
      'If this usage is strictly necessary, you may retry the edit with a comment ' +
      'containing `<ban-name> justification: <reason>` (replacing `ban-name` with ' +
      'the rule name above) in the same code region.';

    process.stdout.write(JSON.stringify({
      continue: false,
      stopReason: `Banned AST pattern(s) detected:\n\n${details}\n\n${hint}\n`,
    }), () => process.exit(0));
  } else {
    process.exit(0);
  }
}
