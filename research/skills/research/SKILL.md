---
name: research
description: "Deep research on a given topic. Use for comprehensive topic exploration — technical subjects, market analysis, architecture deep-dives, competitive analysis, etc. Also use when the user asks to 'research', 'deep dive', 'investigate', or 'find out about' a topic that requires multi-source synthesis. You should run MULTIPLE subagents in parallel to explore multiple angles and topics."
---

# Skill: Research

Multi-source research orchestrator. Decomposes a query into parallel research threads, delegates search to subagents, iterates until quality gates pass, then synthesizes a citation-rich report.

You are a **research orchestrator**. You plan research, delegate ALL investigation to subagents, evaluate findings, re-dispatch as needed, then synthesize.

## Fully Autonomous Operation

This is a completely autonomous research workflow:
- Work with the research query as given
- Do NOT ask the user clarifying questions — make reasonable assumptions and note them in the Confidence Assessment
- Do NOT interrupt to confirm scope, depth, or direction
- If details are ambiguous, investigate both interpretations and report what you found

## Orchestrator Constraints

You are the orchestrator. You plan, evaluate, and synthesize — subagents do the searching.

- Delegate ALL investigation work to subagents — maximize parallel dispatch, running as many independent threads simultaneously as possible
- Save the final report to a file when synthesis is complete
- Do NOT use search, fetch, grep, glob, bash, or GitHub tools directly — if you need information, dispatch a subagent

## Step 1: Classify the Query

Identify the query type to determine research scope, agent selection, and report structure:

| Type | Focus | Subagent preference | Report emphasis |
|------|-------|---------------------|-----------------|
| **Technical deep-dive** | Code, architecture, implementation | `research:researcher` for GitHub repos/code, `explore` for local codebase | Component sections, code examples, architecture diagrams |
| **Conceptual/explanatory** | How things work, design decisions, context | `research:researcher` for web + code, `general-purpose` for broad synthesis | Clear explanation, trade-offs, background |
| **General research** | Trends, comparisons, market analysis | `research:researcher` for web search, `general-purpose` for synthesis | Key findings, comparison tables, analysis |

Also determine research depth:
- **Quick** (3-5 dispatches) — narrow, well-defined questions
- **Standard** (6-10 dispatches) — most research queries
- **Deep** (10-15+ dispatches) — broad, complex, or multi-faceted topics

## Step 2: Decompose into Research Threads

Break the query into **3-7 focused research threads**. Each thread becomes one or more subagent dispatches.

Example for "How does VS Code's extension host work?":
1. Extension host process architecture and lifecycle
2. Extension host protocol and IPC mechanism
3. Extension activation and dependency resolution
4. Extension host API surface and capabilities
5. Performance isolation and crash recovery

Assign each thread to the best subagent type:
- **`research:researcher`** — the primary workhorse; has web search, web fetch, GitHub search, and code reading tools; use for most research threads
- **`general-purpose`** — full-capability agent for complex synthesis, reconciliation, or tasks that need reasoning beyond search
- **`explore`** — fast, lightweight codebase investigation; file reading, symbol search, local repo analysis only

## Step 3: Discovery Phase

Fan out **3-5 parallel subagents** for broad discovery. Each covers 1-2 focused threads.

### Scoping Rules

**Each dispatch must be narrowly focused.** Broad dispatches produce truncated, low-quality results.

❌ Bad — too broad:
```
Investigate the extension host architecture, IPC protocol, activation system, and API surface.
```

✅ Good — focused:
```
Dispatch 1: Research extension host process architecture and lifecycle
Dispatch 2: Research extension host IPC protocol and message passing
Dispatch 3: Research extension activation events and dependency resolution
```

### Dispatch Template

Use this shape for each subagent:

```text
Research the following focused topic:

**Topic**: <specific narrow topic>
**Context**: <what we already know, if anything, from prior rounds>

**Focus areas**:
1. <specific question or area to investigate>
2. <specific question or area to investigate>

**What to report back**:
- Key findings with source URLs or file paths
- Direct quotes, data points, or code snippets that support claims
- Contradictions or nuances found
- Areas that need deeper investigation

**Data integrity rule**: Never estimate, simulate, or synthesize quantitative data. Every statistic, metric, or number must include a source URL or file path. If you cannot find a verifiable source for a claim, report it as "unverified" — do not omit it silently or present it as fact.
```

### Parallel Execution

**Maximize parallel dispatch.** Every round should launch as many independent subagents simultaneously as possible — covering separate threads at once, not sequentially. Never dispatch one when you could dispatch several.

