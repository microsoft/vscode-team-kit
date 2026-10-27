# Changelog

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.
- Move slash commands to `com.github.copilot/commands/`.

## 1.0.0 (2026-03-19)

- Initial release
- Added `/fix-issue` command — reads a GitHub issue, creates a branch, implements the fix with tests, and summarizes changes
- Added `/commit-and-pr` command — commits current work, pushes the branch, creates a PR via `gh`, and sets auto-merge
- Added `/pr-comments` command — fetches unresolved PR review comments, makes requested changes, and summarizes what was done
