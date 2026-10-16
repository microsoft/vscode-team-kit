---
name: generate-presentation
description: 'Make the shortest slide deck (a 16:9 PDF with speaker notes, at most 12 slides) that fully explains a GitHub pull request, in one white Microsoft look: one idea per slide, drawn as diagrams, with screenshots of the real app when the change is visible, every fact from the PR. USE FOR: "/generate-presentation 12345", "make slides about this PR", "a deck for my manager on PR <url>", "present this pull request". DO NOT USE FOR: editing PowerPoint files, videos (use generate-video), decks with no pull request behind them.'
argument-hint: PR number or URL
---

# Generate a presentation of a PR

A 16:9 PDF deck about one pull request, for people who won't read it, in as few slides as answer what changes, why, how it works, what it looks like or does, what could break and how it is tested, the status and where to start reading (at most 12). One idea per slide, drawn as a diagram more than written as text (and, when the PR changes something you can see, shown in screenshots of the real app, driven with Playwright), with speaker notes for every slide, in one fixed white Microsoft look (the look of the videos of generate-video).

The engine ships with this plugin: 57 layouts, the build, and the checks (words per slide, overflow, sources, and every code line and path against the PR). You gather the facts from the PR, write the story and pick a picture for each slide.

> **Host requirements:** a terminal tool and file tools. Optional: a tool that reads images (to look at the pages you build), a subagent tool (for the independent review), and a tool that records chat artifacts (so the deck shows up in the chat).

## Prerequisites

- macOS or Linux, with Node.js 20+.
- Network access to github.com. The first run installs npm packages and a browser into `~/.cache/` (about 300 MB).
- Optional: `gh`, signed in. Its token is used for the GitHub API; without one, public PRs still work (60 requests an hour).
- For a change you can see: a way to run the app with it. Playwright comes with the engine (`<studio>/node_modules/playwright-core`).

## Procedure

### 1. Find the PR

- A URL (`https://github.com/<owner>/<repo>/pull/<n>`) or `<owner>/<repo>#<n>`: use it.
- Only a number: a PR of the current workspace's GitHub repo (`gh repo view --json nameWithOwner -q .nameWithOwner`, or `git remote get-url origin`). If the workspace has no GitHub remote, ask which repo.
- Nothing: ask for the PR. Ask for the audience only if the request hints at one you can't infer (default: teammates and their manager, presented).

### 2. Get the engine

This skill's folder is the folder of this SKILL.md; the plugin's folder is two levels above it. Run the setup script by absolute path (your working directory is usually the user's project, not the plugin):

```sh
node <plugin-dir>/scripts/setup.mjs
```

Its last line is `STUDIO=<folder>`; below, `<studio>` is that folder and `prs <command>` means `node <studio>/cli/prs.mjs <command>`. It works from any folder; give its files by absolute path. Then `prs doctor --deck` (the first time it installs the browser).

Before writing anything, read [guide.md](guide.md) and [layouts.md](layouts.md), and look at [samples.png](samples.png): one slide for every layout. `prs deck samples --no-pdf` (about 10 seconds; safe while other sessions use the engine) builds them at full size into `<studio>/deck/samples/out/slides/NNN.png`; layouts.md gives each layout's page, so open the ones you are choosing between. When no layout can show an idea, "A deck's own designs" in [guide.md](guide.md).

### 3. Make the deck

1. **Start.** `prs deck new --pr <PR URL>` fetches the PR into `<studio>/videos/<slug>/` (brief, diff, the changed files at the head commit) and writes `<studio>/decks/<slug>/deck.mjs`, with the title card and the status already filled from the PR's data (no end slide: the status carries the PR's QR code). The slug is `<owner>-<repo>-<number>` (for example `microsoft-vscode-341604`): give it to every later command, since other decks may share the folder. If a video of the same PR fetched it already, its data is reused; the video's own files (storyboard, scenes) are never touched.
2. **Facts.** Read `brief.md` in full: its Length section gives the cap (as few slides as cover the six answers, at most 12), its Review discussion often says why the code is the way it is (and what is still open), and its Pictures section lists the author's screenshots and the CI's before and after screenshots. Read `pr.diff` as the brief says (all of it outside the tests when the PR is small), and the functions around the changes in the changed files, so you explain what the code does.
3. **Pictures.** Screenshots of the change are the best evidence a deck can show: download the ones you will use into `<studio>/decks/<slug>/assets/` (`curl -fsSL -o <file> '<url>'`), open them to check they show what the brief says, and `prs deck grid <slug> assets/<file>` to read the pixel positions for crops, pins and rings. Then show them: one picture with `image`, before and after side by side with `split` (see "Pictures" in [guide.md](guide.md)). When the PR changes something a user sees or does, take your own too, even when the PR has pictures (theirs show what the author saw, yours show the change running), and even when the state needs the app signed in (chat, anything AI): run the app with the change, drive it with Playwright through the PR's steps (its "how to test", its tests), check that each state is on screen, and save a screenshot of each into `assets/`, with the script next to them. When the PR changes how something behaves, take the same states in the app without the change too, for a before and after.
4. **Outline.** One line per slide: the point (its title), the picture (its layout), the evidence and the answers it gives, following "A deck about a pull request" in [guide.md](guide.md). A slide that gives none goes. Post it as a short message before writing.
5. **Write.** Fill `deck.mjs`: the TODOs of the scaffolded slides, and the slides that explain the PR, copying the fields of each layout's sample (`<studio>/deck/samples/deck.mjs`, same `id` as the layout). Notes on every slide; sources on every number.
6. **Build.** `prs deck build <slug> --no-deliver` while you work (the final build, after the review, delivers). The report lists the words on each slide; it must end with `Checks: clean`: fix the slide, not the check (cut words, pick another layout, copy code exactly from the diff, add the source).
7. **Look.** Open `<studio>/decks/<slug>/out/contact.png`, then the pages (`out/slides/NNN.png`) of every slide you wrote, at full size. Fix what is crowded, clipped, empty-looking, hard to read, or not what its title says, and build again.

