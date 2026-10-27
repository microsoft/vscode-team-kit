# test-videos

Short narrated "how to test" videos for VS Code test plan items (TPIs) and fixed bugs, recorded in real VS Code Insiders with every step checked in the app and what's wrong flagged where it happens.

> **Experimental, macOS only.** On first use the skill installs its tools into `~/.cache/test-videos/` (about 450 MB: `playwright-core` without a browser, and a Python environment with the Kokoro voice, a bundled ffmpeg and Pillow), and the Whisper small.en model into the Hugging Face cache, `~/.cache/huggingface/` (about 460 MB).

## Skills

| Skill | Description |
|---|---|
| [generate-test-video](skills/generate-test-video/) | `/test-videos:generate-test-video <TPI, issue, or several issues>`: a short video a tester can follow instead of reading the item. It shows the setup, each step and what to look for, in the item's order and words, recorded in a throwaway profile with every result checked in the app. Flags pause it where something fails or differs; a verdict slide opens it and a recap ends it. |

## How It Works

1. **Setup:** `scripts/setup.mjs` checks the Mac and installs the tools once (later runs take 2 s). `--selftest` makes a 45 s video that proves every stage works.
2. **Read:** `item.py` finds the item's PRs, whether the installed Insiders has them, and the title's build phrase; the agent reads the item and the PRs' "how to test".
3. **Script and voice:** the agent writes `scenario.mjs` (each step acts and checks its result in the app), the bands and one sentence per step, voiced with Kokoro (or MAI-Voice-2 with an Azure key) and timed word by word with Whisper.
4. **Record:** `run.mjs` launches Insiders in a throwaway profile with its own `HOME` (your keychain linked in, and a copy of your Insiders sign-in only when needed), drives it with Playwright and records it. A failed check fails the run. Everything a run creates lives in one folder under `~/.cache/test-videos/t/`, deleted at the end.
5. **Compose and conclude:** `compose.py` adds the bands, a zoom, the pointer, key badges and the voice; `check.py` measures caption sync and reading speed; `flags.py` pauses on what's wrong; `cards.py` adds the verdict and recap. The mp4 goes to `~/Downloads/test-videos/`.

## Plugin Structure

```text
test-videos/
├── plugin.json
├── CHANGELOG.md
├── README.md
├── scripts/
│   ├── setup.mjs              check the Mac, install the tools, print KIT=, PY=, FFMPEG=, WORK=, DELIVERY=
│   ├── requirements.txt       the pinned Python environment
│   ├── selftest/              the self-test's tiny scenario
│   └── kit/
│       ├── run.mjs            launch Insiders in a throwaway profile, run and record a scenario (or probe it)
│       ├── howto.mjs          the drawn pointer, click rings, key badges and VS Code moves (palette, pickers, chat)
│       ├── item.py            an item's PRs, whether the build has them, the title's phrase (--commit: a commit's)
│       ├── voice.py           voice each step's sentence, with word timings and a listener check
│       ├── compose.py         recording + bands + zoom + voice -> mp4, webm and srt
│       ├── check.py           caption sync, reading speed, contact sheets
│       ├── flags.py           pause and explain where something is wrong
│       ├── cards.py           the verdict slide and the recap
│       ├── concat.py          join parts (one per window)
│       ├── slidekit.py, small.py, env.py
│       ├── mcp-mini-server.mjs  a tiny MCP server, instead of npx packages
│       └── voice_engine.py    the voice and Whisper helpers, from pr-studio (MIT)
└── skills/
    └── generate-test-video/   SKILL.md, video.md, scenario.md, slides.md (each under 8 KB);
                               examples/ (a single issue and a bug group)
```

## Requirements

- macOS, with VS Code Insiders in `/Applications`
- Node.js 20+, Python 3.10–3.13 (`brew install python@3.12`)
- `gh`, signed in (to read items and PRs)
- For items that need chat or agents: a signed-in Insiders, whose sign-in is copied into each throwaway profile

## Settings

- `~/.cache/test-videos/config.json` (written by the setup): the voice. Kokoro is used offline by default. For MAI-Voice-2, set `AZURE_SPEECH_KEY`, or `voice.mai.azResource` and `voice.mai.azResourceGroup` (the key is looked up with `az`).
- `TEST_VIDEOS_HOME` moves the cache folder, `TEST_VIDEOS_DELIVERY` the delivery folder (default `~/Downloads/test-videos/`), and `TEST_VIDEOS_TMP` the runs' temp folder (default `~/.cache/test-videos/t`; keep it short: VS Code's socket paths must stay under 104 characters).
- `TEST_VIDEOS_SLOTS`: how many VS Code instances may run at once across agents (default 2).

## Notes

- **Dependencies:** like pr-studio, the plugin keeps its dependencies in its own cache folder instead of the team kit's root `package.json`. They are large and only this plugin needs them.
- **Voice module:** `scripts/kit/voice_engine.py` is trimmed from the [pr-studio](https://github.com/federicobrancasi/pr-studio) engine (MIT, see `voice_engine.LICENSE`) to what the kit calls.
