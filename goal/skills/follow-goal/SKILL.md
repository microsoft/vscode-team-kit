---
name: follow-goal
description: "Give the agent a durable objective with a verifiable stopping condition, then keep iterating across turns until that condition is met. Use when the user says 'set a goal', 'follow a goal', '/goal …', 'keep working until …', or asks for a long-running task with a clear end state (migrations, large refactors, retry-until-green loops, experiments)."
user-invocable: false
---
<!-- Inspired by Codex's `/goal` command. -->

# Skill: Follow Goal

Run a long, durable objective across many turns toward a verifiable stop condition — instead of stopping after one normal exchange.

> **Requires session storage.** Goal state lives in session storage as `goal.md` and is marked a artifact. Do not fall back to writing `goal.md` into the workspace.

A goal has four parts. Capture all four before starting work:

1. **Objective** — what to achieve, in one sentence.
2. **Stop condition** — an observable, verifiable signal that "done" has been reached (a command exits 0, a file matches a spec, tests pass, parity check passes, etc.).
3. **Validation** — the concrete commands or artifacts that prove progress (test command, build command, lint, diff against reference, review or rubber duck skills).
4. **Constraints** — what NOT to change, scope boundaries, files/areas off-limits.

If any of these are missing or vague, ask the user before saving the goal. A goal without a verifiable stop condition is not a goal — it's a wish.

## State

The goal lives in session storage as `goal.md` — a single markdown file with this shape:

```markdown
---
status: active        # active | paused | done | cleared
created: 2026-05-16
checkpoints: 0
max_checkpoints: 20   # hard safety budget
---

# Objective
<one sentence>

# Stop Condition
<verifiable end state>

# Validation
- `<command or check>`
- ...

# Constraints
- <what not to change>

# Progress Log
<append a one-line checkpoint after each validation pass>
```

`max_checkpoints` is a safety budget. The agent MUST stop and report when it reaches this number even if the stop condition is not met, and ask the user how to proceed.

## Sub-commands

The `goal` skill dispatches to this skill. Behavior depends on the argument:

| Invocation | Action |
|---|---|
| `/goal <objective>` | **Set.** Capture the four parts above (asking the user for anything missing), write `goal.md` with `status: active`, then start the loop. |
| `/goal` (no args) | **Status.** Read `goal.md` and report objective, stop condition, status, checkpoint count, and the last few progress log lines. Do not take any other action. |
| `/goal pause` | Set `status: paused`. Do not iterate. Tell the user how to resume. |
| `/goal resume` | Set `status: active`. Re-read the goal and continue the loop from the latest checkpoint. |
| `/goal clear` | Set `status: cleared` and stop. Leave the file in place so the user can inspect history; do not delete it. |

## The Loop

When `status: active`, on every turn while there is work to do:

1. **Read** `goal.md` (objective, stop condition, validation, progress log).
2. **Check stop condition.** Run the validation commands. If the stop condition is met → set `status: done`, append a final checkpoint, report success, exit the loop.
3. **Plan one checkpoint of work** — the next small, scoped step that moves toward the stop condition. Keep checkpoints small enough that validation runs between each.
4. **Do the work** (edits, commands).
5. **Validate** — run the validation commands.
6. **Append a one-line entry to the progress log** in `goal.md` with what was done and the validation result.
7. **Increment `checkpoints`** in the frontmatter.
8. If `checkpoints >= max_checkpoints` → pause, report, ask the user how to proceed.
9. If status was changed externally to `paused` or `cleared` → stop. Otherwise continue the loop.

The progress log entries should be short and machine-skimmable, e.g.:
```
- 2026-05-16 14:02 — Migrated `auth/` to new API. Tests: 184/184 pass.
- 2026-05-16 14:09 — Migrated `billing/`. Tests: 184/184 pass. Lint clean.
```

## Discipline

- **Never** continue past a failed validation without diagnosing the failure first. A failed validation is a checkpoint event — log it, fix the cause, then re-validate.
- **Never** silently expand scope. If the work requires touching something in `Constraints`, pause and surface it.
- **Never** invent a stop condition. If the user can't articulate one, the goal is not ready — push back.
- Keep the progress log truthful. Do not log "tests pass" without running them.
- One active goal at a time. If the user sets a new goal while one is active, ask whether to replace, pause, or clear the existing one first.

## When to use vs. when not to

Use a goal when:
- The work has a clear, verifiable end state (a test suite green, a migration complete, a build artifact matches a spec).
- The work is too big for one turn but small enough that progress is measurable.
- The user wants to step away while the agent iterates.

Do not use a goal for:
- A loose grab-bag of unrelated tasks. Use a todo list instead.
- Work where "done" is subjective (design polish, prose). Use normal review skills instead.
- Anything destructive without rollback (production deploys, force pushes). The loop is not for irreversible operations.