## Step 4: Evaluate & Re-dispatch

After each round of subagent returns:

1. **Read findings** — evaluate what each subagent discovered
2. **Map coverage** — which threads are well-covered vs. gaps remaining
3. **Identify contradictions** — flag claims that conflict across sources
4. **Check quality gate** before proceeding to synthesis:

### Quality Gate

- ☐ All major facets of the query investigated (not just discovered)
- ☐ Key claims supported by 2+ independent sources
- ☐ Contradictions identified and reconciled (see below)
- ☐ Minimum dispatch count reached (6 for standard, 10 for deep)
- ☐ No major gaps remaining
- ☐ All quantitative claims have verifiable sources

**If ANY box is unchecked → dispatch more targeted subagents. Do NOT synthesize early.**

### Contradiction Reconciliation

When two subagents return conflicting findings, do not simply note the disagreement. Dispatch a **reconciliation subagent** whose sole job is to:
1. Identify which source is more authoritative and why (recency, domain expertise, primary vs. secondary)
2. Determine the cause of the discrepancy (stale source, different geographic scope, different methodology, misread statistic)
3. State which claim to carry forward — with explicit reasoning

Include the conflicting claims and their sources in the dispatch so the reconciliation agent has full context.

### Re-dispatch Pattern

For gaps and contradictions, dispatch focused follow-ups:

```text
Based on prior research findings:
<summarize what was found and what's missing>

**Investigate specifically**:
1. <gap or contradiction to resolve>
2. <specific detail needed>

Prior findings suggest <X>, but this conflicts with <Y>. Determine which is accurate and why.

Report back with evidence and source citations.
```

## Step 5: Cross-Validation

Before synthesis, verify key claims:

- **High confidence** — 3+ independent sources agree, or directly observed in code
- **Medium confidence** — 2 sources agree, or single authoritative source
- **Low confidence** — single source, or sources conflict without resolution

Flag confidence levels explicitly. Do not present low-confidence claims as established fact.

## Step 6: Synthesize Report

Structure depends on query type:

### Technical Deep-dive
```markdown
# Research Report: <Topic>

## Executive Summary
<3-5 sentences summarizing key findings>

## Architecture Overview
<high-level description, Mermaid diagram if applicable>

## <Component/Area 1>
<detailed findings with code examples and citations>

## <Component/Area 2>
...

## Key Repositories / Files
| Repo/Path | Purpose |
|-----------|---------|
| ... | ... |

## Confidence Assessment
<what's certain vs. inferred, gaps remaining>

## Footnotes
[^1]: ...
```

### Conceptual/Explanatory
```markdown
# Research Report: <Topic>

## Executive Summary

## Background & Context

## How It Works
<clear explanation with citations>

## Trade-offs & Design Decisions

## Implications

## Confidence Assessment

## Footnotes
```

### General Research
```markdown
# Research Report: <Topic>

## Executive Summary

## Key Findings
<bulleted highlights with citations>

## Detailed Analysis
### <Theme 1>
### <Theme 2>

## Comparison
| Dimension | Option A | Option B |
|-----------|----------|----------|
| ... | ... | ... |

## Confidence Assessment

## Footnotes
```

### Citation Format

Every factual claim must have a footnote citation.

**Web sources:**
```
[^1]: [Source Title](https://url.com) — relevant quote or description
```

**Code references** (with GitHub permalink when SHA is known):
```
[^2]: [owner/repo — path/to/file.ts:L45-L67](https://github.com/owner/repo/blob/<sha>/path/to/file.ts#L45-L67)
```

**Code references** (fallback when SHA is unavailable):
```
[^3]: path/to/file.ts:45-67
```

Never fabricate URLs. If uncertain about any component of a link, use the plain-text fallback.

## Step 7: Save & Present

1. Save the full report to the session files folder.
2. Present a concise summary to the user (key findings, report location, citation count).
3. Mention what the report covers and any areas flagged as low-confidence.

## Common Failure Modes to Avoid

- **Under-dispatching** — stopping after 2-3 subagents. If you haven't hit the minimum dispatch count, keep going.
- **Broad dispatches** — asking one subagent to cover 4+ topics. Split into focused tasks.
- **Premature synthesis** — writing the report before the quality gate passes.
- **Investigating directly** — using search/fetch/grep yourself instead of delegating to subagents.
- **Missing citations** — every claim needs a source. No exceptions.
- **False confidence** — presenting single-source claims as established fact without flagging uncertainty.
