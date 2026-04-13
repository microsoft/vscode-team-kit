---
name: inbox-dismiss-notification
description: Dismiss a single GitHub notification by marking it as read
tools:
  - execute
---

# Dismiss Notification

Mark a single notification thread as read using `gh api`.

## Mark as read

```
gh api --method PATCH /notifications/threads/{thread_id}
```

## Mark as done (read + unsubscribe)

To fully dismiss and stop receiving updates:

```
gh api --method DELETE /notifications/threads/{thread_id}/subscription
gh api --method PATCH /notifications/threads/{thread_id}
```

Replace `{thread_id}` with the notification's `id` field.

**IMPORTANT:** Do NOT add `2>/dev/null` or redirects — they trigger false "file write" warnings. Do NOT add `GH_PAGER=cat` — it's unnecessary for API calls.
