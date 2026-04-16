# review-areas

Area-focused code review that fans out parallel subagents — each examining a different review perspective (correctness, tests, security, performance, product) — then synthesizes only high-signal findings.

## Skills

| Skill | Description |
|---|---|
| [review-areas](skills/review-areas/) | Fan out area-specific subagents in parallel and merge findings by severity |
| [review-plan](skills/review-plan/) | Review an implementation plan (e.g. from Plan agent) across completeness, feasibility, sequencing, scope, and risk |

## How It Works

1. **Scope** — pick up the active PR, git diff, or explicit file list.
2. **Fan out** — launch 2–4 parallel subagents, each with a focused area prompt (correctness, tests, security, performance, product). No custom agents needed — each subagent gets a self-contained prompt.
3. **Synthesize** — deduplicate across areas, order by severity, apply a strict signal filter.
4. **Fix or report** — by default, fix well-defined issues immediately; stop at reporting if the user asks for review-only.

## Comparison with model-council

| | review-areas | model-council |
|---|---|---|
| Diversity source | Different **areas** (correctness, security, …) | Different **models** (GPT, Opus, Gemini) |
| Custom agents | None — uses unnamed subagents | Three model-pinned agents |
| Best for | Thorough single-model deep dives | Cross-model consensus and blind-spot detection |

Both plugins can be used together: run review-areas for area depth, then model-council for model diversity.

## Plugin Structure

```text
review-areas/
├── .plugin/plugin.json
├── README.md
└── skills/
    ├── review-areas/
    │   └── SKILL.md
    └── review-plan/
        └── SKILL.md
```
