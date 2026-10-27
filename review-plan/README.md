# review-plan

Review implementation plans before handing off to coding — fans out parallel subagents across completeness, feasibility, sequencing, scope, and risk.

## Skills

| Skill | Description |
|---|---|
| [review-plan](skills/review-plan/) | Review an implementation plan (e.g. from Plan agent) across completeness, feasibility, sequencing, scope, and risk |

## How It Works

1. **Scope** — find the session folder's `plan.md` or use the plan supplied in conversation.
2. **Fan out** — launch 2–5 parallel subagents, each with a focused area prompt (completeness, feasibility, grounding, sequencing, scope, verification, risk).
3. **Synthesize** — deduplicate across areas, order by severity, apply a strict signal filter.
4. **Save** — write review findings to a file in the session folder for follow-up.
5. **Revise or report** — by default, fix the plan; stop at reporting if review-only.

## Hook

The native Copilot `postToolUse` hook watches `create`, `edit`, and `apply_patch`. When they change a file named `plan.md`, it reminds the agent to run the review-plan skill before proceeding. It reads `toolName` and `toolArgs`, not memory-tool operations.

## Plugin Structure

```text
review-plan/
├── plugin.json
├── README.md
├── com.github.copilot/
│   └── hooks/
│       └── hooks.json
├── hooks/
│   └── remind-plan-review.mts
└── skills/
    └── review-plan/
        └── SKILL.md
```
