# pr-studio

Explainer videos and slide decks of pull requests, in one white Microsoft look, made in chat by the model you pick. Self-contained: the engine ships with the plugin.

> **Experimental:** on first use the skills install the engine's npm packages and a browser into `~/.cache/pr-studio/` (about 300 MB); videos also install a Python voice environment, the Kokoro voice and Whisper (about 400 MB more).

## Skills

| Skill | Description |
|---|---|
| [generate-video](skills/generate-video/) | `/pr-studio:generate-video <PR>`: a 40–100 second narrated, captioned video of a pull request — what changes, why, how it works, the risk and the status — reviewed before it's delivered |
| [generate-presentation](skills/generate-presentation/) | `/pr-studio:generate-presentation <PR>`: a 16:9 PDF deck about a pull request — one idea per slide, drawn as diagrams, with speaker notes — reviewed before it's delivered |

## How It Works

1. **Get the engine** — `scripts/setup.mjs` unpacks `scripts/engine.pack` (the engine) into `~/.cache/pr-studio/engine/<hash>/`, installs its packages there and prints the folder. It runs once per engine version; later runs return at once. Work in progress (`videos/<slug>/`, `decks/<slug>/`) lives in that copy; the three newest copies are kept, and any copy used in the last day, so a newer plugin never removes another session's work; delivered files in `~/Downloads/` are never touched.
2. **Fetch the PR** — the description, commits, diff and the changed files at the head commit.
3. **Video** — the agent writes the narration with evidence for every claim, the engine voices and times it, the agent fills a diagram per beat from a catalog of 24 (all on one picture, `catalog.png`), then the engine checks every frame (layout, provenance of every word, captions) and renders. Every string on screen is verified against the PR.
4. **Deck** — `prs deck new --pr` starts the deck from the PR's real data (title card, status, end slide with a QR code); the agent writes the slides that explain it, picking a layout for each from 57 (all on one picture, `samples.png`); `prs deck build` checks words per slide, overflow, sources, and every code line and path against the PR.
5. **Review** — a reviewer subagent (`reviewer.md` in each skill) checks accuracy against the diff, clarity and craft, and must sign off.
6. **Deliver** — videos land in `~/Downloads/pr-videos/<slug>/`, decks in `~/Downloads/pr-decks/<slug>/`; the mp4 or PDF and a contact sheet are recorded as chat artifacts.

## Plugin Structure

```text
pr-studio/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
├── scripts/
│   ├── setup.mjs              unpack the engine into the cache, install it, print its folder
│   └── engine.pack            the engine (CLI, video engine, theme, diagrams, voice, deck kit), packed; generated
└── skills/
    ├── generate-presentation/ SKILL.md, guide.md, layouts.md, samples.png, reviewer.md
    └── generate-video/        SKILL.md, guide.md, catalog.md, catalog.png, reviewer.md
```

## Requirements

- macOS or Linux
- Node.js 20+; Python 3.11–3.13 for the voice of videos
- Optional: `gh` signed in (its token is used for the GitHub API; public PRs work without it)

## Settings

`~/.cache/pr-studio/config.json` (written by `prs doctor`): the voice (`voice.provider`, `voice.mai` for MAI-Voice-2 through your Azure resource, else the offline Kokoro voice) and where videos are delivered. `PRS_HOME` moves the whole folder. The history of published videos lives there too, so each new video looks different from the last ones.

## Developing the engine

The engine's source is [pr-studio](https://github.com/federicobrancasi/pr-studio) (MIT). Change it there, run its tests (`npm test`), then rebuild this plugin's generated files from it: `npm run plugin -- <path to this folder>` writes `scripts/engine.pack`, `scripts/setup.mjs`, `catalog.png` with `catalog.md`, and `samples.png`. The pack holds every engine file whole as text (the four sample pictures in base64), so a change shows up as an ordinary diff. The skills' text (`SKILL.md`, the guides, the reviewers) is written here.

The engine keeps its own `package.json` (inside the pack) instead of the team kit's root one: its packages (a browser driver, esbuild, shiki, icons, fonts) are large and only this plugin needs them, so they are installed into the engine's cache folder on first use.
