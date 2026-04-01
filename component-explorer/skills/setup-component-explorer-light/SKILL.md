---
name: setup-component-explorer-light
description: Lightweight setup — install Component Explorer packages and add the Vite plugin, with MCP server for AI agent integration.
---

# Skill: Setup Component Explorer (Light)

Minimal setup: install packages and wire the Vite plugin so fixtures are served at `___explorer`. For the full setup (CLI daemon, VS Code tasks & launch config), use the **setup-component-explorer-full** skill.

## Prerequisites

- The project uses **Vite** as its bundler
- Node.js >= 22

## Step 1: Install Packages

```bash
npm install @vscode/component-explorer @vscode/component-explorer-vite-plugin
```

Use the project's package manager (npm, pnpm, yarn). For workspace monorepos, install into the package that owns the Vite config.

## Step 2: Configure Vite Plugin

Add `componentExplorer()` to `vite.config.ts`:

```ts
import { componentExplorer } from '@vscode/component-explorer-vite-plugin';

export default defineConfig({
  plugins: [
    // ... existing plugins (react, tailwind, etc.)
    componentExplorer(),
  ],
});
```

### Plugin Options

| Option | Default | Description |
|--------|---------|-------------|
| `include` | `'./src/**/*.fixture.{ts,tsx}'` | Glob pattern for fixture files |
| `route` | `'/___explorer'` | URL path for the explorer UI |
| `build` | `'app-only'` | Build mode: `'app-only'`, `'all'`, or `'explorer-only'` |
| `outFile` | `'___explorer.html'` | Output filename for built explorer |
| `logLevel` | `'info'` | `'silent'`, `'info'`, `'verbose'`, `'warn'`, `'error'` |

For projects where fixtures live outside `./src`, set `include` explicitly:

```ts
componentExplorer({
  include: './test/**/*.fixture.{ts,tsx,js,jsx}',
}),
```

## Step 3: Start Dev Server and Open Explorer

1. Start the Vite dev server as a background terminal process (e.g. `npx vite`, `pnpm dev`).
2. Once the server is ready, open the component explorer in VS Code's Simple Browser by running the VS Code command (adjust port if needed):
   ```
   simpleBrowser.show with url: http://localhost:5173/___explorer
   ```

**Important:** Before writing any fixtures, read the **use-component-explorer** skill. It covers fixture patterns, project-specific wrappers, and best practices that are essential for correct usage.

## Optional: MCP Server for AI Agent Integration

To enable AI agents (Copilot) to take screenshots, compare fixtures, and interact with components, add the MCP server.

### Install the CLI

```bash
npm install @vscode/component-explorer-cli
```

### Create `component-explorer.json`

Create `component-explorer.json` next to the Vite config (or at the project root). This points the CLI at the running Vite dev server:

```json
{
  "$schema": "node_modules/@vscode/component-explorer-cli/dist/component-explorer-config.schema.json",
  "sessions": [{ "name": "current" }],
  "server": {
    "type": "http",
    "url": "http://localhost:5173"
  }
}
```

Adjust the `url` if the dev server uses a different port.

### Configure `.vscode/mcp.json`

Create or update `.vscode/mcp.json` to register the MCP server:

```json
{
  "servers": {
    "component-explorer": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "component-explorer",
        "mcp",
        "-p",
        "./component-explorer.json"
      ]
    }
  }
}
```

Adjust the `-p` path if `component-explorer.json` is not at the workspace root.
