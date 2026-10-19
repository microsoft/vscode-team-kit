# Guide: making a "how to test" video

You make one short video that shows a tester how to test one item (a TPI, a fixed bug, or a few fixed bugs of one area): what to set up, what to do, and what to look for, in the real VS Code (Insiders). Testers watch it instead of reading the item and start testing right away, so it must be fast and exact.

In the commands below, `$KIT`, `$PY`, `$WORK` and `$DELIVERY` are the values `scripts/setup.mjs` prints, and `<work>` is your item's folder, `$WORK/<name>/`.

**Examples** (in `examples/` next to this guide; read one before writing your own, and copy its patterns, not its words):
- `issue-342051/`: one issue, in an editor window, with a flag and a recap (`scenario.mjs`, `captions.json`, `voice/lines.json`, `flags.json`, `cards.json`).
- `bugs-welcome-messages/`: three fixed bugs of one area in one video, in the Agents window.

## The video

- **Look:** the recorded VS Code window, with a dark band above it.
  - The band shows the step, **DO** (what to do), **LOOK FOR** (what you should see), or another tag such as **USER SETTINGS**.
  - The band also has a 2× zoom of the spot the pointer is on. Turn the zoom off for steps where it doesn't help.
  - A pointer, click rings and key badges show what is clicked or pressed.
  - A voice (Kokoro at 1.1×, or MAI-Voice-2 at 1.2× with an Azure key) says one short sentence or two per step.
- **Fast:** no intro or title card; the first step is the setup. As short as the steps allow, typically 25–45 s for the walkthrough, plus the slides.
  - The voice says the action and the result, in plain words. Exact names, settings and values go in the band, not the voice.
  - Pointer moves take 250–350 ms. Each step ends 0.25 s after its sentence.
- **Exact:** every step does the action in the app and checks the result, for example in the DOM or the focus. It returns a sentence on success and throws on failure. Never show a result the app didn't produce. When the band claims a visual state ("dashed", "rounded", "red"), check it in the app: read the computed style of the element (`getComputedStyle`), the way the item's PR tests do.
  - **Hovers:** the runner sets `workbench.hover.delay` to 60 s, so stray hovers never show. A step that shows a hover sets a shorter delay, and the band says so. When the item is about how soon a hover or label appears, record it with VS Code's real default (1500 ms on macOS) instead.
- **Faithful to the test:** a tester follows the video instead of the issue, so it must match the item exactly. Every setup item and every step of the item is shown in the item's order, or listed in your report as not shown with the reason. Use the item's exact names, settings and values, labels, and expected results. Add nothing the item and its PRs don't support.
  - **Title:** "How to test TPI #<n> · <short title> · Insiders from <date> or newer", with the phrase from `$PY $KIT/firstbuild.py <merge commit of the item's PR>`, not "1.143.0 or newer": early 1.143.0 builds lack recent fixes. Use the **newest** of the item's merge commits, and copy the phrase exactly: when an earlier build of the same day lacks the commit, it names the build ("Insiders from Oct 16 (0b37947e9c) or newer").
  - **Numbering:** number the band labels by the item's own steps ("STEP 2 OF 3", or "STEPS 3–4 OF 8" for two merged steps), so a tester can follow the video and the issue side by side.
  - **Every place the item names:** if it names two windows (editor and Agents), cover both. Record each window in its own work folder, number the steps across both, then join them with `concat.py`.
  - **Show each state the item asks to see** long enough to be seen (at least 1.2 s, with the zoom on it): appears, disappears, comes back.
  - **Keyboard steps:** if the item says "by keyboard", show the keys (badges), or say in the band how to get there.
  - **Cleanup:** if the test changes anything a temporary profile doesn't undo (files in `~`, `~/.copilot/settings.json`, which the Copilot CLI also reads), end with a short Cleanup step: what to undo, in the band, and one sentence.
  - **Profiles and settings files:**
    - The runner opens the **default** profile of a throwaway user-data folder. That's like a temporary profile for most settings, but not for **application-scoped** ones (`scope: ConfigurationScope.APPLICATION` where the setting is registered; check each setting the video tells testers to set).
    - In a temporary or other non-default profile, application-scoped settings are ignored in that profile's User Settings (JSON). VS Code marks them "can only be set in the settings file from the Default profile". Testers must use **Preferences: Open Application Settings (JSON)**, a file that survives deleting the temporary profile (so it belongs in the Cleanup step).
    - If the item asks for a temporary profile, say "in a temporary profile" in the setup band only when that's true for what you show. If the item also sets an application-scoped setting, launch a real temporary profile (`args: ['--profile-temp']`) and show the right file for each setting. The runner writes its default settings (and `settings`) to the Default profile's file only, so in a temporary profile the window-scoped ones (zoom, hover delay, tips) don't apply: set them in a hidden `prepare` step (write them to the temporary profile's `settings.json`).
    - The Agents window always uses its own built-in profile, which shares the Default profile's settings: settings set from it land in the Default profile's file.
  - **What differs on a tester's machine:** if the recording does something a tester's machine won't (a setting changing how a dialog looks, a delay), say what the tester sees instead.
