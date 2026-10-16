---
name: generate-video
description: 'Make the shortest narrated video that fully explains a GitHub pull request (at most 90 seconds, captions, diagrams chosen for the PR, and real footage of the app, before and after side by side, when the change is visible) in one white Microsoft look. USE FOR: "/generate-video 12345", "make a video of this PR", "explain PR <url> in a video", "a video for my manager about this PR". DO NOT USE FOR: a screen recording on its own (no PR to explain), editing existing videos, slide decks (use generate-presentation).'
argument-hint: PR number or URL
---

# Generate a PR video

The shortest video that fully explains one pull request, for someone who won't read it (often a manager): it answers what changes, why, how it works, what it looks like or does, what could break and how it is tested, the status and where to start reading, and nothing else, in at most 90 seconds. Narrated, captioned, with a diagram chosen for each idea and, when the PR changes something you can see, the real app doing it (driven with Playwright and recorded), in one fixed white Microsoft look. Technical but plain.

The engine ships with this plugin. You write the story and fill the diagrams from the PR; the engine does the rest (fetching the PR, the voice, rendering, checks) and verifies every word on screen against the PR.

> **Host requirements:** a terminal tool that can run commands for several minutes (ideally in the background) and file tools. Optional: a tool that reads images (to look at the frames you render), a subagent tool (for the independent review), and a tool that records chat artifacts (so the video shows up in the chat).

## Prerequisites

- macOS or Linux, with Node.js 20+ and Python 3.11–3.13 (for the voice).
- The voice: Kokoro, offline and free. MAI-Voice-2 instead when `AZURE_SPEECH_KEY` is set, or when `~/.cache/pr-studio/config.json` names an Azure Speech resource (`voice.mai.azResource`, its key looked up with `az`); `prs doctor` says which one is used.
- Network access to github.com and PyPI. The first run installs npm packages, a browser, a voice model and Whisper into `~/.cache/` (about 700 MB in all).
- Optional: `gh`, signed in. Its token is used for the GitHub API; without one, public PRs still work (60 requests an hour).
- For a change you can see: a way to run the app with it. Playwright comes with the engine (`<studio>/node_modules/playwright-core`).

## Procedure

### 1. Find the PR

- A URL (`https://github.com/<owner>/<repo>/pull/<n>`) or `<owner>/<repo>#<n>`: use it.
- Only a number: a PR of the current workspace's GitHub repo (`gh repo view --json nameWithOwner -q .nameWithOwner`, or `git remote get-url origin`). If the workspace has no GitHub remote, ask which repo.
- Nothing: ask for the PR.

### 2. Get the engine

