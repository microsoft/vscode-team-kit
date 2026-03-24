# handy-commands

Helpful slash commands for common development workflows. These are designed for day-to-day use with Copilot in VS Code.

## Commands

### `/handy-commands:fix-issue`

Takes a GitHub issue and drives an end-to-end fix: reads the issue, creates a branch, implements the fix with tests, and summarizes the changes.

### `/handy-commands:commit-and-pr`

Wraps up your current work into a commit and pull request. Generates a well-structured commit message, pushes the branch, creates a PR via `gh`, and sets it to auto-merge.

### `/handy-commands:pr-comments`

Reviews and addresses all outstanding PR review comments on the current branch. Fetches unresolved comments, makes the requested changes, and summarizes what was done.

## Plugin Structure

```
handy-commands/
├── .plugin/plugin.json
└── commands/
    ├── commit-and-pr.md
    ├── fix-issue.md
    └── pr-comments.md
```
