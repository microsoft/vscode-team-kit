# changelog-videos

The daily VS Code changelog video, made in chat: about a minute on the top five picks of the changelog report, each recorded in VS Code itself, the Agents window included, or drawn from the PR's own strings when a recording can't show it. Self-contained: the engine ships with the plugin as plain files.

> **Experimental, macOS and Linux.** On first use, the setup installs the engine's npm packages (about 30 MB) into `~/.cache/changelog-videos/`, and `prs doctor` installs Chrome for Testing (about 300 MB, in Playwright's cache), the voice's Python environment and the offline Kokoro voice (about 420 MB, in the same folder) and the Whisper small.en model (about 460 MB, in `~/.cache/huggingface/`). In a release week, when no Insiders build has the picks yet, VS Code is built from main: about 8 GB, and 12 GB free to build it.

## Skills

| Skill | Description |
|---|---|
| [generate-changelog-video](skills/generate-changelog-video/) | `/changelog-videos:generate-changelog-video [today, a date, a report run or report.md]`: one chapter per pick, in the report's order: a Before → Now strip on the left and the change on the right, with up to three arrows that point at what the narration names as it names it. Every string is checked against its PR, and a fresh subagent reviews every chapter's frames before it's delivered. |

## How It Works

1. **Get the engine:** `scripts/setup.mjs` copies `engine/` into `~/.cache/changelog-videos/engine/<hash>/`, links one npm install per lock file, and prints the folder. The work (`work/videos/`) lives outside the copies, so a newer plugin keeps it. Copies unused for a day, unused installs, Insiders downloads unused for two weeks, builds of main unused for three days, and the recording frames of projects untouched for a week are removed.
2. **The project:** `prs digest new` downloads the report (with `gh`'s token, or `--file report.md`), its top five picks, each PR (description, discussion, diff, and the files it changes at its head), and the VS Code build that has them all: the installed Insiders, else the newest Insiders build, else VS Code built from main.
3. **Facts and narration:** the agent writes, from each PR's diff, what a user sees now and its UI strings, then about 150 words of narration, voiced with MAI-Voice-2 (with an Azure key) or Kokoro, and timed word by word with Whisper.
4. **Recordings:** each chapter whose change VS Code can show is recorded. A demo script drives VS Code with Playwright in a throwaway profile (on a Mac, with a copy of your Insiders sign-in, so chat and the Agents window work; deleted afterwards), in windows you never see: invisible on a Mac, and never the active app, so you can keep working (on Linux, on a virtual display), each step at the words that describe it, while marks follow the UI the arrows will point at.
5. **The chapters:** `digest.json` gives each chapter its strip, its visual (a recording or one of 11 drawn scenes) and its arrows. `prs digest check` checks every string against its PR, every arrow against what is on screen, the recordings' pace and the length.
6. **Review:** `prs digest review` makes a sheet per chapter of the moments to check; a fresh subagent checks every frame, for two rounds at most.
7. **Deliver:** `prs digest render` delivers the mp4, its captions, a contact sheet and a JSON summary to `~/Downloads/changelog-videos/changelog-<date>/`. The mp4 and the contact sheet are recorded as chat artifacts.

The same skill makes the video every day in an internal GitHub Agentic Workflow, which checks this plugin out at a pinned commit, runs the setup and `prs digest new`, and starts the agent with [prompt.md](skills/generate-changelog-video/prompt.md). `scripts/unattended.sh` does the same on your machine, with the GitHub Copilot CLI.

## Plugin Structure

```text
changelog-videos/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
├── scripts/
│   ├── setup.mjs              copy the engine into the cache, install it, print ENGINE=<folder>
│   ├── setup.test.mjs         its tests (the kit's npm test)
│   └── unattended.sh          a video as the daily job makes it, with an agent nobody watches
├── skills/
│   └── generate-changelog-video/
│       ├── SKILL.md           the steps, the review, runs nobody watches
│       ├── recording.md       demo scripts: helpers, marks, pacing, the Agents window
│       ├── reference.md       the project, digest.json, the scenes
│       ├── prompt.md          the prompt of a run nobody watches
│       └── example/           the Oct 19, 2026 video's files and two of its review sheets
└── engine/
    ├── cli/                   prs: the report, the PRs, the builds, the recorder, the checks, the render
    ├── digest/                the player and its 11 drawn scenes
    ├── engine/, theme/        motion, text and the look (Fluent icons inline)
    ├── voice/                 MAI-Voice-2 or Kokoro, and Whisper's word timing
    └── tests/                 the engine's tests
```

## Requirements

- macOS or Linux, with VS Code Insiders (the project downloads the build it needs when the installed one doesn't have the picks)
- Node.js 20+, Python 3.10–3.13
- `gh`, signed in to an account that can read the changelog report; otherwise pass the report as a file
- To record chat and the Agents window: a Mac with a signed-in Insiders. A build of main runs as Code OSS, signed in only if its own profile is; signed out, those chapters are drawn

## Settings

`~/.cache/changelog-videos/config.json`:

- **The voice:** `voice.provider` (`auto`, `mai` or `kokoro`). MAI-Voice-2 needs `AZURE_SPEECH_KEY`, or `voice.mai.azResource` and `voice.mai.azResourceGroup` (the key is looked up with `az`); otherwise the offline Kokoro voice.
- **Its pace:** `voice.pace`, how much faster than its own pace it speaks (1.1 by default).
- **Delivery:** `deliver`, where videos go (`~/Downloads/changelog-videos/` by default).

`CHANGELOG_VIDEOS_HOME` moves the home (settings, the voice, the builds and the work). `PRS_DELIVER` moves the delivery, `PRS_BUILDS` the builds of main (a roomier disk), and `PRS_VSCODE` sets the VS Code that recordings use. `PRS_SHOW_WINDOW=1` shows a recording's windows on a Mac (to watch or debug one). `CHANGELOG_TOKEN` reads the report with another account's token. `PRS_OFFLINE=1` is for an agent sandbox without network: everything works from what `prs digest new` downloaded. `prs doctor` checks the machine and says which voice is used.

## Developing the engine

The engine is the plain files in `engine/`: change them here, like any code.

- After a change, `node scripts/setup.mjs` makes a fresh copy in the cache. Run `npm test` in that copy (the `ENGINE=` folder) for the engine's tests; the setup's own tests run in the kit's `npm test`.
- `prs demo check` says whether VS Code starts on this machine; `scripts/unattended.sh --run <report run>` makes a whole video as the daily job does.

The engine started as [pr-studio](https://github.com/federicobrancasi/pr-studio)'s changelog work; it is developed here now, under this repository's license. Third-party software and assets are listed in [engine/NOTICE](engine/NOTICE). It shares a few helpers (GitHub, the voice, the browser) with the pr-studio plugin; each plugin keeps its own copy, because plugins are self-contained.

The engine keeps its own `package.json` instead of the kit's root one, as an exception to the kit's convention. Its packages (a browser driver, esbuild, fonts) only this plugin needs, so `setup.mjs` installs them into the cache on first use rather than for every kit user.
