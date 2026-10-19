# test-videos

Short narrated "how to test" videos for VS Code test plan items (TPIs) and fixed bugs, recorded in real VS Code Insiders with every step checked in the app and what's wrong flagged where it happens.

> **Experimental, macOS only.** On first use the skill installs its tools into `~/.cache/test-videos/` (about 400 MB): `playwright-core` (no browser), and a Python environment with the Kokoro voice, Whisper, a bundled ffmpeg and Pillow.

## Skills

| Skill | Description |
|---|---|
| [generate-test-video](skills/generate-test-video/) | `/test-videos:generate-test-video <TPI, issue, or several issues>`: a short video a tester can follow instead of reading the item. It shows the setup, each step and what to look for, in the item's order and words, recorded in a throwaway profile with every result checked in the app. Flags pause it where something fails or differs, it opens with a verdict slide and ends with a recap. |

## How It Works

1. **Setup:** `scripts/setup.mjs` checks the Mac (Insiders, `sqlite3`, `gh`, Python 3.10–3.13) and installs the tools into `~/.cache/test-videos/` once. Later runs return at once.
2. **Read the item:** the TPI or issue, its comments, and its PRs' "how to test". The agent checks that the installed Insiders has every fix, or downloads a build by commit, and finds the first build to name in the title.
3. **Script and voice:** the agent writes a `scenario.mjs` (each step does the action and checks the result in the app), the bands (`captions.json`) and one sentence per step, voiced with Kokoro (or MAI-Voice-2 with an Azure key) and timed word by word with Whisper.
4. **Record:** `run.mjs` launches Insiders in a throwaway profile with its own `HOME` (your keychain linked in, and a copy of your Insiders sign-in only when the item needs it), drives it with Playwright, and records it. A step that fails its check fails the run.
5. **Compose and check:** `compose.py` adds the bands, a zoom on what matters, a pointer, click rings and key badges, and the voice. `check.py` measures caption sync and reading speed and writes contact sheets.
6. **Flag and conclude:** `flags.py` pauses the video wherever something fails, differs from the item or looks like a bug, and explains it. `cards.py` adds a verdict slide (verified, issues, changed, partial or failed, the build, and what isn't covered) and a recap.
7. **Deliver:** the mp4 goes to `~/Downloads/test-videos/`, ready to attach to the item on GitHub.

## Plugin Structure

```text
test-videos/
├── .plugin/plugin.json
├── CHANGELOG.md
├── README.md
├── scripts/
│   ├── setup.mjs              check the Mac, install the tools into ~/.cache/test-videos/, print KIT=, PY=, WORK=, DELIVERY=
│   ├── requirements.txt       the pinned Python environment
│   └── kit/
│       ├── run.mjs            launch Insiders in a throwaway profile, run and record a scenario (or probe it)
│       ├── howto.mjs          the drawn pointer, click rings, key badges and a few VS Code moves
│       ├── voice.py           voice each step's sentence, with word timings and a listener check
│       ├── compose.py         recording + bands + zoom + voice -> mp4, webm and srt
│       ├── check.py           caption sync, reading speed, contact sheets
│       ├── flags.py           pause and explain where something is wrong
│       ├── cards.py           the verdict slide and the recap
│       ├── concat.py          join parts (one per window)
│       ├── slidekit.py, small.py, env.py
│       ├── firstbuild.py      the first Insiders build with a commit, for the title
│       ├── mcp-mini-server.mjs  a tiny MCP server, instead of npx packages
│       └── voice_engine.py    the voice and Whisper helpers, vendored from pr-studio (MIT)
└── skills/
    └── generate-test-video/   SKILL.md, guide.md, examples/ (a single issue and a bug group)
```

## Requirements

- macOS, with VS Code Insiders in `/Applications`
- Node.js 20+, Python 3.10–3.13 (`brew install python@3.12`)
- `gh`, signed in (to read items and PRs)
- For items that need chat or agents: a signed-in Insiders, whose sign-in is copied into each throwaway profile

## Settings

- `~/.cache/test-videos/config.json` (written by the setup): the voice. Kokoro is used offline by default. For MAI-Voice-2, set `AZURE_SPEECH_KEY`, or `voice.mai.azResource` and `voice.mai.azResourceGroup` (the key is looked up with `az`).
- `TEST_VIDEOS_HOME` moves the cache folder, and `TEST_VIDEOS_DELIVERY` the delivery folder (default `~/Downloads/test-videos/`).
- `TEST_VIDEOS_SLOTS`: how many VS Code instances may run at once across agents (default 2).

## Notes

- **Dependencies:** like pr-studio, the plugin keeps its dependencies in its own cache folder instead of the team kit's root `package.json`. They are large and only this plugin needs them.
- **Voice module:** `scripts/kit/voice_engine.py` comes from the [pr-studio](https://github.com/federicobrancasi/pr-studio) engine (MIT, see `voice_engine.LICENSE`), with its cache folder pointed at this plugin's.
