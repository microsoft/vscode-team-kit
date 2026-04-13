---
name: inbox-manage-subscription
description: Manage subscription for a GitHub notification thread
tools:
  - execute
---

# Manage Notification Subscription

## Ignore (mute) a thread

Stop receiving notifications for this thread:

```
gh api --method PUT /notifications/threads/{thread_id}/subscription -f ignored=true
```

## Watch a thread

Subscribe to receive notifications:

```
gh api --method PUT /notifications/threads/{thread_id}/subscription -f ignored=false
```

## Unsubscribe from a thread

Remove subscription entirely:

```
gh api --method DELETE /notifications/threads/{thread_id}/subscription
```

Replace `{thread_id}` with the notification's `id` field.
