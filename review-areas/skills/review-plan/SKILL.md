---
name: review-plan
description: "Review an implementation plan produced by the Plan agent. It is CRITICAL to review plans before handing off to implementation — plans often have gaps, incorrect assumptions, or suboptimal sequencing that are cheaper to catch now than after coding. Use when the user asks to 'review the plan', 'check my plan', 'is this plan ready', or after the Plan agent produces a plan.md."
---

# Skill: Review Plan

Fan out parallel read-only subagents, each assigned a different plan-review area, then synthesize the highest-signal findings. This catches gaps that a single read-through misses because each subagent goes deep on its area — one checks feasibility against the actual codebase while another stress-tests sequencing.

## Review Areas

Pick 2–4 areas based on the plan's complexity. Not every review needs all areas — match the areas to the risk profile.

| Area | When to include | Focus |
|------|----------------|-------|
| **Completeness** | Always | Missing requirements, unaddressed edge cases, gaps between the stated goal and proposed steps, unclear expected outcomes |
| **Feasibility** | Always | Technical soundness of proposed changes, references to nonexistent APIs or patterns, incorrect assumptions about the codebase |
| **Grounding** | Always | References to deprecated or renamed APIs, outdated library versions, hallucinated functions or parameters, patterns from training data that don't match the actual codebase or current docs |
| **Sequencing** | Plans with 3+ steps | Dependency correctness between steps, parallelism opportunities missed, blocking-step identification, optimal ordering |
| **Scope** | Always | Over-engineering, unnecessary refactors, gold-plating, scope creep beyond stated goal, or under-specification that will cause ambiguity during implementation |
| **Verification** | Plans with verification steps | Are verification steps specific and actionable? Do they cover the riskiest parts of the change? Missing test strategies |
| **Risk** | Plans touching auth, data, APIs, or infra | Unaddressed failure modes, migration risks, backward compatibility gaps, missing rollback strategy |

## Workflow

### 1 — Scope

- Look for a plan in session memory at `/memories/session/plan.md` first.
- If no session plan exists, check for a plan file the user points to, or a plan visible in the conversation context.
- If there is nothing to review, ask the user to run the Plan agent first or point at a plan file.

### 2 — Fan Out

Launch 2–4 parallel subagents using the area prompts below. Each subagent works in isolation — do not share one area's findings with another before synthesis.

Each gets a self-contained prompt with its area, the plan location, and the return format. Subagents read the full plan from session memory themselves.

### 3 — Synthesize

When all subagents return:

1. Deduplicate findings that overlap across areas (e.g., a feasibility gap that also shows up as a sequencing problem).
2. Order by severity: missing requirements > incorrect assumptions > sequencing errors > scope issues > weak verification > minor risks.
3. Apply the signal filter — drop anything that wouldn't actually cause problems during implementation.
4. If no blocking issues survive, say so and note any areas where the plan could be strengthened.

### 4 — Save Findings

Always save the synthesized findings to session memory at `/memories/session/plan-review.md`. This makes them available for follow-up turns, plan revision, and cross-referencing during implementation.

### 5 — Revise or Report

- **Review-only**: if the user said "only review", "just review", or "read-only", stop after reporting.
- **Default (review-and-revise)**:
  1. For each actionable finding, propose a specific revision to the plan — what to add, remove, reorder, or clarify.
  2. Apply revisions to the plan in session memory (`/memories/session/plan.md`), preserving the plan's existing structure.
  3. After revising, re-read the updated plan to confirm the revisions are coherent.
  4. Report what was revised and any remaining items that need the user's input or a decision.

## Signal Filter

Keep only findings that would cause real problems during implementation:
- A step depends on something that doesn't exist in the codebase
- A requirement from the goal is missing from the steps
- Steps are ordered in a way that creates unnecessary blocking or rework
- The scope clearly exceeds or falls short of the stated goal
- Verification steps wouldn't actually catch the riskiest changes

Drop: stylistic preferences about plan formatting, speculative concerns without evidence, suggestions to add more steps "just in case", pre-existing codebase problems unrelated to the plan.

## Area Prompt

Each subagent gets this prompt with `{AREA}` and `{FOCUS}` filled in from the Review Areas table.

```text
You are a focused plan-review subagent. Your area is: {AREA}

## Where to find the plan
The plan is in session memory at `/memories/session/plan.md`. Read it with your memory tools first. Then explore the codebase to validate the plan's assumptions — check that referenced files, functions, and patterns actually exist.

Focus on: {FOCUS}

Use your tools to read the full plan, inspect the codebase, and verify assumptions. Trace the plan's references through the codebase.

Rules:
- Stay read-only. Do not edit files.
- Only flag issues that would cause real problems during implementation — gaps, wrong assumptions, broken dependencies, or scope mismatches.
- Do not report issues outside your area.
- Do not rewrite the plan — describe the problem and why it matters.
- Keep your response short. No preamble, no formatting commentary.

Return format:

**Area**: {AREA}

**Findings** (0–5 items, severity order):
- One-sentence description. Why it matters. Evidence from the codebase if applicable.

If the plan is sound for your area: "No issues found in {AREA}."
```

## Output Shape

**Plan Summary** (50 words max):
What the plan proposes and its expected outcome.

**What's Solid** (1–3 items):
Acknowledge strong aspects of the plan worth preserving during revision.

**Critical Issues** (0–5 items, severity order):
Each with the area that surfaced it and a proposed revision.

**Suggestions** (0–5 items):
Improvements that didn't reach "blocking" but would strengthen the plan.

**Verdict**: Ready / Needs Revisions / Rethink Needed — with a specific next step.
