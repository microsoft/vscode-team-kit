# Changelog

## 2.0.0 (2026-05-09)

- **Breaking:** Removed custom agent files (Councillor-GPT, Councillor-Opus, Councillor-Gemini) in favor of spawning subagents with the `model` parameter directly
- Skills now specify model names inline; no separate agent definitions needed
- Made skills runtime-agnostic: replaced tool-specific names (`runSubagent`, `readFile`) with generic descriptions
- Removed `(copilot)` suffix from model names; updated to GPT-5.5 and GPT-5.3-Codex
- Replaced VS Code Chat-specific session memory paths with portable "session folder" references; council-plan uses `exit_plan_mode` when available
- Reframed Phase 2 briefs as "preliminary orientation" — agents are explicitly expected to contradict the brief if their own research leads elsewhere
- Stripped risk assessments and pre-interpreted change descriptions from briefs; changed files now list locations only
- Added independent mandate to system preamble: "Form your own view from first principles. Do not anchor to the provided context."
- Added skepticism instruction to planner and reviewer prompts: trust your findings over the brief
- Fixed stale "risk areas" reference in council-review reviewer prompt template

## 1.2.0 (2026-04-15)

- Updated Councillor-Gemini to Gemini 3.1 Pro (Preview)

## 1.1.0 (2026-04-14)

- Added waza eval infrastructure for council-review and council-plan skills

## 1.0.0 (2026-04-01)

- Initial release
- Multi-model council review with consensus synthesis and optional cross-review debate
- Multi-model council planning with independent proposals and consensus plan
- Model-pinned agents: Councillor-GPT, Councillor-Opus, Councillor-Gemini
