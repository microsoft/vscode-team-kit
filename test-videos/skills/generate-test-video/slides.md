# Flags, verdict and recap

## Calling what you find

Testers act on every flag, so call each finding what it is. Before you flag one, read the PRs' code and tests, the code's history (`git log -S`, blame), and the repo's issues (`gh issue list --repo microsoft/vscode --search "<words>"`).
- **Failure** (`fail`): the item's expected result isn't met. Say what was expected and what happened.
- **Regression:** fixed, then broken by a later PR. Measure the build just before that PR, and say "regression from #n", not "still broken".
- **Older than the change:** keep the kind (`fail` if the item's words aren't met, else `bug`), and tag it, for example `"LIKELY BUG · PREDATES THIS PR"`, with its origin ("the removal code is from Sep 4, `<commit>`, #n").
  - Flag an older problem only when a tester will see it and could take it for this fix failing.
  - Leave out what's expected, or what the steps never show.
- **By design:** the PR does it on purpose, though the item says otherwise. That's a `check` ("likely by design: ask @<author>") or a note in the band, not a failure.
- **Already filed:** name the issue ("already filed as #n"; on the recap, "link #n instead of filing"). When the same finding is in several videos, say so in each ("also in TPI #n: file it once").
- **Facts only:** quote only what the recorded run shows; label a quote from a probe ("trial run, same build"). When a stub `npx` or the mini MCP server stands in for a package, read the real package's source before saying what a tester will see.

## flags.json

Each problem pauses the video where it shows: everything but the problem dims, the problem is outlined, a callout explains it, and the voice says it in one sentence.

`{ "flags": [ { "t": 19.5, "kind": "bug", "box": [780, 486, 74, 30], "title": "…", "detail": "…", "say": "…" } ] }`

- **`kind`:**
  - `fail` (red);
  - `change`: where the video differs from the item, and why;
  - `bug`: a likely bug;
  - `check`: something to look at.
- **`t`:** a time in `out/<name>.mp4` while the problem is on screen, just after a sentence ends. The pause snaps to the nearest gap in the voice (within 1.5 s; `"snap": false` pauses exactly at `t`); a gap at a comma would split the sentence.
- **`box`:** in the video's 1920×1330 pixels, with the band in the top 250. Copy it from `out/looks.json`, which lists each `ctx.look` with its time and box, and adjust.
- **Optional:** `marks` (dashed outlines), `image` (as in cards.json), `tag`, and `at` (right, left, below, above).
- **Length:** a 6–8 word title, one or two lines of detail, and `say` in one sentence. `flags.py` warns when a pause runs past 8 s.

## cards.json

The verdict slide opens the video, and a recap ends it when there are flags.

```json
{
	"verdict": { "status": "partial", "headline": "…", "build": "Insiders 1.143.0 · 341e0fa934 · Oct 19", "why": ["…"], "not_covered": "…", "say": "…" },
	"recap": { "label": "TO CHECK", "items": [ { "flag": 1, "kind": "check", "title": "…" } ], "say": "…", "footer": "…" }
}
```

- **`status`:**
  - `verified`: every step passes as the item expects (`why` is optional).
  - `issues`: some checks fail.
  - `changed`: verified only with a setup that differs from the item's, explained in `why`. A typo in the item isn't a change.
  - `partial`: part of the item isn't shown, explained in `why` (see video.md).
  - `failed`: couldn't verify. Give `why` and an `image` of the failure.
- **`headline`, `why` and `not_covered`:** about 50 words in all, readable in 12 s. Name the failures and changes there. Omit `not_covered` when nothing is left out.
- **`recap`:** one line per flag; `"flag": N` fills in its time (`"at": "0:30"` sets one by hand). Its `label` is "TO REPORT" by default, "TO CHECK" when every item is a check, and "CHANGES" for changes only.
- **`watch`:** picture cards, only for likely bugs the walkthrough doesn't show. Never repeat a flag. Each is `{ "tag": "CHECK THIS", "title": "…", "detail": "…", "image": {…}, "say": "…" }`, 2 per slide (`watch_per_slide`: up to 3). `watch_footer` replaces the slides' "Not part of this test's pass/fail" line.
- **Images:**
  - from the video: `{"from": "video", "t": <time in the final video>, "crop": [x, y, w, h], "caption": "…"}`, in 1920×1330 pixels;
  - from a screenshot: `{"from": "shot", "path": "…", "crop": […]}`, with the crop in its own pixels;
  - before and after: `{"pair": [image, image], "direction": "row"}` (or `"column"`), each with a `label` (`"label_at": "bottom"` moves it);
  - outlines: `"marks": [[x, y, w, h]]`.
- **Words:** facts from your runs only. A slide stays up until it can be read at 4.5 words a second. `say` gives the gist, with numbers spelled out, and avoids words the voice mishears ("popup" came out as "pope up").
