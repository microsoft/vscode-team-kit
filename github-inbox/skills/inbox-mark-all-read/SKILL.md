---
name: inbox-mark-all-read
description: Mark all GitHub notifications as read
tools:
  - execute
---

# Mark All Notifications Read

## All notifications

```
gh api --method PUT /notifications
```

## All notifications in a specific repo

```
gh api --method PUT /repos/{owner}/{repo}/notifications
```

Replace `{owner}` and `{repo}` with the repository owner and name.

## Since a specific time

Add the `last_read_at` parameter:

```
gh api --method PUT /notifications -f last_read_at=2024-01-01T00:00:00Z
```
