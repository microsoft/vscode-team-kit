# research

Deep research orchestrator — decomposes queries, fans out parallel subagents for web and code search, iteratively refines findings, then synthesizes citation-rich reports.

## Skills

| Skill | Description |
|---|---|
| [research](skills/research/) | Plan research, delegate search work to parallel subagents, evaluate and iterate, then synthesize a structured report with citations and confidence levels |

## Agents

| Agent | Description |
|---|---|
| [researcher](agents/researcher.agent.md) | Research subagent that searches web, GitHub repos, and local code — the workhorse dispatched by the research orchestrator |

## How It Works

1. **Classify** — identify query type (technical deep-dive, conceptual/explanatory, or general research) to determine scope and report structure.
2. **Decompose** — break the query into 3-7 focused research threads.
3. **Discovery** — fan out 3-5 parallel subagents for broad search across web and code sources.
4. **Evaluate & re-dispatch** — read findings, identify gaps and contradictions, dispatch targeted follow-ups. Repeat until quality gates pass (minimum 6 dispatches, key claims backed by 2+ sources).
5. **Cross-validate** — verify key claims across sources, assign confidence levels (High/Medium/Low).
6. **Synthesize** — produce a structured report with executive summary, analysis sections, citations, and confidence assessment.
7. **Save** — write the full report to session files and present a summary.

## When to Use

- Comprehensive topic exploration requiring multiple sources
- Technical architecture deep-dives across repos and documentation
- Market analysis, competitive research, or trend investigation
- Any question where a single search isn't enough — the skill iterates until the answer is thorough

## Comparison with rubber-duck and review-areas

| | research | rubber-duck | review-areas |
|---|---|---|---|
| Purpose | Investigate and synthesize knowledge | Critique work-in-progress | Review code changes |
| Input | A question or topic | Code, plans, designs | Diffs, PRs |
| Output | Citation-rich research report | Severity-categorized findings | Area-focused review findings |
| Best for | Learning, decision-making, exploration | Quick second opinion | Pre-merge code quality |

## Plugin Structure

```text
research/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
├── agents/
│   └── researcher.agent.md
└── skills/
    └── research/
        └── SKILL.md
```