- **The steps:** follow the item's own steps and order, merged where one picture covers two.
  - **Setup:** setting names and values go in the band, in `backticks`.
  - **A step you can't show** (it needs a person, special hardware, an account you don't have): leave it out, and list it in your report.
  - **A last "repeat in …" step** (another theme or window) can be short.

## The kit

- `node $KIT/run.mjs <work> [--probe [--until <step>]] [--build <app>]`
  - Without `--probe`, it records every step to `run/recording.webm`, `run/timeline.json` and `run/manifest.json`.
  - At most 2 VS Code instances run at once across every agent using the kit. A run waits for a free slot and prints "waiting for a free VS Code slot" until it gets one. Don't kill other runs.
  - With `--probe`, it records nothing: it runs the hidden steps (or up to `<step>`), then saves `run/probe.png` (a screenshot), `run/probe.jpg` (a small copy: open this one) and `run/probe-aria.yml` (the accessibility tree). Use it to find the UI and its selectors, as often as you need. Each launch takes about 15 s.
  - The app runs in a throwaway profile with its own `HOME`, the user's keychain linked in (so macOS never shows a dialog) and, with `signedIn: true`, a copy of the user's Insiders sign-in. The temp folder is deleted when the run ends.
- `$PY $KIT/voice.py <work> [--only step,…]`: voices `voice/lines.json` into `voice/<step>.wav` and `voice/takes.json` (the word timings).
  - Each take must be reported "as written". If it isn't, reword that line and voice it again with `--only`.
  - Voice before recording: the scenario times its actions to the words.
