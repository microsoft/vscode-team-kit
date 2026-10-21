---
name: generate-changelog-video
description: 'Make the daily VS Code changelog video: about a minute on the top five picks of a #changelog report, one chapter each, recorded in VS Code itself (the Agents window included) with a Before → Now strip and arrows to what changed; drawn when a recording can''t show it. Checked against each PR, reviewed, then delivered. macOS or Linux. USE FOR: "make today''s changelog video", "the changelog video for 2026-10-20", "a video of this #changelog report". DO NOT USE FOR: one pull request (use pr-studio:generate-video), how-to-test videos (use test-videos), editing a video.'
argument-hint: today (default), a date YYYY-MM-DD, a report run ID, or a report.md file
---

# Generate the changelog video

One video, about a minute: an intro, one chapter per pick of the #changelog report (its top five, in its order), and an outro. It is a **product demo**: each chapter shows the change in VS Code, with a Before → Now strip on the left and arrows from the strip to the UI on the right. You write the words and the recordings' steps; the engine downloads, voices, places and times the arrows, checks every string against the PRs, and renders.

**The standard is the Oct 19 video** ([example/](example/README.md)): three chapters recorded (two in the Agents window), two drawn, every arrow on what its row names when the narration names it. Read the example first.

**Needs:** macOS or Linux, Node.js 20+, Python 3.10–3.13, VS Code Insiders, and `gh` signed in as an account that can read microsoft/vscode-engineering (where the report is made; without it, pass a `report.md`). On a Mac, recordings copy your signed-in Insiders profile into a throwaway one, so chat and the Agents window can be shown. A release week's build of VS Code from main takes about 12 GB.

## 1. Set up

Run `node <plugin>/scripts/setup.mjs` by absolute path (`<plugin>` is two folders above this file). Its last line is `ENGINE=<folder>`: below, `prs <x>` means `node <engine>/cli/prs.mjs <x>`. The first time, run `prs doctor` too: it installs Chrome for Testing and the voice (a few minutes), and says which voice is used: MAI-Voice-2 when `AZURE_SPEECH_KEY` is set or `~/.cache/changelog-videos/config.json` names an Azure Speech resource (`voice.mai.azResource` and `azResourceGroup`, its key read with `az`), else the offline Kokoro.

## 2. Make the video

About 20–40 minutes. Post a one-line update after each step. Read [recording.md](recording.md) before step 5 and [reference.md](reference.md) before step 6.

1. **The project.** `prs digest new` (or `--date YYYY-MM-DD`, `--run <id>`, `--file report.md`) makes `<engine>/videos/changelog-<date>/` (the slug: pass it to every command). It downloads each PR, and the VS Code build that has the picks: the installed Insiders, else the newest Insiders build, else (a release week) VS Code built from main. Its `brief.md` lists the picks and which build.
2. **Facts.** For each pick, read its `brief.md` and search its `pr.diff`, then write `facts.md` in the project: what a user sees now, its UI strings exactly as in the diff (labels, descriptions, setting IDs, command titles), and a before → after only when the diff shows both. Every word on screen comes from this file or the narration.
3. **What each chapter shows.** For each, in this order:
   - **Record it** (a demo): VS Code doing the change, driven like a user. Most changes can be: the Command Palette, quick picks, menus, hovers, dialogs, `vscode://` links, editors, terminals, settings, and signed in, chat and the Agents window. Record the change itself (the menu open, the dialog up, the text pasted), not its Settings row, unless the change is the setting.
   - **Draw it** (a scene) when a recording can't show it: it needs an enterprise policy, another OS, the network, Stable, or a sign-in the build doesn't have. A change with UI is never a card: take the closest scene.
   - **A card** only when nothing changes on screen.

   Then the parts its arrows point at: up to three, one at a time, in the order the narration names them.
4. **Narration** (`storyboard.json`): beats `intro`, `c1` … `c5`, `outro`, about **150 words** in all. Intro: `Today's VS Code changelog: the top five changes from the last day.` Each chapter: 20–30 words starting `One.` … `Five.`: the change for users, then one detail, naming in order what its arrows point at, as the UI labels it. Outro: `That's today's changelog. The full list is in the changelog channel.` Then `prs voice <slug>`: from here the narration is final, and recordings follow its pace.
5. **Recordings.** `prs demo check` once (when VS Code doesn't start, draw every chapter and say why in `notes.md`). For each recorded chapter, write `demos/<id>.mjs` ([recording.md](recording.md)) and run `prs demo <id> --slug <slug>`. Open its `contact.png`: is the change on screen, is each mark's box on the right UI? Try every chapter whose UI can run here; when the same recording fails twice the same way, draw it, and say why in `notes.md`.
6. **`digest.json`** ([reference.md](reference.md)), then `prs digest check <slug>` until it passes: every string against its PR, every arrow on its part for a second after its phrase, recordings in step with the narration, the length. It lists drawn chapters with no recording tried.
7. **Review**, below, then `prs digest render <slug>`.

## 3. Review

`prs digest review <slug>` writes a sheet per chapter (`build/digest/review/c1.png` …): the chapter as it opens, each arrow as it starts and holds, and as it ends, each frame with what should be on screen and the words spoken then; it prints the checklist.

**A fresh pair of eyes checks every sheet.** Start a subagent with the sheet paths, the checklist and `facts.md`, and ask it to list every wrong frame: it hasn't seen your work, so it judges what is on screen. Without subagents, open every sheet yourself at full size, and say the review was your own. A frame is wrong when:

- the UI is not the one the PR changes (another UI, or a drawing of a UI that doesn't exist);
- a ring is not on what its row names, is on something not there yet, or its arrow comes before its part;
- the narration names a label, option or value that doesn't show then, or shows in other words (a build can word it differently than the PR);
- next to a recording, the strip says what the recording doesn't show;
- something is cut off, overlapping or unreadable.

Fix, `prs digest check`, `prs digest review`, and have the new sheets checked: two rounds at most. Note in `notes.md` what each found.

## 4. Deliver

`prs digest render <slug>` delivers the mp4, its captions, `contact.png` and `<slug>.json` to `~/Downloads/changelog-videos/<slug>/`. Record the mp4 and its contact sheet as chat artifacts if you can, then end with three lines: the path and length, which chapters are recordings (and in which window), and what the review found.

## Runs nobody watches

The daily job, or a stand-in, starts you with [prompt.md](prompt.md). Nobody answers questions: decide, and write each decision in one line in `notes.md`. Never skip a recording or the review to save time or credits: they are what the video is for. Leave the engine as it is; if something in it is broken, say so in `notes.md`. Write files with your file-editing tool, not shell redirects.
