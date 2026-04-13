---
name: inbox-list-notifications
description: Fetch GitHub notifications using the gh CLI
tools:
  - execute
---

# List GitHub Notifications

Use `gh api` to fetch all unread GitHub notifications with automatic pagination.

## Command

Use the `--jq` flag (NOT a pipe to `jq`) to filter output inline:

```
gh api /notifications --paginate --jq '.[] | {id, reason, unread, updated_at, repo: .repository.full_name, title: .subject.title, type: .subject.type, url: .subject.url}'
```

This is the ONLY command you should run. Do NOT modify it. Do NOT add anything to it.

## Rules

- **NEVER** pipe to `jq`, `python`, `python3`, or any other program
- **NEVER** add `2>/dev/null` or any redirects
- **NEVER** add `GH_PAGER=cat` or any environment variable prefixes
- **NEVER** wrap the command in a script
- The `--jq` flag handles all JSON filtering — no external tools needed
- The `--paginate` flag handles pagination — no manual page loops needed

## Filters

- **Participating only:** Add `--method GET -f participating=true`
- **Include read:** Add `--method GET -f all=true`
- **Specific repo:** Use `gh api /repos/{owner}/{repo}/notifications --paginate --jq '...'`
- **Since date:** Add `-f since=2024-01-01T00:00:00Z`

## Constructing HTML URLs

The `url` field is an API URL like `https://api.github.com/repos/owner/repo/pulls/123`. Convert to a clickable URL:
- For pulls: `https://github.com/{repo}/pull/{number}`
- For issues: `https://github.com/{repo}/issues/{number}`

Extract the number from the API URL's last path segment.

## Priority

Sort notifications by reason priority (highest first):
1. `security_alert` (critical)
2. `assign` (high)
3. `review_requested` (high)
4. `mention` (high)
5. `ci_activity` (medium)
6. `comment` (medium)
7. `team_mention` (medium)
8. `state_change` (medium)
9. `author` (low)
10. `subscribed` (low)
