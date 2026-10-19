# Changelog

## 0.1.0 (2026-10-19)

- `generate-test-video`: a short narrated "how to test" or "how to verify" video for a VS Code test plan item (TPI), a fixed bug or a group of fixed bugs of one area. It's recorded in real VS Code Insiders in a throwaway profile, and every step is checked in the app. Flags pause the video where something is wrong; a verdict slide opens it (verified, issues, changed, partial or failed, with the build and what isn't covered) and a recap ends it.
- The kit from the 1.143.0 endgame, made portable: no paths to one machine, its own Python environment and `playwright-core` in `~/.cache/test-videos/`, the Kokoro voice offline or MAI-Voice-2 with an Azure key, and videos delivered to `~/Downloads/test-videos/`. macOS only.
