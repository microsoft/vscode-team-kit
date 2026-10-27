# monitor-pr

Monitor a pull request until CI finishes and Copilot's code review arrives — without polling. Launches two async terminals that watch the PR in the background; the agent is notified automatically when either one produces a verdict.

## Skill

| Skill | Description |
|---|---|
| [monitor-pr](skills/monitor-pr/) | Start two async monitor terminals (CI + Copilot review) and react to their results |

## How It Works

1. **Identify the PR** — from conversation context, or a PR number the user provides.
2. **Launch two async terminals** — one runs `wait-for-ci.mts`, the other `wait-for-copilot-review.mts`. Both exit with a single `RESULT: <STATE>` line. The CI waiter reports merge conflicts and excludes review-policy checks from actual CI completion; the review waiter first detects whether a review is expected, then watches threads and review IDs for a bounded 15-minute window.
3. **React to the verdict** — on `CI_FAILED`, investigate whether the failure is real or a known-flake pattern; on `NEW_COPILOT_REVIEW` or `UNRESOLVED_COPILOT_REVIEW_COMMENTS`, fix the code and push resulting commits.
4. **Restart after pushing** — new commits invalidate in-flight runs, so monitors are re-launched after each push.

## Plugin Structure

```text
monitor-pr/
├── plugin.json
├── README.md
└── skills/
    └── monitor-pr/
        ├── SKILL.md
        └── scripts/
            ├── wait-for-ci.mts
            ├── wait-for-ci.test.mts
            ├── wait-for-copilot-review.test.mts
            └── wait-for-copilot-review.mts
```

## Requirements

- `gh` CLI installed and authenticated
- Node.js (scripts use only built-in modules — no install step)
