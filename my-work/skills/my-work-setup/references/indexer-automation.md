# Indexer automation prompt

Used by the my-work-setup skill to create the daily **My Issues Indexer** automation. Before creating it, replace
`{{SCRIPTS}}` with the absolute path of the my-issues skill's `scripts/` folder and `{{BOARD}}` with
`<COPILOT_HOME>/project-boards` (default `~/.copilot/project-boards`). Everything between the markers is the prompt.

<<<PROMPT
Incrementally refresh my local index of GitHub issues assigned to me, then hand today's triage to my daily triage chat.

Files (all in {{BOARD}}): my-issues.json (source of truth), my-issues.md (generated view), my-issue-features.json (feature areas), my-issues-refresh-manifest.json (last refresh), my-issue-outcomes.json (my decisions; read-only here), my-triage-queue.md/.json (generated), my-work.config.json (my settings).

1. Run `python3 "{{SCRIPTS}}/refresh_my_issues.py"`. Usually it only looks at issues updated since the last refresh (seconds); every 7 days it does a full pass over every issue assigned to me in the configured org (open and closed). It fetches only new or changed issues, verifies issues that left the inventory, enriches microsoft/vscode issues from Sweeper's published index (read-only, cached), adds feature areas for new GitHub feature labels, reclassifies every issue, validates, and atomically publishes. It never changes GitHub. If it fails, stop here and report the error; the previous files stay in place.
2. Run `python3 "{{SCRIPTS}}/my_issues.py" queue --write` and parse its JSON output.
3. If `postToChat` is true, call `send_message` with `session` set to `triageChat` and `message` set to `chatMessage` verbatim. If it fails, call `list_sessions` with `session` set to `triageChat`: if that session still exists and is not archived, the failure was transient, so wait a few seconds and call `send_message` once more; if that also fails, stop and report the error (do not create a new chat). Only when the session no longer exists or is archived, treat it as `createChat`.
4. If `createChat` is true (or step 3 found the chat gone), call `create_session` exactly once with `relationship: "independent"`, `title` set to `title`, `prompt` set to `chatPrompt` verbatim, and no workspace.
5. After posting or creating, run `python3 "{{SCRIPTS}}/my_issues.py" mark-chat "<link of the chat used>"`. If neither `postToChat` nor `createChat` is true, do nothing.
6. Do not triage, summarize issues, or act on GitHub yourself; the triage chat does that with me.

Report: total indexed issues (open/closed), added/updated/removed counts, issues that moved between feature areas, the Sweeper commit transition, validation status, triage queue section counts, and the triage chat used (or why none was).
PROMPT>>>
