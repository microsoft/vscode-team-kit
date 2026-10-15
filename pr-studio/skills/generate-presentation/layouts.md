# Layouts

Every built-in layout, with its fields. [samples.png](samples.png) shows one slide of each (`prs deck samples
--no-pdf` builds them full size into `<studio>/deck/samples/out/slides/`); the data of each sample is in
`<studio>/deck/samples/deck.mjs`, under the same `id` as its layout. Look at the samples, pick, then copy the fields of the
sample.

The page of each sample in `out/slides/` (`NNN.png`): title 001, agenda 002, section 003, statement 004, hero 005,
quote 006, counters 007, pillars 008, icons 009, venn 010, pipeline 012, steps 013, sequence 014, journey 015,
timeline 016, flow 017, cycle 018, lanes 019, loop 020, layers 021, split 023 (with pictures: 053), matrix 024,
quad 025, spectrum 026, targets 027, corridors 028, sliders 029, poll 030, board 032, checklist 033, tree 034, bars 036,
funnel 037, fan 038, hub 039, gate 040, halves 041, ways 042, runs 043, grid 044, code 046, terminal 047, chat 048,
ui 049, files 050, image 051, spans 052, media 054, posts 055, howto 056, transform 057, interview 058, brief 059,
mirror 060, story 061 (and its looks to 066), term 067, a deck's own design 068, end 071.

The limits (≤ 28 and so on) are characters that fit at full size. If the build says "shrunk" or "taller than its area",
cut words, not the font size. Labels are drawn in capitals (eyebrows, the `label` of cards, steps and windows): keep
file names and code out of them.

## Fields every slide can have

`id` (kebab-case, unique) · `layout` · `eyebrow` (2–4 words, the topic; drawn in capitals) · `title` (the point, ≤ 8
words) · `tag` (a pill right of the title: `{ text, tone, icon }`) · `notes` (2–5 sentences for the speaker) · `say` (the
one line to say, ≤ 70 characters; goes into the notes) · `sources` (`['Short label | https://…']`, one line under the
slide) · `link` (a QR badge in the bottom-right corner, also a real link in the PDF: `{ url, label, logo | icon, caption }`)
· `bg` (`'dark'` or `'blue'`, for rhythm) · `clicks` (`[{ caption, say }]`: one PDF page per click; only for designs that
read `ctx.step`, see "A deck's own designs" in [guide.md](guide.md)) · `defines` (terms this slide explains) · `allowTerms` (terms used before
their explanation, on purpose) · `nosrc: true` (the numbers here aren't statistics) · `maxWords` (an agreed exception to the
25 words) · `minutes` (speaking time, if not about 1).

**Inline markup** in any text: `{{blue|marked words}}` (tones: blue, green, red, orange, purple, yellow, neutral) ·
`**strong**` · `` `code` `` · `\n` for a line break.

**Tones** mean something: green good / do this · red bad / danger · orange attention / predict first · yellow medium ·
purple the AI or the model · blue neutral and primary · neutral grey. Pair a colour with an icon or a word.

**Icons** (`icon:`) are Fluent UI names: `node -e "import('<studio>/deck/theme/icon-files.mjs').then(m => console.log(Object.keys(m.ICON_FILES).join(' ')))"`
lists them (`person`, `bot`, `code`, `rocket`, `shield`, `sync`, …). **Logos** (`logo:`) for naming a company or where a
link goes: `anthropic`, `claude`, `github`, `githubcopilot`, `google`, `huggingface`, `meta`, `mistralai`, `openai`, `reddit`, `snyk`, `supabase`, `vercel`, `vscode`, `x`, `youtube` and a few more in
`<studio>/deck/theme/logos/logos.mjs`.

## Text and structure

