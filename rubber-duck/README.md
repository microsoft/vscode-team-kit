# rubber-duck

Constructive devil's advocate that critically reviews proposals, designs, implementations, or tests — identifies weak points and suggests substantive improvements that genuinely matter.

## Skills

| Skill | Description |
|---|---|
| [rubber-duck](skills/rubber-duck/) | Launch a critic subagent on a complementary model to critique work-in-progress with actionable, severity-categorized feedback |

## How It Works

1. **Scope** — pick up the work to review from conversation context, session memory, or the codebase.
2. **Model select** — pick a complementary, higher-order model for the subagent (e.g. Sonnet session → Opus critic, Opus session → GPT 5.5 critic).
3. **Invoke** — launch a general-purpose subagent with the critic prompt.
4. **Report** — present findings categorized as Blocking, Non-Blocking, or Suggestion.
5. **Save** — persist findings to session memory for follow-up.
6. **Act** — by default, propose or apply fixes; stop at reporting if review-only.

## When to Use

- After planning but before implementing — catch bad assumptions early.
- After a first implementation pass — get a second opinion before review.
- On any non-trivial proposal, design doc, or test strategy.
- When you want a quick, opinionated critique without a full multi-subagent review.

## Comparison with review-areas and review-plan

| | rubber-duck | review-areas | review-plan |
|---|---|---|---|
| Approach | Single-agent critic | Multi-subagent fan-out | Multi-subagent fan-out |
| Scope | Anything (proposals, designs, code, tests) | Code changes (diffs, PRs) | Implementation plans |
| Best for | Quick second opinion, early feedback | Thorough area-focused code review | Plan validation before coding |

## Plugin Structure

```text
rubber-duck/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
└── skills/
    └── rubber-duck/
        └── SKILL.md
```
