---
name: inbox-memory
description: Read and write agent storage — memory and rules with environment-aware fallback
tools:
  - memory
  - execute
  - bash
  - read
  - view
  - edit
---

# Inbox Memory

This skill reads and writes persistent memory and rules files for the Inbox agent. It abstracts storage so all agents use a single skill instead of calling `#memory` directly.

## File names

- **Memory**: `github-inbox-memory.md` — session context, patterns, preferences
- **Rules**: `github-inbox-rules.md` — user's rules and preferences

## Storage strategy

Try the `#memory` tool first (available in VS Code Chat). If `#memory` is **not available** (e.g. Copilot CLI), fall back to the file system under `~/.copilot/`:

- `~/.copilot/github-inbox-memory.md`
- `~/.copilot/github-inbox-rules.md`

### How to detect which backend to use

1. Attempt `#memory` with `{ "command": "view", "path": "/memories/github-inbox-memory.md" }`.
2. If it succeeds or returns "file not found" — `#memory` is available. Use it for all reads and writes.
3. If the tool itself is unavailable (tool not found / not supported error) — switch to the file-system fallback for the rest of the session.

## Reading

**Via `#memory`:**
```
{ "command": "view", "path": "/memories/github-inbox-memory.md" }
{ "command": "view", "path": "/memories/github-inbox-rules.md" }
```

**Via file system (fallback):**
Read `~/.copilot/github-inbox-memory.md` or `~/.copilot/github-inbox-rules.md` using `#read` (VS Code) or `#view` (CLI). If the file doesn't exist, treat as empty / first-time user.

## Writing

**Via `#memory`:**
```
{ "command": "delete", "path": "/memories/github-inbox-memory.md" }
{ "command": "create", "path": "/memories/github-inbox-memory.md", "file_text": "<content>" }
```
If the file doesn't exist yet, skip the `delete` and just use `create`.

**Via file system (fallback):**
1. Ensure `~/.copilot/` exists: `mkdir -p ~/.copilot`
2. Write the file using `#edit` or via terminal: write full content to `~/.copilot/github-inbox-memory.md`.

## Rules

- Always read before writing to avoid losing existing content
- Memory and rules are separate files — don't mix them
- Keep memory **under 100 lines** — deduplicate, keep last 5 session logs, be concise
- NEVER use repo memory (`/memories/repo/`) — only the files listed above