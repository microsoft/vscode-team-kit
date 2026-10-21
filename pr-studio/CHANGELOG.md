# Changelog

## 0.5.0 — 2026-10-21

First release in the kit. Experimental.

- **Two skills.** `/pr-studio:generate-video <PR>` makes the shortest narrated, captioned video that fully explains a pull request, at most 90 seconds, with footage of the real app, before and after side by side, when the change is visible. `/pr-studio:generate-presentation <PR>` makes a 16:9 PDF deck of at most 12 slides, with speaker notes, in the same white Microsoft look.
- **Every fact from the PR.** Both answer six questions: what changes, why, how it works, what it looks like or does, what could break and how it is tested, and the status. Every claim carries evidence the engine checks against the PR (a line at its head commit, the description, a commit or the review), and every word on screen says where it comes from.
- **The engine, in `studio/`,** driven by one command, `prs`. It fetches the PR, picks a diagram for each idea (24 treatments for videos, 27 layouts for decks), and voices the narration (MAI-Voice-2 through your Azure resource, or the offline Kokoro voice). It renders, lints every frame (layout, provenance, captions, and whether text stays up long enough to read), and checks the audio against the captions.
- **The real app.** A capture kit drives VS Code with Playwright in a throwaway profile, with a drawn pointer and click rings, and cleans up after itself. `prs app` downloads the Insiders builds with and without a merged VS Code PR. Each marked action plays at the words that describe it, so one recording fits any take of the voice.
- **Reviewed before it's delivered.** A reviewer subagent signs off, working from a review pack the engine prepares: the checks, the cue timings, each claim beside its line, and stills. Later rounds look again at what changed. Without subagents, the agent writes a labelled self-review.
- **Self-contained.** `scripts/setup.mjs` copies the engine into `~/.cache/pr-studio/` and installs its packages (about 57 MB) on first use. Videos also install a Python environment for the voice and word timing. Old copies, unused installs, builds and render caches are pruned.
