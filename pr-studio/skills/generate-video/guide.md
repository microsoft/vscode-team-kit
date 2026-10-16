# Making the video

The three parts of the work: the story (the narration, its beats and their evidence), the visuals (a diagram per beat,
timed to its words), and the sign-off.

## Writing the story

The viewer is someone who won't read the PR: an engineering manager, a reviewer deciding where to start, a
teammate catching up. Technical words are fine; jargon without a picture is not.

### Length: six answers, as short as they allow

A video answers six questions, in the voice or on screen, and nothing else earns its seconds:

1. What changes.
2. Why: the problem or the gap.
3. How it works.
4. What it looks like or does (live footage, when a user can see it).
5. What could break, and how it is tested: the case the change could get wrong (an edge its guard or its tests cover, a
   caveat in the PR), said as a risk, then the tests. "It has tests" alone doesn't answer it.
6. The status, and where to start reading.

Make it as short as these allow: there is no minimum, and at most 90 seconds with the end card (the last word by 86 s).
`prs check <slug>` estimates the length and fails past that; `prs voice <slug>` measures it. The voice speaks a little
faster than its natural pace (`voice.pace`, 1.1 by default, in `~/.cache/pr-studio/config.json`).

- **Fewer beats.** One beat can hold two answers: a before and after shows what the change does and why it was needed.
  The skeleton's beats (the brief's size) are a start: merge or delete the ones that add no answer.
- **The voice tells, the screen shows.** The voice says why and how, in plain sentences. Numbers, file names, test
  names, lists and anything exact go on screen. Never read out what the picture shows. What only the screen says must
  be readable once at playing speed, while it is up (about a second for each short line): keep such lists to a few
  short items rather than slowing the video down.
- **Each idea once.** No beat repeats another, no sentence restates its picture, no summary at the end.
- **The cut test,** before `prs voice`: for each sentence, which answer is lost if it goes? None: cut it.

### Beats

Each beat is one idea, said in one to three sentences, with one diagram. It has:

- `id`: a short word (`problem`, `fix`, `rule`).
- `need`: what the beat has to show, which decides the kind of diagram:
  - `concept`: a problem, a mismatch, ideas side by side
  - `exchange`: messages between parties
  - `flow`: steps in order
  - `rules`: a rule applied to cases
  - `compare`: before and after
  - `architecture`: where it reaches
  - `code`: the lines themselves
  - `numbers`: sizes and measurements
  - `state`: a lifecycle
  - `ui`: something the user sees (with live footage of the app when the PR changes it: "Live footage" below)
  - `status`: scope, tests, what's open
- `say`: the narration. Plain sentences. A number the voice must say (a measured speed-up) comes from the PR as a
  placeholder: `{{facts.additions}}`, `{{facts.changedFiles}}`, and the size of a list: `{{facts.linkedIssues.length}}`.
- `cues`: name -> a phrase from `say` where something should appear (`"step2": "Two"`), or
  `{ "phrase": "...", "nth": 1, "offset": -0.2 }`. Diagrams use these names as times.
