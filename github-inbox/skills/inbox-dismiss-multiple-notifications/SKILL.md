---
name: inbox-dismiss-multiple-notifications
description: Bulk dismiss multiple GitHub notifications
tools:
  - execute
---

# Dismiss Multiple Notifications

Mark multiple notification threads as read in a single operation.

## Mark as read

Run the PATCH command for each thread ID:

```
gh api --method PATCH /notifications/threads/{thread_id_1}
gh api --method PATCH /notifications/threads/{thread_id_2}
gh api --method PATCH /notifications/threads/{thread_id_3}
```

## Mark as done (read + unsubscribe)

For each thread, unsubscribe first then mark read:

```
gh api --method DELETE /notifications/threads/{thread_id}/subscription
gh api --method PATCH /notifications/threads/{thread_id}
```

Chain multiple commands together in a single terminal invocation using `&&` or `;` to avoid multiple confirmations.
