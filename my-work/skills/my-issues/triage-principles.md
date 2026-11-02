# General triage principles

The baseline for every triage decision in My Work, adapted from the github-inbox plugin's general triage principles and common VS Code team conventions. The user's own inbox rules (the `rulesFile` in `my-work.config.json`) refine these and win when they conflict. When citing one, use its id, e.g. `rule: "A1. Merged own PR"`.

## Always

1. **Read the latest comments first.** A notification is triggered by the most recent activity. Read the last comments before recommending anything; never act on metadata alone.
2. **Explain why before dismissing.** Give a one-line reason per item, e.g. "your PR was merged", "bot PR, nothing to do", "closed as duplicate".
3. **Make decision questions self-contained.** Before asking the user to choose an outcome, say what the issue reports, who authored it, the key evidence or repro, current labels, owners and status, whether a duplicate was found, why the recommendation fits, and what the alternatives would mean. Never ask the user to choose from metadata alone.
4. **List items with full clickable links** (`https://github.com/owner/repo/issues/N`), not just `#N`.
5. **Confirm the exact comment text before posting** anything on GitHub.
6. **Summarize before approving a PR**: what changes and the risk.
7. **Only act on items the user asked about.** Never label, assign, close or comment on anything else, even if it could be improved.
8. **Show progress in batches** ("3/12") so the user knows where they are.

## Auto-dismiss

Each applies only after reading the latest comments; any exception keeps the notification.

- **A1. Merged own PR:** the user's merged PR, unless it has unresolved human review feedback. Comments and threads from Copilot code review or other bots don't count; a human comment, changes-requested review or unresolved human thread does.
- **A2. Closed for missing info:** an issue the bot closed because the reporter didn't provide requested information (`info-needed`), unless a recent community comment adds information or asks something.
- **A3. Closed as duplicate or not planned:** unless a recent community comment adds information or asks something.
- **A4. Copilot-authored PR:** a PR authored by the Copilot coding agent and assigned to the user, unless a human (not a bot) @-mentions the user in a comment.
- **A5. CODENOTIFY-only:** a notification triggered only by a CODENOTIFY bot comment, once the PR is merged or closed or the user has already reviewed it. While the PR is open and unreviewed, keep it for review. A human question, direct mention or review request always keeps it.
- **A6. Planning issues:** iteration plans, endgame plans and similar team-plan issues where the user is mentioned only in the issue body (the plan lists everyone). Keep it if a comment @-mentions the user.

## Triage

- **T1. Repro first:** look for reproduction steps, screenshots, GIFs or videos before treating something as a bug. If they're missing, suggest asking the reporter. A bug with clear repro steps already has verification steps.
- **T2. Asking for information:** when an approved comment asks the reporter for missing information, add the `info-needed` label in the same action. A reporter on a very old build is asked to update to the latest release and reproduce, with steps and a recording.
- **T3. Duplicates need evidence:** require the same behaviour, root cause or diagnostics. Similar titles, extensions or broad symptoms only make issues related.
- **T4. Duplicates of not-planned issues:** don't just close. Explain why the original was closed, link it, ask the reporter not to file duplicates, and invite them to add a 👍 or continue there.

## Handling

- **H1. Reassign:** "assign to X" / "it's X's issue" means add X, remove the user, and record `routed`. Then dismiss the notification (H3).
- **H2. Not my area, no owner:** remove the user, leave (or add) `triage-needed` for the team's triage rotation, and record `routed`.
- **H3. Dismiss once addressed:** when an action the user approved is done on GitHub and it addresses why the notification came in (the requested comment and `info-needed` label, a reassignment, a close, a submitted review, starting a review or a reproduce attempt), dismiss that notification without asking, and say so. Keep it if the action failed or only partly happened, or if the latest comments still hold someone else's unanswered ask of the user.
- **H4. Archive finished issue chats:** an issue's own chat that has done what was asked and dismissed the notification has served its purpose. It asks the My Work session to archive it, and a later message about the issue starts a fresh chat. Work sessions (fix, implement, review) are never archived this way.
