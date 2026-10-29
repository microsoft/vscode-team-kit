# Changelog

## 1.1.0

- Persist completed request tool snapshots through the SDK session-workspace file API and restore them after extension restarts without backfilling older requests.
- Prune snapshots for removed requests, serialize and flush pending writes on close, and surface unsupported storage or read/write failures without hiding event history.
- Sort Current tools and request Tools-card links alphabetically, with non-deferred tools before deferred tools; keep Find in the same order.
- Start request Tools cards with links to individual tool metadata sections.
- Include Current tools metadata in Find alongside request Tools cards, automatically expanding and highlighting matching tool details.
- Keep current-catalog matches independent of event category filters and update them when the live catalog changes.
- Expand Current tools inline below the record and timeline-event counts instead of opening a modal dialog.
- Show each request's tool catalog snapshot in a separate expandable Tools card directly under its User card, using the System category filter.
- Label snapshots as observed catalogs, not exact model-request payloads; older requests are not backfilled.
- Show the current main-agent tool catalog with total/deferred counts, descriptions, and input schemas, refreshing on tool changes.
- Keep current inventory separate from historical events and report unsupported hosts or inventory failures explicitly.

## 1.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.
- Move SDK canvas extensions to `com.github.copilot/extensions/`, the runtime's fixed discovery location for Agent Plugins packages. Remove the legacy `extensions` path field.

## 0.1.10

- Remove generated Playwright MCP snapshots from the plugin.

## 0.1.9

- Embed the session timeline screencast as an inline animated GIF, retaining the MP4 download.

## 0.1.8

- Add a 10-second session timeline screencast linked from the README.

## 0.1.7

- Document VS Code and VS Code Insiders install buttons and `/plugin` installation commands.

## 0.1.6

- Combine completion status and duration in one pill and include argument/result sizes.
- Truncate tool previews with CSS ellipses and expose their full text in tooltips.
- Place user section pills inline with the title and timestamp.
- Add arrow Find controls and automatic navigation after query changes; preserve match counts and selection across background updates.

## 0.1.5

- Include the date in user-request timestamps.
- Put the expand indicator before the category and tool name, with status and duration inline.
- Hide empty tool-argument preview placeholders.

## 0.1.4

- Keep Find visible above the sticky event headers.
- Debounce Find by 200 ms and match in a cancellable background worker.
- Avoid rebuilding the timeline while typing and populate matching details only when navigating to them.

## 0.1.3

- Stack all event headers flush at the top and highlight the current request in navigation.
- Move section outlines into inline pills, showing assistant model, response size, and tool-request count.
- Remove generated ellipses and repetitive tool-request previews.
- Replace search filtering with Find, match counts, and next/previous navigation into collapsed details.

## 0.1.2

- Keep user-request cards sticky while scrolling through their nested activity.
- Show request timestamps only, simplify core event labels, and add clickable section outlines.
- Replace collapsed tool-argument JSON with concise readable descriptions and paths.

## 0.1.1

- Add a toolbar action to collapse all expanded timeline events.

## 0.1.0

- Add a live Copilot session timeline canvas with turn navigation, nested tool and subagent activity, category filters, search, readable details, and raw event export.
- Add keyboard accessibility help and a plain-text timeline view.
