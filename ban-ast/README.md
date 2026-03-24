# ban-ast

Ban code patterns using [Tree Sitter](https://tree-sitter.github.io/tree-sitter/) AST queries. When Copilot (or any agent) tries to make an edit that introduces a banned pattern, the preToolUse hook rejects it with a descriptive message — unless the edit includes an explicit justification comment.

## How It Works

1. You can ask the agent to define **ban rules** globally or for a folder/workspace — each one is a Tree Sitter query paired with a name and rejection message.
2. The preToolUse hook intercepts edit tools (`replace_string_in_file`, `multi_replace_string_in_file`, `apply_patch`, `create_file`).
3. It parses the new code with tree-sitter and runs every applicable ban query against it.
4. If a query matches and the code doesn't contain a `<rule-name> justification: <reason>` comment, the edit is rejected.

## Defining Ban Rules

Rules can come from two sources:

### 1. Global rules: `~/.BANNED_AST.md`

Place a `.BANNED_AST.md` in your home directory to define rules that apply globally to every edit. It uses the same multi-rule format as directory-scoped files:

```markdown
---
name: no-eval
message: "Do not use eval(). It is a security risk."
---

(call_expression
  function: (identifier) @fn
  (#eq? @fn "eval"))
```

### 2. Directory-scoped rules: `BANNED_AST.md`

Place a `BANNED_AST.md` anywhere in your project tree. The hook walks up from each edited file's location, collecting rules from every `BANNED_AST.md` it encounters. This lets you scope bans to specific subtrees (e.g. stricter rules in `src/` but not `test/`).

A single `BANNED_AST.md` can contain **multiple rules**, each with its own frontmatter block:

```markdown
---
name: no-console-log
message: "Use a structured logger instead of console.log()."
---

(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @prop)
  (#eq? @obj "console")
  (#eq? @prop "log"))

---
name: no-any-type
message: "Use 'unknown' or a concrete type instead of 'any'."
---

(predefined_type) @type
(#eq? @type "any")
```

### Rule format

Each rule requires two frontmatter fields:

| Field     | Description |
|-----------|-------------|
| `name`    | Unique identifier (lowercase, hyphens ok). Used in justification comments. |
| `message` | Shown when the edit is rejected. Should explain *why* and suggest alternatives. |

The body is a [Tree Sitter query](https://tree-sitter.github.io/tree-sitter/using-parsers/queries) using S-expression syntax.

## Justification Override

If a banned pattern is strictly necessary, the agent can include a comment in the code:

```typescript
// <no-eval> justification: required for dynamic plugin loading
const result = eval(expression);
```

The hook checks for `<rule-name> justification: <non-empty reason>` anywhere in the new code. If found, that rule is not enforced for that edit.
