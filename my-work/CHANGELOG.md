# Changelog

## 1.0.5 (2026-10-28)

- Each issue gets its own chat: the first message about an issue from the panel creates it (its own session, no workspace), and later messages go to the same chat, so the conversation stays with the issue. **Open chat** in the conversation opens it.
- **Start session** on an issue you discussed turns its chat into the work session: it gets a worktree of the repository and starts working with everything you discussed. *Start another session* still creates a separate one.
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