| Layout | Use it for | Fields |
| --- | --- | --- |
| `title` | the first slide (no header line or counter) | `eyebrow` (the occasion), `title` (≤ 40), `sub` (one line under it, ≤ 110) or `quote` (the same, in quotation marks: only for a real quote), `speaker: { initials, name, role }`, `pills` (≤ 3: `{ text, tone, icon }`), `card: { label, big, sub, rows }`: a card on the right, where `rows: 'blocks'` lists the deck's sections with their minutes (computed), or `rows: [{ title, value, note }]` |
| `section` | first slide of a part | `number`, `eyebrow` ('Part 7  ·  Block name  ·  12 minutes': the build fills in the part number and minutes), `title`, `sub` (≤ 100 chars), `chips` (≤ 3; string or `{ icon, text }`, ≤ 32 chars), `tone` |
| `statement` | one big sentence | `eyebrow`, `text` (≤ 110 chars, 1–2 `{{tone\|marks}}`), `chips` (≤ 4: `{ icon, text, tone }`), `note` (≤ 160) |
| `quote` | a real quote, with a source | `eyebrow`, `text` (≤ 140), `who: { initials, name, role }` |
| `pillars` | 2–4 ideas side by side | `items: [{ icon, title (≤ 28), text (≤ 100), example (≤ 80), exampleLabel, tone }]`, `exampleLabel` (default 'Example'), `height` (px, default 430) |
| `counters` | 1–3 big numbers | `items: [{ value (≤ 6 chars, e.g. '84%', '~54', '255k'), label (≤ 40), sub (≤ 80), tone }]`, `note` |
| `checklist` | 3–5 rows (or 6–10 with `columns: 2, dense: true`) | `items: [{ icon, tone, title (≤ 56; ≤ 38 in 2 cols), sub (≤ 80; ≤ 54 in 2 cols) }]` |
| `steps` | 2–6 numbered steps (+ a card on the right) | `steps: [{ title (≤ 48), text (≤ 80), tone }]`, `aside: { label, title, text, prompt, mono }` (a copy-paste prompt goes in `prompt`) |
| `pipeline` | stages left to right | `stages` (2–5): `[{ icon, title (≤ 22), sub (≤ 54), chip, tone, on }]`, `loop: { from, to, label }` (0-based stage indexes, an arrow back), `branch: { from, label, title, sub, tone, icon }` (a failure path under a stage), `stageHeight` (px, default 236: every stage has this height, so raise it if a stage overflows) |
| `sequence` | messages between 2–4 parties | `parties: [{ icon, title, sub, tone }]`, `steps` (2–5): `[{ from, to (0-based), text (≤ 40), mono, reply (≤ 32), replyTone, tone }]` |
| `journey` | one thing travelling across 3–5 stops | `nodes: [{ icon, title, sub (≤ 50), tone, result, resultTone }]`, `hops: ['label', …]`, `packet: { text, icon }` |
| `timeline` | 3–8 dates | `items: [{ date, title (≤ 30), sub (≤ 60), tone, now }]`, `alternate: true` (labels above/below, for 6+ items) |
| `layers` | 2–5 stacked bands | `layers: [{ icon, title, sub, tone, chips: [], callout }]` |
| `matrix` | a table (≤ 7 rows) | `columns: [{ label, width }]` (e.g. '1.4fr', '320px'), `rows: [[cell, …]]`, where a cell is text or `{ text, ok: true/false, icon, tone, mono, pill }`; a row can be `{ cells, tone }` to tint it; `note` |
| `board` | 2–4 columns of cards | `columns: [{ title, icon, tone, items: ['text' or { title, sub }] }]` (≤ 4 items each) |
| `split` | before / after, weak / strong | `left`, `right`: `{ label, tone (left blue, right green by default; `neutral` draws no card), icon, title, prompt \| text \| lines: ['…' or { text, ok }] \| image, mono, notes: ['chip'…], on }`, `verdict: { text, tone, icon }`, `height` (default 420). Short sides (≤ 4 lines of ≤ 44 characters, or a text ≤ 150) get bigger type, centred in the cards. A side with `image: 'assets/x.png'` shows that picture: `crop: [x, y, w, h]`, `box: [x, y, w, h]` (or a list of them) to ring what changed, in the picture's own pixels; equal crops get the same scale on both sides |
| `code` | ≤ 12 lines of code + ≤ 3 numbered callouts | `lang`, `file`, `dir` (a long one is cut with "…"), `code` (string), `from` (first line number), `highlight: [line numbers]`, `diff: true` (lines start with '+', '-' or ' '; no line numbers are drawn, so callouts show only their badge), `callouts: [{ lines: [a, b], title, text, tone }]` (line numbers counted from `from`; ranges that don't overlap), `annotate: true` (the callouts drawn beside their lines, joined by connectors; no diff colours), `fontSize`, `calloutsWidth`, `hideLines`. Lines longer than about 70 characters (110 without callouts) are cut at the right edge: shorten them with `…` |
| `ui` | a mock chat window (tool calls, approvals) | `window: { title, width, blocks: [{ kind: 'user' \| 'agent' \| 'tool' \| 'approve' \| 'toast' \| 'text', text, cmd, buttons, status, statusTone, icon, tone }] }`, `callouts` (≤ 3) |
| `poll` | predict, then reveal (2 pages) | `lead` (≤ 120), `options` (2–4): `[{ text (≤ 40), sub, correct: true }]`, `answer` (≤ 160), `kind: 'hands'` for a show of hands, `reveal: false` for no answer page |
| `image` | a screenshot from the deck's `assets/` (PNG or JPEG), with numbered pins | `src: 'assets/x.png'`, `alt`, `width`, `height`, `crop: [x, y, w, h]` (a region in the picture's own pixels, scaled to `width`; use it, full screenshots are unreadable on a slide; without `crop` the whole image is fitted inside the frame), `placeholder` (text shown if the file is missing), `callouts` (≤ 3: `{ title, text, tone, at: [x, y], box: [x, y, w, h] }`: `at` marks that point with a dot and stands the callout's number about 80 px above it on a stem (below it near the top edge), so leave room there; `box` rings that region, numbered beside it; both in the picture's own pixels, like `crop`; one callout may have both; `prs deck grid` shows them). Pin a spot with some empty picture above it (below it near the top edge), where the number stands |
| `term` | a plain-English definition card (only when the term is new to them and needed later) | `term` (≤ 24), `def` (≤ 110), `analogy` (≤ 90), `example` (≤ 90), `exampleLabel`, `symptom` (≤ 90, "you've seen this when…"), `todo` (≤ 90, what to do), `aliases` |
| `posts` | 1–4 posts from X, Reddit, Hacker News, a blog or GitHub, drawn as cards in our look (never screenshots or logos) | `posts: [{ platform: 'x' \| 'reddit' \| 'hn' \| 'blog' \| 'github' \| 'youtube' \| 'linkedin' \| 'news', author (≤ 28), handle, sub, initials, date, text (1 post ≤ 220 chars; 2 posts ≤ 130; 4 posts ≤ 80), metrics: [{ icon, text }] (e.g. `heart` '15.9k', `repeat` '1.4k', `eye` '3.4M views', `arrowUp` '561 points', `chat` '403 comments'), tone, size }]`, `callouts` (≤ 3, single post only), `takeaway` (one line under the cards), `takeawayTone`, `takeawayIcon`, `width`. Three cards: keep each text to about 3 lines (≤ 110 chars) |
| `agenda` | list of parts with minutes | `items: [{ number, title, sub, minutes, tone }]` |
| `quad` | a 2×2 (no apostrophes in the axis labels: the vertical one renders them badly) | `x: { label, low, high }`, `y: { label, low, high }`, `cells: [topLeft, topRight, bottomLeft, bottomRight]`, each `{ icon, title, text (≤ 80), example (≤ 60), tone }` |
| `grid` | 4–8 small cards | `items: [{ icon, title (≤ 32), text (≤ 80), tone }]`, `cols`, `tinted: true` |
| `end` | closing link + QR | `url`, `title`, `meta`, `qr`, `qrCaption` |

