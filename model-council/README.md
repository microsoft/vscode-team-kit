# model-council

Multi-model council for code review and planning. Independent model-pinned agents inspect the same change set or plan the same task, then findings are synthesized by consensus — highlighting where models agree, where they disagree, and optionally running a debate to resolve contested findings.

## Skills

| Skill | Description |
|---|---|
| [council-review](skills/council-review/) | Orchestrate a multi-model council review: fan out to pinned reviewers, synthesize by consensus vs. contested findings, and optionally cross-review to resolve disagreements |
| [council-plan](skills/council-plan/) | Multi-model council planning: each agent independently proposes an implementation plan, then proposals are synthesized into a consensus plan with alternatives and risks |

## Agents

| Agent | Description |
|---|---|
| [Councillor-GPT](agents/councillor-gpt.agent.md) | Reviewer pinned to GPT models |
| [Councillor-Opus](agents/councillor-opus.agent.md) | Reviewer pinned to Claude Opus models |
| [Councillor-Gemini](agents/councillor-gemini.agent.md) | Reviewer pinned to Gemini models |

## How It Works

1. **Independent reviews** — each council agent receives the same scope and reviews in parallel without seeing each other's findings.
2. **Consensus synthesis** — findings are classified as *consensus* (multiple models agree), *single-reviewer* (one model, strong evidence), or *contested* (models disagree).
3. **Cross-review debate** (optional) — when contested findings exist or the user asks to "discuss" / "debate", the anonymized synthesis is shared back to each agent for a second-look deliberation round.

## Notes

- Each agent is designed for use as a council subagent. They are not directly invocable via `@` mentions — they are dispatched by the council-review and council-plan skills.
- Copilot model labels can change over time. The agents use ordered fallbacks, but you might want to tune the `model` arrays to match the names in your local model picker.

## Plugin Structure

```text
model-council/
├── .plugin/plugin.json
├── README.md
├── agents/
│   ├── councillor-gemini.agent.md
│   ├── councillor-gpt.agent.md
│   └── councillor-opus.agent.md
└── skills/
    ├── council-plan/
    │   └── SKILL.md
    └── council-review/
        └── SKILL.md
```