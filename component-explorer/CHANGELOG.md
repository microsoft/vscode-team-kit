# Changelog

## 1.3.3 (2026-09-22)

- Clarify that light setup excludes full VS Code task and launch configuration, and tag the routing case for focused evaluation

## 1.3.2 (2026-09-22)

- Run component explorer Vally evaluations with GPT-6 Luna; keep setup-variant routing checks as quality signals

## 1.3.1 (2026-09-22)

- Run all component explorer Vally evaluations with GPT-6 Sol

## 1.3.0 (2026-09-22)

- Migrated all component explorer evaluation suites from Waza to Vally with inline capability and trigger stimuli

## 1.2.1 (2026-08-12)

- Migrated all Component Explorer evaluation suites to Waza 0.38.5 schema 1.2 with deterministic spec coverage and enforced trigger-accuracy measurement

## 1.2.0 (2026-04-14)

- Added waza eval infrastructure for all component-explorer skills

## 1.1.0 (2026-04-01)

- Updated component explorer skills with improved setup and usage guidance

## 1.0.0 (2026-03-27)

- Initial release
- Added `setup-component-explorer-light` skill for lightweight package and Vite plugin setup
- Added `setup-component-explorer-full` skill for full setup including CLI, MCP server, VS Code tasks and launch config
- Added `use-component-explorer` skill for writing fixtures, taking screenshots, and comparing components via MCP tools
