# Changelog

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
