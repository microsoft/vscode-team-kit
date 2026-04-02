---
name: council-review
description: "Multi-model council review for diffs, pull requests, and risky changes. It is CRITICAL to use this skill after ANY non-trivial development phase — changes are usually not 100% correct. Development CANNOT be called done until the code has been reviewed. Use whenever the user asks for a review, PR feedback, a bug hunt in recent edits, or wants multiple models to inspect the same change independently. Also use when the user asks to 'discuss findings', 'cross-review', or 'debate' review results between models."
---

# Skill: Review Council

Read-only review powered by a council of model-pinned reviewers. Changes are usually not 100% correct — this skill exists to catch what slipped through. The goal is not broad commentary; it is a short list of concrete issues where the council agrees, plus transparent disclosure of where they disagree.

## Council Agents

Fan out to these reviewers. Use all three when available, at least two otherwise:

- `model-council:Councillor-GPT`
- `model-council:Councillor-Opus`
- `model-council:Councillor-Gemini`

## Workflow

### Phase 1 — Scope

- Prefer the active pull request, current git diff, or an explicit file list from the user.
- If there is nothing to review, ask the user to point at a branch, PR, diff, or file set.

### Phase 2 — Build a Change Summary

Before fanning out, build a concise change summary that each reviewer will receive. Do **not** paste the raw diff into the reviewer prompts — the reviewers have tools to read files and inspect changes themselves.

The summary should include:
1. **Intent** — what the change is trying to accomplish (from PR description, commit messages, or conversation context).
2. **Changed files** — list each file path with a one-line description of what changed in it (e.g., "added validation for user input", "refactored fetch logic into helper").
3. **Risk areas** — note anything that looks risky: new dependencies, auth changes, hot-path modifications, API surface changes.
4. **How to inspect** — tell the reviewers the branch/PR/commit info so they can use their tools to read the actual code.

Keep the summary under ~50 lines. The reviewers will use `readFile`, `search`, `problems`, and `runTests` to dig into the specifics — that's the point. They get better results reading code in context than scanning a wall of diff.

### Phase 3 — Independent First-Pass Reviews

- Give each council agent the same scope using the reviewer prompt below.
- Run them in parallel.
- Do **not** show one reviewer's findings to another before this phase completes.

### Phase 4 — Consensus Synthesis

Classify every finding into one of three buckets:

1. **Consensus** — two or more reviewers independently flag the same underlying issue. These are high-confidence findings.
2. **Single-reviewer, strongly evidenced** — only one reviewer flags it, but the evidence is concrete (compile error, failing test, clear correctness bug, security vulnerability, measurable regression). Keep these with a note that only one model flagged them.
3. **Contested or speculative** — a finding one reviewer flags that another reviewer's analysis implicitly or explicitly contradicts. Mention these briefly under "Contested" so the user can decide, but do not present them as confirmed issues.

Drop style chatter, linter-catchable nits, and low-confidence speculation entirely.

### Phase 5 — Cross-Review (optional)

Trigger this phase when the user asks to "discuss", "debate", or "cross-review" the findings, or when Phase 4 produces contested findings that could benefit from a second look.

1. Share the anonymized synthesis (without attributing which model said what) back to each council agent.
2. Ask each agent: _"Review these findings. For each, state whether you agree, disagree, or want to add nuance. Cite evidence."_
3. Run the agents in parallel again.
4. Update the synthesis: promote contested findings to consensus if the cross-review resolves the disagreement, or note the persisting split.

This deliberation step is lightweight — it only re-examines the synthesized findings, not the full codebase.

## Reviewer Prompt

Use this prompt shape for each council agent. Pass the change summary from Phase 2 — never paste raw diffs.

```text
Review this change set in read-only mode.

## What changed
<change summary from Phase 2: intent, changed files with one-line descriptions, risk areas>

## How to inspect
<branch, PR number, or commit range the reviewer can use with their tools>

Use your tools to read the changed files, check diagnostics, and run focused tests. Do not rely solely on this summary — dig into the code yourself.

Return only high-signal findings that would block approval or clearly require follow-up.
Focus on correctness, regressions, security, missing tests for risky behavior changes, and concrete performance problems.
Do not suggest code edits.
Do not report style issues or speculative concerns.
Cite exact files and lines for every finding.
If you do not find a blocking issue, say "No blocking issues found."
```

## Cross-Review Prompt

Use this prompt shape when running Phase 5:

```text
The following findings were produced by a council of independent reviewers for this change set:

<synthesized findings, without model attribution>

For each finding, state whether you:
- AGREE (the issue is real and correctly described)
- DISAGREE (explain why with evidence)
- NUANCE (the issue is partially correct but needs clarification)

Do not introduce new findings. Stay read-only. Cite files and lines.
```

## Saving Findings

After synthesis, always save the findings to session memory at `/memories/session/review.md`. This makes them available for follow-up turns, fix planning, and cross-referencing with future reviews.

## Default Behavior: Review → Fix

By default, this skill is biased towards **addressing** the issues it finds, not just reporting them. The review is the means, not the end.

After synthesis, determine the mode:

- **Review-only mode** — the user said "only review", "just review", "don't change anything", "read-only", or similar. Stop after the output shape below. Do not edit files.
- **Review-and-fix mode** (default) — plan and apply fixes for consensus and single-reviewer findings after presenting them.

When in review-and-fix mode:
1. Present the findings first (same output shape as below) so the user sees what was found.
2. For each fixable finding, launch one or more parallel `Explore` subagents to investigate the fix.
3. Apply the fixes in severity order.
4. Skip contested findings — those need the user's judgment.
5. After applying fixes, run a lightweight re-review (read the changed lines, check diagnostics) to validate.
6. Report what was fixed and any remaining items that need the user's input.

This keeps the feedback loop tight: review surfaces the problems, Explore agents plan the fixes, then the same turn resolves them.

## Output Shape

### After Phase 4 (standard review)

**Consensus findings** — issues independently identified by multiple reviewers, ordered by severity. Each with a concise explanation and file references.

**Single-reviewer findings** — high-evidence issues flagged by only one model. Note which model flagged it.

**Contested** (if any) — briefly list findings where reviewers disagreed, with a one-line summary of the disagreement. Suggest running a cross-review if the user wants resolution.

**Summary** — one short paragraph. If no blocking issues survive synthesis, say so explicitly and mention any meaningful testing gaps.

### After Phase 5 (cross-review)

Same structure as above, but update the buckets based on the deliberation:
- Contested findings that reached agreement move to Consensus or get dropped.
- Note any findings where the split persists after deliberation.