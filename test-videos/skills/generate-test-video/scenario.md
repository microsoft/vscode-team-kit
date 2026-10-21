# scenario.mjs and captions.json

## scenario.mjs

```js
export default {
	signedIn: false,     // true: a copy of the user's Insiders sign-in (chat, agents, AI)
	agents: true,        // the Agents window (--agents); false: an editor window
	settings: {},        // user settings for the Default and Agents profiles; override the runner's defaults
	keybindings: [],     // keybindings.json, e.g. [{ key: 'ctrl+alt+t', command: 'files.openTimeline' }]
	workspace: { name: 'demo', files: { 'src/a.ts': '…' }, git: true, // a throwaway folder; a git repository by default
		commits: [{ message: 'Add a', files: { 'a.ts': '…' }, daysAgo: 3 }] }, // older commits, oldest first
	openWorkspace: true, // editor window: open it at launch (Agents window: ctx.h.agentsOpenFolder)
	args: [], env: {},   // extra arguments ('--profile-temp') and environment
	steps: [
		{ id: 'prepare', hidden: true, async run(ctx) { /* not in the video */ } },
		{ id: 'setup', async run(ctx) { /* the first shown step */ return 'what was checked'; } },
	],
};
```

- **Lines and bands:** every shown step has a line in `voice/lines.json` and a band in `captions.json` under its `id`. Hidden steps run only before the first shown step.
- **The run:** `run.mjs` runs the scenario in a throwaway profile with its own `HOME` (your keychain linked in). It uses a run folder, `~/.cache/test-videos/t/tv-…`, which it prints and deletes at the end.
  - Recording writes `run/recording.webm`, `run/timeline.json` and `run/manifest.json`.
  - `--probe` records nothing: it runs the hidden steps (with `--until <id>`, also the shown ones through `<id>`) and saves `run/probe.jpg` and `run/probe-aria.yml`. A launch takes about 20 s.
  - Defaults: dialogs are drawn in the window, hovers wait 60 s, and when signed out there's no Chat side bar.
  - At most 2 VS Code instances run at once across agents, so "waiting for a free VS Code slot" is normal. Never kill other runs.

## ctx

