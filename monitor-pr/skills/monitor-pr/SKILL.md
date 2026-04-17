---
name: monitor-pr
description: "Monitor a pull request until CI status or Copilot review is available. Use when: monitor PR, watch PR, land PR, wait for CI, wait for checks, wait for review, check PR status. Starts two async terminal tasks (CI + Copilot review) and reacts when either completes."
---

# Monitor PR

Monitor a pull request by running two scripts in async terminals: one that waits for a Copilot code review, and one that waits for CI to finish. When either terminal exits, the host's async-terminal runtime notifies the agent on its next turn, so the agent can react without polling.

> **Host requirement:** this skill assumes the agent host can run long-lived background terminals and notify the agent when they exit — for example, VS Code Chat's `run_in_terminal` with `mode=async` plus `get_terminal_output` / `kill_terminal`. Hosts without that capability will need to adapt the procedure (e.g. foreground the scripts and block on them).

## When to Use

- After creating a PR and you want to wait for CI and Copilot's review
- When the user says "land this PR", "watch this PR", "monitor CI", or "wait for checks"

## Prerequisites

- **`gh` CLI** installed and authenticated.
- **An active PR** — created earlier in the conversation, or supplied by the user as a number or URL.
- **A Copilot review in flight, or already posted.** If Copilot has never been requested as a reviewer on this PR and has no posted comments, the review script will exit quickly with `NO_PENDING_COPILOT_REVIEW` — this skill only *waits for* Copilot reviews, it does not request them.

## Procedure

### 1. Identify the PR

Extract the PR number from the conversation context. Determine the repo with:

```sh
gh repo view --json nameWithOwner -q .nameWithOwner
```

### 2. Start Two Async Terminals

