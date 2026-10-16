# Making the deck

How to write the slides of a deck about a pull request, and, when no layout can show an idea, how to draw a design of
the deck's own. The fields of every layout are in [layouts.md](layouts.md); one slide of each is in
[samples.png](samples.png).

## Writing the slides

The deck is for someone who won't read the pull request: a teammate catching up, a reviewer deciding where to start,
a manager. After it they should know what changes, why, how it works, what could break, the status, and where to start
reading. Every slide is one idea, drawn as a picture more than written as text, and every fact on it can be traced to
the PR. Look at [samples.png](samples.png) before writing.

### The facts

All of them come from the PR, which `prs deck new --pr` fetched into `<studio>/videos/<slug>/`:

- `brief.md`: the description, the commits, the files by area, the symbols touched, the tests. Read all of it.
- `pr.diff`: all of it outside the tests when the brief says the PR is small enough (under about 400 changed lines);
  otherwise search it for the lines you show or describe.
- The changed files at the head commit, in `build/src/<head>/`: read the functions around the diff, so you explain what
  the code does, not only what changed.
- The review discussion (in the brief): what reviewers asked and the author answered. It often says why the code is the
  way it is, what is risky, or what was left for later: use it on the risk or status slide and in the notes ("in review,
  @x asked whether …"). A reply may say who wrote it ("authored by Copilot"): keep that.
- The pictures (the brief's Pictures section): the author's screenshots, the CI's before and after screenshots of the
  screens the PR changes, and pictures from comments. For anything visible, show them (below).

Untested or claimed-only facts get "per the author" (a manual run, a measurement the author reports). No guesses about
intent and no marketing. The build checks every code line, `inline code` and file path on the slides against the PR
(not in the notes: check those yourself).

### Length

The brief's Length section gives the number of slides, from the PR's size and risk: a small PR 5–6, a medium one 7–8, a
large or risky one 9–10, the title, status and end slides included. About one minute a slide when presented.

A short deck can't have a slide for every step of the arc below; fold it. In 5–6 slides: the title, one slide for the
problem and the change together (a before and after), one for how it works, the status (with what is open, tested or
left for later on the slide or in its notes), and the end. The idea in one sentence fits the title's `sub`; a dark or
blue page is optional below 7 slides.

### Pictures

A screenshot from the PR shows the change better than any drawing of it. When the description has some:

1. Download the ones you will use into `<studio>/decks/<slug>/assets/`, under names that say what they show
   (`curl -fsSL -o <studio>/decks/<slug>/assets/new-dialog.png '<url>'`; the CI's have no extension but are PNG), and
   open each one: check it shows what the brief says.
2. `prs deck grid <slug> assets/new-dialog.png` draws the picture with a grid of its pixels: read the positions for
   the crop and the marks from it.
3. One picture: an `image` slide. `crop: [x, y, w, h]` to the part that matters (a whole window is unreadable on a
   slide), and one callout per point: `at: [x, y]` pins its number beside the spot, `box: [x, y, w, h]` rings a region.
4. Before and after: a `split` with a picture on each side (`image`, the same `crop` on both, a `box` ringing what
   changed on each), its `title` saying the difference in a few words, and the `verdict` for what doesn't change.
5. Put the PR in `sources` ("CI screenshots on owner/repo#n" for the CI's), and say in the notes what the picture shows
   ("the author's screenshot of …").

When the PR changes something a user sees or does, take pictures of the real app as well, even when the PR has its own,
at the states that tell the story (before the action, the action, the result). When it changes how something behaves,
take the same states in the app without the change too, so a `split` shows the same moment before and after (unless a
recording can't reproduce the before: then the after alone). A state that needs the app signed in (chat, anything AI)
is captured too: step 2 says how.

1. Run the app with the change and, for a before and after, the app without it: the same kind of build, with the same
   profile, window and sample data, each with a throwaway profile in a temp folder. For VS Code, no checkout or build is
   needed: Insiders builds by commit, `https://update.code.visualstudio.com/api/commits/insider/<platform>` lists them,
   newest first (`darwin-arm64`, `darwin`, `linux-x64`), and
   `https://update.code.visualstudio.com/commit:<sha>/<platform>/insider`
   downloads one (a zip of about 300 MB). `gh api repos/<owner>/<repo>/compare/<merge commit>...<build sha> --jq .status`
   says whether a build has the change (`ahead` or `identical`: it has it; `behind` or `diverged`: it doesn't; the merge
   commit: `gh pr view <url> --json mergeCommit`): the newest build without it is the before, the oldest with it the
   after. For an open PR, build its base and its head.
2. When the app reads the user's home (VS Code lists their personal skills and agents from it), give it its own `HOME`
   in the temp folder, with the user's keychain linked in (macOS: `<home>/Library/Keychains` → `~/Library/Keychains`):
   without it, the app's first keychain access makes macOS ask the user in a dialog. When a state needs the app signed
   in (chat, anything AI), copy the signed-in state of the same kind of app into the throwaway profile: its secrets
   decrypt with the key in the keychain. For VS Code:
   `sqlite3 <signed-in profile>/User/globalStorage/state.vscdb ".backup <profile>/User/globalStorage/state.vscdb"`,
   from the user's profile of that build (Insiders: `~/Library/Application Support/Code - Insiders`; Code OSS:
   `~/.vscode-oss-dev`), and `"update.mode": "none"` and `"window.zoomLevel": 1` (big enough to read on a slide) in the
   profile's settings. Keep the account's name out of the pictures, and delete the profile when you are done: it holds
   a copy of the sign-in.
3. Drive it with Playwright (`<studio>/node_modules/playwright-core`: `_electron.launch` for an Electron app, a browser
   context for a web app) through the PR's steps: its "how to test", its tests, the same steps in each app. Before each
   screenshot, check that the state is on screen; a screenshot counts only if it is.
4. Save each state into `assets/` under a name that says what it shows (`before-skill-detail.png`,
   `after-skills-list.png`), with the scripts next to them, and use them like the PR's own: crops, pins and rings from
   `prs deck grid`, a `split` for before and after.
5. Say in the notes that the picture is a capture of the app (which build: with or without the PR's change), and the
   steps that led to it.

A PDF doesn't move: show an interaction as its states, side by side or on consecutive slides.

Draw a `ui` or `chat` mock only for behaviour that neither the PR's pictures nor the running app can show, and say in
the notes that it is a sketch.

### A deck about a pull request

1. **Title** (scaffolded): the PR's state, size by area or file, and author are filled in. Write the title as the point
   of the PR in at most 8 plain words, and the `sub` as one sentence: what changes, for whom. (`quote` is for a real
   quote, drawn in quotation marks.)
2. **The problem, made concrete:** what was wrong or missing before this PR, shown, not told. The author's screenshot
   (`image`), a `story` if the PR tells an incident, a `split` (before and after), a `ui` or `chat` mock of the old
   behaviour, a `hero` number when the PR gives one.
3. **The idea in one sentence:** a `statement` (on `bg: 'dark'` or `'blue'` for rhythm). Only in a deck of 9 or more
   slides; in a shorter one the title's `sub` says it, and the dark or blue page goes to another big idea (a `hero`
   number, `counters` for the tests).
4. **How it works:** one or two diagrams of the mechanism, named with the PR's own words: `flow` (decisions),
   `pipeline` (stages), `sequence` (messages between parts), `journey` (one thing travelling), `spans` (what lives how
   long: state that outlives a step), `layers`, `lanes`, `files` (where the change lives), and one `code` slide with the
   lines that matter, from the diff.
5. **What it changes:** for users (`howto` with the real keys and commands, `ui`), or for the code (`split` old/new
   shape, `matrix` of cases). Numbers only from the PR, with `sources`.
6. **Risk, tests, what is open:** what the tests cover (`pillars` or `checklist`, with the test files), what is left
   for later, what could break. From the PR body and the tests in the diff.
7. **Status** (scaffolded): the real path from opened to merged. Write its title.
8. **End** (scaffolded): its title is the one thing to do or remember ("Try it: Alt-click a session pill",
   "Start reading at `_open`").

Pick the middle by the kind of PR:

- **Bug fix:** the symptom (`ui`, `story`) → the cause (`flow`, `code`) → the fix (`split`, `code`) → how it is proven.
- **Feature:** the gap → what it adds (`howto`, `ui`) → how it works (`sequence`, `layers`, `code`) → limits.
- **Refactor:** the old shape → the new shape (`split`, `layers`, `files`) → why it is safe (the tests, no behaviour
  change).
- **Performance:** the cost (`hero`, `bars` from the PR's numbers) → where it came from → the change → the measurement.
- **UI polish:** one slide per visible change, before and after (the author's screenshots with pins, `split`, `ui`),
  grouped if there are many.

### Rules for every slide

1. **One idea.** The title says the point, not the topic, in ≤ 8 plain words (≤ 48 characters; ≤ 40 on the title
   slide, where it is bigger): "Alt picks the side,
   the pill picks the slot" works, "Routing" doesn't. The eyebrow names the topic in 2–4 words.
2. **At most 25 words besides the title** (45 on a story, 60 on a `term` card). The build counts them, lists the count
   of every slide, and warns above 25 in a deck about a PR. Not counted: the eyebrow, small-capital labels (card,
   window and chat labels, table column headers), code lines and the code slide's file name, step numbers and number
   badges, big numbers (`hero`, `counters`), and the title's tag. Everything else counts: pills, arrow labels, and
   `inline code` too. The rest goes into `notes`: the
   speaker says it, the audience doesn't read it.
3. **Every number has a source:** on a slide about the PR, `sources: ['owner/repo#n | https://github.com/…/pull/n']`.
   `nosrc: true` only when the numbers aren't statistics (versions, line numbers, steps).
4. **Every slide has `notes`:** 2–5 plain sentences: what to say, and any caveat ("per the author"). `say` is the one line
   to remember.
5. **A different picture on every slide.** Never the same layout twice in a row; at least half the slides are diagrams,
   pictures or big single ideas (the text-box layouts are `checklist`, `steps`, `pillars`, `board`, `grid`, `matrix`,
   `split` and `term`; a `split` of two screenshots counts as a picture).
6. **Use the PR's names, once, then plain words.** Code names in `` `backticks` `` exactly as in the diff (the build
   flags any it can't find); a name the audience can't know ("Forge links") gets a few plain words the first time, or
   plain words instead.
7. **Colour has meaning:** green good, red risk, orange attention, yellow medium, purple the AI, blue neutral. Pair it
   with an icon or a word. Numbered steps, callouts and cards take colours by their order (blue, green, purple,
   orange): set `tone` on one when its colour would say something wrong (a purple callout that isn't about the AI).
8. **No gray boxes, no soft shadows.** Cards are soft colour tints; emphasis is a sharp ring.
9. **Dark and blue pages for rhythm, one or two a deck:** `bg: 'dark'` or `'blue'` works on `statement`, `quote`, `hero`,
   `icons` and `counters` only; the other layouts are drawn for white.

### Voice

Plain, calm and concrete. Say what the code does, not what the author "wants". No hype ("robust", "seamless",
"game-changer") and no emoji. Technical where the audience is technical, never jargon for its own sake.

## A deck's own designs

When no built-in layout can show an idea, draw it. A design is a function that returns the HTML of one slide; it lives
with the deck, so it can't change any other deck. The example to copy: `<studio>/deck/samples/designs/samples.mjs`
(`samples-build`, the last slides of the samples).

### The file

`<studio>/decks/<slug>/designs/<anything>.mjs`:

```js
// Designs of the <slug> deck. One design draws one slide.
//   offline-queue: a conveyor belt of edits waiting for a signal, the oldest at the front
export function designs({ heading, body, bodyHeight, W, ic, pill, fmt, esc, r1, arrowHead }) {
	return {
		/** What it draws, in one line. Its fields: items: [{ title (<= 20), tone }], ... */
		'offline-queue': {
			css: `
.offline-queue { position: relative; }
.offline-queue .oq-item { position: absolute; border-radius: 20px; background: var(--tint); color: var(--fg); }
`,
			render(s, ctx) {
				const H = bodyHeight(s);
				return heading(s) + body(`<div class="offline-queue" style="width:${W}px;height:${H}px">…</div>`, { vcenter: false });
			},
		},
	};
}
```

The slide then says `layout: 'offline-queue'` and carries the design's own fields next to the usual ones (`id`,
`eyebrow`, `title`, `notes`, `sources`, `say`, `link`, `bg`). `render` may be `async`.

- **Name:** `<deck or topic>-<concept>`, lower case. It must not be the name of a built-in layout.
- **Helpers** (the argument of `designs`): `heading(s)`, `body(html, { vcenter })`, `bodyHeight(s)` (the height under
  the title; a `link` makes it shorter), `W` (1728, the width), `ic(name, size, colour)`, `iconTile(name, { tone, size,
  round, solid })`, `pill({ text, tone, icon })`, `logo(slug, size)`, `fmt` (inline markup), `esc`, `plain`, `r1`,
  `arrowHead(x2, y2, x1, y1, colour, width)`, `arrowSvg(width, colour)`, `stepTone(i)`, `qrSvg(text)`,
  `asset('assets/x.png')` (the `<img src>` of a picture in the deck's `assets/`, or null if it's missing),
  `deckFile('assets/x.png')` (its absolute path, for reading it), `pngSize(file)` (`{ width, height }` of a PNG or
  JPEG: `pngSize(deckFile(s.src))`, to place things on a picture), and `picture(src, { crop, maxW, maxH, maxScale, pins,
  rings })`, which returns `{ html, w, h }`: a cropped, scaled picture with pins (`{ at, n, tone }`) and rings (`{ box,
  n, tone }`), as the `image` layout draws it. Use it for pictures: its frame clips the crop, which the build expects.
- **CSS:** every selector starts with the design's class (`.offline-queue .oq-item`), so designs can't change each
  other. Give inner elements class names with a prefix of the design (`oq-item`, not `item` or `code`): the theme's own
  classes (`code`, `shot`, `pill`, `card`, `mark`…) would style them too. The build includes only the CSS of designs the
  deck uses.
- **Colours:** `var(--blue)`, `--green`, `--red`, `--orange`, `--yellow`, `--purple` and their `-tint`s, `--ink`,
  `--body`, `--muted`, `--line`, `--connector` (arrows), `--mono` (code font). A `t-<tone>` class sets `--fg` and `--tint`.
- **Text:** `data-t` on every element with text (SVG `<text>` too), so the build can check overflow and count words;
  `data-fit` on any box whose text could overflow it; the class `nolint` on decorative text the word count should skip
  (axis ticks, a legend's letters).
- **Code names:** write them in `` `backticks` `` in the slide's data: the build checks those against the PR before
  your design draws them, so the design may draw them however it likes (`fmt` as code, `plain` as plain text).
- **Never:** blurred `box-shadow`, `text-shadow` or `filter` (PDF viewers draw them as gray boxes; a sharp ring
  `box-shadow: 0 0 0 6px var(--fg)` is fine), gray fills or gray outlines, fonts or colours outside the theme.

### Click by click

A slide with `clicks: [{ caption, say }, …]` becomes one PDF page per click. The caption shows in a bar at the bottom,
with numbered dots; `say` goes into the notes. Only designs read the click: `ctx.step` is 1 on the first click.

- Draw the whole picture on every click and hide what comes later with the class `later` (`visibility: hidden`): it keeps
  its place, so nothing jumps.
- Give every element that appears or changes a `data-key`: the build warns if one moves between clicks.
- On each click, show what is new (a ring, a solid fill) and let what came before go quieter.
- Keep it to 3–6 clicks. The bar takes the bottom of the slide: draw within `bodyHeight(s)`.

### A good design

- **The idea is a picture:** what would you draw on a whiteboard to explain it? Draw that, not boxes with words in them.
- **It fills the page** under the title: no small diagram in a sea of white.
- **Few words, big:** the 25-word limit holds.
- **Shapes:** soft colour tints, white icon discs, one solid colour for the thing that matters; connectors go around text,
  never through it.

A menu of pictures, to pick from when a slide needs one:

- **Paper:** a receipt with line items and a total; a boarding pass; a passport with stamps; a contract with a highlighted
  clause; a report card; a sticky note on a monitor; a newspaper front page.
- **Places:** a metro map; a floor plan with locked doors; a road with guardrails; a maze; a fork in the road; a bridge; a
  security checkpoint; a turnstile.
- **Instruments:** a speedometer; a fuel gauge or battery; a thermometer; a scale with weights; a traffic light; a fuse
  box; an hourglass; a stopwatch.
- **Systems:** a conveyor belt with an inspector; slices of Swiss cheese whose holes line up; a chain with one weak link;
  dominoes; a relay baton; a photocopy of a photocopy.
- **Data:** a waffle chart of 100 squares; a slope graph; a dot plot; a heat-map calendar; a Sankey of where things go.
- **Screens:** a browser with its address bar; notifications on a lock screen; an inbox; a git graph; a pull request with
  its checks; a settings toggle.
- **Scenes:** a referee with a card; a podium; a tug of war; a stage with a spotlight; a whiteboard.
