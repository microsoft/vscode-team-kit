---
name: setup-component-explorer-full
description: Full setup of the Component Explorer including CLI, MCP server, VS Code tasks and launch config.
---

# Skill: Setup Component Explorer

When the user asks to add, set up, or integrate the component explorer into their project, follow this guide.

## Prerequisites

- The project uses **Vite** as its bundler
- Node.js >= 22

## Step 1: Install Packages

```bash
npm install @vscode/component-explorer @vscode/component-explorer-cli @vscode/component-explorer-vite-plugin
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

For projects where fixtures live outside `./`, set `include` explicitly:

```ts
componentExplorer({
  include: './test/**/*.fixture.{ts,tsx,js,jsx}',
}),
```

## Step 3: Create `component-explorer.json`

Create a configuration file for the CLI/daemon/MCP features (place next to the Vite config or at the project root):

```json
{
  "$schema": "./node_modules/@vscode/component-explorer-cli/dist/component-explorer-config.schema.json",
  "screenshotDir": ".screenshots",
  "viteConfig": "./vite.config.ts",
  
  // If you need a stable port, configure the redirection server port (required for the launch config in Step 6):
  "redirection": { "port": 5331 }
}
```

## Step 4: Configure VS Code — MCP Server

Create or update `.vscode/mcp.json` to add the component explorer MCP server. This enables AI agents to take screenshots, compare fixtures, and interact with components:

```json
{
  "servers": {
    "component-explorer": {
      "type": "stdio",
      "command": "npm",
      "args": [
        "exec",
        "component-explorer",
        "--no",
        "--",
        "mcp",
        "-p",
        "./component-explorer.json"
      ]
    }
  }
}
```

Adjust the `-p` path to point to the `component-explorer.json` location relative to cwd.

## Step 5: Configure VS Code — Component Explorer Server Task

Add a task to `.vscode/tasks.json` to start the component explorer server:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Component Explorer Server",
      "type": "shell",
      "command": "./node_modules/.bin/component-explorer serve -p ./component-explorer.json --kill-if-running",
      "isBackground": true,
      "problemMatcher": {
        "owner": "component-explorer",
        "fileLocation": "absolute",
        "pattern": {
          "regexp": "^\\s*at\\s+(.+?):(\\d+):(\\d+)\\s*$",
          "file": 1,
          "line": 2,
          "column": 3
        },
        "background": {
          "activeOnStart": true,
          "beginsPattern": ".*Setting up sessions.*",
          "endsPattern": "Redirection server listening on.*"
        }
      }
    }
  ]
}
```

If other tasks already exist, merge the new task into the existing `tasks` array.


## Step 6: Configure VS Code — Launch Configuration (Optional)

To open the component explorer UI in Chrome, add a launch configuration to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Component Explorer (Chrome)",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:5331/___explorer",
      "preLaunchTask": "Component Explorer Server"
    }
  ]
}
```

This requires the `redirection` port to be configured in `component-explorer.json` (see Step 3). The `preLaunchTask` starts the daemon automatically before opening the browser.

If other launch configurations already exist, merge the new configuration into the existing `configurations` array.


## Step 7: Create a First Fixture and Verify

**Important:** Before writing any fixtures, read the **use-component-explorer** skill. It covers fixture patterns, project-specific wrappers, and best practices that are essential for correct usage.

Create a `.fixture.tsx` (or `.fixture.ts`) file to verify the setup works:

1. Start the dev server as a background terminal process: `npx vite` (or `pnpm dev`, etc.)
2. Once the server is ready, open the component explorer in VS Code's Simple Browser by running the VS Code command:
   ```
   simpleBrowser.show with url: http://localhost:5173/___explorer
   ```
3. Run the "Component Explorer Server" VS Code task (or the launch configuration) to start the daemon.
4. Verify the MCP server connects (Copilot can now `list_fixtures`, `screenshot`, etc.).