- `claims`: every factual statement, with evidence. `prs check <slug>` verifies each piece:
  - `{ "file": "src/...ts", "anchor": "functionName" }`: the text (or regex) is in the file at the head commit
  - `{ "file": "src/...ts", "anchor": "old code", "removed": true }`: a line the PR removes
  - `{ "body": "exact words from the PR description" }` (Markdown markers like ** and backticks don't matter)
  - `{ "commit": "words from a commit message" }`, `{ "fact": "additions" }`, `{ "file": "...", "status": "added" }`
  - `{ "review": "exact words from the review discussion" }` (what a reviewer asked or the author answered)
  `{ file, anchor }` works for any file of the repository at the head commit, changed or not: for behaviour that lives
  outside the diff (a default the PR relies on), cite where it is. A count you make yourself ("five collections") is a
  claim too: give an anchor for each thing counted. Cite repository files or the PR itself, never pr-studio's own
  `brief.md` or `pr.json`.

The first beat is the title (fixed design). Its card shows the PR number, the title, the author, the size and the
state, so the voice doesn't: say what the PR does, in one sentence of plain words ("Pasting a link into a Markdown file now offers to turn it
into a titled link."). The card brings in the author, the numbers and the state while it is spoken.

The last beat is the status, in one sentence: what matters most before review or merge (what is still open, or what
proves it works). The screen carries the rest: what is in scope, what follows separately, how it is tested, and 1-3
places to start reading. `status.checklist` shows the places as code (`code(file, { anchor })`); with `status.board`,
make them a "Start reading" column of `ident()` names with their `path()`.

### The narration and the picture

Each treatment has its own way of being narrated, in its description in [catalog.md](catalog.md): a before and
after table names the aspects in order, a wipe tells the old way and turns on "Now", gates take one case at a time.
That's why `prs direct` runs before the voice: write each beat's `say` for the picture it got.

### Arcs that work

Pick the arc that fits the PR, then the needs follow (the title before, the status after):

- **Bug fix**: the symptom and the fix side by side (compare or ui, with footage when it shows) -> the cause and how
  the fix removes it (code/flow/state).
- **Feature**: the gap and what it adds (concept or ui, with footage when it shows) -> how it works
  (exchange/architecture/code).
- **Protocol or security change**: the gap (concept) -> the mechanism (exchange) -> the safety rule (rules); how far
  it reaches goes on the status screen.
- **Refactor**: the old shape and the new (compare/architecture) -> why it's safe (rules).
- **Performance**: the cost and where it came from (numbers/flow) -> the change (compare/code); the measurement,
  quoted from the PR, on screen.
- **Build, infra, tests**: what runs where and what changes (flow/compare); the impact on the status screen.
- **Several small fixes** (a polish PR that closes a list of issues): group them by where they show (one screen, one
  list), one beat a group with a treatment that holds a list (compare.split rows, concept.pillars), the most visible
  group first; the status screen names the rest.

### Style

- Say what the code does, not what the author "wants". Use the PR's names for things, once, then plain words.
- Short sentences that land on one picture each. Cue the words that change the picture.
- Numbers only from the PR, on screen (`fact()`, or `quote()` from the body); the voice says one only when it is the
  point, through a placeholder or quoted from the body.
- Untested or claimed-only facts get "per the author" ("a manual run is still pending, per the author").
- The old behaviour is often not in the diff (a default the PR changes, a component the PR calls): read it with
  `prs file <slug> <path>` (the file at the head commit) or `--base` (before the PR), and cite it. Behaviour drawn by a
  dependency outside the repository: say what the PR says about it, no more.
- No praise, no filler ("This PR introduces a robust..."), no ending summary; the status beat is the ending.

### Pronunciation

Captions show the text as written; the voice reads a spoken form. Code-like words get one automatically:
camelCase is split (`isSameSecureOrigin` -> "is same secure origin"), short acronyms are spelled (`IPC` ->
"I P C"), dotted names say "dot" (`product.json`), and long numbers are read digit by digit (PR numbers).
Anything else goes in `pronounce`, which wins over the automatic forms:

```json
"pronounce": {
  "325804": "three two five eight oh four",
  "mcumming": "M Cumming",
  "RFC 9728": "R F C ninety-seven twenty-eight",
  "getAuthorizationHeaders": "get authorization headers",
  "IPC": "I P C",
  "README": "read me"
}
```

Author logins are not names: map one to how it's said (`"mcumming": "M Cumming"`), or say "by its author" and
let the title frame show the login. Keep commas for real pauses only: the captions break and pause at them, and
the sync gate checks that the audio pauses there too.

What the voice gets wrong, and what to write instead:

- **Code names said alone** (`start()`, `resume`): the voice pauses around them oddly, and the sync gate fails. Say
  what they are: "the start method", "the resume call".
- **Paths:** slashes are dropped and folders read as words. Name the file in words ("the new tracking module") and
  show it on screen with `path()`.
- **Lowercase abbreviations** inside names (`scm`, `ipc`, `cwd`) are read as words: add them to `pronounce`
  (`"scm": "S C M"`). Capitals are spelled out already (`IPC`).
- **Don't respell what it says well** (`OK`, `UI`, `it's`): the transcriber writes those its own way, and a respelling
  it can't match breaks the word timing.
- **One-word entries reach inside names:** `"subagent": "sub agent"` also fixes `CopilotSubagentTracking` and
  `activeSubagentIds` (plurals too); as a word of the narration, an entry matches that exact word, so add the plural
  (`"subagents"`) if you say it. Longer entries match whole words only.
- **A caption shows at most 9 words:** a longer phrase is split evenly, wherever that falls ("clearer | border"). Put a
  comma where a break reads well.

`prs voice` prints what a listener hears in each beat (transcribed without the script, as the sync gate in
`prs publish` listens). A word "heard differently" is usually one the voice said wrong ("subigent", "a count" heard as
"account"): fix it in `pronounce`, or say the sentence another way. Sometimes the transcriber is the one wrong ("closed"
for "close"): judge whether a listener would stumble. A take that came out slow or odd, or a warning of a low alignment score (the take skipped or slurred words):
`prs voice <slug> --redo <beat>`. A retake can bring a new slip: if a word keeps coming out wrong, reword the sentence.
The narration's length is where its last word ends; `prs voice` prints it against the cap. A caption shows at most 9 words: commas and full stops
break it, and a longer phrase is split evenly.

### Example beat

```json
{
  "id": "negotiate",
  "need": "exchange",
  "say": "So VS Code asks at runtime, using RFC 9728. One: request the index. Two: on a 401 or 403, read the marketplace's metadata for its authorization server. Three: get a token for it. Four: retry.",
  "cues": { "rfc": "RFC 9728", "step1": "One", "step2": "Two", "step3": "Three", "step4": "Four" },
  "claims": [
    { "text": "a 401 or 403 from the service index is treated as 'authentication required'",
      "evidence": [{ "file": "src/vs/workbench/services/extensionManagement/electron-browser/extensionGalleryManifestService.ts", "anchor": "statusCode === 401 || statusCode === 403" }] }
  ]
}
```

### A video of a PR made before

Running the skill again on the same PR makes a new video and replaces the one delivered before (publish says so). Its
picks don't count against the new one: `prs direct` avoids other PRs' recent videos, not this PR's.

## Building the visuals

`prs direct <slug>` writes `scenes.js` with one catalog treatment per beat, chosen for the beat's need and away from
what recent videos used. Your job is the content: fill every `TODO` from the PR, set the times, look, fix.
All layout is automatic: there are no pixel positions to set. The engine also fits each beat's body to the frame
(scaled up to 1.25 and centred between the heading and the captions), so a short list doesn't sit in the top half:
don't add items to fill space.

### scenes.js

```js
import { defineVideo, word, cue } from '../../engine/scene.js';
import { label, fact, quote, ident, code, path } from '../../engine/text.js';
import { title, concept, exchange, status } from '../../catalog/index.js';

export default defineVideo({
	motion: 'slides',               // chosen by prs direct: slides | canvas (layout: row | column | grid) | morph
	beats: {
		title: title.frame({ headline: label('Authenticate to a locked Private Marketplace') }),
		problem: concept.mismatch({ eyebrow: label('The problem'), title: label('...'), ... }),
		...
	},
});
```

Beat keys are the storyboard ids, in the same order. The code treatments are imported as
`code as codeSlides` (`codeSlides.diff(...)`), because `code` is already the `code()` helper below.

### Text: say where it comes from

| Helper | For | Checked against |
| --- | --- | --- |
| `label('...')` | your words: titles, captions of boxes | the reviewer (numbers in labels are flagged) |
| `fact('additions', { format: 'n' })` | PR numbers and names (`pr.json` facts) | must exist |
| `quote('contact your administrator')` | exact text of the PR: body, commits, diff, tests | must be an exact substring |
| `ident('isSameSecureOrigin()')` | names in the code | must appear in the diff or changed files |
| `path('src/vs/.../file.ts')` | a changed file (basename shown; `{ show: 'full' \| 'dir' \| 'tail2' }`) | must be changed by the PR |
| `code(file, { from, to })` | source lines at the head commit | fetched and verified |

Mix parts in an array: `[label('GET '), ident('/.well-known/oauth-protected-resource')]`.
`fact()` takes any path in the facts (`fact('approvers.0')`, `fact('linkedIssues.length')`, `fact('authorName')`) and
a format: `'n'` (1,234), `'date'` (14 Oct 2026), `'lower'`, `'state'` (Merged), `'review'` (Approved). The facts are
in `pr.json`: title, number, authorLogin, authorName, state, mergedAt, additions, deletions, changedFiles, commitCount,
reviewers, approvers, reviewDecision, linkedIssues, testFiles, areas, files.
`code()` is never text: in a text param, show a file with `path(file)` and a name with `ident(name)`. `ident`
accepts names in the diff or anywhere in the PR's changed files at the head commit. `quote` accepts any text of the
PR: the title, the description (Markdown markers don't matter), commit messages, test names, the review discussion, and
any line of the diff, context lines included.
Code forms: `code(file, { from: 195, to: 222 })`, `code(file, { anchor: 'private async fetchManifest\\(' })`
(one line, for "start reading here"), `code(file, { anchor: '...', block: true })` (the whole function), and
`code(file, { diff: true, anchor: '...' })` (the diff hunk containing the anchor, for `code.diff`). An anchor that matches
several lines takes `occurrence: n` (0 for the first match; the error lists the lines it matched). A code panel sizes
its font to the longest line shown: pick lines without very long ones (trim with `from`/`to`), or all of it gets small.
`code.diff` counts the + and − of the lines it shows ("in these lines"), not of the whole file.

### Time: land each thing on its word

Any `at` (and `replyAt`, `badgeAt`, `tagAt`...) takes:

- a cue name from the storyboard: `'step2'`
- `cue('step2', 0.4)`: a cue plus seconds
- `word('401')`, `word('resource.', { offset: -0.5 })`, `word('the', { nth: 2 })`: when that word is spoken (the
  word itself first: `word('to')` is "to", not "tool"; a word that only starts with it when there is no whole match)
- a number: seconds after the beat starts

Leave `at` out and items spread evenly over the beat. Set it for anything the narration names.

### Motion

- `slides`: one slide per beat; the outgoing slide is gone before the next appears.
- `canvas`: beats are panels on one board and the camera flies between them (`layout: 'row' | 'column' | 'grid'`).
  The panels share the look; the board's dots and edges show only while moving.
- `morph`: slides, plus one object that flies from beat to beat: `carry: { text: label('bearer token'), icon: 'key',
  anchors: { problem: 'have', fix: 'reply3' } }`. It flies between consecutive beats that both have an anchor.
  Anchors: `concept.mismatch` `have`, `need`; `exchange.lifelines` `request1..n`, `reply1..n`;
  `architecture.map` `chip`. Pick anchors that are on screen when their beat starts (a card head, not a reply
  that appears 15 seconds later). Use morph only when one thing really travels through the story.

### Look before you trust it

- `prs stills <slug>` and open `build/stills/contact.png`, then the frames that matter. `--beat <id>` and
  `--at 12.3,14` render only those, into `build/stills/beat-<id>/` and `build/stills/at/` (each run replaces that
  folder), and keep the full contact sheet. Check: does each picture match the sentence it is under? Does every highlight land on its word? Is
  anything crowded, cut, tiny or empty?
- `prs lint <slug>` checks every frame for text outside its box, clipped text, overlapping text, text in the caption
  band, text without provenance, the end card's QR, and repetition of recent videos.

### When the catalog doesn't fit

Try another treatment for the same need (`prs catalog`; see [catalog.md](catalog.md) and the numbered pictures in
[catalog.png](catalog.png)): `prs direct <slug> --use beat=treatment --reason "..."` (the other beats keep their picks and
their content). Every need has two or three; one of them can almost always show the beat if the narration follows its
shape. If none can, say so in your answer: which beat, and what it needed to show.

Icons: Fluent names, all listed by `prs catalog --icons` (`key`, `lock`, `server`, `globe`, `laptop`, `building`,
`shield`, `beaker`, `branch`, `bug`, `rocket`, `settings`, `extension`, `window`, `terminal`...).

## Live footage

When the PR changes something a user sees or does (a view, a menu, a dialog, a click and what follows), the video shows
it happening in the real app: the diagrams explain why and how, the footage shows it working. When the PR changes how
something behaves (a fix, a different result for the same action), it shows the before too: the same steps in the app
without the change, side by side with the app with it. A new feature, with nothing to compare, shows the after only; so does a fix whose
before a recording can't reproduce (it takes real hardware, a physical key, a race): the after still shows what users
now get. A demo that needs the app signed in (chat, anything AI) still gets its footage: step 3 says how. A change
nobody can see (speed, memory, internals) gets no footage: a screen that looks the same proves nothing about it.

### Record it

1. **The steps.** The PR's "how to test", its screenshots and videos, and its tests give the steps and what should
   happen. Pick the shortest interaction that shows the change: its action and its result.
2. **The apps.** The app with the change and, for a before and after, the app without it: the same kind of build, with
   the same profile, window and sample data, so only the change differs. Run them the repository's way, each with a
   throwaway profile in a temp folder. For VS Code, no checkout or build is needed: Insiders builds by commit,
   `https://update.code.visualstudio.com/api/commits/insider/<platform>` lists them, newest first (`darwin-arm64`,
   `darwin`, `linux-x64`), and `https://update.code.visualstudio.com/commit:<sha>/<platform>/insider` downloads one (a
   zip of about 300 MB). `gh api repos/<owner>/<repo>/compare/<merge commit>...<build sha> --jq .status` says whether a
   build has the change (`ahead` or `identical`: it has it; `behind` or `diverged`: it doesn't; the merge commit:
   `gh pr view <url> --json mergeCommit`): the newest build without it is the before, the oldest with it the after. For
   an open PR, build its base and its head.