- **What a step gets:** `page` (Playwright; prefer roles and labels), `app` (for `app.evaluate`), `work`, `step`, `t0` (the step's start, `Date.now()` ms), and `paths.workspace`, `.home` (where `~/.copilot` lives), `.data` and `.tmp`.
- **Timing:**
  - `at(s)` waits until `s` seconds after the step started.
  - `cue('word', nth)` is when that word of the step's sentence starts. It matches whole words and ignores punctuation, so it's `cue('right-click')`, not `cue('right')`.
  - `await ctx.at(ctx.cue('close') - 0.3)` times an action to a word. Give each action its own word ("click, Command-click, then right-click"), or they run together.
  - `hold()` waits for the sentence's end.
- **`look(locator or box)`** sends the zoom there; mark everything the viewer must see. `mark('layout')` says things moved.
- **`cut(label, async () => …)`** leaves something slow out of the video (a wait, a reply), showing a "label" badge instead.
  - Call it after `hold()`, and `look` at the result after it.
  - Keep the item's instruction to wait in the band.
- **`setSettings({ key: value })`** changes settings mid-run, the way a tester edits `settings.json`; `undefined` removes one. Do setup that comes after the first shown step inside a `cut`.
- **`shot(name)`** saves a screenshot to `run/shots/` while probing.

## ctx.h

- **Pointer:** `hover(locator, {ms, fx, fy})`, `glide(x, y, ms)`, `click({button: 'right', modifiers: ['Meta']})` (both optional; modifiers show in the badge), `box(locator)`. The drawn pointer follows only these, so it never jumps. `locator.click()` is fine in `prepare`.
- **Keys:**
  - `press('Meta+P')` shows ⌘P in the badge; `press('Enter', '↵')` shows a label of your choice.
  - `badge(text)`, `type(text)`.
  - `paste(text)` inserts like a paste, without touching the clipboard.
- **VS Code:**
  - `quickOpen(file)`;
  - `command(label, typed)` runs only the Command Palette row labeled exactly `label`, and throws otherwise;
  - `pickRow(label)`, `quickInput()`, `agentsOpenFolder(folder)`.
- **Chat:** `pickModel(name)` picks the model and checks its label; also `modelLabel()`, `chatRunning()` and `cancelChat()`.

## captions.json

`{ "name": "tpi-<n>-how-to-test", "title": "…", "steps": { "setup": { "label": "SET UP", "do": "…", "tag2": "USER SETTINGS", "look": "`\"setting\": value`" }, "step1": { "label": "STEP 1 OF 3", "do": "…", "look": "…", "zoom": 1.5, "dy": 12 } } }`

- **`zoom`:** 2 by default, any number, or `false` (the text then gets the band's full width).
  - It shows about 265 × 70 CSS px of the page at 2×, 355 × 95 at 1.5×, and 425 × 115 at 1.25×. A bigger `look` box is centered and cut.
  - It pans in the 0.4 s before each `look`, so look at a result 0.45 s or more after the click that causes it.
  - `dy` moves it down.
- **Text:**
  - DO and LOOK FOR share 4 lines (2+2, 3+1 or 1+3). `compose.py` fails past that: cut words, never the font.
  - About 4 words per second of the step; `check.py` flags anything over 4.5.
  - `backticks` mark code. ⌘ ⇧ ⌥ ⌃ ↵ ⎋ render.
- **Captions** come from the voice, split at `. ! ? :` and at commas after 7 words. Reword a caption that `check.py` marks CHECK.

## Patterns

- **Waiting:** wait for states (`locator.waitFor()`, polling), not time. Use fixed waits only to let a viewer see something.
- **Editors:** click `.view-lines`, then `type` or `paste` one line at a time. Or set `"editor.autoClosingBrackets"` and `"editor.autoClosingQuotes"` to `"never"` and `"editor.autoIndent"` to `"none"`. Or write the files in `prepare`. Text read back has U+00A0 for spaces.
- **Lists that refresh after a click** (the Timeline) can drop a ⌘-click made too soon: wait until the rows stop changing, and check the selection before acting on it.
- **Focus:** the window can't lose focus here (Playwright keeps it, and `blur()` shrank the window). Say what the recording did instead, and flag it as a change.
- **The integrated browser** is recorded. Serve a localhost page from `prepare`, and stop it at the end.
- **A zoom that missed:** after recording, copy `run/timeline.json` to `run/timeline.recorded.json` once (a new recording deletes it), fix its `look` boxes or times, and compose again. Never edit a check's result.
- **MCP servers:** never `npx -y`.
  - Copy `$KIT/mcp-mini-server.mjs` into the workspace and use `"command": "node", "args": ["<path>", "<name>"]`. Its tools are `ping` and `get_env`, and it logs requests to `$MCP_MINI_LOG`.
  - When the item's JSON must keep `npx`, put a stub `npx` first on the `PATH` (`env`), and say so in the band.
- **Signed in, with a small request budget:**
  1. Probe everything before the first send (`--until`).
  2. Spend one request on a probe that saves every later state.
  3. Dry-run the later steps with `!echo hello` as the first prompt: an Agent Host session runs it without the model. Switch it with an environment variable.
  4. Record once.
  - Log each send in `<work>/requests.log`.
  - Call `h.pickModel(<a low-cost model>)` before every send (the default model differs between runs), and wait for a reply inside a `cut`.
  - End with `h.cancelChat()`; otherwise quitting stops on "A session is in progress".
  - VS Code's own model calls (titles) don't count. The video shows the account's name and avatar.
- **Agents window:**
  - The new-session input is `.sessions-chat-editor`; in a session it's `.interactive-input-part`.
  - Chats are tabs in the "Chats" tablist.
  - Look at a request's bubble, not `.interactive-request`.
  - The side panel's state varies, so open or close it in `prepare`.
