# Changelog

## 1.2.2 (2026-09-22)

- Run the `manage-bans` Vally evaluations with GPT-6 Luna

## 1.2.1 (2026-09-22)

- Run the `manage-bans` Vally evaluations with GPT-6 Sol

## 1.2.0 (2026-09-22)

- Migrated the `manage-bans` evaluation suite from Waza to Vally with inline capability and trigger stimuli

## 1.1.1 (2026-08-12)

- Migrated the `manage-bans` evaluation suite to Waza 0.38.5 schema 1.2 with deterministic spec coverage and enforced trigger-accuracy measurement

## 1.1.0 (2026-04-14)

- Added eval infrastructure with trigger tests and task definitions for the `manage-bans` skill

## 1.0.0 (2026-03-24)

- Initial release
- PreToolUse hooks intercept file edits (`replace_string_in_file`, `multi_replace_string_in_file`, `apply_patch`, `create_file`) and reject banned patterns
- Ban rules defined via Tree Sitter AST queries in `BANNED_AST.md` files (directory-scoped) or `~/.BANNED_AST.md` (global)
- Multiple rules per file using frontmatter-delimited blocks with `name` and `message` fields
- Justification override via inline comments (`<rule-name> justification: <reason>`)
- `manage-bans` skill for creating and managing ban rules
