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

Two possible backends:

- **`#memory` tool** (VS Code Chat) — stores under the virtual path `/memories/`
- **File system** (`~/.copilot/`) — used by Copilot CLI; also usable from VS Code Chat
  - `~/.copilot/github-inbox-memory.md`
  - `~/.copilot/github-inbox-rules.md`

### How to pick a backend (run ONCE per session, cache the choice)

1. Detect availability of `#memory`: try `{ "command": "view", "path": "/memories/github-inbox-memory.md" }`. If the tool itself errors as unavailable, `#memory` is NOT available.
2. Check for existing CLI memory: see if `~/.copilot/github-inbox-memory.md` or `~/.copilot/github-inbox-rules.md` exist and are non-empty (use `ls -la ~/.copilot/` or `#view`).
3. Decide:
   - If `#memory` is unavailable → use **file system** (`~/.copilot/`). No prompt.
   - If `#memory` is available AND `~/.copilot/` has NO existing inbox files → use **`#memory`**. No prompt.
   - If `#memory` is available AND `~/.copilot/` has existing inbox files → **ASK the user** with `#askQuestions` which backend to use. Show them what was found (file names + sizes or a one-line preview). Options:
     - "Use `~/.copilot/` (existing CLI memory)" — recommended when CLI files exist
     - "Use VS Code `#memory` (start fresh / keep VS Code-only)"
     - "Use VS Code `#memory` and import from `~/.copilot/`" — copy current CLI files into `#memory` once
4. Cache the chosen backend for the rest of the session and use it for ALL subsequent reads and writes. Do NOT mix backends within a session.

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