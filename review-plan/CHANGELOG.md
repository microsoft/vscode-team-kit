# Changelog

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.
- Move hook configuration to `com.github.copilot/hooks/hooks.json`, keeping the reminder script at `hooks/remind-plan-review.mts`.
- Use native Copilot `postToolUse` events for `create`, `edit`, and `apply_patch` to remind the agent after a `plan.md` file changes. Plans and review findings use session-folder files rather than the memory tool.

## 1.0.0 — 2026-04-17

Initial standalone release, extracted from the `review-areas` plugin.

### Added

- **review-plan skill** — reviews implementation plans by fanning out parallel subagents across completeness, feasibility, sequencing, scope, and risk, then synthesizes deduplicated findings ordered by severity.
- **remind-plan-review hook** — PostToolUse hook that fires after `plan.md` is written to session memory and reminds the agent to run the review before proceeding.
