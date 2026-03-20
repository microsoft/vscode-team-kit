# Writing Plugins

This repo is a plugin marketplace following the [Open Plugin spec](https://github.com/anthropics/open-plugin). Each top-level directory containing a `.plugin/plugin.json` is a plugin.

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
