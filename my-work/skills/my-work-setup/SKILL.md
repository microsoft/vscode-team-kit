---
name: my-work-setup
description: Set up the My Work canvas and the my-issues index for a new user, or check and repair an existing setup. Use when the user asks to set up, install, configure, onboard or troubleshoot "My Work", the daily triage canvas, the issue index or the indexer automation.
---

# Set up My Work

My Work combines a canvas (the `my-issues-triage` canvas, titled "My Work"), the **my-issues** skill and one daily automation that refreshes a local index of the user's issues and hands the day's triage to a reused triage chat. Walk the user through the steps below, checking what already exists first, and confirm before creating anything that runs on a schedule.

Paths: `<scripts>` is the absolute path of the my-issues skill's `scripts/` folder (a sibling of this skill's folder: `../my-issues/scripts`). **First run `python3 "<scripts>/my_issues.py" paths`** and use the `board`, `configFile`, `rulesFile`, `memoryFile` and `dataDir` it prints for every file you read or write. They honour `COPILOT_HOME`; never assume `~/.copilot` or `Path.home()`. Below, `<board>` means that `board` path.

## 1. Prerequisites

Check each and tell the user what is missing:

| Need | Check | Notes |
|---|---|---|
| GitHub CLI, signed in | `gh auth status` | The index, notifications and My Work searches all use `gh`. |
| Python 3.9+ and Node 22+ | `python3 --version`, `node --version` | |
| Agents window with canvases enabled | `list_canvas_capabilities` for `my-issues-triage` succeeds | VS Code Insiders. Canvases are off in a fresh profile: if the canvas isn't listed, ask the user to turn on the **`chat.canvases.enabled`** setting (Settings → search "canvases") and reload the window. Session features read the Agents window's local session store (best effort). |
| Local clone for fix sessions | see below | Optional. |
| Sweeper state clone | see below | Optional, microsoft/vscode only. |

**Repository clone (never clone it for the user).** First look it up: run `python3 "<scripts>/my_issues.py" find-clones --repo <planRepo>` (default `microsoft/vscode`). It reads the Agents window's session store read-only, resolves worktrees to their main clone, checks each folder's git remote, and lists matching clones with how many sessions used them. Then confirm with the user: "Your sessions use `~/work/vscode` for microsoft/vscode — use that?" If several match, offer them as choices (most used first); if none match, ask where their clone is. Record the confirmed path in `repoPaths` (step 2). Run `find-clones` without `--repo` to suggest paths for other repositories they work on too. If they have no clone, leave it out (configured paths that don't exist are ignored): fix and investigation sessions then ask where the repository is instead of guessing.

**Sweeper clone.** Check `git -C ~/work/vscodesweeper-state rev-parse origin/state`. If it's missing, explain that it powers the Cleanup proposals and the Implement view (without it everything else works), and offer to clone it. Only after the user agrees, run `git clone --single-branch --branch state https://github.com/egamma/vscodesweeper-state ~/work/vscodesweeper-state` (public, read-only use; the indexer only fetches it), or into a path they choose and record it as `sweeperRepo`.

## 2. Configuration (`<board>/my-work.config.json`)

All fields are optional. Ask only about values that differ from the defaults, then write the file (create `<board>` if needed):

```json
{
  "org": "microsoft",
  "planRepo": "microsoft/vscode",
  "repoPaths": { "microsoft/vscode": "~/work/vscode" },
  "sweeperRepo": "~/work/vscodesweeper-state",
  "rulesFile": "~/.copilot/github-inbox-rules.md",
  "memoryFile": "~/.copilot/github-inbox-memory.md",
  "dataDir": "~/.agents/data/my-work",
  "fixSkill": "",
  "login": null,
  "msrc": { "enabled": true, "fixWorkflow": "" }
}
```

- `org`: whose issues are indexed and searched. `login` defaults to the `gh` user.
- `planRepo`: its open milestones define My Work's *current* and *next* groups.
- `repoPaths`: local clones used for fix sessions and read-only investigations.
- `rulesFile` and `memoryFile`: the user's inbox rules and memory, shared with the github-inbox plugin. Rules are numbered "from now on" instructions (auto-dismiss, routing, triage); memory holds facts such as people's GitHub logins, area owners and the user's team. If github-inbox stores them with VS Code's memory tool (`/memories/github-inbox-*.md`) instead of `~/.copilot/`, offer to copy them to `~/.copilot/` so My Work can read them. If there are none, offer starter files: rules with sections **Auto-dismiss rules**, **Routing** (who owns which areas, with GitHub logins) and **Triage**; memory with **Team and owners** and **Preferences**. The bundled [triage principles](../my-issues/triage-principles.md) apply either way.
- `fixSkill`: a skill fix sessions should use for bugs (for example a personal `fix-vscode-bug` skill). Check which skills the user has and suggest one; leave it empty if there is none. Without it, sessions are told to reproduce first and add a regression test.
- `msrc.fixWorkflow`: how this user sets up a private security fix (for example which private repository, branch or skill to use). It stays in the local config; never put it in a shared repository. Set `msrc.enabled` to false to hide MSRC items.

## 3. Feature areas (optional)

The first refresh creates `<board>/my-issue-features.json` with no custom areas; feature areas are then discovered automatically from GitHub feature labels. To group several labels or give an area precedence, add entries with a `priority` above 10:

```json
{ "id": "settings", "name": "Settings", "labels": ["config", "settings-editor"], "priority": 60 }
```

## 4. Open the canvas

Open it now, before the index exists, so the user can start right away: call `list_canvas_capabilities` for `my-issues-triage`, then `open_canvas` with `instanceId` "triage-board" and input `{}`. **My Work** and **Notifications** work immediately; Today, Cleanup and Implement show the index build's progress and fill in when it finishes. Suggest trying **Browse issues & PRs** and pasting an issue number into the chat box at the bottom.

## 5. Build the index

Start `python3 "<scripts>/refresh_my_issues.py"` **in the background** (async) and keep going; don't wait for it. On the first run it creates the feature configuration, index and manifest, indexes the user's **open** issues and publishes them (usually within a minute), then adds their **closed** issues and publishes again. It fetches issues in batches of 50, so even ten thousand issues take only minutes. It never changes GitHub. The canvas shows its progress; report the final counts when it finishes.

## 6. Daily automation

Read [references/indexer-automation.md](references/indexer-automation.md), replace `{{SCRIPTS}}` and `{{BOARD}}` with absolute paths, and ask the user whether they want it and at what time (default weekdays 09:00 local). If yes, create it with the automation tool: name "My Issues Indexer", a quick-chat target on the local agent host, and auto-approval so its commands can run unattended. It creates the "Daily triage" chat on its first run and reuses that chat every day after. Don't run it while the first index build is still going.

## Troubleshooting

- **Today / Cleanup / Implement say "No issue index yet"**: run step 5.
- **Empty Cleanup and Implement**: no Sweeper clone (step 1), or no microsoft/vscode issues.
- **Notifications error**: run `gh auth status`; the token needs the `notifications` scope (`gh auth refresh -s notifications`).
- **Start session cannot find the repository**: add it to `repoPaths`.
- **Sessions don't link to issues**: keep `#N` in session titles. Session data comes from the Agents window's internal storage and can change between builds.
- **Two "My Work" canvases**: an older personal copy of the extension (`~/.copilot/extensions/my-issues-triage`) is still installed; remove it after switching to the plugin.
