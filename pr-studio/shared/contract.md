# The contract of a PR video or deck

Both skills explain one pull request to someone who won't read it: a manager, a reviewer deciding where to start, a
teammate catching up. Technical words are fine; jargon without a picture is not.

## The six answers

1. What changes.
2. Why: the problem or the gap.
3. How it works.
4. What it looks like or does: the real app, when a user can see the change ([capture.md](capture.md)).
5. What could break, and how it is tested: the case the change could get wrong (an edge its guard or its tests cover, a
   caveat in the PR), said as a risk, then the tests. "It has tests" alone doesn't answer it.
6. The status, and where to start reading.

Make it as short as these allow, and include nothing that answers none of them. The cut test: for each sentence, beat or
slide, which answer is lost if it goes? If none, cut it. Say each idea once, and don't end with a summary.

A brief from another skill (a code walkthrough's intent groups) sets the order and the claims about the code, not the
coverage: the why, the risk and the status still come from the PR.

Arcs that work, between the title and the status:
- **Bug fix:** the symptom and the fix side by side, then the cause.
- **Feature:** the gap and what it adds, then how it works.
- **Refactor:** the old shape and the new, then why it is safe.
- **Performance:** the cost, then the change with the PR's measurement.
- **Several small fixes:** grouped by where they show, the most visible first.

## Accurate or absent

- Everything comes from the PR. `prs new` (or `prs deck new --pr`) puts it in `<studio>/videos/<slug>/`:
  - `brief.md`: read all of it. Its review discussion often says why the code is the way it is, what is risky, or what
    was left for later.
  - `pr.diff`: all of it outside the tests when the brief says the PR is small; otherwise search it for what you show.
  - The changed files at the head commit (`build/src/<head>/`): read the functions around the diff.
- Behaviour outside the diff (a default the PR relies on, the old behaviour): read it with
  `prs file <slug> <path> [--base]` and cite it.
- Untested or claimed-only facts get "per the author". No guesses about intent, and no marketing or praise ("robust",
  "seamless").
- Numbers come only from the PR, with their source. Use the PR's names once, then plain words. Say what the code does,
  not what the author "wants".

## One look

Everything uses one fixed white Microsoft look: Aptos, the Microsoft palette, the engine's layouts. Don't add colours,
fonts or backgrounds. Variety comes from a different picture for each idea, not from styling. Colour has meaning:
- green: good;
- red: risk;
- orange: attention;
- yellow: medium;
- purple: the AI;
- blue: neutral.

Pair a colour with an icon or a word.

## Working

- Write only inside `<studio>` (the engine's folder, printed by the setup script) and a temp folder for the app's
  throwaway profile. Don't touch the user's files or repository: no checkouts, stashes, resets, branches, commits or
  worktrees.
- Look at what you make (the contact sheets, then single frames or pages) before saying it works. If you can't read
  images, say so.
- Somebody is watching: post a one-line update after each stage, and ask only when you are blocked.
