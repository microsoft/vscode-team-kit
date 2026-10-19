---
name: generate-test-video
description: 'Make a short narrated "how to test" or "how to verify" video for a VS Code test plan item (TPI), a fixed bug, or a few fixed bugs of one area: recorded in real VS Code Insiders in a throwaway profile, every step checked in the app, with captions, a zoom, flags that pause where something is wrong, a verdict slide and a recap. macOS. USE FOR: "make a how-to-test video for TPI 342400", "a video to verify issue 341013", "how-to-verify video for bugs 339711 339712 339714". DO NOT USE FOR: explaining a PR to someone who won''t test it (use pr-studio:generate-video), plain screen recordings, editing an existing video.'
argument-hint: TPI or issue number or URL, or several issue numbers of one area
---

# Generate a test video

A short video a tester follows instead of reading the item: its setup, steps and expected results, in its order and words, in real VS Code Insiders. Every step acts in the app and checks the result there, so the video never shows a result the app didn't produce. It pauses on anything wrong, opens with a verdict slide, and ends with a recap.

Needs macOS, VS Code Insiders in `/Applications`, Node 20+, Python 3.10–3.13, `gh` signed in, and a terminal tool that runs commands for minutes. Items about chat or agents need a signed-in Insiders: its sign-in is copied into each throwaway profile.

## 1. Set up

Run `node <plugin-dir>/scripts/setup.mjs` (the plugin's folder is two above this file). Add `--selftest` on a Mac's first use: it makes a tiny video to prove every stage works. It installs the tools into `~/.cache/test-videos/` once (about 400 MB) and ends with `KIT=`, `PY=`, `FFMPEG=`, `WORK=` and `DELIVERY=`: `$KIT` and so on below. If it reports a problem it can't fix, stop and say what to install. The voice is Kokoro (offline), or MAI-Voice-2 when `AZURE_SPEECH_KEY` is set or `~/.cache/test-videos/config.json` names an Azure Speech resource.

Read [video.md](video.md), [scenario.md](scenario.md), and before step 9 [slides.md](slides.md). Then read one example in [examples/](examples/) (`issue-342051/`: one item, editor window; `bugs-welcome-messages/`: a group, Agents window), never the one for the item you're making.

## 2. Make the video

The item is a URL, `<owner>/<repo>#<n>` or a number (`microsoft/vscode` unless told otherwise). Several numbers are fixed bugs of one area in one video ("Bug groups" in video.md). With nothing, ask. Work in `$WORK/<name>/` (`<work>`; make it first, and keep your notes and diffs there too), named `tpi-<n>-how-to-test`, `issue-<n>-how-to-verify` or `bugs-<area>-<n1>-<n2>-…-how-to-verify`.

1. **Read the item.** `$PY $KIT/item.py <n>` lists its PRs (closing ones first), whether the installed Insiders has them, and the title's phrase. Then read the item with `gh issue view <n> --repo microsoft/vscode --json title,body,labels,comments` (`--comments` alone drops the body), its PRs and their "how to test". List every setup item, step and expected result, and decide what to show ("Scope" in video.md).
2. **Build.** Use the installed Insiders if it has every fix. Otherwise download one by commit: `https://update.code.visualstudio.com/api/commits/insider/darwin-arm64` lists them, and `https://update.code.visualstudio.com/commit:<sha>/darwin-arm64/insider` downloads one. Unzip it into `<work>` with `ditto -x -k`, and pass `--build <app>` to `run.mjs` and `item.py`. If no Insiders has the change yet, stop and say so. For the bundled Copilot SDK, check the build's own files.
3. **Probe.** Write `scenario.mjs` with a hidden `prepare` step. Run `node $KIT/run.mjs <work> --probe` until the app is in the starting state, then `--probe --until <step>` to probe the steps through that one: what's on screen (`run/probe-aria.yml`, `run/probe.jpg`) and how to check it.
4. **Voice.** Write one short sentence per shown step in `voice/lines.json`, then run `$PY $KIT/voice.py <work> [--only step,…]` until every take is "as written". Reword any line that isn't.
5. **Steps and bands.** Each step does its action, timed to its words, and checks the result. Its band in `captions.json` is numbered by the item's own steps.
6. **Record.** `node $KIT/run.mjs <work>`; every step must pass. When signed in, plan so one recording is enough ("Signed in" in scenario.md).
7. **Compose and check.** `$PY $KIT/compose.py <work>`, then `$PY $KIT/check.py <work>`; only a CHECK needs action. Open the contact sheets (`out/contact-*.jpg`).
   - To see one moment: `$FFMPEG -v error -ss <s> -i <mp4> -frames:v 1 <work>/frames/f.png`, then `$PY $KIT/small.py <work>/frames/f.png --crop x,y,w,h`. Frames are 1920×1330, with the band in the top 250 px.
   - For sheets of a stretch: `$PY $KIT/small.py --video <mp4> <dir> [--every s] [--from s] [--to s]`.
   - Does each step show what its band says, at its words? Is anything covered, clipped or too fast? Fix and repeat.
8. **Compare** with the item in a table: item step → video time → same / different / not shown. Fix what you can.
9. **Flags, then the verdict and recap** (slides.md). Run `$PY $KIT/flags.py <work> --preview`, look at `flagged/preview-*.jpg`, and run it again without `--preview` (no flags: skip it). Do the same with `cards.py` (`carded/slides/preview-*.jpg`), then run `$PY $KIT/check.py <work>/carded`.

Post a one-line update after each stage, and ask only when blocked.

## 3. Deliver

1. Copy `<work>/carded/out/<name>.mp4` into `$DELIVERY`, replacing an older one of that name.
2. Delete any build you downloaded. `pgrep -fl <your run folder's tv-… name>` must print nothing.
3. If you can, record the mp4 as a chat artifact (`Video: #<n> <short title>`).
4. End with the report:
   - the verdict and flags;
   - the video's path and length;
   - the steps shown, and what isn't shown and why;
   - the build (version and commit);
   - signed in or not, and the chat requests sent;
   - anything a tester should know that the video doesn't say.

The user attaches the video on GitHub; the API can't.

## Rules

- **Faithful and exact:** use the item's steps, order, names and values, and nothing the item and its PRs don't support. Every step checks its result in the app. Never fake a result; if the item can't be shown, stop and say why.
- **Isolated:** launch VS Code only with `run.mjs`. Never touch the user's windows, profiles, settings, repositories, `~/.copilot` or system settings. Install nothing, and write only in `<work>` and `$DELIVERY`. Never let VS Code run `npx -y`; see "MCP servers" in scenario.md.
- **GitHub:** read only. Never post, comment, react or label.
- **Cheap:** sign in only when the item needs it. Send only the chat requests it needs, short and harmless, on a low-cost model. Approve only actions inside the throwaway workspace.
- **Small images:** every image you open stays in the session at full size. Open only small JPEGs (`run/probe.jpg`, contact sheets, `preview-*.jpg`, `small.py` output), never a PNG. Prefer text (`probe-aria.yml`, DOM checks) when it answers the question.
