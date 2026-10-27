# Changelog

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.
- Move inbox agents to `com.github.copilot/agents/`.

## 1.2.0 (2026-04-23)

- Add `inbox-project-board` sub-agent for triaging notifications into GitHub project boards

## 1.1.0 (2026-04-17)

- Refine memory handling for more consistent recall across triage sessions

## 1.0.0 (2026-04-13)

- Initial release
- Smart grouping and rules-based triage for GitHub notifications
- Sub-agents for review, triage, investigation, memory, and summarization
- Skills for dismissing, listing, searching, and managing notification subscriptions
