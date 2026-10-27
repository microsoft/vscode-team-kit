# Changelog

## 1.0.0 (2026-10-22)

- BREAKING: Require Agent Plugins 1.0 with a root `plugin.json`. Marketplace metadata now lives only in `marketplace.json`; legacy manifests are removed.
- Move SDK canvas extensions to `com.github.copilot/extensions/`, the runtime's fixed discovery location for Agent Plugins packages. Remove the legacy `extensions` path field.

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
