---
name: generate-presentation
description: 'Make the shortest slide deck (a 16:9 PDF with speaker notes, at most 12 slides) that fully explains a GitHub pull request, in one white Microsoft look: one idea per slide, drawn as diagrams, with screenshots of the real app when the change is visible, every fact from the PR. USE FOR: "/generate-presentation 12345", "make slides about this PR", "a deck for my manager on PR <url>", "present this pull request". DO NOT USE FOR: editing PowerPoint files, videos (use generate-video), decks with no pull request behind them.'
argument-hint: PR number or URL
---

# Generate a presentation of a PR

A 16:9 PDF with speaker notes, at most 12 slides, that fully explains one pull request. It has one idea per slide, drawn
as a diagram, and screenshots of the real app when the change is visible. You write the slides from the PR; the engine
draws them and checks the words, code lines, paths and sources. First read [contract.md](../../shared/contract.md).

**Needs:** a terminal and file tools (reading images, subagents and chat artifacts help). macOS or Linux with Node.js
20+, and access to github.com. Commands install what they need into `~/.cache/` on first use. `gh`, signed in, is
optional.

## 1. Find the PR and the engine

- **The PR:**
  - a URL or `<owner>/<repo>#<n>`: use it;
  - a number alone: a PR of the workspace's GitHub repo;
  - nothing: ask.

  Ask for the audience only if the request hints at one you can't infer. By default, it is teammates and their manager.
- **The engine:** run `node <plugin>/scripts/setup.mjs` by absolute path; `<plugin>` is two folders above this file.
  Its last line is `STUDIO=<folder>`. Below, `prs <x>` means `node <studio>/cli/prs.mjs <x>`.

## 2. Make the deck

Post a one-line update after each step.

1. **Start.** `prs deck new --pr <url>` fetches the PR into `<studio>/videos/<slug>/` (the slug is `<owner>-<repo>-<n>`;
   pass it to every command) and writes `<studio>/decks/<slug>/deck.mjs`. The title card and the status slide (with the
   PR's QR code) are filled from the PR's data. There is no end slide.
2. **Facts.** Read them as the contract says. The brief's Pictures section lists the author's and the CI's screenshots.
3. **Pictures.**
   - Download the PR's screenshots you'll use into `assets/` (`curl -fsSL -o <studio>/decks/<slug>/assets/<name>.png
     '<url>'`; the CI's are PNGs without an extension). Open each to check it shows what the brief says.
   - When the PR changes something a user sees or does, capture the app too ([capture.md](../../shared/capture.md)):
     the author's pictures show what they saw, yours show the change running.
   - `prs deck grid <slug> assets/<file>` draws the picture with a grid of its pixels, to place crops, pins and rings.
     Add `--vs assets/<other>` to see where two pictures differ.
   - Draw a `ui` or `chat` mock only for what neither the pictures nor the app can show, and say in the notes that it
     is a sketch.
4. **Outline.** One line per slide: its point (the title), its layout, its evidence, and the answers it gives. Post it
   before writing.
5. **Write** `deck.mjs`. Pick layouts from [layouts.md](layouts.md), and copy each one's fields from its sample.
6. **Build.** Run `prs deck build <slug> --no-deliver` until it ends with `Checks: clean`. Fix the slide, not the
   check: cut words, pick another layout, copy code exactly from the diff, or add the source.
7. **Look.** Open `out/contact.png`, then every page at full size (`out/slides/NNN.png`). Fix what is crowded, clipped,
   empty, hard to read, or not what its title says.

### The slides

Most PRs need four or five:

1. **Title** (scaffolded): the PR's point in 8 plain words or fewer, and a `sub` of one sentence: what changes, for
   whom.
2. **What it looks like or does,** shown rather than told: a `split` of captures before and after, an `image`, or a
   `hero` number from the PR.
3. **How it works:** one or two diagrams of the mechanism, in the PR's own words (`flow`, `pipeline`, `sequence`,
   `journey`, `spans`, `layers`, `lanes`, `files`), or one `code` slide with the lines that matter.
4. **What could break, and how it is tested:** a `checklist` or `pillars` with the test files, or a callout on the
   how-it-works slide.
5. **Status** (scaffolded): the path from opened to merged, with the PR's QR code. Its title says where to start
   reading, or what is still open. Its notes give the scope, the tests and what is open.

Add a slide only for an answer these can't hold; the contract's arcs give the order.

Every slide:
- **One idea.** The title says the point, not the topic: "Alt picks the side, the pill picks the slot", not "Routing".
  The eyebrow names the topic in 2–4 words.
- **At most 25 words** besides the title (the build counts them, labels, subs and callouts included; not the eyebrow,
  column headers, code lines or big numbers). The rest goes in the notes.
- **Notes and sources.** Notes of 2–5 plain sentences: what to say, with caveats. Every number has a source:
  `sources: ['owner/repo#n | <url>']`.
- **A different picture.** Never the same layout twice in a row. At least half the slides are diagrams, pictures or
  big single ideas.
- **Code names** in `` `backticks` ``, exactly as in the diff: the build checks them.
- **Rhythm:** one or two slides with `bg: 'dark'` or `'blue'`, on `statement`, `quote`, `hero`, `icons` or `counters`.
- **Pictures:**
  - crop to the part that matters, pin each point, or ring a region;
  - a before and after is a `split` with the same crop on both sides;
  - a PDF doesn't move: show an interaction as its states;
  - the notes say where each picture comes from: the author, the CI, or a capture of which build.

## 3. Review

Follow [review.md](../../shared/review.md).
- **Reviewer inputs:**
  - the PR URL, the slug and `<studio>`;
  - `brief.md` and `pr.diff` from `<studio>/videos/<slug>/`;
  - `deck.mjs`, `assets/` and `out/` from `<studio>/decks/<slug>/`.
- **Review file:** `<studio>/decks/<slug>/review.md`.
- **Once signed off:** run `prs deck build <slug>` without `--no-deliver`.

## 4. Deliver

The final build prints the folder it delivered to (`~/Downloads/pr-decks/<slug>/` by default). It holds:
- `<slug>.pdf`;
- `contact.png`;
- `notes.md` (the notes and sources);
- `slides/` (a picture per page, which VS Code's chat shows as a slide viewer).

How to finish:
- **Called by another skill or agent:** don't end your turn: give it the paths and what it asked for. It records the
  artifacts.
- **With a chat-artifact tool:** record the PDF (`Slides: #<n> <PR title>`, plus ` (self-reviewed)` if it was) and
  `contact.png` (`All pages: #<n>`), by absolute path. End your turn there.
- **Otherwise:** end with the PDF's path, the slide count and about how many minutes, a line per slide, the verdict,
  and what you couldn't check.
