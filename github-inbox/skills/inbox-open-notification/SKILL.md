---
name: inbox-open-notification
description: Open a GitHub notification URL in the browser
tools:
  - execute
---

# Open Notification

Open a notification's issue or PR in the default browser.

## Command

```
open {url}
```

On Linux use `xdg-open {url}` instead.

Replace `{url}` with the GitHub HTML URL (e.g., `https://github.com/owner/repo/issues/123`).

You can also use:

```
gh issue view {number} --repo {owner}/{repo} --web
gh pr view {number} --repo {owner}/{repo} --web
```
