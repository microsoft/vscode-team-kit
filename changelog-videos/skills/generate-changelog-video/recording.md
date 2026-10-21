# Recording a chapter

`videos/<slug>/demos/<id>.mjs` (an ES module, named after its chapter: `c2.mjs`). `prs demo <id> --slug <slug>` starts VS Code in a throwaway profile with a small workspace, runs `setup()`, then records the window while the default export runs, and writes `build/demos/<id>/`: `demo.json`, `clip.mp4`, `contact.png` (stills with each mark's box) and `screen.txt`.

```js
export const files = { 'README.md': '# My project\n' };          // the workspace (optional)
export const settings = { 'workbench.startupEditor': 'none' };   // user settings (optional)
export async function setup(ctx) { }                              // before the recording (optional)
export default async function demo(ctx) { }                       // recorded
```

## The helpers (`ctx`)

| Helper | What it does |
|--------|--------------|
| `run('Category: Title')` | runs a command from the Command Palette, typed as a user would |
| `palette(text)` | opens the Command Palette and types, without Enter; `picker()`, `pickerItem(label)`: the open quick pick and a row of it |
| `setting(id)` | opens the Settings editor on one setting (searches in it when it's open); returns its row (found by ID, not wording); its checkbox is `row.locator('.monaco-custom-toggle')` |
| `openUrl(url)` | opens a `vscode-insiders://` link (`scheme`) in the window, as if clicked on a web page |
| `terminal(command)` | opens a terminal (its prompt shows no user or machine name) and runs a command |
| `chat.input()`, `chat.send(text)`, `chat.reply()` | the chat input of this window; send a prompt; wait for the reply |
| `openAgentsWindow()` | in `setup()` only: opens the Agents window, and the recording is of it; returns its helpers |
| `moveTo(locator)`, `click(locator)`, `type(text)`, `press(key)`, `sleep(ms)` | the mouse and the keyboard, as a user |
| `mark(name, locator, { text, tight })` | follows that UI for the arrows (below) |
| `step(label)` | a moment worth a still |
| `cue(phrase, { nth, offset })`, `cue.end()`, `hold(seconds)` | keep the narration's pace (below) |

## Marks

An arrow points at a mark. A mark counts as on screen only when it really is: in the window, not transparent, not covered. Give each a locator that matches only its UI (filter by text only it shows). With `{ text }` it counts only while that text shows in it; with `{ text, tight: true }` its box is the text's own: a sentence of a dialog, a line a terminal printed. Stable locators: `setting(id)`, `.monaco-dialog-box`, `.quick-input-widget .monaco-list-row`, `.suggest-widget .monaco-list-row`, `.monaco-list-row` filtered by text, `a.action-label[aria-label^="…"]`, `.monaco-hover`, `.xterm-rows`. When one doesn't match, `prs demo inspect <id>` prints the text on screen with each element's class and box.

## Pacing

`cue(phrase)` waits until the chapter's narration says the phrase: do each step at the words that describe it, and the recording plays as recorded, in step with the voice. `cue.end()` waits for the end of the narration, and the clip ends there (cancelling a dialog after it isn't shown). Record after `prs voice`; when the narration changes, record again (`prs digest check` says so).

- Keep what an arrow points at on screen a second after its phrase. When the next step hides it (typing closes a menu), cue that step later: `cue('or a title', { offset: 1.3 })` ([example/demos/c4.mjs](example/demos/c4.mjs)).
- When the UI takes a varying time to show something (a link opening a dialog), `step()` when it shows and `hold(2.2)` before the step that hides it ([example/demos/c5.mjs](example/demos/c5.mjs)).
- A step that takes longer than the narration allows makes the next cue late (the check says which): start it at an earlier cue.

## The Agents window

Open it in `setup()`, and make what the recording needs there (a session: one short, harmless prompt, and its reply), so the recording starts on it. Oct 19, c2: "Two. In the Agents window, a session's first button is now New Nested Session, replacing Pin. One click starts a new chat inside it."

```js
export async function setup({ openAgentsWindow, sleep }) {
	const agents = await openAgentsWindow();
	await agents.chat.send('Suggest a one-line tagline for a to-do list app. Reply with the tagline only.');
	await agents.chat.reply();
	await sleep(1500);
}

export default async function demo({ page, moveTo, click, mark, step, cue }) {
	const rows = page.locator('.monaco-list-row').filter({ visible: true });
	const row = rows.filter({ hasText: /tagline|to-do/i }).first();
	const plus = row.locator('a.action-label[aria-label^="New Nested Session"]');
	const tooltip = page.locator('.monaco-hover, .workbench-hover').filter({ visible: true }).filter({ hasText: 'New Nested Session' }).first();
	const nested = rows.filter({ hasText: 'New Session' }).first();
	mark('tooltip', tooltip, { text: 'New Nested Session' });
	mark('nested', nested);
	await cue('a session\'s');
	await moveTo(row, 20);
	await cue('first button');
	await moveTo(plus, 15);
	await tooltip.waitFor({ state: 'visible', timeout: 10_000 });
	step('tooltip');
	await cue('One click', { offset: 0.6 });   // the tooltip stays a moment for its arrow
	await click(plus);
	await nested.waitFor({ state: 'visible', timeout: 15_000 });
	step('nested');
	await cue.end();
}
```

Its arrows: `"focus": [{ "part": "tooltip", "row": "nested" }, { "part": "nested", "row": "click", "at": "One click" }]`, and `"proof": "New Nested Session"`. Session rows are `.monaco-list-row` (their actions show on hover); the chat inputs' placeholders are "Chat with Copilot" (a session) and "Pitch your idea" (a new one); the slash menu is `.suggest-widget`.

Signed out (Linux, CI, or a profile whose session expired: `prs demo` prints which), there is no chat and no agent session, and `openAgentsWindow()` stops: draw those chapters. A build of main runs as Code OSS, signed in only when its own profile (`~/.vscode-oss-dev`) is: say so in your summary.

## Rules

- The proof is the PR's text that one of the marks shows (a label, a description), never text the demo typed. A removal has none: mark where it was (the list, searched for it) and name it in `removed` ([reference.md](reference.md)).
- Never change anything outside the throwaway profile: cancel install and sign-in dialogs; don't sign in, push or install.
- On Linux, `prs demo` stops when VS Code renders with the wrong fonts: never work around it.
- Shortcuts: next to a recording, write one as the recording shows it (Ctrl+T on Linux, ⌘T on a Mac).
