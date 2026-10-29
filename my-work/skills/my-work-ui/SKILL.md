---
name: my-work-ui
description: UX principles for the My Work canvas (the my-issues-triage panel). Use before changing, rebuilding, restyling or customising any part of its UI, including layout, toolbars, lists, bands, the details pane, buttons, colours and density, and when reviewing such a change. It keeps the panel looking and behaving like VS Code, simple and quiet.
---

# My Work canvas: UX principles

The My Work panel must look and behave like a part of VS Code, not like a web app. It should stay simple: one row of controls per view, no repeated labels, and no boxes where a line will do. Apply every rule below to new UI as well as existing UI. If a request conflicts with a rule, say which rule and ask before breaking it.

Code: `com.github.copilot/extensions/my-work/assets/` (`app.js`, `style.css`, `index.html`) and `lib/vscodeTheme.mjs`. Asset edits reload open panels automatically. Changes in `lib/` need an extensions reload and the canvas reopened.

## 1. VS Code look

- **Colours come from the VS Code theme.** `lib/vscodeTheme.mjs` maps the host theme into CSS variables. Use these variables and never hard-coded colours. Each has a fallback for the panel's own Light and Dark themes, for example `var(--section-bg, transparent)`.

  | Element | Variables | VS Code tokens |
  |---|---|---|
  | Band and section headers | `--section-bg/fg/border` | `sideBarSectionHeader.*` |
  | Row hover | `--hover` | `list.hoverBackground` |
  | Selected row | `--sel-bg/fg`, `--sel-active-bg/fg` | `list.inactiveSelection*`, `list.activeSelection*` |
  | Focus | `--focus` | `list.focusOutline`, `focusBorder` |
  | Counts | `--badge-bg/fg` | `badge.*` |
  | Primary button | `--accent`, `--accent-fg`, `--btn-hover`, `--btn-border`, `--btn-separator` | `button.*` |
  | Other buttons | `--btn2-bg/fg/hover/border` | `button.secondary*` |
  | Inputs, dropdowns | `--input-*`, `--dropdown-*` | `input.*`, `dropdown.*` |
  | Icon actions | `--toolbar-hover`, `--icon-fg` | `toolbar.hoverBackground`, `icon.foreground` |
  | Toggled actions | `--toggle-bg/fg/border` | `inputOption.active*` |
  | Tabs | `--tab-fg`, `--tab-active-fg/border` | `panelTitle.*` |

  When VS Code has a token for something new, map it in `toTokens()` and use it.
- **Shapes and type follow VS Code.**
  - 4px corners (`--r`). No shadows on panes, buttons or cards.
  - The VS Code system font and 13px base size.
  - Focus is a 1px `--focus` outline inset by 1px.
- **Icons are codicons.** The font comes from the VS Code installation. A new icon needs its `.codicon-<name>::before` code point, taken from VS Code's `src/vs/base/common/codiconsLibrary.ts`.
- **Text:** sentence case. The only uppercase text is 11px bold pane and section headers, as in VS Code.

## 2. Layout and density

- **Two panes:** the list on the left and the details on the right. When the panel is narrow they stack, list on top. The page grid uses `minmax(0, 1fr)`, so wide content (a long code line) can never push a pane past the window.
- **Density follows VS Code's `window.density.layout`**, read from the user settings and pushed live. The panel's Density setting offers VS Code (follow), Default and Compact.
  - **Default:** the panes are cards with a 4px gap and small padding.
  - **Compact:** no gaps and no corners; the panes are joined by one 1px border. Spacing inside is tighter.
- **The sash between the panes** behaves like a VS Code sash:
  - It is 4px wide and highlights in `--accent` after hovering a moment.
  - Drag it, or use the arrow keys when it has focus. Double-click resets it.
  - The size is saved (`listWidth`, or `listHeight` when stacked).

## 3. Lists and bands

- **A band is a VS Code view pane header.** It is full width and 22px tall, with an 11px bold uppercase title, a 16px chevron, header colours and a count badge on the right.
  - Every band collapses, and its state is saved in `collapsedGroups`.
  - Its one-line description is the title's tooltip, not a line under it.
- **Collapse All / Expand All** sits in each view's action bar and toggles icon and label with the state.
- **A row is a title plus at most one meta line.** The meta line holds the number, age, and only the tags that change a decision.
  - No description or reason lines: those belong in the tooltip and the details pane.
  - Rows are square and use the list hover and selection colours.
