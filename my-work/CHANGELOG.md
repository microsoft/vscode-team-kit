# Changelog

## 1.0.7 (2026-10-28)

- A batch tops itself up to your batch size when items leave it (for example notifications dismissed in bulk or from the chat), instead of making you press Next to see the rest.
- The batch bar shows what's left instead of an internal batch number: "24 to go · 0 of 24 done · 23 more after these".
- **Your own sections** in My Work, created with **+ Section**: a name, optional instructions for sessions started from it, and an optional link pattern. A section holds **notes** (title, link, description, due date) plus issues and sessions you move or drag into it. Start session on a note follows the section's instructions; pasting a matching link into the chat box adds a note. Sections can be edited, reordered and deleted (their issues and sessions go back to Current).
- BREAKING: the built-in MSRC group and the `msrc` config are removed. On first run, existing MSRC items and `msrc.fixWorkflow` become a custom **MSRC** section with the same items, linked sessions and instructions (still private).
- My Work shows when work is finished instead of dropping it silently:
  - Issues and PRs you added locally or to My priorities get a **Closed** / **Merged** tag; sessions get **Done** (marked done in the Agents window) or **PR merged** / **PR closed** from their latest pull request.
  - Finished rows are dimmed and stay until you clear them, with a **Clear** quick action on each and **Clear done** on the group.
  - Issues closed in the current or next milestone in the last 7 days fold into a **Closed this week** line at the bottom of the group.
- Every My Work section (MSRC, current and next milestone, My priorities) can be collapsed from its header; the panel remembers which are collapsed.

## 1.0.6 (2026-10-28)

- Issue chats and work sessions are nested under your My Work session. The first message about an issue creates its chat there (no workspace), even when the panel is open in another session; Start session, Start another session, Implement and starting from a notification create nested sessions with their own worktree. MSRC sessions stay separate.
- A message a chat doesn't answer within 3 minutes (for example because the Agents window lost the nested chat) shows "No reply yet" with **Resend in a new chat**, instead of waiting forever.
- Session rows (in issue, MSRC and session views) list everything the session created or linked: pull requests and issues, with their labels. **Summarize** asks the My Work chat for a short summary of what the session is doing, its state and next step, kept per session and flagged when the session has changed since.
- Paste screenshots into the issue conversation or My Work chat box. They're saved privately in the My Work data folder (kept 30 days), shown as thumbnails, and passed to the chat as file paths it can open.
- **Open chat** works for nested chats (such as the My Work chat), not only top-level sessions.
- Browse issues & PRs:
  - Remembers where you were: switching to another view and back reopens it (or the issue you opened from it), and the source, area and filter are kept when the panel is reopened.
  - **Recent filters** (history button) re-runs any of your last 15 filters with its list; a refresh button re-runs the current search on GitHub.
  - The filter has its own row, with refresh and history at the end of the source row; examples use your own GitHub login.
  - Clicking anywhere on a row opens it.
- My Work list:
  - Quick actions on rows, shown on hover or keyboard focus: issues get Start / Open session, Open on GitHub (and Remove for locally added ones); sessions get Open session and Remove; MSRC items get Start / Open session and Open in IcM.
  - Drag a session from **Active sessions** into Current, Next or My priorities to add it to My Work there (a session that works on an issue adds that issue).
  - Rows are normal clickable boxes (pointer cursor); dragging uses the grip that appears on the left on hover.

## 1.0.5 (2026-10-28)

- Each issue gets its own chat: the first message about an issue from the panel creates it (its own session, no workspace), and later messages go to the same chat, so the conversation stays with the issue. **Open chat** in the conversation opens it.
- **Start session** on an issue you discussed turns its chat into the work session: it gets a worktree of the repository and starts working with everything you discussed. *Start another session* still creates a separate one.
- Browse issues & PRs: Refresh re-runs the search on GitHub (no 2-minute cache), and the list also re-runs when a chat changes something, e.g. closes an issue.
- Issue chats get the helper script's exact path, so they can record decisions without relying on personal instructions.

## 1.0.4 (2026-10-28)

- Browse issues & PRs: the filter applies when you press Enter and narrows the selected list (Bugs, an area, Reviews…) with a live GitHub search. Write GitHub syntax (`author:alexdima`) or plain words ("created by alexdima this month"): the chat turns plain words into search qualifiers, resolving names with your memory, and the panel shows them to edit.

## 1.0.3 (2026-10-28)

- Develop locally: set `devSource` in `my-work.config.json` to a my-work checkout and the installed panel runs that checkout's code, assets and scripts, titled "My Work (dev)". Asset edits reload the open panel.

## 1.0.2 (2026-10-28)

- Browse issues & PRs: clicking a title opens the issue in the panel (details, discussion, Start session, add to current/next/My priorities) with Back to results; the GitHub link is still on the issue number.
- Remove an issue planned for the current or next milestone back to untriaged: clears its GitHub milestone and drops it from My Work.
- Issues not in your index get the same My Work menu (local moves, Remove from My Work), and opening issues works before the index exists.

## 1.0.1 (2026-10-27)

- The reused daily triage chat is created with the title "My Work", matching the canvas.

## 1.0.0 (2026-10-27)

- BREAKING: Require Agent Plugins 1.0 hosts with SDK canvas extensions (`com.github.copilot/extensions/`).
- The index is incremental: the first run publishes open issues first, then adds closed ones; daily runs only fetch issues updated since the last refresh, with a full pass every 7 days (or `--full`).
- The indexer fetches issues in batches of 50 with GraphQL, so a first build of thousands of issues takes minutes instead of hours.
- No binaries in the plugin: the panel uses the codicon icon font from the local VS Code installation.
- Security: the panel server only answers its own host (DNS-rebinding protection) and requires its per-run token on every API call; the page has a content security policy; images in issues load only from GitHub's hosts; GitHub text in chat prompts is JSON-quoted and marked as untrusted data, and "Start session" clicks no longer imply approval for GitHub changes.
- Setup gets every path from `my_issues.py paths` (honours `COPILOT_HOME`) instead of assuming `~/.copilot`.
- Setup opens the canvas before building the index, and builds it in the background.
- While the indexer runs, Today, Cleanup and Implement show its progress (phase, count, start time) and a warning if the last refresh failed.
- Triage follows bundled general triage principles (adapted from github-inbox, plus common auto-dismiss, triage and handling defaults: merged own PRs, closed duplicates, Copilot PRs, CODENOTIFY, planning issues, info-needed, duplicate evidence, reassigning), refined by your inbox rules, and reads your inbox memory for people, GitHub logins and owners. Both files are shared with the github-inbox plugin.
- Initial release: the My Work canvas (My Work, Today, Notifications, Cleanup, Implement), the my-issues skill with its indexer and helper scripts, and the my-work-setup onboarding skill (finds your existing repository clone from your Agents window sessions, confirms it with you, and offers to clone the Sweeper state repo).
