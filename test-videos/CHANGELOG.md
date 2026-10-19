# Changelog

## 0.2.0 (2026-10-19)

From cold runs, where a fresh agent made each video from the skill alone (#342051, #145202, TPI #342443 signed in, and five Explorer and Timeline bugs), then a review for size and a cold run of the smaller skill (#145202: 29 min, down from 39).

- Smaller, same features: the skill text is 4 files under 8 KB each (`SKILL.md`, `video.md`, `scenario.md`, `slides.md`; 43 KB → 24 KB), each rule said once; each example is under 8 KB (60 KB → 22 KB); `voice_engine.py` keeps only what the kit calls (52 KB → 11 KB); `firstbuild.py` is now `item.py --commit <sha>`.
- New in the docs: scope when an issue has no steps or its PR tests more, acceptance criteria, and when a video is `partial`; signed-in items on a small request budget; the Agents window, editors, dialogs, git history and the integrated browser; zoom timing and size, and fixing a zoom without recording again; `recap.label` and the verdict's word budget.
- New `setup.mjs --selftest` (a 45 s video proving every stage on a new Mac) and `item.py <n>` (an item's PRs, whether the installed Insiders has them, and the title's phrase).
- Runs live in one short folder under `~/.cache/test-videos/t/` (`TEST_VIDEOS_TMP`), VS Code's temp files included; each run prints it.
- Runner: dialogs are drawn in the window; no Chat side bar when signed out; new `workspace.commits`, `keybindings` and `ctx.setSettings()`.
- Helpers: `h.paste()`; `h.click({ button, modifiers })` for right-clicks and ⌘-clicks; `h.command()` runs only the row labeled exactly as asked; `h.pickRow()`, `h.quickInput()`; `h.pickModel()`, `h.modelLabel()`, `h.chatRunning()`, `h.cancelChat()`. Key badges put modifiers in the Mac's order (⇧⌘P). The drawn pointer follows only the kit's own moves.
- `check.py` checks sync against where speech starts, up to 0.6 s needs no action, and every line that does starts with CHECK. `compose.py` writes `out/looks.json` for flags, refuses a failed recording, renders `↵` and keeps punctuation after a code span. `flags.py` warns about pauses over 8 s; with no flags, `cards.py` uses `out/` as it is. A new recording deletes a stale `run/timeline.recorded.json`. `cards.py --preview` estimates the verdict's length. The voice check accepts ordinals transcribed as digits.
- Both examples pass every step on Insiders `341e0fa934`; the single-issue one serves its own localhost page.
- `setup.mjs` prints `FFMPEG=` and re-runs take 2 s; no `__pycache__` in the plugin folder.

## 0.1.0 (2026-10-19)

- `generate-test-video`: a short narrated "how to test" or "how to verify" video for a VS Code test plan item (TPI), a fixed bug or a group of fixed bugs of one area. It's recorded in real VS Code Insiders in a throwaway profile, and every step is checked in the app. Flags pause the video where something is wrong; a verdict slide opens it (verified, issues, changed, partial or failed, with the build and what isn't covered) and a recap ends it.
- The kit from the 1.143.0 endgame, made portable: no paths to one machine, its own Python environment and `playwright-core` in `~/.cache/test-videos/`, the Kokoro voice offline or MAI-Voice-2 with an Azure key, and videos delivered to `~/Downloads/test-videos/`. macOS only.
