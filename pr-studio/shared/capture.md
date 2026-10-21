# The real app, captured with Playwright

When the PR changes something a user sees or does (a view, a menu, a dialog, a click and what follows), show it
happening in the real app: recorded for a video, as screenshots for a deck.

When the PR changes how something behaves (a fix, a different result for the same action), also show the before: the
same steps in the app without the change. For a change behind a setting that is off by default, the same build with
the setting off can be the before. Two cases show the after only:
- a new feature, with nothing to compare;
- a before a recording can't reproduce (real hardware, a physical key, a race).

A change nobody can see (speed, memory, internals) gets no footage: a screen that looks the same proves nothing. A
visible change is not done without its capture: the setup below is part of the job, never a reason to skip it.

## Capture it

1. **The steps.** The PR's "how to test", its screenshots and its tests give the steps and what should happen. Pick
   the shortest interaction that shows the change: its action and its result. Capture needs only the storyboard, so it
   can run while the rest is made.
2. **The apps.** Use the same kind of build, profile, window and sample data for both, so only the change differs.
   - VS Code: `prs app <slug>` prints `AFTER=<app>`, the oldest Insiders build with the PR's merge; `--before` adds
     `BEFORE=<app>`, the newest without it. Each downloads once, into `~/.cache/pr-studio/builds/`.
   - An open PR, or another app: build its base and its head.
3. **Script it with the capture kit:** `footage/capture.mjs` for a video (`assets/` for a deck), run once per app:
   `node capture.mjs <app> after`, and the same with `before`.

   ```js
   import { vscode } from '<studio>/capture/kit.mjs';
   await vscode({
     repo: { files: { 'notes.md': '# Notes\n\nOne line of notes.\n' } },
   }, async k => {
     k.mark('open');
     await k.click({ role: 'treeitem', name: 'notes.md' });
     await k.see({ role: 'tab', name: 'notes.md' });
     k.mark('preview');
     await k.command('Markdown: Open Preview to the Side');
     await k.see({ role: 'tab', name: '[Preview] notes.md' });
     await k.hold(1500);
     await k.shot('preview');
   });
   ```

   - **What it does:** it runs VS Code in a throwaway profile with its own `HOME` (the keychain linked, so macOS asks
     nothing). The window is light, at zoom 1, locked to 1280×720, with menus drawn inside it, a pointer, click rings and
     key badges. It records `<name>.webm` and `<name>.marks.json`, and deletes the profile whatever happens.
   - **Steps:**
     - `see`, `click`, `hover`, `type`, `press('Meta+S')`, `command(title)` (F1, the title, Enter), `hold(ms)`, and
       `shot(label)` (`<name>-<label>.png`, at twice the size); `k.name` is `after` or `before`, and `k.page` and
       `k.app` are Playwright's.
     - A target is a CSS selector, `{ role, name }`, `{ text }` or `{ label }`.
     - Each step waits until it can be done. Check each result with `see`: a capture counts only if it shows.
   - **Marks:** call `k.mark(<cue>)` just before each action the narration names, with the name of its cue. The video
     plays each action at its cue at real speed, so one recording fits any take of the voice.
   - **Finding things:** `await k.probe('here')` writes the window's accessibility tree (roles and names) and a
     screenshot. A failed step writes one itself, and names the closest elements.
   - **Options:**
     - `repo: { files, change, stage }`: the sample git repository it opens: `files` committed, then `change` written
       (`null` deletes a file), and staged with `stage: true`;
     - `workspace: <folder>`: a folder to open in place of `repo`;
     - `settings: { … }`: user settings over the kit's (a setting the PR adds is in the brief);
     - `record: false`: screenshots only (a deck);
     - `signIn: true`: for chat and anything AI, a copy of the user's signed-in Insiders state, deleted with the profile;
     - `args: [ … ]`: more arguments for the app, such as `--extensionDevelopmentPath=<folder>` for a sample extension
       that sets up what the change needs.
   - **Another app:** Playwright (`<studio>/node_modules/playwright-core`) with the same care: a throwaway profile, a
     fixed window, a pointer and click rings drawn in the page, and cleanup in a `finally`.
4. **Readable and private.**
   - Same steps at the same pace in both apps: rest on a target before a click, hold each result a second or two, and
     type at a human pace (the kit does).
   - Crop to the part that changes, with the same crop for the before and the after.
   - Keep the account's name and anything private out of the frame.
5. **Keep it:** the script, the recordings with their marks, and a screenshot of each state, in `footage/` (a deck:
   `assets/`). The setup prunes builds unused for 14 days.

Then use it as your skill says: a `ui.footage` beat in a video, `image` and `split` slides in a deck.
