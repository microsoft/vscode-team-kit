# component-explorer

Skills for setting up and using the [VS Code Component Explorer](https://github.com/microsoft/vscode-packages/tree/main/js-component-explorer) — a fixture-based visual testing tool with MCP-powered screenshot comparison.

## Skills

| Skill | Description |
|---|---|
| [setup-component-explorer-light](skills/setup-component-explorer-light/) | Lightweight setup — install packages and add the Vite plugin |
| [setup-component-explorer-full](skills/setup-component-explorer-full/) | Full setup including CLI, MCP server, VS Code tasks and launch config |
| [use-component-explorer](skills/use-component-explorer/) | Write fixtures, take screenshots, compare components, and use MCP tools |

## What is the Component Explorer?

The component explorer lets you define **fixture files** (`*.fixture.tsx`) that render UI components in isolation. It provides:

- **Vite plugin** — auto-discovers fixtures and serves an explorer UI
- **Daemon** — manages headless browser instances for screenshot capture
- **MCP server** — enables AI agents (Copilot) to take screenshots, compare visual diffs, and watch for changes

## Quick Start

1. Install the plugin (see [add-component-explorer](skills/add-component-explorer/))
2. Write fixtures and use MCP tools (see [use-component-explorer](skills/use-component-explorer/))
