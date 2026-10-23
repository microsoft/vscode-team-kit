# Changelog

## 0.1.0 (2026-10-21)

First release in the kit. Experimental.

- `generate-changelog-video`: the daily VS Code changelog video. About a minute on the top five picks of the changelog report, one chapter each, in the report's order: a Before → Now strip on the left and the change on the right, recorded in VS Code (the main window or the Agents window, signed in on a Mac, or on Linux with basic encryption) or drawn from the PR's own strings when a recording can't show it, with up to three arrows that point at what the narration names as it names it. Every string is checked against its PR, the recordings keep the narration's pace, and a fresh subagent reviews every chapter's frames before it's delivered to `~/Downloads/changelog-videos/`.
- The engine from [pr-studio](https://github.com/federicobrancasi/pr-studio)'s changelog work, trimmed to what the video needs: the report download, each PR's brief, the build that has the picks (the installed Insiders, the newest Insiders build, or VS Code built from main in a release week), the recorder, the 11 drawn scenes, the voice (MAI-Voice-2 with an Azure key, or the offline Kokoro) and the render.
- When VS Code isn't signed in to GitHub, `prs demo check` says so and how to sign in, and the skill asks you to sign in before recording chat or the Agents window (a run nobody watches draws those chapters). A Mac where Insiders was never started records signed out.
- On a Mac, recordings run in invisible windows that never become the active app, so you can keep working while a video is made (`PRS_SHOW_WINDOW=1` shows them); on Linux, on a virtual display.
- `scripts/setup.mjs` installs it into `~/.cache/changelog-videos/` on first use; `scripts/unattended.sh` makes a video the way the daily job does, with an agent nobody watches.
- Its example is the Oct 19, 2026 video: three chapters recorded (two in the Agents window), two drawn.
