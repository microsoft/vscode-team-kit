# Changelog

## 0.5.0 — 2026-10-19

Faster to make. In side-by-side blind runs (the same agent and prompt, one PR each), a video took 19 minutes on average instead of 30: 22 instead of 29 for a visible change, and 6 instead of 37 for one nobody can see. A deck took 17 minutes instead of 20. Blind judges preferred the new output 4 times out of 6, and found no factual error in it, against 4 in 0.4.0's (in both, the title card's first frames show a total still counting up).

- **The review reads a pack, and round 2 looks only at what changed.**
  - `prs review-pack <slug>` (`prs deck review <slug>` for a deck) gathers what a reviewer checks: the lint and sync results, each beat's words and cues with what comes on screen when, each claim beside the line it rests on, and a still at every cue.
  - From the second round on, the engine compares each beat or slide with the last round's and scopes the review to the must-fixes, what changed and its neighbours; much changed means a full round again.
  - A nice-to-have is done only when it's cheap; the rest are listed as not done.
- **Lint catches what reviewers used to.**
  - Text on screen for less time than it takes to read before its beat leaves is a problem; an element shown well after the narration names it, and a beat showing only its heading, are warnings.
  - `"hold": <s>` on a beat keeps it on screen after its last word.
  - The deck build checks the speaker notes' code names and paths as it checks the slides.
- **Capturing the app is a short script.**
  - The capture kit (`studio/capture/kit.mjs`) owns the throwaway profile, its own `HOME` with the keychain linked, the sign-in copy, the settings, the window, the pointer, click rings and key badges, screenshots, and the cleanup. A script holds only the PR's steps (`args` adds launch arguments, such as a sample extension). A missing element names the closest ones and saves what the window showed.
  - `prs app <slug> [--before]` finds the Insiders builds with and without a merged VS Code PR and downloads both at once, resuming a dropped download. The skills start it right after `prs new`, so the builds arrive while the story is written. Setup prunes builds unused for two weeks.
- **Record once.** `k.mark(<cue>)` notes each action, and `ui.footage` plays each at its cue, at real speed, holding the result until the next. Capture needs only the storyboard, so it can run in a subagent while the voice and the scenes are made, and voicing again doesn't need a new recording.
- **Fewer turns.** Each skill starts with the commands in order. The brief lists the settings and named constants the PR adds, each with its evidence ready to paste into a claim.
- **Measured.** Every `prs` command adds its time and result to the video's or deck's `run-log.jsonl`; `prs mark` notes a step that isn't a command.

## 0.4.0 — 2026-10-19

Smaller and simpler: the same videos and decks from a fraction of the instructions and the install.

- **The engine is plain files** in `studio/`, changed and reviewed here like any code; `scripts/engine.pack` is gone.
  - `setup.mjs` copies the engine into the cache and links one shared npm install for each lock file.
  - Work lives in `~/.cache/pr-studio/work/`, outside the copies, so a newer plugin keeps it (work in old copies is moved there).
  - Copies unused for a day, unused installs, and the render caches of work untouched for a week are pruned.
- **Less to read:** about 2,100 words for a video and 2,400 for a deck (up to 2,900 and 3,200 with a capture of the app), from 9,200 and 8,700.
  - The rules both skills share are written once, in `shared/`: `contract.md`, `capture.md` and `review.md`.
  - `prs direct` writes each picked treatment's notes and fields into `scenes.js`, so the catalog is read only to re-pick (`prs catalog`; `prs catalog --sheet` draws them all).
- **Smaller plugin and install:** 2.2 MB in the kit becomes 0.9 MB, and the npm install goes from 141 to 57 MB.
  - The pictures of every diagram and layout are gone: `prs catalog --sheet` and `prs deck samples` draw them on demand.
  - The 184 Fluent icons are vendored as path data, replacing the 87 MB icon package.
  - Kokoro is installed only when the voice needs it: without an Azure Speech key, or when the key lookup fails and `prs voice` falls back to it. A system ffmpeg with the right codecs is reused. Commands install what they need on first use.
- **Decks are about pull requests only:** 27 layouts (from 57) and three logos. A design of a deck's own is still possible; its rules live in the example design.
- **Footage is part of the engine.** A storyboard beat with `"footage": true` gets `ui.footage`: the recordings (before and after side by side, cropped, in step) play at their cues. Stills, lint and the contact sheet show them, with no frames to splice by hand.
  - A video made with 0.3, whose footage a script laid into the rendered frames, needs that beat turned into `ui.footage` before it is published again: `prs publish` renders the frames itself, so it stops and says how rather than deliver the video without its footage.
- **Fewer commands.**
  - `prs direct` checks the story first.
  - `prs preview` renders the stills and lints.
  - `prs publish` lints, renders and publishes.
  - A sync-gate failure says what to fix.
  - `prs concepts` and `prs report` are gone.
- **Called by another skill:**
  - A brief, such as the intent groups of Agents' `/create-code-walkthrough`, sets the order and the claims about the code, not the coverage: the why, the risk and the status still come from the PR. Viewers of walkthrough videos made from such briefs missed the why.
  - Without subagents, the review is a labelled self-review, and a caller that records the artifacts gets the paths instead.