Run BOTH of these scripts in separate **async** terminals (`mode=async` on `run_in_terminal`, or your host's equivalent). Use a small timeout, such as `timeout=1000`, so the tool returns quickly after the monitor process starts. Do NOT await them and do NOT poll or sleep; the runtime will notify you on a later turn when each script exits.

The scripts live next to this skill, at `<plugin-dir>/scripts/wait-for-ci.mts` and `<plugin-dir>/scripts/wait-for-copilot-review.mts`. **Always invoke them by absolute path** — derive the plugin directory from the absolute path of this SKILL.md (two directories up from `skills/monitor-pr/SKILL.md`), not from the current working directory. The agent's CWD is usually the user's project repo, not this plugin.

**Terminal A — wait for Copilot code review:**

```sh
node <plugin-dir>/scripts/wait-for-copilot-review.mts <pr-number> <owner/repo>
```

**Terminal B — wait for CI:**

```sh
node <plugin-dir>/scripts/wait-for-ci.mts <pr-number> <owner/repo>
```

After launching both, record their terminal IDs and stop. Return control to the user with a brief status message, for example: "Monitoring PR #N — waiting for CI and Copilot review."

### 3. React to Notifications

When you are notified that one of these terminals has exited, read its output with `get_terminal_output` and act on the `RESULT:` line. The terminal output already contains everything you need — read it carefully before taking any action.

| Script | Result | Exit | Action |
|--------|--------|------|--------|
| `wait-for-copilot-review.mts` | `UNRESOLVED_COPILOT_REVIEW_COMMENTS` | 0 | Unresolved Copilot comments existed before monitoring started. The output lists each comment (file, line, body). Follow step 4 below. |
| `wait-for-copilot-review.mts` | `NO_PENDING_COPILOT_REVIEW` | 0 | No Copilot review is currently in flight and there are no unresolved Copilot comments. Report the status and move on — do not try to request a review yourself. |
| `wait-for-copilot-review.mts` | `NEW_COPILOT_REVIEW` | 0 | A new Copilot review arrived after monitoring started. The output lists each new inline comment (file, line, body). Follow step 4 below. |
| `wait-for-copilot-review.mts` | `COPILOT_REVIEW_ERROR` | 2 | Report the script or `gh` error output to the user. |
| `wait-for-ci.mts` | `CI_PASSED` | 0 | CI is green. Report the status and keep waiting for the review terminal if it is still running. |
| `wait-for-ci.mts` | `CI_FAILED` | 1 | Follow step 5 below. |
| `wait-for-ci.mts` | `CI_ERROR` | 2 | Report the script or `gh` error output to the user. |

If only one of the two terminals has completed, leave the other running.

### 4. Addressing Copilot Review Comments

After a `NEW_COPILOT_REVIEW` or `UNRESOLVED_COPILOT_REVIEW_COMMENTS` result:

1. **Repeat the Copilot review comments to the user** before making edits. Include the file, line, and body from the terminal output so the user can see exactly what Copilot asked for.
2. **Fix the code in the working tree** using your own judgment.
3. **Stop after making local changes. DO NOT commit, push, or resolve review threads.** Leave the edits unstaged in the working tree for the user to review.
4. **Do not ask whether to commit or push as part of this skill.** Only commit, push, or resolve threads if the user gives an explicit follow-up instruction after reviewing the local changes.

Only use the following commands after the user explicitly asks you to commit, push, or resolve review threads.

To find unresolved Copilot thread IDs:
```sh
gh api graphql -f query='{ repository(owner: "<owner>", name: "<repo>") { pullRequest(number: <N>) { reviewThreads(first: 50) { nodes { id isResolved comments(first: 1) { nodes { body author { login } } } } } } } }' -q '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | select(.comments.nodes[0].author.login | test("copilot"; "i")) | {id, body: (.comments.nodes[0].body[:80])}'
```

To resolve a thread:
```sh
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<THREAD_ID>"}) { thread { isResolved } } }'
```

### 5. Handling CI Failures

When `wait-for-ci.mts` reports `CI_FAILED`, investigate whether the failures are real or flaky before doing anything else.

1. **Identify the failing jobs** with `gh pr checks <pr-number>` and look up the run ID from the failed job URL.
2. **Read the failed logs** with `gh run view --job <job-id> --log-failed` and search for the actual error (test name, assertion, build error, etc.). Skip past cleanup/teardown output to the real failure line.
3. **Decide whether the failure is flaky.** Treat a failure as flaky only if ALL of the following hold:
    - The PR's actual file changes have no plausible connection to what failed (for example, a docs-only PR failing an integration test in an unrelated area).
    - The failure looks timing-sensitive, environment-related, or matches a known infrastructural pattern for this repo's CI (network timeout, missing artifact, `ECONNRESET`, runner disconnected, lock contention, etc.) rather than a clean assertion in code the PR touched.
    - The failing test is known to be flaky in the repo (referenced in an existing issue, tagged as flaky, or the failure mode is obviously infrastructural such as `npm install` failing or a download retry being exhausted).
4. **If the failure looks flaky**, retry just the failed jobs without asking the user:
    ```sh
    gh run rerun <run-id> --failed
    ```
    Then kill the old `wait-for-ci.mts` terminal with `kill_terminal` and start a fresh one per step 2. Tell the user briefly that you identified the failure as an unrelated flake and retried it.
5. **If the failure looks real** (touches code you changed, clean assertion failure, compile error in your diff, etc.), do NOT retry. Handle it the same way as a Copilot review comment: explain the failure to the user, fix it in the working tree, and stop without committing, pushing, or resolving anything. If you are not confident you understand the failure, ask the user for guidance instead of guessing at a fix.
6. **Never retry the same job more than once in this conversation** without the user's explicit permission. If a retried job fails again, stop and treat it as a real failure even if it still looks flaky.

**Merge conflict exception:** If the failing check is a mergeability check (for example, `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, or a required merge check such as `VS Code Merge Check`) and the fix is only resolving merge conflicts with the base branch, you may commit the merge-conflict resolution automatically after validating it. Do not apply this exception to ordinary compile/test failures or review comments.

### 6. After Explicitly Requested Pushes

If the user later explicitly asks you to commit and push the local fixes, new commits re-trigger CI and may invalidate the existing Copilot review. After pushing fixes, kill any still-running monitor terminals with `kill_terminal` and re-run this skill to watch the fresh run.

## Notes

- Both scripts poll every 30 seconds to avoid hitting API rate limits, so there is up to ~30s of latency between an event occurring on GitHub and the script reporting it. Each poll also prints a progress line to stdout so the agent can confirm the monitor is still alive when reading the terminal output.
- `wait-for-ci.mts` exits **immediately** on the first poll that contains any failed or cancelled check; it does not wait for other checks to finish. All currently-failed checks at that moment are listed in the output.
- `wait-for-copilot-review.mts` retries the pending-reviewer check once after a short grace window on startup to tolerate GitHub not yet having registered a freshly-requested Copilot reviewer.
