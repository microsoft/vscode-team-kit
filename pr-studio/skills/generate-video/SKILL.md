---
name: generate-video
description: 'Make the shortest narrated video that fully explains a GitHub pull request (at most 90 seconds, captions, diagrams chosen for the PR, and real footage of the app, before and after side by side, when the change is visible) in one white Microsoft look. USE FOR: "/generate-video 12345", "make a video of this PR", "explain PR <url> in a video", "a video for my manager about this PR". DO NOT USE FOR: a screen recording on its own (no PR to explain), editing existing videos, slide decks (use generate-presentation).'
argument-hint: PR number or URL
---

# Generate a PR video

The shortest narrated video that fully explains one pull request: at most 90 seconds, captioned, with a diagram for
each idea and, when the change is visible, the real app doing it. You write the story and fill the diagrams from the PR;
the engine fetches, voices, renders, and checks every word on screen against the PR. First read
[contract.md](../../shared/contract.md).

**Needs:** a terminal that runs commands for minutes, and file tools (reading images, subagents and chat artifacts help).
macOS or Linux with Node.js 20+, Python 3.11–3.13, and access to github.com and PyPI. Commands install what they need
into `~/.cache/` on first use. `gh`, signed in, is optional: public PRs work without it.

## 1. Find the PR and the engine

