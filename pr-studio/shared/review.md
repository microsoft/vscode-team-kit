# Review

Nothing is final until a reviewer signs it off. The reviewer sees what the author no longer sees: a number that doesn't
match the diff, a highlight two words late, a box nobody can read on a laptop.

## Running it

- **With subagents:**
  - Before each round, make the review pack: `prs review-pack <slug>` for a video, `prs deck review <slug>` for a deck
    (after its `--no-deliver` build). Give the reviewer this file as its instructions, the pack's `pack.md`, and the
    inputs your skill lists. From the second round on, add the last verdict and what you changed.
  - Round 1 is complete. From round 2, the pack's scope (from the engine, not your account) says what to look at again:
    the must-fixes, and the beats or slides that changed with their neighbours. Much changed means a full round again.
  - The reviewer only reads: append each verdict to the review file yourself, as it comes, before fixing.
  - Fix every must-fix, rebuild, and ask again until `VERDICT: SIGNED OFF`. A verdict with must-fixes is never the last
    one. A nice-to-have only when it is cheap (minutes, no new capture); list the others as not done.
- **Without subagents** (the host has none, or the calling skill runs this one without them):
  - Review it yourself with "Self-review" below, and write it to the same file: what you found, then what you fixed,
    round by round.
  - Say that no independent sign-off happened: `(self-reviewed)` in the artifact's label, or in your answer.

## The reviewer

You review a video or deck about a pull request before it goes to someone who won't read the PR. Decide whether it is
accurate, complete, as short as it can be and well made, and if not, exactly what must change. Be strict about accuracy
and length, and practical about taste: only ask for changes that clearly improve it. Anything a viewer would notice is a
must-fix; mark a nice-to-have only when the video or deck is fine without it.

- **Read-only:** never edit its files. To inspect, you may run:
  - for a video: `prs stills <slug> --at <t,...>` (frames at those seconds, in `build/stills/at/`), `prs lint <slug>`
    and `prs history`;
  - for a deck: `prs deck build <slug> --no-deliver`.
  - `prs` is `node <studio>/cli/prs.mjs`, and `<studio>` is given with the paths.
- **Start from the pack.** It holds the checks; each beat's cues and what comes on screen when (with lint's timing
  findings); each claim beside the line it rests on; and a still at every cue (`stills/`, `contact.png`). For a deck:
  every slide with its notes and sources. Open full-size frames or pages only where the pack leaves doubt.
- **Round 2 and later:** if the pack's scope is incremental, check that each must-fix is fixed, review the beats or
  slides it lists, and look through the whole contact sheet once (a transition can break a neighbour). Reopen the full
  review only for a reason you can name.
- **Verify against the source,** not the storyboard or the deck: `brief.md`, `pr.diff`, and the changed files at the
  head commit (`<studio>/videos/<slug>/build/src/<head>/`). The pack shows each claim's line; check that it supports the
  claim, not only that it exists.
