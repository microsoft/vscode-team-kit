# Changelog

## 1.0.0 — 2026-09-22

Initial release.

### Added

- **find-issue skill** — searches a repository (microsoft/vscode by default) for issues matching a natural-language description, and drafts a pre-filled new issue when nothing matches. Uses the GitHub `search_issues` tool, which runs a semantic search on github.com.
- **find-duplicates skill** — finds likely duplicates of an existing issue with GitHub's semantically-similar issues API (`gh` CLI) and scores each candidate with a bundled duplicate scoring framework.