- **The PR:**
  - a URL or `<owner>/<repo>#<n>`: use it;
  - a number alone: a PR of the workspace's GitHub repo;
  - nothing: ask.

  A calling skill may pass a brief (a code walkthrough's groups): follow it as the contract says. For a brief about a
  branch, use its PR (`gh pr view <branch> --json url`, in that repository); if it has none, say that a video needs a
  pull request, and stop.
- **The engine:** run `node <plugin>/scripts/setup.mjs` by absolute path; `<plugin>` is two folders above this file.
  - Its last line is `STUDIO=<folder>`. Below, `prs <x>` means `node <studio>/cli/prs.mjs <x>`, and `prs help` lists
    every command.
  - If something can't be installed (no Python 3.11–3.13), stop and say what to install.
  - The voice is MAI-Voice-2 when `AZURE_SPEECH_KEY` is set or `~/.cache/pr-studio/config.json` names an Azure
    resource (`voice.mai.azResource`), otherwise the offline Kokoro; `prs doctor` says which.

## 2. Make the video

About 30 minutes, or 60–90 with footage and the review rounds. Post a one-line update after each step.

1. **Fetch.** `prs new <url>` writes `<studio>/videos/<slug>/` (the slug is `<owner>-<repo>-<n>`; pass it to every
   command): `brief.md`, `pr.diff`, the changed files, and a storyboard skeleton.
2. **Story.** Write `storyboard.json` (below). Run `prs check <slug>` until it passes, then apply the cut test.
3. **Direct.** `prs direct <slug>` picks a diagram treatment for each beat, different from recent videos. It scaffolds
   `scenes.js` with each pick's fields and a note on how to narrate it ("names the aspects in order"): fit each `say`
   to its pick.
   - Keep the picks.
   - To re-pick one that can't show its beat: `prs direct <slug> --use <beat>=<treatment> --reason "…"`, then
     `prs direct <slug> --force` to rewrite the scaffold (before you fill it; the picks stay). `prs catalog` lists the
     treatments. If none fits, say so in your answer.
4. **Footage,** when the PR changes something a user sees or does: [capture.md](../../shared/capture.md).
5. **Voice and scenes.** Start `prs voice <slug>` in the background, and fill every TODO of `scenes.js` meanwhile
   (below). The voice prints what a listener hears in each beat. Fix a word "heard differently" with `pronounce` or
   other words, then run `prs voice <slug> --redo <beat>`.
6. **Preview.** `prs preview <slug>` renders key frames and `build/stills/contact.png`, then lints. Look at the sheet,
   then the frames that matter, and fix until lint reports 0 problems.
7. **Publish.** `prs publish <slug>` renders, encodes, and checks the audio against the captions (the sync gate; a
   failure says what to fix). It then delivers the video.

### The storyboard

A beat is one idea, in one to three sentences, with one diagram. Merge or drop the skeleton's beats that add no answer:
a before and after can show both what changes and why.

- **`id`:** a short word.
- **`need`:** the kind of diagram.
  - `concept`: a problem, or ideas side by side;
  - `exchange`: messages between parties;
  - `flow`: steps;
  - `rules`: a rule applied to cases;
  - `compare`: before and after;
  - `architecture`: where it reaches;
  - `code`, `numbers`, `state`, `ui`, `status`.
- **`say`:** plain sentences. The voice says why and how; numbers, names and lists go on screen. A number it must say
  is a placeholder: `{{facts.additions}}`.
- **`cues`:** names for the phrases where things appear: `"step2": "Two"`, or `{ "phrase", "nth", "offset" }` (`nth`
  counts from 0: a phrase said twice cues the first time unless `nth` is 1).
- **`claims`:** every factual statement, as `{ "text": "…", "evidence": [ … ] }`. `prs check` verifies each piece of
  evidence: `{ "file", "anchor" }` (text or a regex at the head commit; `"removed": true` for a removed line),
  `{ "body" }`, `{ "commit" }` or `{ "review" }` (exact words), or `{ "fact": "additions" }`. A count you make is a
  claim: anchor each thing counted.
- **`"footage": true`:** on the beat that shows the real app.

The first beat (`title`) says what the PR does in one sentence; its card shows the number, author, size and state. The
last (`status`) says what matters most before review or merge; its screen lists scope, tests and where to start reading.

**Pronunciation.** The voice splits camelCase, spells short capitals and says "dot". Anything else goes in the top-level
`pronounce` (`{ "scm": "S C M", "mcumming": "M Cumming" }`).
- Don't say a code name alone (`start()` → "the start method"); name a file in words and show its path on screen.
- Don't respell what the voice says well (`OK`, `UI`). A one-word entry also works inside names; add plurals you say.
- Use commas only for real pauses: captions break there, and the gate checks that the voice pauses too.

### scenes.js

Beat keys are the storyboard ids. The engine lays everything out. Never open another video's `scenes.js`.

- **Text:** every string on screen says where it comes from, and the engine checks it:
  - `label('…')`: your words (numbers in it are flagged);
  - `fact('additions', { format: 'n' })`: from `pr.json` (formats `n`, `date`, `state`, `review`, `lower`);
  - `quote('…')`: exact PR text (the body, commits, review, any diff line);
  - `ident('name')`: a name in the changed files;
  - `path(file)`: a changed file.

  Mix them in an array.
- **Code:** `code(file, { from, to })`, `{ anchor }` (one line), `{ anchor, block: true }` (the function), or
  `{ diff: true, anchor }` (its hunk); add `occurrence: n` when the anchor matches several lines. Avoid long lines: the
  font fits the longest.
- **Time:** an `at` is a cue name, `cue('step2', 0.4)`, `word('401', { offset: -0.2 })`, or seconds into the beat.
  Without one, items spread over the beat.
- **Icons:** `prs catalog --icons` lists the names.
- **Footage:** a `"footage": true` beat gets `ui.footage`.
  - `after: { src: 'footage/after.webm', from, to, at }` shows seconds `from`–`to` of the recording, starting at cue
    `at`; `before` is the same for the app without the change. Optional: `crop: [x, y, w, h]`, `speed`, `label`,
    `note`, and `layout: 'rows'` for a wide, short part.
  - Narrate what happens as it happens, with a cue on each action and its result. A before and after is one beat: say
    the action once, then the difference ("press Save: the old build drops the selection, the new one keeps it").
    Write about as many seconds of words as the clip lasts.
  - A clip plays at one speed from its cue, so a clip with several actions has to match the words' timing: record it
    after `prs voice`, pacing each action to its cue's second in `build/timeline.json`. Voicing that beat again moves
    them.

## 3. Review

Follow [review.md](../../shared/review.md).
- **Reviewer inputs:**
  - the PR URL, the slug and `<studio>`;
  - from `<studio>/videos/<slug>/`: `brief.md`, `pr.diff`, `storyboard.json`, `scenes.js`, `build/stills/` and
    `footage/`;
  - the delivered mp4.
- **Review file:** `build/review.md`.
- **After fixes:** run `prs preview` and `prs publish` again.

## 4. Deliver

`prs publish` prints where it delivered the mp4 (`~/Downloads/pr-videos/<slug>/` by default). That folder holds the mp4,
a webm (VS Code's chat plays it in place of the mp4), the captions and `contact.png`.
- **Called by another skill or agent:** don't end your turn: give it the paths and what it asked for. It records the
  artifacts.
- **With a chat-artifact tool:** record the mp4 (`Video: #<n> <PR title>`, plus ` (self-reviewed)` if it was) and
  `contact.png` (`Key frames: #<n>`), by absolute path. End your turn there.
- **Otherwise:** end with the mp4's path and length, a line per beat, the verdict, and what you couldn't check.
