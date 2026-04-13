---
name: inbox-search-issues
description: Search GitHub issues and PRs assigned to you, needing triage, or matching custom queries
tools:
  - execute
---

# Search GitHub Issues and PRs

Use `gh` CLI to search for issues and PRs beyond notifications. This covers your full "issues inbox" — assigned work, triage queue, open PRs, and custom queries.

## My assigned issues

```
gh api /search/issues --jq '.items[] | {number, title, repo: .repository_url, state, labels: [.labels[].name], updated_at, html_url}' -f q='assignee:@me is:open is:issue sort:updated-desc'
```

## My open PRs

```
gh api /search/issues --jq '.items[] | {number, title, repo: .repository_url, state, draft: .draft, updated_at, html_url}' -f q='author:@me is:open is:pr sort:updated-desc'
```

## PRs waiting for my review

```
gh api /search/issues --jq '.items[] | {number, title, repo: .repository_url, state, updated_at, html_url}' -f q='review-requested:@me is:open is:pr sort:updated-desc'
```

## Issues needing triage (no type label)

This depends on the repo's label conventions. Common pattern — issues with no `bug`, `feature-request`, or `enhancement` label:

```
gh api /search/issues --jq '.items[] | {number, title, labels: [.labels[].name], updated_at, html_url}' -f q='assignee:@me is:open is:issue -label:bug -label:feature-request -label:enhancement sort:updated-desc repo:{owner}/{repo}'
```

Replace `{owner}/{repo}` with the target repository.

## Issues in a specific repo

```
gh api /search/issues --jq '.items[] | {number, title, state, labels: [.labels[].name], updated_at, html_url}' -f q='is:open is:issue repo:{owner}/{repo} sort:updated-desc'
```

## Stale issues (no activity in 30 days)

```
gh api /search/issues --jq '.items[] | {number, title, updated_at, html_url}' -f q='assignee:@me is:open is:issue sort:updated-asc updated:<{30_days_ago_date}'
```

Replace `{30_days_ago_date}` with a date like `2026-01-24`.

## Issues by milestone

```
gh api /search/issues --jq '.items[] | {number, title, state, labels: [.labels[].name], html_url}' -f q='is:open milestone:"{milestone}" repo:{owner}/{repo}'
```

## Custom query

The GitHub search syntax supports:
- `assignee:@me`, `author:@me`, `mentions:@me`
- `is:open`, `is:closed`, `is:issue`, `is:pr`
- `label:bug`, `-label:duplicate`
- `repo:owner/repo`, `org:microsoft`
- `review-requested:@me`, `reviewed-by:@me`
- `sort:updated-desc`, `sort:created-desc`
- `updated:>2026-01-01` (date filters)

```
gh api /search/issues --jq '.items[] | {number, title, state, labels: [.labels[].name], updated_at, html_url}' -f q='{query}'
```

## Rules

- Run each search as a separate terminal invocation
- NEVER pipe to `jq` or other programs — use `--jq`
- NEVER add `2>/dev/null` or redirects
