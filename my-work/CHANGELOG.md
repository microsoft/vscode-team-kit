# Changelog

## 1.0.0 (2026-10-27)

- BREAKING: Require Agent Plugins 1.0 hosts with SDK canvas extensions (`com.github.copilot/extensions/`).
- While the indexer runs, Today, Cleanup and Implement show its progress (phase, count, start time) and a warning if the last refresh failed.
- Triage follows bundled general triage principles (adapted from github-inbox, plus common auto-dismiss, triage and handling defaults: merged own PRs, closed duplicates, Copilot PRs, CODENOTIFY, planning issues, info-needed, duplicate evidence, reassigning), refined by your inbox rules, and reads your inbox memory for people, GitHub logins and owners. Both files are shared with the github-inbox plugin.
- Initial release: the My Work canvas (My Work, Today, Notifications, Cleanup, Implement), the my-issues skill with its indexer and helper scripts, and the my-work-setup onboarding skill (finds your existing repository clone from your Agents window sessions, confirms it with you, and offers to clone the Sweeper state repo).
