---
name: inbox-get-notification-details
description: Get details of a specific GitHub notification thread
tools:
  - execute
---

# Get Notification Details

Use `gh api` to fetch details of a specific notification thread or issue/PR comments.

## Notification thread details

```
gh api /notifications/threads/{thread_id}
```

## Issue comments (latest)

```
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[-1] | {user: .user.login, body: .body}'
```

## PR comments (latest)

```
gh api repos/{owner}/{repo}/pulls/{number}/comments --jq '.[-1] | {user: .user.login, body: .body}'
```

Replace `{thread_id}`, `{owner}`, `{repo}`, `{number}` with actual values.

## Rules

- Run each `gh api` command as a **separate** terminal invocation — NEVER chain with `&&`
- NEVER add `2>/dev/null`, `GH_PAGER=cat`, or pipe to other programs
- Use `--jq` for filtering — it is built into `gh`
