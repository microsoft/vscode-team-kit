---
name: use-component-explorer
description: Read this skill when the project uses the component explorer and you deal with UI (fixtures, screenshots, read when adding/changing UI).
---

# Skill: Use Component Explorer

## Writing Fixtures

Fixture files end in `.fixture.ts` or `.fixture.tsx` and are auto-discovered by the Vite plugin.

### Core Pattern

Every fixture has a `render` function that receives a container DOM element and a `RenderContext`:

```ts
import { defineFixture } from '@vscode/component-explorer';

export default defineFixture({
  render: (container) => {
    // Render your component into container
    return { dispose: () => { /* cleanup */ } };
  },
});
```

### Render Context

The second argument to `render` provides:
- `signal` — `AbortSignal` for cancellation (check `signal.aborted` or listen to `'abort'`)

```ts
defineFixture({
  render: async (container, { signal }) => {
    const data = await fetch('/api/data', { signal });
    container.textContent = await data.text();
  },
});
```

### React Fixtures

```tsx
import { createRoot } from 'react-dom/client';
import { defineFixture } from '@vscode/component-explorer';
import { MyComponent } from './MyComponent';

export default defineFixture({
  render: (container) => {
    const root = createRoot(container);
    root.render(<MyComponent />);
    return { dispose: () => root.unmount() };
  },
});
```

### Fixture Groups

Group related fixtures in a single file:

```tsx
import { defineFixture, defineFixtureGroup } from '@vscode/component-explorer';

export default defineFixtureGroup({
  Default: defineFixture({ render: (c) => { /* ... */ } }),
  WithError: defineFixture({ render: (c) => { /* ... */ } }),
  Disabled: defineFixture({ render: (c) => { /* ... */ } }),
});
```

Groups can have metadata (path prefix, labels):

```tsx
export default defineFixtureGroup({ path: 'Forms/', labels: ['forms'] }, {
  Primary: defineFixture({ /* ... */ }),
  Secondary: defineFixture({ /* ... */ }),
});
```

### Fixture Variants

For closely related variants rendered side-by-side:

```tsx
import { defineFixture, defineFixtureGroup, defineFixtureVariants } from '@vscode/component-explorer';

export default defineFixtureGroup({
  Sizes: defineFixtureVariants({
    Small: defineFixture({ render: (c) => { /* ... */ } }),
    Medium: defineFixture({ render: (c) => { /* ... */ } }),
    Large: defineFixture({ render: (c) => { /* ... */ } }),
  }),
});
```

### Background

Set `background: 'dark'` for components designed for dark backgrounds:

```ts
defineFixture({
  background: 'dark',
  render: (container) => { /* ... */ },
});
```

## Important Rules

### Fixtures Must Be Side-Effect Free

Fixtures must not mutate global state. Each fixture's `render` function should only modify the provided `container` element and return a `dispose` function that fully cleans up. No writes to `document.body`, global variables, `localStorage`, shared singletons, or other state outside the container. This ensures fixtures can be rendered in any order, in parallel, and multiple times without interference.

### Use a Local Wrapper Instead of `defineFixture` Directly

Do **not** use `defineFixture` / `defineFixtureGroup` from `@vscode/component-explorer` directly in fixture files. Instead, create a project-local wrapper (e.g. `fixtureUtils.ts`) that applies project-wide conventions (theme variants, shared styles, DI setup, disposable management). Fixture files then import from that local module.

This ensures consistency across all fixtures and makes it easy to evolve conventions in one place.

Example local wrapper:

```ts
// src/testing/fixtureUtils.ts
import { defineFixture, defineFixtureGroup, defineFixtureVariants } from '@vscode/component-explorer';

export { defineFixtureGroup };

interface MyFixtureContext {
  container: HTMLElement;
}

interface MyFixtureOptions {
  labels?: string[];
  render: (context: MyFixtureContext) => void | { dispose(): void } | Promise<void | { dispose(): void }>;
}

export function defineMyFixture(options: MyFixtureOptions) {
  return defineFixture({
    labels: options.labels,
    render: (container) => options.render({ container }),
  });
}
```

Fixture files then use the local wrapper:

```tsx
// src/components/Button.fixture.tsx
import { defineMyFixture, defineFixtureGroup } from '../testing/fixtureUtils';
import { createRoot } from 'react-dom/client';
import { Button } from './Button';

export default defineFixtureGroup({
  Primary: defineMyFixture({
    labels: ['.screenshot'],
    render: ({ container }) => {
      const root = createRoot(container);
      root.render(<Button variant="primary">Click me</Button>);
      return { dispose: () => root.unmount() };
    },
  }),
});
```