- **A video:** you can't watch or hear it. Judge from:
  - the pack, its stills and the contact sheet (they include the footage);
  - the storyboard (the narration and its cues);
  - `build/timeline.json` (each word's start `a` and end `b`, in seconds);
  - the sync gate's text match (in the pack, from `prs publish`).

  Say what you could not check.

### Checklist

1. **Accuracy.** Every claim, number, name, path and code line (in the narration, on screen, in the notes) matches the
   PR. Flag anything inferred beyond it, overstated, or called tested when only the author claims it. The status
   matches the PR's state, scope, follow-ups and reviews. A point the review discussion settled is told as it was
   settled.
2. **Coverage.** From the narration and the screen (or the slides alone; notes add detail, not answers), someone who
   never opens the PR gets the six answers of the contract.
   - Write each answer in a line, with its beat or page.
   - One missing, wrong, only implied or only in the notes is a must-fix.
   - A risk needs its own words; "it has tests" isn't one.
   - Text only on screen counts if it can be read once while it is up (about a second a short line).
3. **Brevity: the cut test.** For each sentence, beat or slide: which answer is lost if it goes? None: a must-fix to
   cut it. These are must-fixes too:
   - an idea said twice;
   - narration reading out what the screen shows;
   - a title or status beat longer than one sentence;
   - detail on a slide that belongs in the notes.

   Limits: a video is at most 90 s with the end card, its last word by 86 s; a deck is at most 12 slides. Ask for more
   only to add a missing answer.
4. **Picture matches words.**
   - Each diagram shows the concrete thing in the PR's own terms, and fits its idea: a sequence for an exchange, a
     split for before and after, a flow for decisions.
   - In a video, at each cue the thing named is on screen and highlighted, not two words late.
   - In a deck, every title says the point, not the topic.
5. **The real app.** A visible change is shown in the real app ([capture.md](capture.md)), and a change in behaviour
   with its before. Check that:
   - it is a build of the app driven by Playwright, never a mock or component fixtures;
   - the action and its result are on screen at their words (a video) or in the state the slide says (a deck);
   - it is readable and cropped, with the pointer and click rings in a video;
   - the notes say where each picture comes from.

   A visible change without it is a must-fix, whatever the reason (builds, sign-in, a running chat). Only a step no
   recording can reproduce (real hardware, a physical key) may be left out. Footage never stands in for what it can't
   show (a speed-up, a leak).
6. **Craft.** Readable at laptop size; nothing crowded, clipped, overlapping, floating or mostly empty; code readable
   and the right lines; one white Microsoft look. A deck: a different layout on every slide, never the same twice in a
   row, and one or two dark or blue slides in a deck of 7 or more.
7. **Video only:**
   - `prs lint` is clean (its timing warnings, in the pack, looked at), and the sync gate passed.
   - The text match shows what the voice really said: a difference that changes the meaning ("forged links" for
     "Forge links") is a must-fix.
   - The end card's QR and URL point to the PR.
   - **Novelty:** compare with recent videos (`prs history`, `~/Downloads/pr-videos/*/contact.png`). It should look
     different, not like a reskin, and every override in `direction.json` needs a convincing reason.
8. **Deck only:**
   - The build ends with `Checks: clean` (25 words or fewer a slide), or each warning is explained.
   - Every slide's notes say what to say in 2–5 sentences, with caveats and sources.

## Self-review

The author's blind spot: knowing the PR, everything seems clear. Do these in order, writing down what you find, and
don't skip one because it "looks fine":

1. **Claims.** Make the review pack (`prs review-pack <slug>` or `prs deck review <slug>`): it lists each claim beside
   the line it rests on. Check that each line supports its claim, then add any number, name or code line on screen or in
   the notes that no claim covers, with the line it comes from. One with no line is a must-fix.
2. **Cold read.** Go through the narration or the pages in order, as someone who never saw the PR, and write in a line
   what they now know after each one.
   - A word they can't know yet, or a step that doesn't move them forward, is a must-fix.
   - Then write the six answers from your notes: one missing is a must-fix.
3. **Cut.** Each sentence and slide again: which answer is lost if it goes?
4. **Pictures at full size.**
   - A video: the contact sheet (its frames are taken just after each cue), then one frame per beat at its fullest
     (`prs stills <slug> --ends`). Open more only where the sheet leaves doubt.
   - A deck: every page.
5. **The checklist,** point by point, ending with `VERDICT: SIGNED OFF (self-review)` once nothing is left, or
   `VERDICT: CHANGES REQUESTED` and the must-fixes.

## Output

- The first line is exactly `VERDICT: SIGNED OFF` or `VERDICT: CHANGES REQUESTED`.
- **Must-fix:** numbered blockers only. Each gives the time, beat or page, what is wrong, and the concrete fix. Write
  "None" if there are none.
- **Nice-to-have:** at most 5.
- **What I checked:** a few bullets, including what you could not check.
