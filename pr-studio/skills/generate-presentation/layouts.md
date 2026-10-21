# Layouts

Pick a layout for each slide below, then copy the fields of its sample: the slide with the same `id` in
`<studio>/deck/samples/deck.mjs`. `prs deck samples --no-pdf` draws every sample in a few seconds, into
`<studio>/deck/samples/out/slides/NNN.png`. The page column gives each sample's page.

| Layout | For | Page | Beyond the sample |
| --- | --- | --- | --- |
| `title` | the first slide (scaffolded) | 001 | |
| `statement` | one big sentence, with 1–2 `{{tone\|marks}}` | 002 | dark version: 028 |
| `hero` | one giant number or word | 003 | |
| `quote` | a real quote, with who said it | 004 | |
| `counters` | 1–3 big numbers | 005 | |
| `pillars` | 2–4 ideas side by side | 006 | |
| `icons` | 2–5 big icons, 1–3 words each | 007 | `arrows: true` |
| `checklist` | 3–5 rows | 008 | 6–10 rows: `columns: 2, dense: true` |
| `board` | 2–4 columns of cards | 009 | |
| `pipeline` | stages left to right | 010 | `loop` (an arrow back), `branch` (a failure path) |
| `steps` | 2–6 numbered steps, and a card on the right | 011 | a copy-paste prompt goes in `aside.prompt` |
| `sequence` | messages between 2–4 parties | 012 | |
| `journey` | one thing travelling across 3–5 stops | 013 | the scaffolded status slide uses it |
| `flow` | boxes and arrows with yes/no branches | 014 | at most 5 × 3 boxes; titles ≤ 24 characters (a long code name overflows); `cols` and `rows` as many as used (an empty column is still drawn) |
| `lanes` | who does what: steps in 2–3 lanes | 015 | |
| `layers` | 2–5 stacked bands | 016 | |
| `bars` | a bar chart, 2–8 bars | 017 | `horizontal: true` for long labels |
| `split` | before and after, old and new | 018 | pictures on both sides: 026 (the same `crop`; `box` rings what changed) |
| `matrix` | a table of up to 7 rows | 019 | |
| `code` | up to 12 lines, with up to 3 callouts | 020 | `diff: true` (lines start with `+`, `-` or a space), `from`, `highlight`; shorten lines over ~70 characters with `…` |
| `chat` | a conversation | 021 | |
| `ui` | a mock chat window: tool calls, approvals | 022 | |
| `files` | a folder tree, up to 3 files explained | 023 | |
| `image` | a picture from `assets/`, cropped, with pins and rings | 024 | `crop`, pins (`at`) and rings (`box`) are in the whole picture's pixels, not the crop's; leave room above a pin for its number |
| `spans` | what lives how long: state across moments | 025 | |
| `howto` | how to do it in the app: the real keys, step by step | 027 | |

## Fields every slide can have

Beyond `id`, `layout`, `eyebrow`, `title`, `notes` and `sources`:
- `say`: the one line to remember;
- `link`: a QR badge, also a link in the PDF: `{ url, label, logo | icon }`;
- `tag`: a pill beside the title: `{ text, tone, icon }`;
- `bg`: `'dark'` or `'blue'`;
- `nosrc: true`: the numbers aren't statistics (versions, line numbers);
- `maxWords`: an agreed exception to the 25 words.

## Markup, icons and fitting

- **Inline markup** in any text: `{{blue|marked words}}` (any tone, or `neutral`), `**strong**`, `` `code` ``, and `\n`.
- **Icons:** `prs catalog --icons` lists the names. **Logos:** `github`, `githubcopilot` and `vscode`.
- If the build says "shrunk" or "taller than its area", cut words, not the font size.
- Labels are drawn in capitals, so keep file names and code out of them.

## A design of the deck's own

When no layout can show an idea, draw it in `<studio>/decks/<slug>/designs/<name>.mjs`, a function that returns the
slide's HTML. Copy `<studio>/deck/samples/designs/samples.mjs`: its comments give the helpers and the rules.
