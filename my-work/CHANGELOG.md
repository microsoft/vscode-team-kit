# Changelog

## 1.0.7 (2026-10-28)

- Fixed: dismissing a notification only marked it as read, so it stayed in your github.com/notifications inbox. Dismiss now marks it **Done** (`DELETE /notifications/threads/{id}`).
- New **my-work-ui** skill: the panel's UX principles (VS Code tokens and shapes, density, sash, bands, toolbars, search, rows, details sections, accessibility) plus a checklist for every UI change, so anyone who rebuilds or customises the panel keeps it consistent.
- Fixed: the details header's split button was drawn as two separate buttons, and wide content could push the details pane past the window.
- New look across all views:
  - The header shows a one-line summary of the view (for example "1.145.0 · 28 of 35 done · 80% · 7 in progress · due in 4 days", or "40 unread · 10 need you · 49 done today") with a segmented progress bar, and the date and index age on the right.
  - Every group is a band: a light full-width header with a chevron, title and count on the right. The band's description shows as a tooltip on its title. Every band collapses, in every view, and the panel remembers what you collapse.
  - In progress / To do / Done inside a band use a quieter header with an icon and a count pill.
  - Simpler toolbars: Today drops its section pills (the bands are the sections) and the Re-check buttons are icon-only.
- **Layout like VS Code:** the list and details panes follow VS Code's Layout Density (`window.density.layout`, View > Appearance > Layout Density). Default shows them as cards with a small gap; Compact joins them with a single border. The Density setting now offers VS Code (the default), Default and Compact.
- **Resizable panes:** drag the sash between the list and details to resize them, or use the arrow keys on it. Double-click resets the size, and the panel remembers it.
- **VS Code toolbars:**
  - Each view has one toolbar row: the area picker, then an icon action bar with counts (Route, Auto-dismiss, Safe to dismiss, Re-check rules), then Refresh. Labels and "Updated …" are in the tooltips. Toggled filters use VS Code's `inputOption.active*` colours.
  - **Collapse All / Expand All** in every view's action bar folds or opens all its bands at once, like a VS Code view. The choice is remembered.
  - Browse works like the Settings editor: a search box with Group by, Recent filters and Refresh inside it, and Bugs / Features / All / Reviews tabs underneath next to the area picker.
- The Notifications action bar no longer jumps. Route, Auto-dismiss and Safe to dismiss always keep their place, disabled when empty, and Classify / Re-check keeps one slot, which turns into a spinner while the chat works.
- Fixed: a classification stored from another chat or panel didn't refresh your open panel, so its "Classifying 0/1" spinner stayed until a reload. Panels now refresh when classifications, rules or dismissals change.
- **Hovers everywhere:** native tooltips don't show in the canvas, so every action, icon button and activity bar item now shows a VS Code-style hover after a short delay. Browse rows explain their kind icon and drag grip.
- The My Work tree is indented like a VS Code tree: In progress / To do / Done sit one step in from their band, and their items one step further. Every count lines up on the right edge. **Clear done** is now an icon.
- The My Work chat's conversation starts collapsed, showing just the input. Opening it is remembered.
- More breathing space: padding around each view's toolbar and the header, and slightly taller rows in Compact. The toolbar buttons shrink with an ellipsis instead of pushing the actions out of view.
- **Activity bar like VS Code's:** 48px items with 24px icons, inactive and active icon colours, a 2px active edge, quiet counts under the icons and hover-style tooltips. The logo is gone.
- **Collapse All Sections / Expand All Sections** in the details header, for every kind of item. Cleanup's Recommended next is now a section too.
- **Chat inputs like VS Code's chat input:** every chat box (issue chats, notification chats and the My Work chat) is now one bordered input box. It is one line: the text, with Send as a small icon action at its end that turns blue when you type.
- **Details pane like a VS Code editor:**
  - Recommended next, On GitHub, Comments, Your checks, Sweeper's evidence, Works on, Latest reply and the other sections are VS Code view pane sections: a full-width uppercase header with a chevron that folds the section. Folded sections stay folded.
  - Section content sits flat on the pane: no cards, boxes or tinted backgrounds.
  - Status messages (Needs you, Your rules, Sweeper proposes) are an icon line with a thin coloured edge.
  - Long comments are clipped, with **Show more**, and a commenter's role is shown as quiet text.
