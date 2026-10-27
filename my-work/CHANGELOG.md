# Changelog

## 1.0.0 (2026-10-27)

- BREAKING: Require Agent Plugins 1.0 hosts with SDK canvas extensions (`com.github.copilot/extensions/`).
- The index is incremental: the first run publishes open issues first, then adds closed ones; daily runs only fetch issues updated since the last refresh, with a full pass every 7 days (or `--full`).
- The indexer fetches issues in batches of 50 with GraphQL, so a first build of thousands of issues takes minutes instead of hours.
- Security: the panel server only answers its own host (DNS-rebinding protection) and requires its per-run token on every API call; the page has a content security policy; images in issues load only from GitHub's hosts; GitHub text in chat prompts is JSON-quoted and marked as untrusted data, and "Start session" clicks no longer imply approval for GitHub changes.
- Setup gets every path from `my_issues.py paths` (honours `COPILOT_HOME`) instead of assuming `~/.copilot`.
- Setup opens the canvas before building the index, and builds it in the background.
- While the indexer runs, Today, Cleanup and Implement show its progress (phase, count, start time) and a warning if the last refresh failed.
- Triage follows bundled general triage principles (adapted from github-inbox, plus common auto-dismiss, triage and handling defaults: merged own PRs, closed duplicates, Copilot PRs, CODENOTIFY, planning issues, info-needed, duplicate evidence, reassigning), refined by your inbox rules, and reads your inbox memory for people, GitHub logins and owners. Both files are shared with the github-inbox plugin.
- Initial release: the My Work canvas (My Work, Today, Notifications, Cleanup, Implement), the my-issues skill with its indexer and helper scripts, and the my-work-setup onboarding skill (finds your existing repository clone from your Agents window sessions, confirms it with you, and offers to clone the Sweeper state repo).