- `$PY $KIT/firstbuild.py <commit>`: the first Insiders build that contains a commit (a PR's merge commit), and the phrase for the title ("Insiders from Oct 16 or newer").
- `$PY $KIT/concat.py <result work> <part 1 work> <part 2 work>`: joins composed videos (one per window) into `<result>/out/<name>.mp4`, `.srt` and `.webm`. The result's `captions.json` gives the name.
- `$PY $KIT/compose.py <work>`: builds `out/<name>.mp4`, `.webm` and `.srt` from the recording, the voice and `captions.json`.
- `$PY $KIT/flags.py <work> [--preview]`: pauses the finished video where something is wrong and flags it (see "Flags inside the video").
- `$PY $KIT/cards.py <work> [--preview]`: the verdict slide and "worth a look" slides, joined around the finished video (see "Verdict and end slides").
- `$PY $KIT/check.py <work>`: reports the length, what a listener hears, and any band too fast to read (over 4.5 words/s). Each caption should be within 0.3 s of its spoken words. It also writes the contact sheet `out/contact-01.jpg`, … (frames at each step and each zoom target, six to a page): open its pages.
- `$PY $KIT/small.py <png> [--crop x,y,w,h]`: a small JPEG of any picture, or a full-detail crop of it, to open instead of the PNG. `$PY $KIT/small.py --video <mp4> <dir>` makes sheets of a video's frames, one per second. For one moment in detail: `ffmpeg -v error -ss <s> -i <mp4> -frames:v 1 /tmp/<name>.png`, then `small.py` with `--crop`. See **Images** in the rules.
- `$KIT/mcp-mini-server.mjs [name]`: a tiny stdio MCP server, to use instead of `npx …` packages, which would install software on the Mac. It has the tools `ping` and `get_env` (the value of an environment variable in its process). On start it writes "started pid=…" to stderr, and it logs each request to `$MCP_MINI_LOG` if set. Copy it into the throwaway workspace and use `"command": "node", "args": ["<path>/mcp-mini-server.mjs", "<name>"]`.
  - **Never let VS Code run `npx -y`.** When a test's JSON must keep `npx` (to match the test), put a stub `npx` first on the app's `PATH` (scenario `env`). The stub logs its arguments and exits, so nothing is downloaded; say so in the band.

## scenario.mjs

```js
export default {
	signedIn: false,          // true: a copy of the user's Insiders sign-in (chat, agents, anything AI)
	agents: true,             // true: opens the Agents window (--agents); false: an editor window
	settings: { 'workbench.colorTheme': 'Default High Contrast' }, // user settings (both profiles); see the defaults in run.mjs
	workspace: { name: 'demo', files: { 'src/a.ts': '...' }, git: true }, // a throwaway folder (a git repository by default)
	openWorkspace: true,      // editor window only: open the workspace at launch (the Agents window: ctx.h.agentsOpenFolder)
	args: [], env: {},        // extra command-line arguments and environment
	steps: [
		{ id: 'prepare', hidden: true, async run(ctx) { /* not in the video: set up the state */ } },
		{ id: 'setup', async run(ctx) { /* the first step shown */ return 'what was checked'; } },
	],
};
```

Every shown step needs a line in `voice/lines.json` and a band in `captions.json`, under the same `id`. `ctx` gives a step:

- `ctx.page`: the Playwright page. Use roles and labels (`getByRole`) or stable classes; `run/probe-aria.yml` shows what is there.
- `ctx.h`: the helpers.
  - Pointer: `hover(locator, {ms, fx, fy})`, `glide(x, y, ms)`, `click()`.
  - Keys: `press('Meta+P')` (shows ⌘P in the badge), `badge(text)`, `type(text)`.
  - VS Code moves: `quickOpen(file)`, `command('Developer: Reload Window')`, `agentsOpenFolder(folder)`.
  - Measuring: `box(locator)`.
- `ctx.at(seconds)` waits until that long after the step started. `ctx.cue('word', nth)` is when that word of the step's sentence starts. Together they time an action to its word: `await ctx.at(ctx.cue('close') - 0.3)`.
- `ctx.hold(tail)` waits until the sentence has ended.
- `ctx.cut(label, async () => { … })` runs something slow and leaves it out of the video. Examples: a required wait ("wait 15 seconds"), a model's reply, a scan. The video shows `label` ("15 s later") in a badge where the cut is, so testers know time passed. Rules:
  - Call it after the step's sentence has ended (`await ctx.hold()` first): the narration isn't cut.
  - Mark the result to show (`ctx.look`) after it.
  - A tester's instruction to wait ("wait 15 seconds") still goes in the band.
- `ctx.look(locator or box)` sends the zoom there; mark each thing the viewer must look at. `ctx.mark('layout', {...})` means things moved.
- **Native menus and the drawn pointer:** the windows ignore the real mouse (the runner sets this), but Chromium still sends one synthetic mouse move at the real cursor about 0.5 s after a context menu opens or closes, and the drawn pointer jumps. `examples/bugs-welcome-messages/scenario.mjs` has a filter that drops that move (`installMoveFilter`, called in its `prepare` step): copy it if your scenario uses a right-click menu or a picker. The same jump can happen when typing makes the chat input grow to a second line; the filter fixes that too.
- `ctx.paths.workspace` and `ctx.paths.home`: the throwaway folder and the app's `HOME`, where `~/.copilot` lives.
- **Chat requests at the end:** VS Code asks "A session is in progress" before quitting while a request still runs. Cancel any running request in your last step. Otherwise the runner kills the app after 15 s, and then kills every process still using the run's temp folder.
- `ctx.shot(name)` saves a screenshot to `run/shots/` while probing.

## captions.json

```json
{
	"name": "tpi-<n>-how-to-test",
	"title": "How to test TPI #<n> · <short title> · Insiders from <date> or newer",
	"steps": {
		"setup": { "label": "SET UP", "do": "…", "tag2": "USER SETTINGS", "look": "`\"setting\": value`" },
		"step1": { "label": "STEP 1 OF 3", "do": "…", "look": "…", "zoom": 2 }
	}
}
```

- `zoom`: 2 by default, 1.5 for bigger things, `false` to turn it off. With it off, the text gets the whole width. At 2× the zoom shows about 260 px of the page (350 px at 1.5×): a `ctx.look` box wider than that is cut at both ends, so keep boxes within it or lower the zoom.
- `dy`: moves the zoom down, in pixels.
- **DO** and **LOOK FOR** share the band: 2 + 2 lines, 3 + 1 or 1 + 3 fit. `compose.py` fails if they don't: shorten the words, never the font.
- **Readable:** a band stays on screen only while its step runs, and viewers read about 4 words a second. Keep each band's DO and LOOK FOR at about 4 words per second of its step (a 6 s step: about 24 words, settings included). `check.py` flags any band above 4.5. Trim the words first; hold a step longer only when trimming can't get there.
- ⌘ ⇧ ⌥ ⌃ are drawn correctly; `backticks` mark code.

## Flags inside the video (flags.json)

When the video shows something wrong, flag it **where it happens**: the video pauses on that frame, dims everything but the problem, outlines it, explains it in a callout, and says it in one sentence; then it plays on. Flag every:
- **failure** (`"kind": "fail"`, red): a step that doesn't do what the item expects. Say what was expected, what happened, and why if you know.
- **change** (`"kind": "change"`): where the video does something differently from the item, and why.
- **likely bug** (`"kind": "bug"`) or **thing to check** (`"kind": "check"`): anything odd you saw on the way.

Each flag also goes on the end: in `cards.json` "recap" (one line each, with its time), and failures and changes on the verdict slide. Use "watch" picture cards only for findings the walkthrough doesn't show.

```json
{ "flags": [ { "t": 19.5, "kind": "bug", "box": [780, 486, 74, 30], "title": "…", "detail": "…", "say": "…" } ] }
```

- `t` is a time in `out/<name>.mp4` where the problem is on screen; the pause snaps to the nearest gap in the voice (within 1.5 s), so pick a `t` in the middle of the time it's visible, right after a sentence ends: a gap at a comma splits the sentence. `box` is in that video's 1920×1330 pixels (the band is the top 250). Optional: `marks` (dashed outlines, e.g. where something was), `image` (a picture in the callout, as in cards.json), `tag`, `at` (right, left, below, above).
- Keep the callout short (a 6–8 word title and one or two lines): the pause lasts until it can be read at 4.5 words/s.

Then: `$PY $KIT/flags.py <folder> --preview` (look at `flagged/preview-*.jpg`: the right moment, the box on the problem, nothing important covered), `$PY $KIT/flags.py <folder>`, and then `cards.py`, which uses the flagged video.

## Verdict and end slides (cards.json)

Every video starts with a **verdict slide**: did the agent verify the item, on which build, and what isn't covered. When you saw likely bugs while testing, it ends with **"worth a look" slides**, each with a picture. Write `cards.json` next to the finished video's `captions.json`, the folder whose `out/<name>.mp4` you'd deliver (the `concat.py` result for joined videos):

```json
{
	"verdict": {
		"status": "verified",
		"headline": "All 6 steps passed, each checked in the app.",
		"build": "Insiders 1.143.0 · e9f10b90b5 · Oct 16",
		"not_covered": "a screen reader; Windows",
		"say": "Verified: every step passes on the October sixteenth Insiders."
	},
	"watch": [
		{ "title": "…", "detail": "…", "image": { "from": "video", "t": 19.5, "crop": [750, 462, 380, 84], "caption": "…" }, "say": "Worth a look: …" }
	]
}
```

- **`status`:**
  - `verified`: every step passed, as the item expects.
  - `issues`: some checks fail in part ("7 of 8 behaviors pass; behavior 2 fails in part").
  - `changed`: verified only with a setup different from the item's text, with `why`. A typo in the item (a wrong setting name in its title) isn't a change: note it in the band.
  - `partial`: some of the item's steps weren't run (for example they'd change the tester's machine), with `why`. An item whose broken state is unclear isn't partial: show it, and use a CHECK THIS flag if needed.
  - `failed`: couldn't verify. Add `why` (1–3 short lines) and an `image` showing the failure.
- **`not_covered`:** the steps the video leaves out, as in your report. Omit it when nothing is left out.
- **`recap`:** when the video has flags, end with **one** text slide listing them (time in the final video, tag, title) instead of repeating each flag as a picture card: the flag already showed and explained it. Its `say` names them briefly. Give each item `"flag": N` (its number in flags.json) and `cards.py` fills in its time in the final video.
- **`watch`:** likely bugs you saw that aren't the item's pass/fail. Two per slide by default; `"watch_per_slide": 3` fits three short items on one slide (shorter video).
  - Each needs evidence: a frame of the video, or a probe screenshot (`"from": "shot", "path": …`).
  - Use `"tag": "CHECK THIS"` instead of the default "LIKELY BUG" when it may be intended.
- **Pictures:**
  - `crop` is in the finished video's 1920×1330 pixels (the band is the top 250); `t` is the time in that video.
  - `{"pair": [image, image], "direction": "row"}` shows before and after, each with a `label`.
  - `"marks": [[x, y, w, h]]` draws a dashed outline, for example where something was.
- **Facts only:** every word comes from your runs' results and checks. Keep the text short: a slide stays up until it can be read at 4.5 words/s, and the voice (`say`) gives just the gist. Spell numbers out in `say`, and avoid words the voice can mishear (it said "popup" as "pope up"; "picker" works).

Then:
1. `$PY $KIT/cards.py <folder> --preview`, and look at `carded/slides/preview-*.jpg`.
2. `$PY $KIT/cards.py <folder>`: it voices the slides and writes `carded/out/<name>.mp4`.
3. `$PY $KIT/check.py <folder>/carded`, and deliver `carded/out/<name>.mp4`.

## Wording what's wrong

Testers act on every flag, so call each finding what it is. Before flagging, read the item's PRs (their code and tests) and the code's history (`git log -S`, blame), and search the repo's issues (`gh issue list --repo microsoft/vscode --search "<words>"`).

- **A failure** (`fail`): the item's expected result isn't met. Say what was expected and what happened.
- **A regression:** it was fixed, then a later PR broke it. Measure the build just before that PR, and name it ("regression from #n"), not "still broken".
- **Older than the change:** the problem comes from code older than the item's PRs. Keep the kind (`fail` if the item's words aren't met, else `bug`), and say so with a tag and the origin: `"tag": "LIKELY BUG · PREDATES THIS PR"` or `"FAIL · PREDATES THESE PRS"`, "the removal code is from Sep 4 (`<commit>`, #n)".
- **By design:** the PR's code or tests do it on purpose, though the item's text says otherwise. Not a failure: a `check` ("likely by design: ask @<item author>"), or a note in the band.
- **Already filed:** name the open issue ("already filed as #n"; on the recap: "link #n instead of filing").
- **The same finding in several videos:** say so in each ("also in TPI #n: file it once").
- **Facts only:** quote only what the recorded run shows. A quote from a probe on the same build says so ("trial run, same build").
- **Stand-ins:** when a stub `npx` or the mini MCP server replaces a real package, read the real package's source before saying what a tester will see with it, and say only that.
- **The status follows:** `partial` when a central part of the item couldn't run (an older build, an account, another OS), even if every shown step passes; a by-design difference or an older bug doesn't make it `issues` on its own unless the item's expected result isn't met.

## Several fixed bugs in one video

The endgame verifies every bug fixed in the milestone. Bugs of one feature area share one video:

- **Each bug is a step.** Use its own repro or "how to test" steps: the issue, its comments, and the fixing PR. Find the PR in the issue's timeline (a closing PR or a "Fixes #n" commit). Show the fixed behavior and check it in the app, the way a verifier would.
  - **Band label:** the issue number and position, e.g. `#339745 · 2 OF 7`.
  - **Length:** keep each bug to about 5–12 s.
