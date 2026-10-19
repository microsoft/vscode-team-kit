---
name: generate-test-video
description: 'Make a short narrated "how to test" or "how to verify" video for a VS Code test plan item (TPI), a fixed bug, or a few fixed bugs of one area. It is recorded in real VS Code Insiders in a throwaway profile, with every step checked in the app, captions, a zoom on what matters, flags that pause where something is wrong, a verdict slide and a recap. macOS. USE FOR: "make a how-to-test video for TPI 342400", "a video to verify issue 341013", "how-to-verify video for bugs 339711 339712 339714", "endgame video for this test plan item". DO NOT USE FOR: explaining a pull request to someone who won''t test it (use pr-studio:generate-video), a plain screen recording with nothing to verify, editing an existing video.'
argument-hint: TPI or issue number or URL, or several issue numbers of one area
---

# Generate a test video

A short video a tester can follow instead of reading the item: the setup, each step and what to look for, in the item's own order and words, in the real VS Code Insiders. Each step does the action in the app and checks the result there (the DOM, the focus, computed styles, files on disk), so the video never shows a result the app didn't produce. Where something fails, differs from the item or looks wrong, the video pauses and explains it. A verdict slide opens it (verified, issues, changed, partial or failed, the build, what isn't covered) and a recap ends it.

> **Host requirements:** a terminal tool that can run commands for several minutes, and file tools. Optional: a tool that reads images (to look at the small JPEG contact sheets and crops), and one that records chat artifacts (so the video shows up in the chat).

## Prerequisites

- macOS, with VS Code Insiders in `/Applications`, Node.js 20+ and Python 3.10–3.13.
- `gh`, signed in: the item, its comments and its PRs are read with it.
- The first run installs the tools into `~/.cache/test-videos/` (about 400 MB, once): `playwright-core` (no browser) and a Python environment with the Kokoro voice, Whisper, a bundled ffmpeg and Pillow.
- The voice: Kokoro, offline and free; MAI-Voice-2 instead when `AZURE_SPEECH_KEY` is set or `~/.cache/test-videos/config.json` names an Azure Speech resource.
- Items about chat or agents need a signed-in Insiders: its sign-in is copied into each throwaway profile.

## Procedure

### 1. Find the item

- A URL, `<owner>/<repo>#<n>` or a number: an issue in `microsoft/vscode` unless the user says otherwise. A TPI has the `testplan-item` label; a fixed bug has its fixing PR in its timeline.
- Several numbers: fixed bugs of one feature area, in one video ("Several fixed bugs in one video" in [guide.md](guide.md)).
- Nothing: ask for the item.

### 2. Set up

This skill's folder is the folder of this SKILL.md; the plugin's folder is two levels above it. Run, by absolute path:

```sh
node <plugin-dir>/scripts/setup.mjs
```

The last lines print `KIT=`, `PY=`, `WORK=` and `DELIVERY=`: below, `$KIT`, `$PY`, `$WORK` and `$DELIVERY` are those values. If it reports a problem it can't fix (no Python 3.10–3.13, no Insiders), stop and tell the user what to install.

Then read all of [guide.md](guide.md), and one example in [examples/](examples/): `issue-342051/` for one item, `bugs-welcome-messages/` for a group of bugs.

### 3. Make the video

Work in `$WORK/<name>/` (`<work>` below), named after the delivered file: `tpi-<n>-how-to-test`, `issue-<n>-how-to-verify`, or `bugs-<area>-<n1>-<n2>-…-how-to-verify`.

1. **Read the item:** `gh issue view <n> --repo microsoft/vscode --comments`, the PRs and issues it refers to, and their "how to test". List every setup item, step and expected result, and decide what can be shown. A step that needs another OS, an account or a service you don't have is left out and listed in Not covered.
2. **Pick the build:** the installed Insiders if it has every fix, else download one by commit ("Builds" in [guide.md](guide.md)). If no Insiders build has the change yet, stop and say so. Get the title's phrase with `$PY $KIT/firstbuild.py <newest merge commit>`.
3. **Probe:** write `scenario.mjs` with a hidden `prepare` step, and run `node $KIT/run.mjs <work> --probe [--until <step>]` until the app is in the starting state. Then probe each step: what is on screen (`run/probe-aria.yml`, `run/probe.jpg`) and how to check it.
4. **Voice:** write one short sentence per shown step in `voice/lines.json`, and run `$PY $KIT/voice.py <work>` until every take is "as written".
5. **Steps and bands:** write each step (the action, timed to its words, and the check) and its band in `captions.json`: the label numbered by the item's own steps, DO, LOOK FOR, and the exact names, settings and values.
6. **Record:** `node $KIT/run.mjs <work>`. Every step must pass; fix and record again until they do.
7. **Compose and check:** `$PY $KIT/compose.py <work>`, then `$PY $KIT/check.py <work>`. Open the contact sheet pages (`out/contact-*.jpg`), and crop the moments that matter with `$PY $KIT/small.py`. Does each step show what its band says, at its words? Is anything covered, clipped, or too fast to read? Fix and repeat.
8. **Compare with the item:** make a table, item step → video time → same / different / not shown, and fix every difference you can.
9. **Flag what's wrong:** for each failure, change from the item, likely bug or thing to check, add a flag in `flags.json` where it shows. Word it as "Wording what's wrong" in [guide.md](guide.md) says (a regression, older than the change, by design, already filed). Run `$PY $KIT/flags.py <work> --preview`, look at `flagged/preview-*.jpg`, then `$PY $KIT/flags.py <work>`.
10. **Verdict and recap:** write `cards.json` (status, headline, build, not covered, why; the recap lists the flags). Run `$PY $KIT/cards.py <work> --preview`, look at `carded/slides/preview-*.jpg`, then `$PY $KIT/cards.py <work>` and `$PY $KIT/check.py <work>/carded`.

Somebody is watching: post a one-line update after each stage (item read, probed, voiced, recorded, checked, flagged, delivered), and ask only when you are blocked.

### 4. Deliver

1. Copy `<work>/carded/out/<name>.mp4` into `$DELIVERY` (`~/Downloads/test-videos/`), replacing an older video of the same name. Only the mp4 goes there.
2. Clean up: delete any build you downloaded, and check that nothing you started is still running (`ps -axo pid,command | grep test-video-run-`).
3. If you have a tool that records chat artifacts (for example `add_artifact_or_reference`), record the mp4 with its absolute path (label: `Video: #<n> <short title>`).
4. End with the report ("Report" in [guide.md](guide.md)): the verdict and flags, the path and length, the steps shown, what isn't shown and why, the build, signed in or not and the chat requests sent, and anything a tester should know that the video doesn't say.

GitHub can't attach a video through its API: the user drags the mp4 into a comment on the item. Never post, comment, react or label yourself.

## Rules

The full rules are in [guide.md](guide.md). In short:

- **Faithful to the item.** Every setup item and step in the item's order, with its exact names and values, numbered by its own steps. Nothing the item and its PRs don't support.
- **Exact.** Every step checks its result in the app and throws when it fails. Never fake a result with a mock or an edited picture; if the item can't be shown, stop and say why.
- **Fast.** No intro; one or two short sentences per step; bands readable at 4 words a second.
- **Isolated.** Launch VS Code only with `run.mjs` (a throwaway profile with its own `HOME`). Never touch the user's windows, profiles, settings, repositories, `~/.copilot`, or system settings. Write only in your work folder, `$DELIVERY` and temp folders. Never let VS Code run `npx -y`: use `$KIT/mcp-mini-server.mjs`, or a stub `npx`.
- **Cheap.** Sign in only when the item needs it. Send only the chat requests the item needs, short and harmless, on a low-cost model, checking the model picker before each send. Approve only actions inside the throwaway folders.
- **Honest flags.** Call each finding what it is: a failure, a regression, older than the change, by design, or already filed.
- **Small images.** Open only small JPEGs (contact sheets, previews, `small.py` crops), never a full-size PNG: every image you open stays in the session's history.

## Commands

| | |
| --- | --- |
| `node <plugin-dir>/scripts/setup.mjs [--check]` | check the Mac and install the tools (`--check`: install nothing); prints `KIT=`, `PY=`, `WORK=`, `DELIVERY=` |
| `node $KIT/run.mjs <work> [--probe [--until <step>]] [--build <app>]` | record the scenario, or probe it (a screenshot and the accessibility tree) |
| `$PY $KIT/voice.py <work> [--only step,…] [--pace <x>]` | voice `voice/lines.json`, with word timings and what a listener hears |
| `$PY $KIT/compose.py <work>` | the recording, bands, zoom and voice → `out/<name>.mp4`, `.webm`, `.srt` |
| `$PY $KIT/check.py <work>` | caption sync, reading speed, contact sheets `out/contact-*.jpg` |
| `$PY $KIT/flags.py <work> [--preview]` | pause and explain where something is wrong (`flags.json`) |
| `$PY $KIT/cards.py <work> [--preview]` | the verdict slide and the recap (`cards.json`) → `carded/out/<name>.mp4` |
| `$PY $KIT/concat.py <result> <part 1> <part 2> …` | join parts recorded in different windows |
| `$PY $KIT/small.py <png> [--crop x,y,w,h]`, `--video <mp4> <dir>` | small JPEGs and crops to look at |
| `$PY $KIT/firstbuild.py <commit>` | the first Insiders build with a commit, and the title's phrase |
