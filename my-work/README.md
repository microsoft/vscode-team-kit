# My Work

Plan and run your day in one canvas: your current and next milestone, your own priority list, the Agents window sessions working on them, GitHub notifications, and Sweeper-assisted cleanup of the issues assigned to you.

> **Experimental:** Requires a Copilot host supporting SDK canvas extensions (the VS Code Insiders Agents window). No npm dependencies are needed; the host resolves `@github/copilot-sdk/extension`. The scripts need Python 3.9+ and the GitHub CLI (`gh`).

This is an Agent Plugins 1.0 package. The runtime discovers the canvas extension at `com.github.copilot/extensions/my-work/`.

## Skills

| Skill | Description |
|---|---|
| [my-work-setup](skills/my-work-setup/) | Onboarding: checks prerequisites, writes your config, builds the issue index and creates the daily indexer automation |
| [my-issues](skills/my-issues/) | Queries and acts on the local index of your issues, runs the Sweeper cleanup workflow and drives the canvas |
| [my-work-ui](skills/my-work-ui/) | UX principles for the panel (VS Code look, density, toolbars, lists, details pane), used before anyone changes, rebuilds or customises its UI |

## Getting started

[![Install in VS Code Insiders](https://img.shields.io/badge/Install_in-VS_Code_Insiders-24bfa5?style=for-the-badge)](vscode-insiders://chat-plugin/install?source=microsoft%2Fvscode-team-kit&plugin=my-work)

Or run these in a Copilot chat session that supports `/plugin`:

```text
/plugin marketplace add microsoft/vscode-team-kit
/plugin install my-work@vscode-team-kit
```

Make sure canvases are enabled (setting `chat.canvases.enabled`, off in a fresh profile), then ask **"set up My Work"**. The my-work-setup skill walks you through the rest (about 10 minutes, most of it the first index build).

## What you get

The canvas (`my-issues-triage`, titled **My Work**) has five views:

- **My Work** — your own **sections** (for example MSRC: notes with a link, description and due date, plus issues and sessions you put there; each section can have its own instructions for sessions), your issues in the current and next milestone (live from GitHub), then **My priorities**, your own ordered list kept locally. **Browse issues & PRs** finds your bugs, feature requests, all your issues or PRs awaiting your review, optionally in one feature area; filter the selected list by typing and pressing Enter, in GitHub syntax or plain words ("created by alexdima this month"): the chat turns plain words into search qualifiers using your memory for names, and the panel shows them for editing. Open a result to read and discuss it, start a session, or drag it into a group. Discussing an issue from the panel gives it its own chat, nested under your My Work session; **Start session** turns that chat into the work session (a worktree of the repository), so the conversation carries on there. Planned issues can be sent back to untriaged. Add the session you're working in and it resolves the issue it works on; opening a session shows its status, latest reply, requests and edited files. A docked **My Work chat** takes pasted links or plain requests ("add the session I'm in").
- **Today** — the daily queue: newly assigned issues, Sweeper verdict changes, new activity, severe bugs and top close proposals.
- **Notifications** — your unread GitHub notifications, classified by the triage chat with your inbox rules into Needs action, Route, Auto-dismiss, Safe to dismiss and FYI, with bulk dismiss and route.
- **Cleanup** — Sweeper close and needs-info proposals with live fact checks and independent judge chats; each action needs your approval.
- **Implement** — agent-ready issues, bugs first, with one-click fix sessions.

A daily automation refreshes the index and posts the day's triage to a reused triage chat, titled **My Work**, that works alongside the canvas.

## How it works

- `skills/my-issues/scripts/refresh_my_issues.py` builds an incremental local index (`~/.copilot/project-boards/my-issues.json`) of every issue assigned to you in your org, with feature areas discovered from GitHub labels and optional [Sweeper](https://github.com/egamma/vscodesweeper-state) enrichment for microsoft/vscode. It never changes GitHub.
- `skills/my-issues/scripts/my_issues.py` answers queries, builds the daily queue, applies approved cleanup actions and records your decisions.
- The canvas extension serves a loopback-only panel. The extension can't create chats, so it sends requests to the chat it is attached to (for example "start a nested judge chat"), and chats report back through canvas actions.
- Your inbox rules live in `~/.copilot/github-inbox-rules.md`, shared with the [github-inbox](../github-inbox/) plugin. They decide what can be auto-dismissed, routed or closed; Sweeper is advisory only.

## Configuration

Optional per-user settings live in `~/.copilot/project-boards/my-work.config.json`: org, plan repository, local clones, Sweeper clone, rules file, data folder and your private security-fix workflow. Defaults suit the VS Code team. See [my-work-setup](skills/my-work-setup/SKILL.md).

## Data and privacy

Everything stays on your machine:

| Data | Location |
|---|---|
| Issue index, queue, decisions, judge opinions, config | `~/.copilot/project-boards/` |
| Panel state (batches, activity, threads, priorities, settings) | `~/.copilot/extension-data/my-issues-triage/` |
| Pinned sessions, your sections and notes, My Work chat link | `~/.agents/data/my-work/` (configurable, owner-only permissions) |

Nothing changes on GitHub without an explicit per-item click or approval in chat. Your sections and their notes are stored only locally; sessions started from a note follow that section's instructions (for a security section, to stay private). Session details are read best-effort from the Agents window's internal session store, which can change between builds.

## Develop locally

To try changes before publishing, keep the plugin installed and point it at your checkout. Add `"devSource"` to `my-work.config.json`:

```json
{ "devSource": "~/work/vscode-team-kit/my-work" }
```

The panel then loads its code, assets and scripts from that folder and shows "My Work (dev)":

- Edits under `assets/` reload the open panel right away.
- Edits under `lib/` or the Python scripts take effect after an extensions reload (ask the chat to reload extensions) or in a new chat.
- `extension.mjs` always runs from the installed copy.

Remove `devSource` to go back to the published version.

## Validation

```sh
node --test my-work/test/*.test.mjs
python3 -m py_compile my-work/skills/my-issues/scripts/*.py
```

## Plugin structure

```text
my-work/
├── plugin.json
├── CHANGELOG.md
├── README.md
├── skills/
│   ├── my-issues/
│   │   ├── SKILL.md
│   │   ├── triage-help.md
│   │   └── scripts/
│   │       ├── my_issues.py
│   │       ├── my_work_config.py
│   │       └── refresh_my_issues.py
│   ├── my-work-setup/
│   │   ├── SKILL.md
│   │   └── references/indexer-automation.md
│   └── my-work-ui/
│       └── SKILL.md
├── com.github.copilot/extensions/my-work/
│   ├── extension.mjs
│   ├── lib/          (server, data, prompts, config, sessions, work, …)
│   └── assets/       (index.html, app.js, style.css; icons use the VS Code installation's codicon font)
└── test/
    └── my-work.test.mjs
```
