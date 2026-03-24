# Writing Plugins

This repo is a plugin marketplace following the [Open Plugin spec](https://open-plugins.com/plugin-builders/specification.md). Each top-level directory containing a `.plugin/plugin.json` is a plugin.

## Creating a New Plugin

1. Create a directory at the repo root with your plugin name (lowercase, hyphens ok, e.g. `my-plugin`).
2. Add `.plugin/plugin.json` with at minimum a `name` field:
   ```json
   {
     "name": "my-plugin",
     "version": "1.0.0",
     "description": "Brief description of what the plugin does."
   }
   ```
3. Register the plugin in `marketplace.json` by adding an entry to the `plugins` array:
   ```json
   {
     "name": "my-plugin",
     "source": "./my-plugin/",
     "description": "Brief description.",
     "version": "1.0.0"
   }
   ```
4. Add your components (commands, agents, skills, rules, hooks, MCP servers, etc.).
5. Update the **Plugins** table in `README.md`.

For the full specification on plugin structure, component types, and file formats, fetch https://open-plugins.com/plugin-builders/specification.md.

## Node Scripts

Dependencies are declared in the root `package.json`. Any Node.js script (hooks, MCP servers, utilities, etc.) should require the install helper at the top to ensure `node_modules` are available:

```js
import install from '<path-to-team-kit>/common/install-if-necessary.mts';

install().then(() => import('./impl.mts'));
```

This runs `npm install` if `package.json` or `package-lock.json` have changed since the last install.

## Edit Tools

The `common/edit-tools.mts` module describes the built-in file-editing tools (`replace_string_in_file`, `multi_replace_string_in_file`, `apply_patch`) and provides `extractEditInputs(toolName, toolInput)` to normalise their inputs into a common `EditInput[]` shape.

Use it in PreToolUse hook scripts to introspect which files and changes an edit tool is about to make:

```js
import { extractEditInputs, editedFilePaths, isEditTool } from '<team-kit>/common/edit-tools.mts';

// In a hook script, read the event from stdin:
const event = JSON.parse(await readStdin());
if (isEditTool(event.tool_name)) {
  const edits = extractEditInputs(event.tool_name, event.tool_input);
  const files = editedFilePaths(edits);
  // ... inspect edits or files
}
```