This skill's folder is the folder of this SKILL.md; the plugin's folder is two levels above it. Run the setup script by absolute path (your working directory is usually the user's project, not the plugin):

```sh
node <plugin-dir>/scripts/setup.mjs
```

Its last line is `STUDIO=<folder>`; below, `<studio>` is that folder and `prs <command>` means `node <studio>/cli/prs.mjs <command>`. It works from any folder; give its files by absolute path (`<studio>/videos/<slug>/…`). Then run `prs doctor`: the first time it installs the browser, the voice and Whisper; later it only checks. If it reports a problem it can't fix (for example no Python 3.11–3.13), stop and tell the user what to install.

Before writing anything, read [guide.md](guide.md), and skim [catalog.md](catalog.md) with [catalog.png](catalog.png): the fields of every diagram treatment, and a picture of each, numbered as in catalog.md.

### 3. Make the video (aim for 15–20 minutes; about 30 with live footage)

1. **Fetch.** `prs new <PR URL>` writes `<studio>/videos/<slug>/`: `brief.md` (read all of it, the review discussion too), `pr.diff` (read as the brief says: all of it outside the tests when the PR is small), `pr.json`, the changed files at the head commit, and a storyboard skeleton with the right number of beats. The slug is `<owner>-<repo>-<number>` (for example `microsoft-vscode-341604`): give it to every later command (`prs check <slug>`, `prs voice <slug>`…), since other videos may share the folder.
2. **Story.** Write `storyboard.json`: the six answers in as few beats and words as carry them, the title and status beats one sentence each, the numbers and names on screen rather than in the voice; a `need` per beat, cues, and the claims with evidence ("Writing the story" in [guide.md](guide.md)). Run `prs check <slug>` until it says *ready for prs voice*, then cut every sentence that answers none of the six questions.
3. **Footage, when the change is visible.** If the PR changes something a user sees or does, run the app with the change, use Playwright to do what the PR is about (its "how to test", its tests), check that the result is on screen, and record it into `<studio>/videos/<slug>/footage/`. When the PR changes how something behaves, record the same steps in the app without the change too, so one beat shows the before and the after side by side. The beats that narrate them show the real app, the pointer moving and clicking; the diagrams still explain why and how. A video of a visible change isn't done without its footage: the setup (two builds, a copy of the sign-in, a script that drives the chat) is part of the job, about ten minutes, never a reason to skip it. How: "Live footage" in [guide.md](guide.md).
4. **Direction, before the voice.** `prs direct <slug>` picks a treatment for each beat and the motion for the video, writes `direction.json`, and scaffolds `scenes.js`. Read each pick in [catalog.md](catalog.md): its description says how the narration should go with it ("names the aspects in order", "turns on Now"); adjust the `say` of that beat to fit, and `prs check <slug>` again. Keep the picks: they are chosen to differ from recent videos, and running `prs direct` again keeps them. If one truly can't show its beat, re-pick it with `prs direct <slug> --use <beat>=<treatment> --reason "…"` (the reason is recorded and reviewed; the other beats keep their picks).
5. **Voice, in the background, then the scenes.** Start `prs voice <slug>` (about a minute) and fill every TODO of `scenes.js` from the PR while it runs. The voice prints what a listener hears in each beat: a word "heard differently" is usually one the voice said wrong (fix it with `pronounce`, or say it another way, and voice again); a take that came out slow or odd can be redone alone with `prs voice <slug> --redo <beat>`.
6. **Look.** `prs stills <slug>` renders key frames and `build/stills/contact.png`. Open the contact sheet and the frames that matter, and fix what you see. Stills work before the voice is done.
7. **Check.** `prs lint <slug>` must report 0 problems (layout, text provenance, caption band, novelty, QR).
8. **Render and publish.** `prs render <slug>` (seconds: frames are cached), put the footage into its beat's frames ("Live footage" in [guide.md](guide.md)), then `prs publish <slug>`: encode, subtitles, the sync gate (audio against captions), and delivery to `~/Downloads/pr-videos/<slug>/` (replacing a video of the same PR delivered before; it says so).

Somebody is watching: post a one-line update after each stage (fetched, storyboard ready, footage recorded, direction picked, voice done, stills checked, published), and ask only when you are blocked.

### 4. Get it reviewed

Follow "Sign-off" in [guide.md](guide.md) until the reviewer answers `VERDICT: SIGNED OFF`; its instructions are in [reviewer.md](reviewer.md). If you can start a subagent (for example `runSubagent` in VS Code chat or `task` in Copilot CLI), give it those instructions, the inputs the sign-off lists and `<studio>` as the folder to work in. Save each verdict to `<studio>/videos/<slug>/build/review.md`. If you can't start subagents, do the review yourself with "Reviewing your own video" in [reviewer.md](reviewer.md), write it to the same file, and say that no independent sign-off happened: in the mp4's artifact label (`… (self-reviewed)`) when you record one, otherwise in your answer.

### 5. Deliver

`prs publish` put `<slug>.mp4`, `<slug>.webm` (the same video for VS Code's chat, which can't play MP4; record the mp4 and the chat finds it), `<slug>.srt` (captions), `contact.png` (key frames) and `<slug>.json` (what the video is and used) in `~/Downloads/pr-videos/<slug>/`.

1. If you have a tool that records chat artifacts (for example `add_artifact_or_reference` or `setArtifacts`), record the mp4 (label: `Video: #<n> <PR title>`) and `contact.png` (label: `Key frames: #<n>`), with their absolute paths. That is your last step: the chat shows the video as a card that plays it, so end your turn there, with no closing message.
2. Without such a tool, end your answer with: the mp4 as a link to its absolute path and its length, one line per beat, the reviewer's verdict, and what you couldn't check (you can't hear the audio; the sync gate measured it).

## Rules

- **Short and complete.** The six answers, in the voice or on screen, and nothing that answers none of them; at most 90 seconds. The voice says why and how; numbers, names and lists go on screen.
- **Accurate or absent.** Every statement in the narration and on screen must come from the PR: its body, commits, diff, tests or code at the head commit. Write the author's untested claims as "per the author". No guesses about intent, no marketing.
- **Text provenance.** Screen text goes through `label()` (your words), `fact()` (numbers and names from `pr.json`), `quote()` (exact PR text), `ident()` (code names in the diff), `path()` and `code()`. `prs prepare` verifies every one against the PR; numbers in a `label()` get flagged.
- **The app is real.** Footage shows a build of the app running the PR's change (for VS Code, an Insiders build by commit), driven by Playwright: never an animation made to look like it, and never component fixtures or a dev server of the user's checkout. Run it in a throwaway profile with sample data, never in the user's own windows or files, and never create branches, commits or worktrees in their repository; copy their sign-in into it only when the demo needs it (chat, anything AI).
- **One look.** White, Microsoft palette, Aptos. Don't add colors, fonts, backgrounds or new layouts inside a video. The first frame (title) and the end card are fixed.
- **Different explanations.** Never open or copy another video's `scenes.js`. If the treatment picked for a beat can't show what it needs, try another one for the same need ("When the catalog doesn't fit" in [guide.md](guide.md)), and if none can, say so in your answer.
- **Stay in the engine's folder.** Write only inside `<studio>` (and a temp folder for the app's throwaway profile): don't change the user's files.
- **Look at what you make.** Open the stills and the contact sheet before saying something works.
- **Signed off by another agent.** When the host can start a subagent, the reviewer is one: a self-review is only for hosts that can't. A verdict with must-fixes is never the last one: fix, publish, and ask again until it signs off.

Optional: if the user asks for options, add `export const concepts = { beat, options: { a, b, c } }` to `scenes.js` and run `prs concepts`: it renders the beat three ways side by side.

## Commands

| | |
| --- | --- |
| `prs doctor` | install or check the browser, the voice, Whisper and ffmpeg |
| `prs new <url>` | fetch the PR, write brief.md and a storyboard skeleton |
| `prs check <slug>` | storyboard: the 90 s cap, one-sentence title and status, cues, placeholders, evidence anchors, pronunciation hints |
| `prs voice <slug> [--provider mai\|kokoro\|recording\|silent] [--redo beat,...]` | narration + word timing (pause-snapped); what a listener hears; `--redo` takes those beats again |
| `prs direct <slug> [--use beat=treatment --reason ...] [--fresh]` | pick treatments and motion (a re-run keeps them; `--fresh` picks again); scaffold scenes.js |
| `prs stills <slug> [--beat id] [--at 12.3,20] [--ends]` | key frames + contact sheet in `build/stills/`; `--beat` writes to `build/stills/beat-<id>/`, `--at` and `--ends` (one frame per beat at its fullest) to `build/stills/at/` |
| `prs file <slug> <path> [--base]` | any file of the repository at the head commit (`--base`: before the PR), for behaviour outside the diff |
| `prs lint <slug> [--every 0.5]` | layout, provenance, caption band, novelty, QR |
| `prs render <slug>` / `prs draft <slug>` | final frames / a half-size preview mp4 |
| `prs publish <slug>` | encode, subtitles, sync gate, deliver |
| `prs catalog` | every treatment with its params |
| `prs history`, `prs report <slug>` | recent videos (what they used); where the time went |
