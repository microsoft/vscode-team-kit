# goal

Give the agent a durable objective with a verifiable stopping condition, then keep iterating across turns until that condition is met. Inspired by [Codex's `/goal` command](https://developers.openai.com/codex/use-cases/follow-goals).

## Requirements

Session storage must be available in the agent (e.g. the `memory` tool in VS Code, or equivalent). Goal state is stored as `goal.md` in session storage. Without it, the skill will refuse to start rather than write to the workspace.

## Skills

| Skill | Description |
|---|---|
| [goal](skills/goal/) | `/goal` entry point — dispatches set / status / pause / resume / clear to the follow-goal skill |
| [follow-goal](skills/follow-goal/) | Capture an objective + stop condition + validation + constraints, persist to session storage, and loop checkpoint-by-checkpoint until the stop condition is met |

## Usage

| Invocation | Action |
|---|---|
| `/goal <objective>` | Set a new goal and start the loop |
| `/goal` | Show current goal status and the last few progress-log entries |
| `/goal pause` | Pause the loop |
| `/goal resume` | Resume the loop from the latest checkpoint |
| `/goal clear` | Clear the goal (file is kept for history) |

## How It Works

1. **Capture** — the agent collects objective, verifiable stop condition, validation commands, and constraints. If any are missing or vague, it asks before saving.
2. **Persist** — goal state is stored as a single markdown file (`goal.md`) in session storage with status frontmatter and a progress log.
3. **Loop** — while `status: active`, the agent: re-reads the goal, runs validation, plans one small checkpoint, edits, re-validates, appends a progress-log entry, increments the checkpoint counter.
4. **Stop** — when the stop condition is met (`status: done`), when `max_checkpoints` is hit, when validation fails repeatedly, or when the user pauses / clears.

## Hook

`remind-goal-progress` fires after session storage writes to `goal.md` and injects a reminder about the loop discipline (run validation, log a checkpoint, respect the safety budget). This is what keeps the agent honest across turns — VS Code Copilot does not auto-continue between turns, so the hook re-anchors the loop whenever the goal state moves.

## Plugin Structure

```text
goal/
├── .plugin/plugin.json
├── README.md
├── CHANGELOG.md
├── hooks/
│   ├── hooks.json
│   └── remind-goal-progress.mts
└── skills/
    ├── goal/
    │   └── SKILL.md
    └── follow-goal/
        └── SKILL.md
```

## Differences from Codex `/goal`

Codex's `/goal` is a runtime feature that drives the model to keep working autonomously for hours. VS Code Copilot stops at end of turn, so this plugin emulates the same UX through three layers:

- **Commands** provide the `/goal …` entry points.
- **Skill** enforces the contract (objective + verifiable stop + validation + constraints) and the checkpoint discipline.
- **Hook** re-injects the loop reminder whenever the goal state changes, so the agent doesn't drift into freeform work.

The agent won't literally run for hours unattended, but a session that holds an active goal will keep returning to the same stop condition instead of being re-prompted from scratch each turn.
