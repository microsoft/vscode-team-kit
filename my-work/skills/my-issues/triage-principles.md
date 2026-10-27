# General triage principles

The baseline for every triage decision in My Work, adapted from the github-inbox plugin's general triage principles. The user's own inbox rules (the `rulesFile` in `my-work.config.json`) refine these and win when they conflict.

1. **Read the latest comments first.** A notification is triggered by the most recent activity. Read the last comments before recommending anything; never act on metadata alone.
2. **Explain why before dismissing.** Give a one-line reason per item, e.g. "your PR was merged", "bot PR, nothing to do", "closed as duplicate".
3. **Check merged PRs for unresolved threads** before recommending a dismiss.
4. **Check closed issues for recent community comments** (duplicate, not planned) before dismissing; someone may need an answer.
5. **Keep code-review notifications** (e.g. CODENOTIFY) for review while the PR is open; never auto-dismiss them.
6. **Check bot- or Copilot-authored PRs for human @-mentions** before dismissing them.
7. **Look for reproduction steps before treating something as a bug** (steps, screenshots, GIFs, videos). If they're missing, suggest asking the reporter.
8. **Be thoughtful with duplicates of not-planned issues.** Explain why the original was closed, link it, ask the reporter not to file duplicates, and invite them to add a 👍 or continue there.
9. **Confirm the exact comment text before posting** anything on GitHub.
10. **Summarize before approving a PR**: what changes and the risk.
11. **Only act on items the user asked about.** Never label, assign, close or comment on anything else, even if it could be improved.
12. **Show progress in batches** ("3/12") so the user knows where they are.