- The status checklist's places to start reading light up together a quarter of the way into the beat, so a viewer can read them all once; before, the last one lit only near the end.

## 0.3.0 — 2026-10-16

- Short by default: a video or a deck answers six questions (what changes, why, how it works, what it looks like or does, what could break and how it is tested, the status and where to start reading) in as little as covers them. There is no minimum; a video is at most 90 seconds with the end card, a deck at most 12 slides. The size tiers now only set the storyboard's starting beats; `prs check` fails past the cap instead of below a window, and `prs publish` won't deliver a video past it.
- The voice tells why and how; numbers, names and lists go on screen. The title and status beats are one sentence each (`prs check` warns otherwise): the title card brings in the author, the size and the state within that sentence, and the status checklist brings its places to start reading forward a third of the way in, so they can be read before the end card.
- Before and after footage plays side by side in one beat, in step, instead of one after the other.
- The voice is 10% faster (`voice.pace`, 1.1 by default): Kokoro speaks at that speed, MAI-Voice-2 takes are sped up without changing pitch (its SSML rate is only partly honoured), and the estimates follow. `"pace": 1` in `~/.cache/pr-studio/config.json` restores the old pace.
- Decks have no end slide: the status slide carries the PR's QR code and where to start reading.
- Both reviewers check coverage (each of the six answers, a risk in its own words rather than only "it has tests", and screen-only answers readable at playing speed) and brevity (a sentence, beat or slide that answers none of them, or reads out what the screen shows, is a must-fix).
- The reviewer is another agent whenever the host can start one, and a verdict with must-fixes is never the last.
- Captures come from a build of the app (for VS Code, an Insiders build by commit), never component fixtures or the user's checkout; nothing is written to the user's repository, and the capture script deletes its temp profile, with its copy of the sign-in, in a `finally`.
- Measured on three PRs against 0.2.0: videos 55.7 → 37.2 s, 81.9 → 51.1 s and 70.9 → 37.9 s; decks 6 → 5 and 8 → 7 slides. A viewer given only the delivered video found all six answers in each new video (the risk explicit in the one made with the final rules, implied in the other two); each old one missed what could break.

## 0.2.0 — 2026-10-16

- Live UI: when a pull request changes something visible, both skills run the app with the change in a throwaway profile and drive it with Playwright (it comes with the engine). Videos record the interaction and lay it into its beat's frames between `prs render` and `prs publish`, so the mp4, the WebM and the contact sheet all show it; decks save a screenshot of each state into `assets/`.
- Before and after: when a pull request changes how something behaves, the same steps are recorded in a build without the change too (for VS Code, an Insiders build from before the merge, fetched by commit), and the before plays first. A drawn pointer travels to each target and rings each click, a badge shows a shortcut's keys, and the app is zoomed in to read at 1080p.
- The capture keeps to itself and can still sign in: its own `HOME` with the user's keychain linked in, so macOS never asks anything, and, when the demo needs AI, a copy of the user's signed-in state in its throwaway profile, deleted after the recording.
- Both reviewers check the footage and the screenshots: real, of the PR's change, readable, and in step with the narration or the slide; a visible change without them goes back, whatever the reason given (builds, sign-in, a running chat request).
- `generate-video` declines only a screen recording with no pull request to explain.

## 0.1.0 — 2026-10-15

Initial experimental release, self-contained: the engine (from [pr-studio](https://github.com/federicobrancasi/pr-studio), MIT) ships packed in `scripts/engine.pack`, and `scripts/setup.mjs` unpacks and installs it into `~/.cache/pr-studio/engine/<hash>/` on first use. Fifteen files in all: each skill has one guide, and one picture of every diagram or layout.

- `generate-video`: a 40–100 second narrated, captioned explainer video of a pull request, with every string on screen verified against the PR and a `pr-director` review; the mp4 and its contact sheet are recorded as chat artifacts, and that ends the turn: the chat shows the video as a card.
- `generate-presentation`: a 16:9 PDF deck about a pull request, started from the PR's real data (`prs deck new --pr`), with every code line and path checked against the PR and a deck review; the PDF and its contact sheet are recorded as chat artifacts, and that ends the turn: the chat shows the deck as a card.

Tuned in three rounds of test runs on real pull requests (a fresh agent with only the skill, each round reviewed):

- The brief carries the PR's pictures (the author's, the CI's before and after screenshots, those in comments), who approved, and the whole review discussion; it says when there are none.
- Decks: screenshots cropped, pinned and ringed (`image`), before and after side by side (`split` with pictures), `spans` for what lives how long, `prs deck grid` (pixel positions, and where two shots differ), a 25-word limit the build enforces, and a scaffold whose status slide names the approver.
- Videos: each beat's body fills the frame; the narration is written for the picked diagrams (`prs direct` before the voice); the voice reports what a listener hears and retakes one beat (`--redo`); claims can cite the review discussion and any file of the repository (`prs file`).