See **Project-Specific Wrapper Functions** below for a more advanced example with theme variants and disposable management.

## Recommended Patterns

### Extract Render Functions

For complex fixtures, extract render logic into standalone named functions rather than inline lambdas. This improves readability and makes it easy to share setup across fixtures:

```ts
export default defineFixtureGroup({
  Buttons: defineFixture({
    labels: ['.screenshot'],
    render: renderButtons,
  }),
  InputBoxes: defineFixture({
    labels: ['.screenshot'],
    render: renderInputBoxes,
  }),
});

function renderButtons(container: HTMLElement): void {
  container.style.padding = '16px';
  container.style.display = 'flex';
  container.style.gap = '8px';
  // ... create and append button elements
}

function renderInputBoxes(container: HTMLElement): void {
  // ...
}
```

### Set Explicit Container Dimensions

Fixtures should set explicit width/height on the container for deterministic screenshots:

```ts
function renderEditor(container: HTMLElement): void {
  container.style.width = '600px';
  container.style.height = '400px';
  // ...
}
```

### Project-Specific Wrapper Functions

For large projects, create a shared utility file (e.g. `fixtureUtils.ts`) with wrapper functions that apply common setup to all fixtures. Examples:

- Auto-create Dark/Light theme variants using `defineFixtureVariants`
- Inject shared services or dependency injection containers
- Manage cleanup via a disposable store
- Apply project-wide styles or container setup

```ts
// fixtureUtils.ts — project-specific wrapper
import { defineFixture, defineFixtureVariants } from '@vscode/component-explorer';

interface MyFixtureContext {
  container: HTMLElement;
  disposables: { add<T extends { dispose(): void }>(d: T): T };
}

interface MyFixtureOptions {
  labels?: string[];
  render: (context: MyFixtureContext) => void | Promise<void>;
}

function defineMyFixture(options: MyFixtureOptions) {
  const createForTheme = (theme: 'dark' | 'light') => defineFixture({
    isolation: 'none',
    background: theme,
    render: (container) => {
      const disposables = new DisposableStore();
      applyTheme(container, theme);
      const result = options.render({ container, disposables });
      return isPromise(result) ? result.then(() => disposables) : disposables;
    },
  });
  return defineFixtureVariants(options.labels ? { labels: options.labels } : {}, {
    Dark: createForTheme('dark'),
    Light: createForTheme('light'),
  });
}
```

Then fixture files become concise:

```ts
import { defineMyFixture, defineThemedGroup } from './fixtureUtils';

export default defineThemedGroup({
  MyComponent: defineMyFixture({
    labels: ['.screenshot'],
    render: renderMyComponent,
  }),
});

function renderMyComponent({ container, disposables }: MyFixtureContext): void {
  container.style.width = '400px';
  // ...
}
```

### Async Render with Services

When components need async setup (e.g. loading services, fetching data):

```ts
defineFixture({
  render: async (container, { signal }) => {
    const services = await createServices();
    const widget = services.createWidget(container, { /* options */ });
    return { dispose: () => widget.dispose() };
  },
});
```

### Parameterized Render Functions

Share render logic across fixtures with different configurations:

```ts
interface WidgetFixtureOptions {
  code: string;
  width?: string;
  height?: string;
}

export default defineFixtureGroup({ path: 'editor/' }, {
  TypeScript: defineFixture({
    labels: ['.screenshot'],
    render: (container) => renderWidget({ code: tsCode, width: '600px', height: '400px' }, container),
  }),
  Markdown: defineFixture({
    labels: ['.screenshot'],
    render: (container) => renderWidget({ code: mdCode, width: '500px' }, container),
  }),
});

function renderWidget(options: WidgetFixtureOptions, container: HTMLElement): void {
  container.style.width = options.width ?? '400px';
  container.style.height = options.height ?? '300px';
  // ... setup widget with options.code
}
```

## File Naming Convention

Place fixture files next to the component they test:

```
src/
  components/
    Button/
      Button.tsx
      Button.fixture.tsx       ← fixture file
    Input/
      Input.tsx
      Input.fixture.tsx
```

Or in a dedicated test directory (adjust the `include` glob in the vite plugin):

```
src/
  components/
    Button.tsx
test/
  componentFixtures/
    Button.fixture.ts
```
