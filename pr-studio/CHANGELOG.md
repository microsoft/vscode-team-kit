# Changelog

## 0.1.0 — 2026-10-15

Initial experimental release, self-contained: the engine (from [pr-studio](https://github.com/federicobrancasi/pr-studio), MIT) ships packed in `scripts/engine.pack`, and `scripts/setup.mjs` unpacks and installs it into `~/.cache/pr-studio/engine/<hash>/` on first use. Fifteen files in all: each skill has one guide, and one picture of every diagram or layout.

- `generate-video`: a 40–100 second narrated, captioned explainer video of a pull request, with every string on screen verified against the PR and a `pr-director` review; the mp4 and its contact sheet are recorded as chat artifacts, and that ends the turn: the chat shows the video as a card.
- `generate-presentation`: a 16:9 PDF deck about a pull request, started from the PR's real data (`prs deck new --pr`), with every code line and path checked against the PR and a deck review; the PDF and its contact sheet are recorded as chat artifacts, and that ends the turn: the chat shows the deck as a card.

Tuned in three rounds of test runs on real pull requests (a fresh agent with only the skill, each round reviewed):

- The brief carries the PR's pictures (the author's, the CI's before and after screenshots, those in comments), who approved, and the whole review discussion; it says when there are none.
- Decks: screenshots cropped, pinned and ringed (`image`), before and after side by side (`split` with pictures), `spans` for what lives how long, `prs deck grid` (pixel positions, and where two shots differ), a 25-word limit the build enforces, and a scaffold whose status slide names the approver.
- Videos: each beat's body fills the frame; the narration is written for the picked diagrams (`prs direct` before the voice); the voice reports what a listener hears and retakes one beat (`--redo`); claims can cite the review discussion and any file of the repository (`prs file`).
