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
   the shortest interaction that shows the change: its action and its result.
2. **The apps.** You need the app with the change and, for a before and after, the app without it:
   - Use the same kind of build, profile, window and sample data, so only the change differs. Run each with a throwaway
     profile in a temp folder, never in the user's own windows or files.
   - VS Code needs no checkout or build: Insiders builds by commit.
     - `https://update.code.visualstudio.com/api/commits/insider/<platform>` lists them, newest first (`darwin-arm64`,
       `darwin`, `linux-x64`).
     - `https://update.code.visualstudio.com/commit:<sha>/<platform>/insider` downloads one (a zip of about 300 MB).
     - `gh api repos/<owner>/<repo>/compare/<merge commit>...<build sha> --jq .status` says whether a build has the
       change: `ahead` or `identical` has it, `behind` or `diverged` doesn't. The merge commit comes from
       `gh pr view <url> --json mergeCommit`.
     - The newest build without the change is the before, and the oldest with it is the after.
   - For an open PR, build its base and its head.
3. **Keep it to itself, signed in when needed.**
   - **Home:** when the app reads the user's home (VS Code lists their personal skills and agents from it), give it its
     own `HOME` in the temp folder, with the user's keychain linked in (macOS: `<home>/Library/Keychains` →
     `~/Library/Keychains`). Without it, macOS asks the user in a dialog.
   - **Sign-in:** when the demo needs the app signed in (chat, anything AI), copy the signed-in state of the same kind
     of app into the throwaway profile. For VS Code:
     - `sqlite3 <signed-in profile>/User/globalStorage/state.vscdb ".backup <profile>/User/globalStorage/state.vscdb"`;
     - the signed-in profile is `~/Library/Application Support/Code - Insiders` for Insiders, `~/.vscode-oss-dev` for
       Code OSS;
     - add `"update.mode": "none"` to the profile's settings.
   - Keep the account's name out of the frame.
   - The script deletes its temp folder (profile and `HOME`) in a `finally`, so no run leaves the copy of the sign-in
     behind.
   - Keep the temp folder's path short (`mktemp -d /tmp/prs-XXXX`, or `~/.prs-XXXX` where `/tmp` isn't allowed): VS
     Code puts a socket in its profile, and macOS caps a socket's path at about 100 characters, so a deep folder makes
     it exit at once.
4. **Drive it with Playwright** (`<studio>/node_modules/playwright-core`: `_electron.launch` for an Electron app, a
   browser context for a web app). Do the same steps at the same pace in each app. Wait until each step can be done;
   after it, check that its result is on screen. A capture counts only if it is.
5. **Readable.**
   - Use a window of about 1280×720 with the app zoomed in (VS Code: `"window.zoomLevel": 1`), and draw menus in the
     window, where captures see them (VS Code on macOS: `"window.menuStyle": "custom"`). Size the window once the app
     has loaded, then lock it (`setResizable(false)` on its `BrowserWindow`), so it can't change mid-recording.
   - For screenshots of an Electron app, launch it with `--force-device-scale-factor=2` and take them with the window's
     `capturePage()` (through `electronApp.evaluate`): `page.screenshot()` can clip a zoomed window.
   - Crop to the part that changes, with the same crop for the before and the after.
   - A recording has no pointer: draw one in the page (an arrow above everything, following the mouse) and a ring that
     grows on each click.
   - Move the mouse in steps (`mouse.move(x, y, { steps: 25 })`), rest on the target, click, and hold each result for a
     second or two.
   - Show a shortcut's keys in a badge while they are pressed, and type at a human pace.
6. **Keep it:**
   - the scripts, the recordings and a screenshot of each state, in `<studio>/videos/<slug>/footage/` for a video, or
     `<studio>/decks/<slug>/assets/` for a deck;
   - the downloaded builds can go once it is delivered.

Then use it as your skill says: a `ui.footage` beat in a video, `image` and `split` slides in a deck.
