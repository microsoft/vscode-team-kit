# The video

## What it is

- **Look:** the recorded window under a dark band. The band shows the step's label, **DO**, **LOOK FOR** (or a tag such as **USER SETTINGS**) and a zoom on what matters. A drawn pointer, click rings and key badges show what's clicked or pressed.
- **Voice:** Kokoro at 1.1×, or MAI-Voice-2 at 1.2×, says one or two short sentences per step: the action and the result, in plain words. Exact names and values go in the band.
- **Fast:** no intro; the first step is the setup. Keep it as short as the steps allow, typically 25–45 s plus the slides, with pointer moves of 250–350 ms.
- **Exact:** each step does its action, checks the result in the app, and returns what it checked. Check DOM, focus or files, and use `getComputedStyle` for a visual claim such as "dashed", the way the PR's tests do.
  - When the product doesn't do what the item expects, the step checks and records what did happen, returns, and gets a `fail` flag (slides.md).
  - A step throws only when the run itself breaks, because `compose.py` refuses a failed recording.
- **Hovers:** the runner delays hovers by 60 s, so none shows by accident. A step that shows one sets a shorter delay, and its band says so. An item about how soon something appears uses VS Code's real default (1500 ms on macOS).

## Faithful to the item

A tester follows the video instead of the item, so:
- **Everything is shown:** every setup item, step and expected result, in the item's order, with its exact names, settings, values and labels. Anything left out is reported, with the reason. Add nothing the item and its PRs don't support.
- **Title:** `How to test TPI #<n> · <short title> · Insiders from <date> or newer` (`How to verify #<n> · …` for a bug). Copy the phrase from `item.py` exactly: it names the build when an earlier build that day lacks the change. Never write "1.143.0 or newer".
- **Numbering** follows the item:
  - "STEP 2 OF 3", or "STEPS 3–4 OF 8" for merged steps;
  - "PR STEP 2 OF 4" when following a PR's how-to-test;
  - "CRITERION 2 OF 4" for acceptance criteria, with the PR's extra checks last as "ALSO".
- **Windows:** if the item asks for two (the editor window and the Agents window), record each in its own work folder and number the steps across both. Join them with `$PY $KIT/concat.py <result> <part 1> <part 2>`; the result's `captions.json` gives the name. If the item says one **or** the other, one is enough.
- **States** the item asks to see (appears, disappears, comes back) stay on screen at least 1.2 s, with the zoom on them.
- **Keyboard steps** show their keys.
- **A step you can't show** (it needs a person, hardware or an account) is left out and reported.
- **Cleanup:** if the test changes anything a throwaway profile doesn't undo (files in `~`, `~/.copilot/settings.json`, application settings), end with a short Cleanup step.
- **A tester's machine:** where it will show something different, say what. For example, dialogs are drawn in the window here (`window.dialogStyle: custom`): say that a tester's dialog is native.
- **Settings and profiles:**
  - The runner uses the Default profile of a throwaway user-data folder. It writes `settings` there and to the Agents window's profile, which shares the Default profile's settings.
  - Check how each setting the video names is registered. An application-scoped one (`ConfigurationScope.APPLICATION`) is ignored in a temporary profile's settings, so testers set it in **Preferences: Open Application Settings (JSON)**, and undo it in Cleanup.
  - If the item asks for a temporary profile and an application setting, launch one (`args: ['--profile-temp']`). Set the window settings it needs (zoom, hover delay) in `prepare`.

## Scope

- **A TPI:** its steps and expected results.
- **A fixed bug:** its repro and expected behavior, from the issue and its comments.
  - If they have no steps, follow the fixing PR's "how to test" (`item.py` finds the PR), and say so in the first band.
  - If the PR tests more, cover the issue's behavior first, and add only steps that verify the same fix. Its steps for other changes go in Not covered, without making the video `partial`.
- **`partial`:** whenever one of the item's own steps, criteria or expected results isn't shown, or is shown in only one of its forms ("criterion 3 in part"), even if everything shown passes. Other operating systems, and accounts the item doesn't need, go in Not covered without making it partial.

## Bug groups

Fixed bugs of one area share one video, and each bug is a step taken from its own repro or how-to-test.
- **Order:** by what their setups build on, not by number.
- **Bands:** label each one `#<n> · k OF m`, and keep each bug to 5–12 s.
- **Another window or workspace:** a case that needs one (a symlinked folder from a comment, say) is its own part, joined with `concat.py`.
- **Build:** every fix must be in it; run `item.py` per bug.
- **Title:** `How to verify <n> <area> fixes · <phrase>`, where the phrase comes from the newest fix: `$PY $KIT/item.py --commit <its merge commit>`.
- **Name:** `bugs-<area>-<n1>-…-how-to-verify`.
- **Verdict:**
  - `verified` when every bug shown passes;
  - `issues` when one fails: flag it, and write a headline like "6 of 7 fixes verified; #339746 still breaks when narrow";
  - `partial` when a bug that could be verified here isn't shown.
  - A bug that only another OS can show goes in Not covered.