- **Row actions are an action bar.** They show on hover or focus as 22px icon buttons with 5px corners, on an opaque background so they cover the title. Each has a tooltip and an `aria-label`.
- **My Work groups** have In progress / To do / Done stages:
  - Stages collapse; Done starts collapsed.
  - A session that works on or fixed an issue stands for that issue, so nothing is listed twice.
  - Chevrons line up on a 16px grid: group 16px, stage 32px, row dot 48px.

## 4. Toolbars and actions

- **One toolbar row per view:** the area picker, then an icon action bar, then Refresh.
  - Counts sit next to their icons, for example Route 2, Auto-dismiss 7, Safe to dismiss 12.
  - Labels and status ("Updated 1m ago") go in tooltips.
  - Don't add rows of pills. A filter that switches on is a toggle action using `--toggle-*`.
- **Search works like the Settings and Keyboard Shortcuts editors.**
  - One full-width input with its actions inside it on the right: Group by (an icon over an invisible native select), Recent filters, Refresh.
  - Source tabs (Bugs, Features, All, Reviews) go under the input as VS Code panel tabs with an underline on the active one. A secondary dropdown goes on the right of that row.
- **Buttons:**
  - Give each place one primary button. Everything else is a secondary button or an icon action.
  - A primary action with alternatives is a split button: one joined shape with a `--btn-separator` line, not two separate buttons.
- **Keep it simple.** Before adding a control, look for an existing place for it: a menu, a tooltip, or the details pane. Rare actions go in menus, never in the always-visible toolbar.

- **Chat inputs look like VS Code's chat input.** Every input is one bordered box (`--input-bg`, `--input-border`, `--focus` border while focused, 6px corners) built by the same `.composer` markup.
  - The auto-growing text area is on top. Under it is a toolbar row with Send as a 22px icon action on the right, coloured `--accent` once there is text or focus. It is never a big filled button.
  - Pasted screenshots show above the text.
  - Enter sends; Shift+Enter adds a new line.
  - Never build a separate input style for a new chat surface: reuse `.composer`.

## 5. Details pane

- **The header** has the title (15px), one meta line (number, kind, age) and the primary split button on the right.
- **Sections are VS Code panes.** Every block (Recommended next, On GitHub, Comments, Your checks, Sweeper's evidence, Works on, Latest reply…) gets a full-width section header with a chevron, built by `sectionizeDetail()` from `.reco-h`, `.linked > .linked-head`, `.gh-title` and `.gh-comments-h`.
  - Header actions such as "Ask the chat" sit on the right of the header.
  - Folded sections stay folded, keyed by name (`d-<name>` in `collapsedGroups`). A new block must use one of these header classes, so it becomes a section automatically.
- **Flat content:** no cards, boxes, tinted backgrounds or shadows inside sections.
  - Status messages (Needs you, Your rules, Sweeper proposes) are an icon line with a 2px coloured left edge.
  - Recommendations are plain list rows.
- **Clamp long text:** the description gets "Show full description". Comments over about 240px get "Show more", remembered for the session. A commenter's role (member, owner) is quiet text, not a chip.

## 6. Behaviour

- **Accessibility:**
  - Every icon-only control has an `aria-label` and a tooltip.
  - Headers and toggles are buttons with `aria-expanded`, and Enter or Space toggles them.
  - The list supports keyboard navigation, and Alt+↑/↓ reorders items within a section.
- **Persist what the user arranges:** collapsed bands and sections, pane size, density, reorder, grouping and filters.
- **The panel never changes GitHub on its own.** Actions that post, close, assign or dismiss need the user's explicit click or approval. Panel requests to the chat say "change nothing on GitHub".

## 7. Check every UI change

Before committing, check the change live in the panel (screenshots) for each of:

1. Both densities, Default and Compact, and the narrow stacked layout.
2. The VS Code theme and the panel's own Light and Dark themes. Fallbacks must work when a token is missing.
3. No horizontal overflow, and nothing clipped at the right edge, including the header split button.
4. Hover, selection and focus states, and the collapsed and expanded state of bands and sections.
5. Then run `npm test` in `my-work/` and `npm run test:packages` at the repository root. Add a line to `CHANGELOG.md`.
