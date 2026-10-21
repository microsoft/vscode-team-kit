# Reference: the project and digest.json

## The project

`<engine>/videos/changelog-<date>/` (the engine's `videos/` is `~/.cache/changelog-videos/work/videos/`):

| File | Who | What |
|------|-----|------|
| `brief.md`, `picks.json`, `report.md` | `prs digest new` | the picks, where each PR's brief, diff and files are, and the build the demos record |
| `facts.md`, `notes.md` | you | per pick, what a user sees and its strings; one line per decision |
| `storyboard.json` | you | the narration: beats `intro`, `c1` … `c5`, `outro` |
| `digest.json` | you | the chapters: the strip, the visual, the arrows |
| `demos/<id>.mjs` | you | the recordings ([recording.md](recording.md)) |

Each PR is in `<engine>/videos/<owner>-<repo>-<n>/`: `brief.md` (its description, settings, tests, discussion), `pr.diff`, and the files it changes at its head in `build/src/<sha>/`.

## Times

A time is a phrase of the chapter's narration (when it is spoken), seconds into the chapter (`0.35`), `{ "cue": "phrase", "nth": 1, "offset": 0.3 }`, `{ "mark": "dialog", "edge": "start" | "end" }` (when a demo's mark is on screen), or `{ "step": "label" }`. A key named `at`, `from`, `until` or ending in `At` is a time.

## digest.json

A recorded chapter with three arrows (Oct 19, c4; [example/digest.json](example/digest.json) has all five):

```json
"c4": {
	"pick": 4,
	"headline": "/fork, with a title or with a prompt",
	"eyebrow": "In Agent Host chats",
	"before": { "at": "In Agent Host chats", "rows": [{ "id": "old", "mono": true, "text": "/fork" }] },
	"now": { "at": "now takes", "rows": [
		{ "id": "plain", "mono": true, "text": "/fork", "changed": false },
		{ "id": "title", "mono": true, "text": "/fork <title>" },
		{ "id": "prompt", "mono": true, "text": "/fork prompt <prompt>" } ] },
	"visual": { "demo": "c4" },
	"focus": [
		{ "part": "prompt", "row": "prompt", "at": "takes a prompt" },
		{ "part": "title", "row": "title", "at": "or a title" },
		{ "part": "forked", "row": "title", "at": "like" } ],
	"proof": "Fork conversation and send a prompt",
	"recap": { "before": "/fork", "now": "/fork <title> · /fork prompt <prompt>", "mono": true }
}
```

- **headline**: what changed for users, under 52 characters. **eyebrow** (optional): where.
- **before** (only a before the diff shows) and **now**: `at` (when the head appears; for now, the phrase that states the change) and `rows`; optionally `head`, `icon`, `tone`, `pulseAt`, `dim: false`. Rows: `id`, `text` (about 30 characters; `sub` for a second line), `style` (`chip`: a dark button with `icon`, `"github"` for the GitHub mark; `button`: a blue button), `icon`, `mono`, `kbd` (a shortcut), `toggle` (`on`, `off`, `flip`), `tone` (`orange`: a warning; `blue`), `changed: false` (a Now row that is not new), `at`.
- **setting** (optional): `{ name, state, at, toggle }`, a setting card under the strip. A toggle that flips, or Before and Now toggles that differ, say a default changed: only when the PR changes one (the check looks).
- The strip must fit 675 px: about 7 rows with heads (the check measures it).
- **visual**: `{ "demo": "c4" }` or `{ "scene": { "name": "…", "params": { … } } }` (times in params too).
- **focus** (not on a card): up to three arrows, one at a time, `{ "part", "row", "at" }`: from the strip row `row` to `part` (a demo's mark or a scene's part), from the phrase `at`, while the part is on screen and still, at least a second each (the check says when one can't). Its color is its row's: grey from a Before row, blue from a button, orange from a warning, else green. Without `row`, an arrow starts from the first green Now row; without `at`, once its row is in and its part is on screen.
- **proof** (demos): the PR's text one of the arrows' marks shows on screen.
- **removed** (a demo of a removal, in place of proof): the label the PR's diff takes out. The check makes sure no mark of the recording shows it: the recording shows where it was, now without it (the picker searched for it).
- **clip** (demos, optional): `start` / `end` trim the recording; a demo paced with `cue()` needs neither.
- **recap**: the outro's line, `{ before, now, mono }`; `before: null` shows "New".

The camera moves in on the first arrow's part, and on to a later one out of view. To keep more of the UI in view (a whole setting), point the first arrow at a bigger mark: the row, not a word of it.

## Scenes

A scene draws one VS Code piece from the PR's real strings (the check looks); example data around them (a file name, a session title) can be made up. `prs digest scenes` lists each scene's params and parts, and the icons.

| Scene | For | Parts (focus) |
|-------|-----|---------------|
| `button-swap` | a page whose button changes (Welcome page, a banner, an empty view) | `before`, `after` |
| `list-actions` | a list row whose actions change (a new button, a hover action, a nested row) | `row`, `action`, `tooltip`, `child` |
| `app-badge` | the app icon in the dock with a badge | `badge`, `tile` |
| `slash-menu` | a chat input with a slash command and its suggestions | `input`, `list`, `entry0`… |
| `picker` | a dropdown from a chat input button, or a quick pick: a new entry, a disabled one and its reason | `picker`, `button`, `item0`… |
| `dialog` | a modal dialog (a confirmation, a warning) | `dialog`, `title`, `highlight`, `primary`, `cancel` |
| `setting` | a setting: a default the PR changes, a new setting, a new description | `row`, `value`, `description` |
| `command-palette` | a new or renamed command, or a new keybinding | `input`, `list`, `item0`… |
| `notification` | a notification toast and its actions | `toast`, `message`, `action0`… |
| `editor` | a file where text appears at the cursor (pasted, inserted): the PR's own example | `editor`, `inserted` |
| `card` | no UI to show: the change in words, its setting or command (no focus) | |

A part exists only when its params draw it (a `tooltip` needs `tooltipAt`). A card's title says the change for users; its lines, the details; say in the narration if nothing changes on screen.