- Notification rows drop the description line and show just the title, the issue number and the age. The reason is in the tooltip and the details.
- **VS Code look:** the panel uses VS Code's own theme colours and shapes.
  - Bands are VS Code view pane headers: `sideBarSectionHeader.*` colours, 22px tall and uppercase, with `badge.*` count badges.
  - Rows are square list rows with `list.hoverBackground` and `list.*SelectionBackground`.
  - Buttons use `button.*` and `button.secondary*`, the area picker uses `dropdown.*`, and row actions are a 22px icon action bar with `toolbar.hoverBackground`.
  - Focus outlines use `focusBorder`, corners are 4px, and the font is VS Code's system font.
- An issue with a session shows **Open session** as its main action (Start another session in the menu), and a closed issue never offers to start a fix session; the panel uses the live GitHub state when the index lags. Recommended next no longer says a fix session is running, or suggests one, for closed issues or issues that already have a session.
- Link an issue to a session by hand when the panel can't find it: **Works on** on a session (type #123, owner/repo#123 or a link; unlink with ✕), or **Link a session…** in an issue's menu to pick one of your sessions. Linked sessions show on the issue, and in My Work the session stands for that issue.
- Browse issues & PRs: **Group by** reporter (team / community / bots), milestone, age, interest (👍 and comments) or label. Groups collapse, and the choice is remembered. Grouping uses the search results, so it costs no extra GitHub calls.
- Browse issues & PRs: the feature-area picker sits next to the sources and narrows Bugs, Features or All (for example only the bugs in Agents Window). The separate Area source is gone; saved views and history that used it open as All with that area.
- Messages forwarded to an issue's chat or the My Work chat are checked after sending: the Agents window can drop a message to a nested chat it lost track of while reporting success. If it didn't arrive, the panel says so. A late reply now offers **Resend** (same chat, keeps the conversation) next to **Resend in a new chat**.
- Recommended next suggests **Reproduce** for open bugs whose report has steps: the issue's own chat tries the steps on the latest code (no code or GitHub changes) and reports back in the conversation whether it reproduces, with evidence and a suggested next step.
- A batch tops itself up to your batch size when items leave it (for example notifications dismissed in bulk or from the chat), instead of making you press Next to see the rest.
- The batch bar shows what's left instead of an internal batch number: "24 to go · 0 of 24 done · 23 more after these".
- **Your own sections** in My Work, created with **+ Section**: a name, optional instructions for sessions started from it, and an optional link pattern. A section holds **notes** (title, link, description, due date) plus issues and sessions you move or drag into it. Start session on a note follows the section's instructions; pasting a matching link into the chat box adds a note. Sections can be edited, reordered and deleted (their issues and sessions go back to Current).
- Reorder anything in your sections (notes, issues, sessions) by dragging, or with Alt+↑/↓; the order is saved. Items moved into a section land where you drop them.
- BREAKING: the built-in MSRC group and the `msrc` config are removed. On first run, existing MSRC items and `msrc.fixWorkflow` become a custom **MSRC** section with the same items, linked sessions and instructions (still private).
- My Work shows when work is finished instead of dropping it silently:
  - Issues and PRs you added locally or to My priorities get a **Closed** / **Merged** tag; sessions get **Done** (marked done in the Agents window) or **PR merged** / **PR closed** from their latest pull request.
  - Finished rows are dimmed and stay until you clear them, with a **Clear** quick action on each and **Clear done** on the group.
  - Every My Work group splits into **In progress** (has a running session, or is a session), **To do** and **Done** (closed or merged items, finished sessions, and milestone issues closed in the last 7 days), each with the same collapsible header and icon; Done starts collapsed and the panel remembers what you collapse. Done lists issues and sessions together, newest first, with closed issues tagged **Fixed**, **Not planned** or **Duplicate** (GitHub's close reason). The same work is listed once: a session that works on or fixed an issue in the group (its title names the issue, it was added with the issue, or its pull request closes it) is shown with the issue number, and the issue is hidden; the session counts as done once its issues are closed.
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