- **Build:** each bug's fix must be in the build you record. Check with `gh api repos/microsoft/vscode/compare/<fix merge>...<build commit> --jq .status` (`ahead` or `identical`).
- **Title:** the area and the newest fix's `firstbuild.py` phrase: `How to verify <n> <area> fixes · Insiders from … or newer`. Keep it short; the bands carry the numbers.
- **Name:** `bugs-<area>-<n1>-<n2>-…-how-to-verify`, so testers find a bug by searching the folder for its number.
- **A bug you can't verify here** (another OS, an account, a service you don't have): leave it out and name it in the verdict's NOT COVERED with the reason.
- **A bug that isn't fixed**, or a fix that doesn't hold: flag it (`kind: fail`) where it shows, and count it in the verdict.
  - **Verdict:** `verified` if all shown bugs pass, `issues` otherwise.
  - **Headline:** for example "6 of 7 fixes verified; #339746 still breaks when narrow".
  - **Fixed, then broken again:** if a later PR broke it, measure the build just before that PR, and call it a regression from that PR, not "still broken".
  - **Already reported:** search the repo for an open issue about the failure (`gh issue list --repo microsoft/vscode --search "<words>"`), and name it ("already filed as #n").
- **Other problems** you see along the way: flag them as `bug` or `check`, as usual, with a `recap` at the end. Leave out behavior that predates the fix or is expected (check the code's history first): it only invites invalid reports.
- **Throwaway paths:** the run's temp folder is under `/var/folders/…`, which macOS also reaches as `/private/var/…`. Open folders by their real path (`fs.realpathSync`), or a recent list can show one folder twice.

## Builds

- Use the installed Insiders if it has the change. `gh api repos/microsoft/vscode/compare/<merge commit>...<installed commit> --jq .status` gives `ahead` or `identical` when it does. The installed commit is in `/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/product.json`.
- Otherwise download a newer Insiders by commit:
  - `https://update.code.visualstudio.com/api/commits/insider/darwin-arm64` lists the commits.
  - `https://update.code.visualstudio.com/commit:<sha>/darwin-arm64/insider` downloads one.
  - Unzip it with `ditto -x -k` into your work folder and pass `--build`. Delete it when the video is delivered.
- For anything in the bundled Copilot SDK, check the build's own files.
- The title's phrase: `$PY $KIT/firstbuild.py <merge commit>` on the newest of the item's merge commits.

## Rules

- **Isolation:**
  - Use only `run.mjs` to launch VS Code. Never touch the user's open VS Code windows, profiles, settings, repositories or branches, `~/.copilot`, or system settings such as the proxy.
  - Never install anything outside your work folder (the setup's cache folder is the exception).
  - Write only in your work folder, `$DELIVERY`, and temp folders, and delete the temp folders.
- **GitHub:** never post, comment, react or label. You only read; the user attaches the video.
- **Cost:**
  - Use `signedIn` only when the item needs it.
  - Send only the chat requests the item needs: short, harmless ones (`Reply with exactly OK.`), on a low-cost model. Have the scenario check the model picker's label before every send.
  - Never approve a tool action that changes anything outside the throwaway workspace.
- **Honesty:** never fake a result with a mock or an edited picture. If the item can't be shown, stop and say why.
- **Images:** every picture you open is kept, at full size, in the session's history, and a 2 GB history crashed the session before. Open only small JPEGs (at most 1280 px wide): `run/probe.jpg`, `run/shots/*.jpg`, the `contact-*.jpg` pages, the `preview-*.jpg` files, or a `small.py` copy or crop. Never open a PNG or a full-size frame. Prefer text (`probe-aria.yml`, DOM checks, `getBoundingClientRect`) when it answers the question, and don't reopen an image that hasn't changed.

## Report

End with:

- The verdict you put on the slide, and the likely bugs on the end slides.

- The video's path and length.
- The steps shown.
- What isn't shown, and why.
- The build used (version and commit).
- Signed in or not, and the number of chat requests sent.
- Anything a tester should know that the video doesn't say.