## Diagrams

Prefer these: the shape carries the idea, so the slide needs few words.

| Layout | Draws | Fields |
| --- | --- | --- |
| `tree` | a request branching into what the agent could do; your words cut some branches | `root: { label, text (≤ 40) }`, `branches` (3–6): `[{ text (≤ 22), cut: 'the words that cut it' (≤ 24) }]` (list the open ones last), `cutLabel`, `keepLabel` |
| `spectrum` | a scale between two extremes, with the good zone | `left`, `right`: `{ title (≤ 18), text (≤ 34), icon, tone }`, `zone: { from, to (0–1), title, text (≤ 50), tone }`, `marks: [{ at, label, tone }]` |
| `chat` | a conversation (light, or `dark: true` like the editor) | `messages` (2–4): `[{ from: 'user' \| 'agent' \| 'note', text (≤ 120), label, mono, icon, tone }]`, `window` (bar title), `width`, `callouts` (≤ 3) |
| `files` | a folder tree with explained files | `root`, `items: [{ path: 'a/b/FILE.md' (end folders with /), title (≤ 26), text (≤ 40), icon, tone }]` (an item without `title` is drawn, not explained; ≤ 3 explained), `panelWidth` (the tree's width, default 640), `noteHeight` (each note's height, default 128) |
| `cycle` | a loop of 3–6 steps | `steps: [{ icon, title (≤ 24), sub (≤ 28), tone }]`, `center: { title (≤ 28), icon }`, `aside: { label, title, text }` |
| `flow` | boxes and arrows with yes/no branches | `nodes: [{ id, col, row, title (≤ 24), sub (≤ 32), icon, tone, kind: 'decision' }]`, `edges: [{ from, to, label, tone, bend: 'below' \| 'above', dashed }]`, `cols`, `rows` (≤ 5 × 3), `boxWidth` (px, default 390; narrower for 4–5 columns), `boxHeight` |
| `spans` | **what lives how long**: a few moments left to right, a row per piece of state, a bar while it holds (a lifecycle; ownership that ends while identity stays) | `moments` (3–5): `[{ title (≤ 18), sub (≤ 24) }]`, `rows` (2–5): `[{ title (≤ 20), tone, bars: [{ from, to (moment indexes, 0-based), text (≤ 26), tone, solid }] }]`, `labelWidth` |
| `bars` | a bar chart | `bars` (2–8): `[{ label, value, text, tone, on }]`, `unit`, `max`, `horizontal: true` (long labels), `note` |
| `funnel` | narrowing stages with numbers | `stages` (2–5): `[{ value, label (≤ 34), tone }]`, `note` |
| `hero` | one giant number or word, optionally with a brand logo | `logo` (slug), `logoText`, `icon`, `value` (≤ 6 chars), `label` (≤ 70), `sub` (a pill, ≤ 30), `subTone`, `tone`, `title` (optional), `align: 'left'` |
| `venn` | 2–3 overlapping circles | `sets: [{ title (≤ 20), sub, tone }]`, `center: { title, icon }` |
| `media` | 1–6 pictures with captions, or groups of stacked strips (chat lines) | `items: [{ src, alt, caption, sub, kind: 'image' \| 'video' \| 'website' \| 'motion' \| 'cad' \| 'svg', fit, placeholder }]`, `cols`, `height`; or `groups: [{ title, tone, icon, items: [{ src }] }]` |
| `terminal` | a terminal with commands and output | `lines: [{ cmd } \| { out, tone } \| { comment }]`, `window`, `width`, `fontSize`, `callouts` (≤ 3) |
| `icons` | 2–5 big icons with 1–3 words each | `items: [{ icon, title (≤ 16), sub (≤ 24), tone }]`, `arrows: true`, `note` |
| `story` | **what happened**: a real event in 3–5 beats on a timeline, with the outcome on the right. It goes before the lesson it supports, and may use up to **45 words**. | `eyebrow` ('What happened · 24 April 2026'), `title` (the event in plain words), `who: { icon, text (≤ 50 chars) }`, `beats` (3–5): `[{ time (≤ 16 chars: 'The task', '9:41 pm', 'Day 2'), text (≤ 12 words), icon, tone }]`, `outcome: { label, value (≤ 7 chars), text (≤ 14 words), pill, pillTone, tone }`, `link` (the original account), `look` (below) |
| `lanes` | **who does what**: steps left to right in 2–3 lanes (e.g. People and AI) | `lanes: [{ id, title (≤ 10), icon, tone }]`, `steps` (3–7): `[{ lane (a lane id; `null` = across all lanes, e.g. the release), icon, title (≤ 24), sub (≤ 20) }]`, `hops: ['', 'label on the line into step 2', …]` |
| `loop` | **a loop that repeats until it's clean, then a person decides** (e.g. You ⇄ Copilot review, then a teammate, then merged) | `steps` (3–5): `[{ icon \| logo, title (≤ 20), sub (≤ 26), tone, solid }]`, `hops: ['label on the arrow into step 2', …]`, `backs` (1–2, inner first): `[{ from, to, label, chips: [{ text, tone }], tone, dashed }]`, `zone: { from, to, label, tone }` (a tinted band behind the steps that loop) |
| `fan` | **written once, read by everyone**: 1–3 inputs → a hub → 3–7 readers | `inputs: [{ icon, title (≤ 18; `` `code` `` for file names), sub (≤ 30), tone }]`, `hub: { logo \| icon }`, `readers: [{ logo \| icon, title (≤ 26), sub, tone }]` |
| `howto` | **how to do it in an app**, for people who never used it: the real keys and small screens, step by step | `steps` (2–5): `[{ title (≤ 24), sub, tone, ui }]`; `ui` is one of `{ keys: ['F1'], alts: [{ label: 'Mac', keys: ['⇧','⌘','P'] }] }`, `{ palette: 'typed', items: ['Command title'], pick }`, `{ prompt, input, hint }`, `{ prompt, list: [...], pick }`; `button: { url, label, caption, icon }` (a real link in the PDF; `vscode://chat-plugin/install?source=owner/repo&plugin=name` installs a plugin), `note` |
| `sliders` | **settings drawn as sliders**: where each knob sits, and which one is locked | `rows` (2–3): `[{ label, left: { text (≤ 22), icon }, right: { text, icon }, at (0–1), tone, lock: true, mark (a pill under the knob, ≤ 22) }]` |
| `gate` | **many work alone, one person decides**: agents in a tinted area, all paths through one gate before the exit, and a blocked way around it | `zone: { label, tone }`, `workers` (2–4): `[{ icon, title (≤ 18) }]`, `gate: { icon, title (≤ 26), tone }`, `exit: { icon, title (≤ 12), tone }`, `bypass: { label (≤ 20) }` |
| `halves` | **two halves of one idea**, a dark one and a light one, joined by an arrow (e.g. while you're away / when you're back) | `left`, `right`: `{ label, icon, title (≤ 30), hero: ['icon', …] (1–4 big icons), card: { icon, text (≤ 40) } (one message-like line), items: [{ icon, text (≤ 26) }], dark: true, tone }` |
| `ways` | **one app, seen 2–3 ways** (a screenshot, the app's tree of named parts, both) | `ways: [{ pic: 'screen' \| 'tree' \| 'both', label (window name), title (≤ 20), sub (≤ 26), pros (≤ 26), cons (≤ 30), tone }]` |
| `runs` | **a loop**: the same job on a timer, a fresh run each time, one shared notes file | `task`, `times` (3–5), `run` (label next to each run), `rw` (label on the arrows), `memory: { file, text }`, `sides: [{ icon, title, sub, tone }]` |
| `hub` | **the model and its tools**, grouped by kind, with a numbered example path | `ask`, `center: { icon \| logo, title }`, `path: ['id', …]`, `groups: [{ title, tone, items: [{ id, icon \| logo, title (≤ 20) }] }]` (5–9 items) |
| `targets` | **three dartboards**: what a vague, a good and a too-tight prompt get you | `items` (3): `[{ title, prompt (≤ 44), hits: 'scatter' \| 'center' \| 'off', verdict (≤ 26), tone }]` |
| `corridors` | **three roads to a goal**: no walls (it wanders), walls with room, a tunnel into a wall | `items` (3): `[{ kind: 'open' \| 'rails' \| 'tunnel', title, prompt (≤ 40), verdict (≤ 22), tone }]` |
| `transform` | **raw in, clean out**, with what cleans it in the middle | `from: { icon, label, text }` (fillers in `~~double tildes~~` are struck out; no other markup), `via: { icon, label, sub }`, `to: { icon, label, text }` (plain text), `note` |
| `interview` | **the agent interviews you**; each answer adds a line to the spec on the right | `ask`, `qa` (2–4): `[{ q (≤ 44), rec (≤ 20), a (≤ 16), spec (≤ 30) }]`, `spec: { file, title }` |
| `brief` | **plan first**: a brainstorm becomes a written plan, you approve, then it builds | `steps` (3), `chat: [{ from: 'you' \| 'agent', text }]`, `doc: { file, sections: [{ label, text } \| { label, items }] }`, `approve: { label, sub }`, `roles: { you, agent }` |
| `mirror` | **the original and the copy**, compared again and again until they match | `prompt`, `left`/`right`: `{ title (≤ 18), sub, tone }`, `compare`, `loop`, `counter: { value, label }` |

## Story looks

`story` with `look` draws the same story data full page, with the outcome inside the picture. Two stories near each other
use different looks.

| `look` | Draws | Best for |
| --- | --- | --- |
| `road` | one wide road across the page, a big stop per beat; the outcome is the last, biggest stop (a coloured capsule) | a change over time ("monthly → weekly"); 3–4 beats, outcome value a short word or number |
| `number` | the outcome number huge in a disc in the middle; the beats sit around it, numbered, and point into it | a story whose point is one number ("22,003 issues read"); 4 beats |
| `panels` | a comic strip: one tall tinted panel per beat, the outcome in the last panel in full colour | a short sequence of scenes (problem → flood → fix); 3–4 beats |
| `split` | before and after: the problem on a red half, the fix and the outcome on a green half. A beat with `side: 'after'` starts the right half (default: the second half). `before`, `after`: the two labels | a turnaround |

Avoid `html` (raw HTML). If no layout fits, write a design of the deck's own: "A deck's own designs" in [guide.md](guide.md).
