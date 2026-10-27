# Changelog

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.
- Move the Debug agent to `com.github.copilot/agents/`.

## 1.1.0 — 2026-08-12

Add an explicit security stance that calibrates caution to local, developer-owned debugging: the ingest token is treated as an ephemeral loopback value rather than a credential, and effort is directed at not leaving probe code behind, keeping probe payloads bounded, and guarding the loopback trust boundary.

Add a tiered configuration-delivery model for probes: environment variables, inline literals inside the owned marker block for targets that cannot read the environment, and approval-gated runtime injection for already-running processes. Frontend probes are now permitted against a loopback collector, with narrowly scoped browser preflight support for event ingestion. Runtime injection gains an explicit cleanup obligation.

Require a structured question tool for every human gate and declare it a prerequisite. Closed decisions use explicit choices, while material clarifications and reproduction adjustments can accept free-form detail instead of forcing guessed choices.

Make cleanup resilient to ownership drift: ambiguous probe blocks remain active and untouched while independently verified cleanup and collector teardown continue, then unresolved paths and markers are reported together.

## 1.0.0 — 2026-07-24

Initial experimental release. Adds the evidence-driven `debug` orchestration skill; enforced competing-hypothesis breadth with append-only investigation rounds, reusable physical probes, cautious evidence classifications, event-volume planning, and bounded retry escalation; a resumable SQLite investigation and probe-ownership ledger with a canonical external schema; risk-based clarification and instrumentation approvals; authenticated loopback and explicit trusted-network collection for local processes, mobile devices, containers, VMs, and services; scoped ingest/admin tokens; bounded JSONL storage with rejection telemetry; connectivity preflights; safe lifecycle diagnostics and shutdown; human reproduction and verification gates; controlled multi-model advice; and ownership-validated cleanup.