Somebody is watching: post a one-line update after each stage (fetched, app captured, outline, first build, checks clean), and ask only when you are blocked.

### 4. Get it reviewed

Run the reviewer as a subagent on the strongest model available, with [reviewer.md](reviewer.md) as its instructions. Give it the PR URL, the slug, `<studio>`, and the paths: `<studio>/videos/<slug>/brief.md`, `pr.diff`, `<studio>/decks/<slug>/deck.mjs`, `<studio>/decks/<slug>/assets/` (the pictures, and the script that captured the app) and `<studio>/decks/<slug>/out/` (contact sheet and pages); from the second round on, the last verdict and what you changed. Fix every must-fix, build, and ask again until it answers `VERDICT: SIGNED OFF`; then `prs deck build <slug>` once more, without `--no-deliver`. Save each verdict to `<studio>/decks/<slug>/review.md` as it comes, before fixing (in a self-review: what you found, then what you fixed, round by round).

If you can't start subagents, do the review yourself with "Reviewing your own deck" in [reviewer.md](reviewer.md): its steps are written to catch what the author of a deck misses. Write it to `review.md` the same way, ending with `VERDICT: SIGNED OFF (self-review)` once it holds, and say that no independent sign-off happened: in the PDF's artifact label (`… (self-reviewed)`) when you record one, otherwise in your answer.

### 5. Deliver

The build copied the deck to `~/Downloads/pr-decks/<slug>/`: `<slug>.pdf`, `contact.png` (every page on one image), `notes.md` (speaker notes with every source) and `slides/` (one picture per slide, which VS Code's chat shows as a slide viewer when the PDF is recorded as an artifact). A deck of the same PR delivered before is replaced (the build says so).

1. If you have a tool that records chat artifacts (for example `add_artifact_or_reference` or `setArtifacts`), record the PDF (label: `Slides: #<n> <PR title>`) and `contact.png` (label: `All pages: #<n>`), with their absolute paths. That is your last step: the chat shows the deck as a card, so end your turn there, with no closing message.
2. Without such a tool, end your answer with: the PDF as a link to its absolute path, the number of slides and about how many minutes, one line per slide, the reviewer's verdict, and what you couldn't check.

## Rules

- **Accurate or absent.** Every statement and number comes from the PR: its description, commits, diff, tests or code at the head commit. Write the author's untested claims as "per the author". No guesses about intent, no marketing.
- **The app is real.** A screenshot of the app comes from a build of the app running the PR's change (for VS Code, an Insiders build by commit), driven by Playwright: never a mock passed off as one, and never component fixtures or a dev server of the user's checkout. Run it in a throwaway profile with sample data, never in the user's own windows or files, and never create branches, commits or worktrees in their repository; copy their sign-in into it only when a state needs it (chat, anything AI).
- **Short and complete.** Each of the six answers on a slide, and no slide that answers none of them; at most 12 slides. The slides show the point; the details go in the notes.
- **One look.** The theme is fixed: no new colours, fonts or backgrounds. Variety comes from a different picture on every slide, not from styling.
- **Stay in the engine's folder.** Write only inside `<studio>/decks/<slug>/` (and a temp folder for the app's throwaway profile): don't change the user's files, or the engine, its theme or its samples.
- **Look at what you make.** Open the contact sheet and the pages before saying the deck is done. If you can't read images, say so.
- **Signed off by another agent.** When the host can start a subagent, the reviewer is one: a self-review is only for hosts that can't. A verdict with must-fixes is never the last one: fix, build, and ask again until it signs off.
- **Fix the cause.** When a check fires, change the slide; `maxWords` and `nosrc` are for real exceptions only.

## Commands

| | |
| --- | --- |
| `prs doctor --deck` | install or check the browser and packages |
| `prs deck new --pr <PR URL>` | fetch the PR and start `decks/<slug>/deck.mjs` from its data |
| `prs deck build [slug] [--no-deliver]` | PDF, a PNG per page, contact sheet, notes and checks in `decks/<slug>/out/`; deliver |
| `prs deck grid <slug> <assets/x.png> [--vs <assets/y.png>]` | the picture with a labelled grid of its pixels, in `decks/<slug>/out/grid/`: for crop, pin and ring positions; `--vs`: where a before and an after of the same screen differ |
| `prs deck samples [--no-pdf]` | build the layout samples full size: one slide per layout, pages in `deck/samples/out/slides/` |
