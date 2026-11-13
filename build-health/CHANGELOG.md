# Changelog

## 2.1.0 (2026-11-12)

- Covers both pipelines that build `main`: Pipeline 727 (`VS Code (CI)`), where the CI builds of `main` run from Nov 13, 2026, and Pipeline 111 (`VS Code`), the scheduled and manual product builds. `fetch-builds.sh --pipeline` takes a comma-separated list (default `727,111`) and fetches `--count` builds of each.
- The report analyzes each pipeline on its own: per-pipeline current status, build table, incidents and top failure reasons, so a red product build never breaks or fixes a CI streak.
- Informational runs (0-second placeholders Azure Pipelines creates when it can't evaluate a trigger) are skipped.

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.

## 1.0.0 — 2026-04-25

Initial release.

### Added

- **build-health skill** — fetch and analyze VS Code rolling build data from Azure DevOps Pipeline 111.
- `fetch-builds.sh` — download recent builds via the Azure CLI (`az`).
- `analyze-builds.mjs` — generate a build health report with break/fix transitions, error details, and commit links. Supports `markdown` and `text` output formats.