3. **Keep it to itself, signed in when needed.** When the app reads the user's home (VS Code lists their personal skills
   and agents from it), give it its own `HOME` in the temp folder, with the user's keychain linked in (macOS:
   `<home>/Library/Keychains` → `~/Library/Keychains`): without it, the app's first keychain access makes macOS ask the
   user in a dialog. When the demo needs the app signed in (chat, anything AI), copy the signed-in state of the same
   kind of app into the throwaway profile: its secrets decrypt with the key in the keychain. For VS Code:
   `sqlite3 <signed-in profile>/User/globalStorage/state.vscdb ".backup <profile>/User/globalStorage/state.vscdb"`,
   from the user's profile of that build (Insiders: `~/Library/Application Support/Code - Insiders`; Code OSS:
   `~/.vscode-oss-dev`), and `"update.mode": "none"` in the profile's settings. A signed-in app can show the account's
   name: keep it out of the frame. The script deletes its temp folder (profile and `HOME`) in a `finally`, so no run,
   failed or not, leaves the copy of the sign-in behind.
4. **Drive it with Playwright** (`<studio>/node_modules/playwright-core`: `_electron.launch` for an Electron app, a
   browser context for a web app, both with `recordVideo`): the same steps at the same pace in each app. Wait until each
   step can be done; after it, check that the result is on screen: the recording counts only if it is.
