# review-plan

Review implementation plans before handing off to coding — fans out parallel subagents across completeness, feasibility, sequencing, scope, and risk.

## Skills

| Skill | Description |
|---|---|
| [review-plan](skills/review-plan/) | Review an implementation plan (e.g. from Plan agent) across completeness, feasibility, sequencing, scope, and risk |

## How It Works

1. **Scope** — find the plan in session memory or conversation context.
2. **Fan out** — launch 2–5 parallel subagents, each with a focused area prompt (completeness, feasibility, grounding, sequencing, scope, verification, risk).
3. **Synthesize** — deduplicate across areas, order by severity, apply a strict signal filter.
4. **Save** — persist findings to session memory for follow-up.
5. **Revise or report** — by default, fix the plan; stop at reporting if review-only.

## Hook

The `remind-plan-review` hook fires after a `plan.md` is written to session memory and reminds the agent to run the review-plan skill before proceeding.

## Plugin Structure

```text
review-plan/
├── .plugin/plugin.json
├── README.md
├── hooks/
│   ├── hooks.json
│   └── remind-plan-review.mts
└── skills/
    └── review-plan/
        └── SKILL.md
```
