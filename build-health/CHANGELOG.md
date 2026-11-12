# Changelog

## 2.1.0 (2026-11-12)

- The rolling build is now Pipeline 727 (`VS Code (CI)`), where the CI builds of `main` run from Nov 13, 2026. `fetch-builds.sh` fetches it by default, and the report names the pipeline of the fetched runs. Use `--pipeline 111` for the scheduled and manual product builds.

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.

## 1.0.0 — 2026-04-25

Initial release.

### Added

- **build-health skill** — fetch and analyze VS Code rolling build data from Azure DevOps Pipeline 111.
- `fetch-builds.sh` — download recent builds via the Azure CLI (`az`).
- `analyze-builds.mjs` — generate a build health report with break/fix transitions, error details, and commit links. Supports `markdown` and `text` output formats.
