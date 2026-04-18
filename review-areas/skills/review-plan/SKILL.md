---
name: review-plan
description: "Review an implementation plan produced by the Plan agent. It is CRITICAL to review plans before handing off to implementation — plans often have gaps, incorrect assumptions, or suboptimal sequencing that are cheaper to catch now than after coding. Use when the user asks to 'review the plan', 'check my plan', 'is this plan ready', or after the Plan agent produces a plan.md."
---

# Skill: Review Plan

Your goal is to CRITICALLY review the given implementation plan. Provide thorough, constructive feedback that enhances the plan's quality and likelihood of successful execution and solving the stated goal.

Fan out parallel read-only subagents, each assigned a different plan-review area, then synthesize the highest-signal findings. Each subagent goes deep on one area, catching gaps a single pass misses.

## Review Areas

Pick 2–4 areas based on the plan's complexity and risk profile.

| Area | Focus |
|------|-------|
| **Completeness** | Missing requirements, unaddressed edge cases, gaps between the stated goal and proposed steps, unclear expected outcomes |
| **Grounding** | Technical soundness and factual accuracy — references to nonexistent or deprecated APIs, hallucinated functions, incorrect codebase assumptions, outdated versions. Use web search to validate uncertain claims. Suggest alternative approaches when the plan is fundamentally wrong |
| **Sequencing** | Dependency correctness between steps, parallelism opportunities missed, blocking-step identification, optimal ordering |
| **Scope** | Over-engineering, gold-plating, scope creep or under-specification, scope disproportionate to value delivered |
| **Verification** | Are verification steps specific, actionable, and covering the riskiest parts of the change? Missing test strategies |
| **Risk** | Unaddressed failure modes, migration risks, backward compatibility gaps, missing rollback strategy |

## Workflow

### 1 — Scope

- Look for a plan in session memory at `/memories/session/plan.md` first.
- If no session plan exists, check for a plan file the user points to, or a plan visible in the conversation context.
- If there is nothing to review, ask the user to run the Plan agent first or point at a plan file.

### 2 — Fan Out

Launch 2–4 parallel subagents using the area prompts below. Each subagent works in isolation — do not share one area's findings with another before synthesis.

Each gets a self-contained prompt with its area, the plan location, and the return format. Subagents read the full plan from session memory themselves. Subagents may surface findings their area doesn't explicitly list — don't constrain them to only the listed focus items.

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

Before reporting a finding, ask: *Does this change what a developer would actually do — or how likely the plan is to succeed?* Ground every finding in something observable: a file that doesn't exist, an API that behaves differently, a requirement the steps don't cover, a sequence that creates rework.

If a concern is speculative, cosmetic, or unrelated to the plan's goal, leave it out.

## Area Prompt

Each subagent gets this prompt with `{AREA}` and `{FOCUS}` filled in from the Review Areas table.

```text
You are a focused plan-review subagent. Your area is: {AREA}

## Where to find the plan
The plan is in session memory at `/memories/session/plan.md`. Read it with your memory tools first. Then explore the codebase to validate the plan's assumptions — check that referenced files, functions, and patterns actually exist.

Focus on: {FOCUS}

Use your tools to read the full plan, inspect the codebase, verify assumptions, and run existing tests or check lint/compile errors for evidence. Use web search to validate uncertain API or version claims.

Rules:
- Stay read-only. Do not edit files.
- Only flag issues that would change what a developer actually does or how likely the plan is to succeed.
- Do not report issues outside your area, but do surface unexpected findings within it.
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