5. **Show the hand.** The recording has no pointer: draw one in the page (an arrow or a dot above everything, following
   the mouse) and a ring that grows on each click. Move the mouse in steps (`mouse.move(x, y, { steps: 25 })`) so it
   travels to each target, rest on it a moment, click, and hold each result for a second or two. Keys are invisible
   too: show a shortcut's keys in a badge (`⌃ Esc`) while it is pressed, and type text at a human pace.
6. **Readable at 1080p.** A window of about 1280×720 with the app zoomed in (VS Code: `"window.zoomLevel": 1`), laid
   into the frame at about its own size; crop to the part that matters when it's bigger. A before and after shares the
   body, so crop both recordings to the same part, the one that changes, and keep it near its own size.
7. Keep the scripts, the recordings and a screenshot of each state in `<studio>/videos/<slug>/footage/`. Downloaded
   builds can go once the video is delivered (about 300 MB each).

### Narrate it

A footage beat tells what happens in the order it happens, with a cue on each action and each result ("click Skills
again", "back on the list"). A before and after is one beat, the two recordings side by side and in step: the voice
says the action once and then the difference ("press Save: the old build drops the selection, the new one keeps
it"). One after the other only when timing is the point (how long something takes, what comes first). Write
about as many seconds of words as the clip lasts: a clip can hold its last frame, but never lose an action. The beat's
treatment draws its heading (eyebrow and title: what is shown); the footage covers the body. Give it a treatment with
a simple body, for example `prs direct <slug> --use <beat>=concept.pillars --reason "live footage covers the body"`
(several beats: `--use a=…,b=…`; `compare.split` for a before and after, with a row per difference) and fill it from
the PR as usual: it is checked like any beat, and it is what `prs stills` shows.

### Put it into the video

After `prs render`, before `prs publish`:

- `prs render` writes the frames to `build/frames/%05d.png`: 1920×1080, 30 a second, without captions. `prs publish`
  draws the captions over the band from y 940 down and encodes the mp4, the WebM and the contact sheet from these
  frames, so footage put into them reaches everything delivered.
- The beat runs from its `start` to its `end` in `build/timeline.json` (frames: seconds × 30), with its `cues` in
  seconds: line the footage up so each action lands on its words. Trim the recording, hold its last frame
  (`tpad=stop_mode=clone`), speed up only the waiting; never change the number of frames (the narration and captions
  are timed to them).
- Lay it over the body, below the heading and above y 940, on a white box that covers the whole body (nothing of the
  diagram shows around it): look at a frame of the beat first to see where its heading ends.
- A before and after: both recordings in the box at once, in two columns (two rows when the part that changes is wide
  and short), the same crop and scale, each under its label, "Before" and "After" (Aptos semibold, about 26 px:
  `Aptos-SemiBold.ttf` in the `Contents/Resources/DFonts` folder of Microsoft Word or PowerPoint, else Segoe UI or
  Inter; `#1b1b1f`, and `#0078d4` for After), with a thin `#e3e6eb` line round each. Start both at the same action, so
  they move together.
- The frames are hard links into the render cache: delete a frame before writing its replacement (or write a new file
  and `mv` it over), never write into it, or other frames and later renders change too.
- Every `prs render` writes the frames again: keep the composition as a script in `footage/` and run it after each
  render.
- `prs stills` and `prs lint` draw the slide, not the footage. Look at the composed frames themselves, and after
  `prs publish` at frames of the delivered mp4 (`ffmpeg -ss <seconds> -i <mp4> -frames:v 1 <png>`).

## Sign-off

Nothing is delivered as final until the `pr-director` agent signs it off. It sees what the author no longer sees:
a number that doesn't match the diff, a highlight that lands two words late, a box nobody can read on a laptop.

1. Make sure `prs lint <slug>` is clean and `prs publish <slug>` passed the sync gate. Its notes: "caption pause not
   silent" means a comma the voice ran through (drop the comma, or retake); "audio pause under a caption word" means
   the voice stopped inside a word, often before a name (reword, or `prs voice <slug> --redo <beat>`). One of each is
   tolerated; more fail the gate.
2. Run `prs stills <slug>` on the final version (the reviewer reads `build/stills/contact.png` and single frames).
   The full contact sheet for the review is `build/stills/contact.png`; `--beat`, `--at` and `--ends` make their own
   in their folders, and `build/contact.png` is the one `prs publish` delivers. Don't copy one over another.
3. Run the reviewer as a subagent on the strongest model available, with [reviewer.md](reviewer.md) as its
   instructions. Give it:
   - the PR URL, the slug, and `<studio>` (the engine's folder, from the setup script)
   - the paths: `<studio>/videos/<slug>/brief.md`, `pr.diff`, `storyboard.json`, `scenes.js`, `build/stills/`, and
     the mp4 in `~/Downloads/pr-videos/<slug>/`
   - with live footage: the `footage/` folder and the beat it is in
   - from the second round on: the last verdict and what you changed
4. Save the verdict to `<studio>/videos/<slug>/build/review.md` as it comes, before fixing (append each round; in a
   self-review: what you found, then what you fixed, round by round). Fix every must-fix, render (and lay in the
   footage again), publish, ask again. Stop at `VERDICT: SIGNED OFF`.

If you can't start subagents, follow "Reviewing your own video" in [reviewer.md](reviewer.md), write it to the
same `review.md`, and mark the video as self-reviewed (see "Deliver" in the skill).
