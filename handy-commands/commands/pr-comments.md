---
description: Address PR review comments on the current branch.
---

# PR Comments

Review and address all outstanding PR comments for the current branch.

## Steps

1. **Identify the current branch** — Run `git branch --show-current` to determine the active branch.
2. **Find the associated PR** — Use the GitHub CLI (`gh pr view`) or equivalent to find the pull request associated with this branch. If no PR exists, inform the user and stop.
3. **Fetch review comments** — Run `gh pr view --comments` and `gh api` calls as needed to retrieve all unresolved review comments, including inline code comments and general conversation threads.
5. **Address each actionable comment** — For each unresolved actionable comment:
   - Read the referenced file and line range
   - Understand the reviewer's request
   - Make the requested change (or an equivalent improvement)
   - If the request is unclear or you disagree, explain your reasoning and ask the user before proceeding using the ask_question tool
6. **Summarize changes** — After addressing all comments, present a summary of:
   - What was changed and why
   - Any comments that were skipped and the reason
   - Suggested reply text for conversational comments

## Guidelines

- Do NOT commit or push your changes.
- Make each fix in a minimal, focused way — avoid unrelated refactors.
- If a comment references code that has since changed, note the discrepancy and ask the user how to proceed.
- Prefer small, incremental commits over one large commit so reviewers can see what changed.
- Use `$ARGUMENTS` as an optional filter — if provided, only address comments from that reviewer or matching that keyword.
