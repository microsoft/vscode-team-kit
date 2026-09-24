# Changelog

## 1.2.4 — 2026-09-22

- Run `review-areas` Vally evaluations with GPT-6 Luna and supply a diff for the security review case

## 1.2.3 — 2026-09-22

- Run the `review-areas` Vally evaluations with GPT-6 Sol

## 1.2.2 — 2026-09-22

- Migrated the `review-areas` evaluation suite from Waza to Vally with inline capability and trigger stimuli

## 1.2.1 — 2026-08-12

- Migrated the `review-areas` evaluation suite to Waza 0.38.5 schema 1.2 with deterministic spec coverage and enforced trigger-accuracy measurement

## 1.2.0 — 2026-04-17

- Extracted `review-plan` to its own standalone plugin, simplifying this plugin to focus solely on area-based review

## 1.1.0 — 2026-04-14

- Added evaluation infrastructure (trigger tests and eval tasks) for the review-areas skill

## 1.0.0 — 2026-04-01

- Initial release with area-focused code review skill
- Fan-out to parallel subagents across correctness, tests, security, performance, and product areas
- Severity-ordered synthesis with strict signal filtering
