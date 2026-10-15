# Making the video

The three parts of the work: the story (the narration, its beats and their evidence), the visuals (a diagram per beat,
timed to its words), and the sign-off.

## Writing the story

The viewer is someone who won't read the PR: an engineering manager, a reviewer deciding where to start, a
teammate catching up. After 40-100 seconds they should know what changes, why, how it works, what could break,
the status, and where to start reading. Technical words are fine; jargon without a picture is not.

### Length

`brief.md` gives the tier. It comes from the size outside tests, the number of areas, and whether the PR touches
security, protocols or compatibility. The narration runs at about 2 words per second, pauses included (both voices).

| Tier | Narration | Words | Beats |
| --- | --- | --- | --- |
| small | 40-55 s | 80-110 | 4: title, 2 explanation beats, status |
| medium | 60-80 s | 120-160 | 5: title, 3 explanation beats, status |
| large | 85-100 s | 170-200 | 6-7: title, 4-5 explanation beats, status |

`prs check <slug>` estimates the length; `prs voice <slug>` reports the real one. The seconds are the rule; the words
are a guide to get there. The window is for the narration: the end card adds about 4 seconds to the file, and that
doesn't count against the tier.

### Beats

Each beat is one idea, said in 15-40 words, with one diagram. It has:

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
  - `ui`: something the user sees
  - `status`: scope, tests, what's open
- `say`: the narration. Plain sentences. Numbers from the PR as placeholders: `{{facts.additions}}`,
  `{{facts.changedFiles}}`, `{{facts.number}}`, and the size of a list: `{{facts.linkedIssues.length}}`.
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

The first beat is the title (fixed design). Keep its narration to the PR number, the author, what it does in a few
words, and the size:
`"Pull request {{facts.number}}, by {{facts.authorName}}: <what it does>. {{facts.additions}} lines added across {{facts.changedFiles}} files."`.
`authorName` is the name on the author's GitHub profile (the brief shows it next to the login); when there is none,
use `{{facts.authorLogin}}` with a `pronounce` entry, or "by its author". Add the state ("Still open for review.") if it
matters. Cue names `author`, `stats` and `state` drive the title.

The last beat is the status: what is in scope, what follows separately, how it is tested, what is still open, and
1-3 places to start reading. `status.checklist` shows the places as code (`code(file, { anchor })`); with
`status.board`, make them a "Start reading" column of `ident()` names with their `path()`. In a small video the
narration can't say all of that: say the one that matters most (what is still open, usually), and let the screen show
the rest.

### The narration and the picture

Each treatment has its own way of being narrated, in its description in [catalog.md](catalog.md): a before and
after table names the aspects in order, a wipe tells the old way and turns on "Now", gates take one case at a time.
That's why `prs direct` runs before the voice: write each beat's `say` for the picture it got.

### Arcs that work

Pick the arc that fits the PR, then the needs follow:

- **Bug fix**: the symptom (concept/ui) -> the cause (code/flow/state) -> the fix (code/compare) -> how it's proven
  (status).
- **Feature**: the gap (concept) -> what it adds (ui/flow) -> how it works (exchange/architecture/code) -> limits
  and status.
- **Protocol or security change**: the gap (concept) -> the mechanism (exchange) -> the safety rule (rules) -> how
  far it reaches (architecture) -> status.
- **Refactor**: the old shape (architecture) -> the new shape (compare) -> why it's safe (rules/status).
- **Performance**: the cost (numbers) -> where it came from (flow/code) -> the change (compare) -> the
  measurement, quoted from the PR (numbers).
- **Build, infra, tests**: what runs where (flow/architecture) -> what changes (compare) -> impact (numbers/status).
- **Several small fixes** (a polish PR that closes a list of issues): group them by where they show (one screen, one
  list), one beat a group with a treatment that holds a list (compare.split rows, concept.pillars), the most visible
  group first; the status beat names the rest.

### Style

- Say what the code does, not what the author "wants". Use the PR's names for things, once, then plain words.
- Short sentences that land on one picture each. Cue the words that change the picture.
- Numbers only from the PR, through placeholders or quoted from the body (then the screen shows `quote()`).
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
The narration's length is where its last word ends; `prs voice` prints it against the tier. A caption shows at most 9 words: commas and full stops
break it, and a longer phrase is split evenly.

### Example beat

```json
{
  "id": "negotiate",
  "need": "exchange",
  "say": "So VS Code asks at runtime, using RFC 9728. One: request the index. Two: on a 401 or 403, read the marketplace's well-known metadata for its authorization server and scopes. Three: get a token scoped to that resource. Four: retry. If step one works, nothing else runs.",
  "cues": { "rfc": "RFC 9728", "step1": "One", "step2": "Two", "step3": "Three", "step4": "Four", "skip": "If step one works" },
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
   - from the second round on: the last verdict and what you changed
4. Save the verdict to `<studio>/videos/<slug>/build/review.md` as it comes, before fixing (append each round; in a
   self-review: what you found, then what you fixed, round by round). Fix every must-fix, render, publish, ask again.
   Stop at `VERDICT: SIGNED OFF`.

If you can't start subagents, follow "Reviewing your own video" in [reviewer.md](reviewer.md), write it to the
same `review.md`, and mark the video as self-reviewed (see "Deliver" in the skill).
