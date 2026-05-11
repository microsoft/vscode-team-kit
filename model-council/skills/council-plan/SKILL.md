---
name: council-plan
description: "Multi-model council planning for implementation and architecture decisions. Use when the user asks to 'plan with council', 'multi-model plan', 'get different perspectives on approach', 'council plan', or wants multiple models to independently propose plans for the same task. Also use when the user asks to 'debate approaches', 'compare strategies', or 'cross-plan'."
---

# Skill: Plan Council

Multi-model planning powered by a council of model-pinned agents. Each agent independently researches the codebase and proposes an implementation plan for the same task. The orchestrator then synthesizes the proposals into a consensus plan — surfacing approaches the models agree on, alternatives where they diverge, and risks multiple models flagged independently.

This catches blind spots that a single-model plan misses: one model might notice a reusable pattern another overlooks, or flag an architectural risk the others didn't consider.

## Council Models

Spawn subagents with the `model` parameter to pin each to a different model. Use all three when available, at least two otherwise:

- `GPT-5.5`
- `Claude Opus 4.6`
- `GPT-5.3-Codex`

Each subagent receives the same system preamble:

> You are an independent subagent for read-only code research.
> MUST stay read-only. Stay within the requested scope.
> Do not speculate. Do not suggest patches.
> For every finding, cite exact files and lines.
> Form your own view from first principles. Do not anchor to the provided context.

## Workflow

### Phase 1 — Scope

Establish what needs to be planned:

- Gather the user's goal, constraints, and any relevant context (issue, PR description, conversation history).
- If the task is vague, ask the user to clarify scope before fanning out — council time is expensive.
- Run an Explore subagent to gather baseline codebase context: relevant files, existing patterns, analogous features. This context goes into the planner prompt so agents start informed.

### Phase 2 — Build a Planning Brief

Before fanning out, build a **preliminary orientation** that each agent will receive. This is a starting point, not ground truth — agents are expected to contradict it if their own research leads elsewhere.

The brief should include only:
1. **Goal** — what needs to be built or changed, and why.
2. **Constraints** — technical constraints explicitly stated by the user (not inferred).
3. **Codebase context** — file and directory paths discovered in Phase 1. No conclusions, no risk assessments — just locations.
4. **Open questions** — unresolved areas where the user has not stated a preference.

Keep the brief under ~50 lines. Do not answer the open questions — leave them open so agents form independent views. The agents will use search, read and terminal tools to dig into specifics.

### Phase 3 — Independent Planning

Spawn all subagents in parallel at once:
- One subagent per model using the `model` parameter. Prepend the system preamble to the planner prompt below.
- Do **not** share one agent's proposal with another before this phase completes.

### Phase 4 — Consensus Synthesis

Compare the three proposals and classify into:

1. **Consensus approach** — two or more agents independently propose the same approach, architecture, or sequencing. These form the backbone of the plan. High confidence.
2. **Alternatives** — agents propose different viable approaches for the same aspect. Present each with trade-offs and a recommendation. Let the user decide or pick the approach with the strongest rationale.
3. **Consensus risks** — risks or concerns flagged by two or more agents independently. These are high-confidence and should be addressed in the plan.
4. **Single-agent insights** — a useful idea only one agent surfaced. Keep if well-evidenced, note it came from one model.

Drop vague suggestions, over-engineering proposals, and speculative concerns.

### Phase 5 — Debate (optional)

Trigger this phase when the user asks to "debate", "discuss", or "cross-plan", or when Phase 4 produces significant alternatives that could benefit from deliberation.

1. Share the anonymized synthesis (without attributing which model said what) back to each council agent.
2. Ask each agent to evaluate the alternatives and state which approach they'd recommend, with evidence.
3. Spawn all subagents in parallel at once.
4. Update the synthesis: promote alternatives to consensus if deliberation resolves the split, or sharpen the trade-off description if it persists.

This deliberation step is lightweight — it only re-examines the synthesized plan, not the full codebase.

## Planner Prompt

Use this prompt shape for each council agent. Pass the planning brief from Phase 2.

```text
You are an independent planning agent. Research and propose an implementation plan for this task.

## Goal
<goal from Phase 2>

## Constraints
<constraints from Phase 2>

## Codebase context
<key files, patterns, analogous features from Phase 2>

## Open questions
<areas where you should propose an approach>

Use your tools to read relevant files, search for patterns, and check diagnostics. Do not rely solely on this brief — explore the codebase yourself to find reusable patterns, potential conflicts, and implementation details.

**The brief above is preliminary orientation, not ground truth.** If your own research contradicts the stated constraints, context, or framing, trust your findings over the brief and say so explicitly.

Return a structured plan:
1. **Approach** — your recommended implementation strategy in 2-3 sentences.
2. **Steps** — ordered implementation steps with file paths. Note dependencies between steps.
3. **Files to modify** — each file with a one-line description of what changes.
4. **Risks** — concrete risks or gotchas you found (not speculative concerns).
5. **Alternatives considered** — other approaches you evaluated and why you didn't recommend them.

Be specific. Reference exact functions, types, and patterns. Do not suggest code edits — describe what needs to change and why.
If the task is straightforward with one obvious approach, say so and keep the plan short.
```

## Debate Prompt

Use this prompt shape when running Phase 5:

```text
The following plan was synthesized from independent proposals by a council of planning agents:

<synthesized plan, without model attribution>

For each alternative or contested decision, state which approach you recommend and why. Cite files, patterns, or constraints as evidence.

Do not introduce entirely new approaches. Stay focused on the presented alternatives.
If you agree with the consensus, say so briefly and move on.
```

## Saving the Plan

After synthesis, persist the consensus plan so it is available for implementation, follow-up turns, and cross-referencing with reviews. Use whichever mechanism the runtime provides:

- If a plan-mode tool is available (e.g., `exit_plan_mode`), use it to present the plan for user approval.
- Otherwise, save the plan to session memory as `plan.md`.

## Output Shape

### After Phase 4 (standard planning)

**Goal** — one-sentence restatement of what's being planned.

**Consensus approach** — the implementation strategy the council agrees on. Structured as ordered steps with file paths and dependencies.

**Alternatives** (if any) — aspects where agents proposed different approaches. For each: the options, trade-offs, and a recommendation.

**Consensus risks** — risks flagged by multiple agents. Each with a mitigation suggestion.

**Single-agent insights** (if any) — useful ideas from one model, noted as lower confidence.

**Verification** — how to validate the implementation (specific tests, commands, checks).

### After Phase 5 (debate)

Same structure as above, but update based on deliberation:
- Alternatives that reached agreement move to Consensus approach.
- Sharpen trade-off descriptions for alternatives where the split persists.
- Note any risks that were upgraded or downgraded after debate.
