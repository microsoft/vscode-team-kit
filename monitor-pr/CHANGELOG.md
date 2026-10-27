# Changelog

## 2.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.

## 1.5.0 (2026-08-11)

- Wait up to 15 minutes for automatic Copilot reviews instead of relying on `requested_reviewers`
- Exit immediately when no Copilot review is expected, using applicable automatic-review rules, explicit requests, reviewed commit IDs, and the `microsoft/vscode*` repository convention
- Check unresolved Copilot threads on every poll so review comments are reported as soon as they appear
- Report merge conflicts immediately and distinguish green CI with outstanding non-build policy checks

## 1.4.0 (2026-08-09)

- Stop waiting for the non-build `VS Code PR Check` and `Community PR Approvals` policy checks on draft PRs

## 1.3.0 (2026-08-09)

- Allow fixes made while monitoring a PR to be pushed without waiting for explicit user approval

## 1.2.0 (2026-05-11)

- Handle each Copilot review comment immediately using agent judgment; resolve threads even when no code change is made (#19)
- Clarify CI failure handling: do not retry real failures, fix locally, never push without explicit user approval (#19)

## 1.1.0 (2026-04-19)

- Clarify handling of merge conflicts in skill instructions (#12)
- Clarify handling of Copilot code review (CCR) comments (#9)
- Move monitor scripts into the skill directory for a cleaner plugin structure

## 1.0.0 (2026-04-12)

- Initial release
- Launch two async terminals to monitor CI status and Copilot code review without polling
- Automatically react to CI failures and unresolved review comments
- Restart monitors after pushing new commits
