# Writing Plugins

Each top-level directory containing a `plugin.json` is an Agent Plugins 1.0 package. Plugins are self-contained. Do not add legacy manifests or compatibility paths.

## Creating a New Plugin

1. Create a directory at the repo root (lowercase, hyphens ok, e.g. `my-plugin`).
2. Add `plugin.json`:
   ```json
   {
     "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
     "name": "my-plugin",
     "version": "1.0.0",
     "description": "Brief description of what the plugin does.",
     "license": "MIT",
     "keywords": ["relevant", "tags"]
   }
   ```
3. Add a `CHANGELOG.md` with the initial release entry (see [Versioning](#versioning) below).
4. Add a `README.md` with: one-sentence description, skills table, how it works, and plugin structure tree.
5. Register the plugin in `marketplace.json` — add an entry to the `plugins` array with matching `name`, `version`, and `description`.
6. Add the plugin to the appropriate workflow section in the repo `README.md`.
7. Put portable skills in `skills/` and packaged MCP servers in `mcp.json`. Put Copilot agents, commands, hooks, and SDK extensions under `com.github.copilot/{agents,commands,hooks,extensions}/`. Hook scripts may stay in `hooks/` or `scripts/`, referenced with `${PLUGIN_ROOT}`.

The [canonical manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) is closed. Keep `categories`, `status`, `maintainers`, and `evals` only in `marketplace.json`. The manifest's optional `extensions` field is an object keyed by client namespace, never a component path. SDK canvas extensions use the fixed `com.github.copilot/extensions/` directory; manifest settings cannot redirect discovery.

Use Copilot's native hook contract: `version: 1`, camelCase lifecycle keys such as `preToolUse` and `postToolUse`, and flat command entries. Read `toolName` and `toolArgs` from events. Do not use the legacy `PreToolUse`, `tool_name`, or `tool_input` fields.

Run `npm run test:packages` after package changes. It validates all local manifests against the vendored official schema and checks layout and marketplace/version consistency. Update the schema fixture from its canonical URL only when changing the targeted specification.

## Versioning

Every plugin uses [semantic versioning](https://semver.org/). Version numbers must stay in sync across three places:

| File | Field |
|---|---|
| `my-plugin/plugin.json` | `"version"` |
| `marketplace.json` | `"version"` in the plugin's entry |
| `my-plugin/CHANGELOG.md` | Top entry heading |

**On every change to a plugin**, bump the version and add a changelog entry in the same commit. Don't batch version bumps across multiple PRs.

## Node Scripts

Dependencies are declared in the root `package.json`. Any Node.js script (hooks, MCP servers, utilities, etc.) should require the install helper at the top to ensure `node_modules` are available:

```js
import install from '<path-to-team-kit>/common/install-if-necessary.mts';

install().then(() => import('./impl.mts'));
```

This runs `npm install` if `package.json` or `package-lock.json` have changed since the last install.

## Edit Tools

The `common/edit-tools.mts` module describes Copilot's native file-editing tools (`create`, `edit`, `apply_patch`) and provides `extractEditInputs(toolName, toolArgs)` to normalise their inputs into a common `EditInput[]` shape.

Use it in `preToolUse` hook scripts to inspect which files and changes an edit tool is about to make:

```js
import { extractEditInputs, editedFilePaths, isEditTool } from '<team-kit>/common/edit-tools.mts';

// In a hook script, read the event from stdin:
const event = JSON.parse(await readStdin());
if (isEditTool(event.toolName)) {
  const edits = extractEditInputs(event.toolName, event.toolArgs);
  const files = editedFilePaths(edits);
  // ... inspect edits or files
}
```
