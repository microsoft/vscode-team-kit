---
name: inbox-storage
description: Read and write agent storage — memory and rules using the built-in memory tool
tools:
  - memory
---

# Agent Memory and Rules

This skill reads and writes memory and rules files for the Inbox agent using the built-in `#memory` tool. Files are stored under `/memories/` and persist across conversations.

## File locations

- **Memory**: `/memories/github-inbox-memory.md` — session context, patterns, preferences
- **Rules**: `/memories/github-inbox-rules.md` — user's rules and preferences

## Reading files

Call `#memory` with `{ "command": "view", "path": "/memories/github-inbox-memory.md" }` or `{ "command": "view", "path": "/memories/github-inbox-rules.md" }`.

If the file doesn't exist, the tool returns an error — start fresh.

## Writing files

To write (full replace): first call `#memory` with `{ "command": "delete", "path": "/memories/github-inbox-memory.md" }`, then `{ "command": "create", "path": "/memories/github-inbox-memory.md", "file_text": "<full content>" }`.

If the file doesn't exist yet, skip the `delete` and just use `create`.

For incremental edits, use `str_replace`: `{ "command": "str_replace", "path": "/memories/github-inbox-memory.md", "old_str": "<exact text>", "new_str": "<new text>" }`.

## Rules

- Always read before writing to avoid losing existing content
- Memory and rules are separate files — don't mix them
- Use ONLY `#memory` for reading and writing — NEVER use terminal commands (`cat`, `tee`, `echo`, etc.) or VS Code file tools (`readFile`, `editFile`, `createFile`)
