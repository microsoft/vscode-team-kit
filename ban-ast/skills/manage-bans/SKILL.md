---
name: manage-bans
description: Create and manage banned AST patterns that prevent specific code constructs. Use when the user wants to ban a code pattern, add a tree-sitter lint rule, or prevent specific syntax from appearing in edits.
---

# Managing Banned AST Patterns

Ban rules are discovered from two sources, both checked by the preToolUse hook:

1. **`$HOME/.BANNED_AST.md`** — global rules that apply to all edits, regardless of project.
2. **`BANNED_AST.md` files in any parent directory of the edited file** — can contain multiple rules, scoped to that subtree.

## Source 1: Global Ban File (`$HOME/.BANNED_AST.md`)

Place a `BANNED_AST.md` in your home directory to define rules that apply globally to every edit. It uses the same multi-rule format as directory-scoped files:

```markdown
---
name: no-eval
message: "Do not use eval(). It poses a security risk and should be replaced with safer alternatives."
---

(call_expression
  function: (identifier) @fn
  (#eq? @fn "eval"))
```

### Creating a Global Ban

1. Open or create `~/.BANNED_AST.md`.
2. Add a rule block with `---` frontmatter containing `name` and `message`, followed by `---` and the Tree Sitter query.
3. Multiple rules can be stacked in the same file, each separated by a new frontmatter block.
4. Validate the rule — see [Validating Rules](#validating-rules) below.

## Source 2: `BANNED_AST.md` Files (Directory-Scoped)

Place a `BANNED_AST.md` file in any directory to ban patterns for all files at or below that directory. The hook walks up from each edited file's directory to the filesystem root, collecting rules from every `BANNED_AST.md` it finds.

A single `BANNED_AST.md` can contain **multiple rules**, each separated by its own frontmatter block:

```markdown
---
name: no-eval
message: "Do not use eval(). It poses a security risk."
---

(call_expression
  function: (identifier) @fn
  (#eq? @fn "eval"))

---
name: no-console-log
message: "Avoid console.log() in production code."
---

(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @prop)
  (#eq? @obj "console")
  (#eq? @prop "log"))
```

Each rule section starts with `---` frontmatter containing `name` and `message`, followed by `---`, then the Tree Sitter query body. The next `---` begins the next rule.

### When to Use Which

- **`~/.BANNED_AST.md`** — personal global bans that apply everywhere regardless of file location.
- **`BANNED_AST.md`** — scoped bans for subtrees (e.g. ban `any` in `src/` but allow it in `tests/`).

When both sources define a rule with the same `name`, the `BANNED_AST.md` closer to the edited file takes precedence.

## Rule Format

### Frontmatter Fields

- **name** (required): A unique identifier for this ban (lowercase, hyphens ok). This is used in justification comments (`<name> justification: ...`).
- **message** (required): The rejection message shown when this pattern is detected. Should explain WHY the pattern is banned and suggest alternatives.

### Body

The body contains a [Tree Sitter query](https://tree-sitter.github.io/tree-sitter/using-parsers/queries) that matches the banned AST nodes. These use S-expression syntax with optional predicates like `#eq?` and `#match?`.

## Examples

### Global ban file (`~/.BANNED_AST.md`)

```markdown
---
name: no-eval
message: "Do not use eval(). It poses a security risk. Use Function constructor or a sandboxed interpreter instead."
---

(call_expression
  function: (identifier) @fn
  (#eq? @fn "eval"))
```

### Multi-rule `BANNED_AST.md`

Place this in a project directory to ban multiple patterns for all files below it:

```markdown
---
name: no-console-log
message: "Avoid console.log() in production code. Use a structured logging framework instead."
---

(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @prop)
  (#eq? @obj "console")
  (#eq? @prop "log"))

---
name: no-any-type
message: "Do not use the 'any' type. Use 'unknown' or a concrete type instead."
---

(predefined_type) @type
(#eq? @type "any")
```

## Validating Rules

After writing a rule, always validate it using the `validate-rule.mts` script before finishing. This catches query syntax errors and confirms the rule matches the intended patterns — and only those patterns.

```bash
node ban-ast/scripts/validate-rule.mts \
  --lang ts \
  --query '<your-tree-sitter-query>' \
  --should-match '<code that should be flagged>' \
  --should-not-match '<code that should be allowed>'
```

- `--lang` — file extension for the language (default: `ts`). Supported: `ts`, `js`, `tsx`, `py`, `rs`, `go`, `c`, `cpp`, `cs`, `java`, `rb`, and more.
- `--query` — the Tree Sitter S-expression query from the rule body.
- `--should-match` — a code snippet that **must** trigger the rule. Repeat for multiple cases.
- `--should-not-match` — a code snippet that **must not** trigger the rule. Repeat for multiple cases.

If no `--should-match` / `--should-not-match` flags are given, the script only checks that the query is syntactically valid.

The script exits with code `1` if any test fails, so you can see immediately when a rule needs to be revised.

### Example

```bash
node ban-ast/scripts/validate-rule.mts \
  --lang ts \
  --query '(call_expression function: (identifier) @fn (#eq? @fn "eval"))' \
  --should-match 'eval("code")' \
  --should-not-match 'foo("code")'
```

Expected output:

```
PASS [should-match]:     "eval(\"code\")"
PASS [should-not-match]: "foo(\"code\")"

2 test(s): 2 passed, 0 failed.
```

## Justification Override

If a banned pattern is strictly necessary, include a justification comment in the code to bypass the ban for that specific instance:

```typescript
// <no-eval> justification: required for dynamic plugin loading
const result = eval(expression);
```

The hook checks for `<rule-name> justification: <non-empty reason>` anywhere in the new code. If found, that rule is not enforced for that edit. The reason must be non-empty to ensure overrides are intentional and documented.
