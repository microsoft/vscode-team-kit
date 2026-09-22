# vscode-issues

Search VS Code GitHub issues from chat: check whether an issue already exists for something you describe, or find duplicates of an existing issue.

## Skills

| Skill | Description |
|---|---|
| [find-issue](skills/find-issue/) | Describe a bug, crash, or feature request in plain language; get matching existing issues, or a pre-filled new issue if nothing matches |
| [find-duplicates](skills/find-duplicates/) | Give an issue number or URL; get high-confidence and possible duplicates, scored with a bundled framework |

Both skills search `microsoft/vscode` by default. Name another repository (`owner/repo` or a URL) to search there instead. They only run when you invoke them; the agent won't load them on its own.

## How It Works

**find-issue**

1. **Queries** — turns your description into up to 3 search queries (your exact phrasing plus two variations).
2. **Search** — a subagent runs all queries in parallel with the GitHub `search_issues` tool, which does a semantic search on github.com.
3. **Read** — reads each candidate issue to confirm relevance.
4. **Report** — lists exact matches and related issues; if there's no exact match, drafts a new issue with a pre-filled link.

**find-duplicates**

1. **Resolve** — normalizes `12345`, `#12345`, or an issue URL to a repository and issue number.
2. **Search** — calls GitHub's semantically-similar issues API once with the `gh` CLI.
3. **Score** — a subagent scores every candidate with [references/framework.md](skills/find-duplicates/references/framework.md) (error signature, reproduction, component, symptoms, context, plus disqualifiers and edge cases).
4. **Expand** — reads comments on high-confidence matches and `*duplicate`-labeled issues to pick up linked duplicates.
5. **Report** — lists High Confidence and Possible duplicates. Nothing is dropped; low scores go under Possible.

## Requirements

- The GitHub tools in chat (`search_issues`, `issue_read`), for both skills.
- The [GitHub CLI](https://cli.github.com/), authenticated with `gh auth login`, for find-duplicates.

## Plugin Structure

```text
vscode-issues/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
└── skills/
    ├── find-duplicates/
    │   ├── SKILL.md
    │   └── references/
    │       └── framework.md
    └── find-issue/
        └── SKILL.md
```
