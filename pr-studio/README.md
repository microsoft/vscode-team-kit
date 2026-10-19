# pr-studio

Explainer videos and slide decks of pull requests, in one white Microsoft look, made in chat by the model you pick. Self-contained: the engine ships with the plugin as plain files.

> **Experimental:** on first use, the commands install the engine's npm packages (about 60 MB) and a browser into `~/.cache/pr-studio/`. Videos also install a Python environment with Whisper, plus the offline Kokoro voice when the voice needs it (no Azure Speech key).

## Skills

| Skill | Description |
|---|---|
| [generate-video](skills/generate-video/) | `/pr-studio:generate-video <PR>`: the shortest narrated, captioned video that fully explains a pull request, at most 90 seconds — what changes, why, how it works, what it looks like or does, the risk and the status, with real footage of the app (before and after side by side) when the change is visible — reviewed before it's delivered |
| [generate-presentation](skills/generate-presentation/) | `/pr-studio:generate-presentation <PR>`: a 16:9 PDF deck about a pull request, in as few slides as it takes (at most 12) — one idea per slide, drawn as diagrams, with screenshots of the real app when the change is visible, and speaker notes — reviewed before it's delivered |

## How It Works

1. **Get the engine** — `scripts/setup.mjs` copies `studio/` into `~/.cache/pr-studio/engine/<hash>/`, links one shared npm install for each lock file, and prints the folder.
   - Work in progress (`videos/<slug>/`, `decks/<slug>/`) lives in `~/.cache/pr-studio/work/`, outside the copies, so a newer plugin keeps it.
   - Copies unused for a day, unused installs, Insiders builds unused for two weeks, and the render caches of work untouched for a week are pruned.
   - Delivered files in `~/Downloads/` are never touched.
2. **Fetch the PR** — the description, commits, review discussion, diff and the changed files at the head commit.
3. **Live UI** — when the PR changes something visible, the agent drives a build of the app with Playwright, in a throwaway profile, through the capture kit (`studio/capture/kit.mjs`): it owns the profile, the sign-in copy, the window, the pointer and the cleanup, so a script holds only the PR's steps. `prs app` downloads the Insiders builds with and without a VS Code PR once. The kit records the interaction for the video, with marks that play each action at its words, side by side with a build without the change when the behaviour changes, and saves a screenshot of each state for the deck.
4. **Video** — the agent writes the narration, with evidence for every claim: the six answers (what changes, why, how it works, what it looks like or does, what could break and how it is tested, the status and where to start reading) and nothing else, in at most 90 seconds.
   - `prs direct` picks one of 24 diagram treatments for each beat, different from recent videos, and scaffolds the scenes.
   - The engine voices and times the narration, checks every frame (layout, where every word comes from, captions, and whether on-screen text is up long enough to read), renders, and checks the audio against the captions.
5. **Deck** — `prs deck new --pr` starts from the PR's real data: the title card, and the status with the PR's QR code. The agent writes as few slides as give the same six answers (at most 12), from 27 layouts. `prs deck build` checks words per slide, overflow, sources, and every code line and path against the PR.
6. **Review** — a reviewer subagent ([shared/review.md](shared/review.md)) checks accuracy against the diff, the six answers, a cut test on every sentence and slide, craft, and the real app, and must sign off. Before each round, `prs review-pack` (`prs deck review` for a deck) gathers the checks, the cue timings, each claim beside its line, and stills; from the second round on, it scopes the review to what changed. A host or calling skill without subagents gets a labelled self-review.
7. **Deliver** — videos land in `~/Downloads/pr-videos/<slug>/` and decks in `~/Downloads/pr-decks/<slug>/`. The mp4 or PDF and a contact sheet are recorded as chat artifacts, or returned to the calling skill.

## Plugin Structure

```text
pr-studio/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
├── scripts/
│   ├── setup.mjs              copy the engine into the cache, install it, print its folder
│   └── setup.test.mjs         its tests (the kit's npm test)
├── shared/                    read by both skills
│   ├── contract.md            what every video and deck answers, and the rules for facts
│   ├── capture.md             the real app, driven with Playwright through the capture kit
│   └── review.md              the reviewer, and the self-review
├── skills/
│   ├── generate-presentation/ SKILL.md, layouts.md
│   └── generate-video/        SKILL.md
└── studio/                    the engine: CLI, video engine, diagrams, theme, deck kit, capture kit, voice, tests
```

## Requirements

- macOS or Linux
- Node.js 20+; Python 3.11–3.13 for the voice of videos
- Optional: `gh` signed in (its token is used for the GitHub API; public PRs work without it)
- For a visible change: a way to run the app with it (Playwright comes with the engine)

## Settings

`~/.cache/pr-studio/config.json`:
- **The voice:** `voice.provider`, or `voice.mai` for MAI-Voice-2 through your Azure resource; otherwise the offline Kokoro voice.
- **Its pace:** `voice.pace` sets how much faster than its own pace it speaks (1.1 by default, 1 for its own).
- **Delivery:** where videos and decks are delivered.

`PRS_HOME` moves the settings, the work and the history of published videos, which keeps each new video looking different from the last ones. `prs doctor` checks the machine and says which voice is used.

## Developing the engine

The engine is the plain files in `studio/`: change them here, like any code.
- After a change, `node scripts/setup.mjs` makes a fresh copy in the cache. Run `npm test` in that copy (the `STUDIO=` folder) for the engine's tests.
- `prs smoke` makes a short video end to end.
- The setup's own tests run in the kit's `npm test`.

The engine started as [pr-studio](https://github.com/federicobrancasi/pr-studio) (MIT). That repository's `npm run plugin` built the old `engine.pack` and no longer applies here.

The engine keeps its own `package.json` instead of the kit's root one, as an exception to the kit's convention. Its packages (a browser driver, esbuild, shiki, fonts) are large and only this plugin needs them, so `setup.mjs` installs them into the cache on first use rather than for every kit user.
