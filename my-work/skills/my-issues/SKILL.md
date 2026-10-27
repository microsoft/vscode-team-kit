---
name: my-issues
description: Query and act on the local index of every GitHub issue assigned to you (default org:microsoft), enriched with Sweeper (vscodesweeper) triage proposals, and drive the My Work canvas. Use when the user asks about "my issues", their backlog, feature-area counts, what Sweeper proposes for an issue, propose-close/needs-info/route-to-area/autoFixable/stale/no-repro lists, what changed since the last refresh, wants to record a triage decision, or sends a "Panel request"/"Panel message" from the My Work canvas.
---

# My Issues index and the My Work canvas

A daily automation ("My Issues Indexer", set up with the **my-work-setup** skill) maintains a local index of all issues assigned to the user in their GitHub org. Use it to answer questions about the user's issues **before** calling GitHub. It is fast and offline.

Paths below use `<board>` for `<COPILOT_HOME>/project-boards` (default `~/.copilot/project-boards`) and `<scripts>` for this skill's `scripts/` folder. Per-user settings (org, plan repository, local clones, Sweeper clone, rules file, data folder, MSRC workflow) live in `<board>/my-work.config.json`; see the my-work-setup skill.

## Files (`<board>/`)

| File | Role |
|---|---|
| `my-issues.json` | Source of truth (can be tens of MB). **Never read it whole**; use the helper script. |
| `my-issue-outcomes.json` | User-owned triage decisions. The refresh re-applies these to the index each run. |
| `my-issues-refresh-manifest.json` | Last refresh: added/updated counts, Sweeper commit, Sweeper `triageActionChanges`. |
| `my-issue-features.json` | Feature areas (label → area, priority): the user's own, plus `"auto": true` areas the refresh adds for every GitHub feature label (microsoft/vscode labels coloured #c5def5, except `perf`) found on an open issue, at priority 10. Auto areas are kept; edit them (rename, priority) or list labels in `ignoredAutoLabels` only when the user asks. |
| `my-issues.md` | Generated human view. Don't edit. |
| `my-triage-queue.md` / `.json` | Generated daily triage queue. Don't edit. |
| `my-triage-chats.json` | Which refresh already got its daily triage message, and `persistentChat`: the one triage chat reused every day. Written by `mark-chat`. |
| `my-work.config.json` | Per-user settings (optional; defaults suit the VS Code team). |
| `my-issues-refresh-status.json` | Progress of the running (or last failed) refresh, written by `refresh_my_issues.py`; the canvas shows it on Today, Cleanup and Implement. |

Record keys are `owner/repo#number`. A bare number means `<planRepo>#number` (default `microsoft/vscode`).

## Helper scripts

`python3 <scripts>/my_issues.py <command>`

| Command | Use |
|---|---|
| `stats [--state open\|closed\|all]` | Counts by area, Sweeper action/severity, autoFixable, outcomes |
| `list [filters] [--sort ...] [--limit N] [--json]` | Filtered issue lists (open by default) |
| `get <key\|number\|url>` | Full compact record plus Sweeper's current Summary / Best solution / Proposed action |
| `changes [--limit N]` | What the last refresh changed, including Sweeper verdict flips |
| `record <issue> --decision <d> [--note ...] [--canonical owner/repo#n]` | Record an explicit user decision |
| `record <issue> --clear` | Remove a recorded decision |
| `queue [--write]` | Build the daily triage queue (`my-triage-queue.md`/`.json`) and count unread GitHub notifications. Prints `triageChat` (the reused triage chat), `postToChat` (send today's `chatMessage` to it), `createChat` (no triage chat yet: create one with `title` and `chatPrompt`) for the automation. Both are false when today was already handled or there is nothing new |
| `mark-chat <link>` | Record that the current refresh was posted to (or created) this triage chat, and make it the chat reused on later days |
| `cleanup [--group fixed\|duplicate\|reason\|needs-info] [--limit N]` | Sweeper-backed cleanup candidates. With no group it prints counts. Each item has evidence, the exact proposed comment, and the planned `gh` steps |
| `proposal <issue>` | The same cleanup view for a single issue |
| `apply <issue> --comment-file F --confirm [--group G] [--label L] [--duplicate-of N] [--note ...] [--force]` | Execute ONE approved cleanup action on GitHub and record the outcome |
| `checks <issue> [--popular N]` | Live, read-only fact checks on a cleanup proposal |
| `judge-prompt <issue...>` | Blind judge prompt and title (issue identity only) for a separate judge chat |
| `opinion <issue> --action keep-open\|fixed\|duplicate\|not-planned\|needs-info [--reference R] [--confidence C] --reasoning "..." [--evidence E]` / `opinion <issue> --clear` | Record or clear a **blind** judgement (judge chats only) |
| `implement [--readiness implement\|plan] [--limit N]` | Agent-ready issues (Sweeper `agentReadiness`), bugs first, then by severity and upvotes |
| `find-clones [--repo owner/repo]` | Local clones the user's Agents window sessions worked in, by GitHub repository, most used first (read-only; works without an index) |

`python3 <scripts>/refresh_my_issues.py [--full]` is the indexer pipeline. Only the indexer automation (or first-time setup) runs it; it never changes GitHub. The first run indexes open issues first (published quickly), then closed ones. Later runs only fetch issues updated since the last refresh (seconds); every 7 days, or with `--full`, a full pass also catches issues that were unassigned, transferred or deleted.

`list` filters: `--area <id>`, `--repo owner/repo`, `--label L` (repeatable, all required), `--action keep-open|propose-close|needs-info|route-to-area`, `--severity S` (repeatable), `--autofixable`, `--no-milestone`, `--no-outcome`, `--has-outcome`, `--no-repro`, `--stale-days N`, `--text <title substring>`, `--state`. Sort: `updated` (default), `created`, `upvotes`, `confidence`, `severity`.

Feature area ids: read `my-issue-features.json` (fallback `others`). Sweeper severities: `data-loss`, `crash`, `freeze`, `perf`, `correctness`, `visual`, `papercut`. Sweeper only covers microsoft/vscode; without a Sweeper clone, proposals and cleanup are simply empty.

## Common recipes

- Daily triage chat: read `<board>/my-triage-queue.md`. Its sections are Newly assigned, Sweeper changed its verdict, New activity, Severe bugs, and Top close proposals. It only lists open issues with no decision, or issues changed on GitHub after the last decision.
- Morning overview: `changes`, then `list --no-outcome --action propose-close --limit 15`.
- Close candidates: `list --action propose-close --no-outcome --sort confidence`.
- Worst bugs: `list --label bug --severity data-loss --severity crash --severity freeze --sort upvotes`.
- Hand-off to Copilot: `list --autofixable --no-outcome`.
- Backlog cleanup: `list --stale-days 365 --no-milestone`, or `list --label bug --no-repro`.
- One issue: `get 12345`.

Present lists as Markdown tables or bullets with issue links. Keep them short (≤25 rows) and say how many matched in total.

## Cleanup workflow (Sweeper-assisted, one issue at a time)

Triggers: "clean up my issues", "clean up: already fixed", "close the duplicates", "send info requests", or an issue from the triage queue or a notification that has a Sweeper close or needs-info proposal.

| Group | Sweeper proposal | Planned GitHub action |
|---|---|---|
| `fixed` | Already fixed on main (fix commit + shipped version) | comment, then close as completed |
| `duplicate` | Duplicate of #N | comment (includes `/duplicate of #N`), add `*duplicate`, close as duplicate of #N |
| `reason` | as-designed / out-of-scope / question | comment, add `*as-designed`/`*out-of-scope`/`*question`, close as not planned |
| `needs-info` | Needs more info from reporter | comment, add `info-needed` (stays open) |

Steps:
1. `cleanup` for counts, then `cleanup --group <g> --limit 10`. Items with `activitySinceReview: true` sort last. Treat their proposal as possibly outdated.
2. **For each issue, one at a time:**
   a. Fetch it live: `gh issue view <n> -R <repo> --comments`, and read the latest comments. If someone added information or disagreed after Sweeper's `reviewedAt`, say so and suggest skipping.
   b. For `fixed`, glance at the fix commit (`gh api repos/<repo>/commits/<sha> --jq .commit.message`). For `duplicate`, check that the original issue is open and matches.
   c. Show the user: issue link and title, Sweeper's summary, the key evidence, confidence, the **exact comment text**, and the planned steps.
   d. Ask with the ask_user tool: **Approve**, **Edit comment**, **Skip**, **Keep open** (record `rejected`), or **Defer** (record `deferred`). Never batch approvals; each issue needs its own explicit approval.
   e. On Approve or an approved edit: write the final comment to a temp file and run `apply <issue> --comment-file <file> --confirm`. It re-checks live state, refuses if the issue was closed or got new comments since review (use `--force` only if the user approves after seeing them), runs the planned `gh` steps, and records the outcome. Delete the temp file.
   f. On Skip, record nothing. On Keep open or Defer, use `record` with a short note.
3. After the batch, summarise what was done and what's left (`cleanup` counts).

**Rotation with notifications:** in the daily triage chat, the user may ask to alternate batches, e.g. "10 notifications, then 10 cleanups". Alternate fixed-size batches: notifications newest first, then cleanup with Easy closes first and then fixed → duplicate → reason → needs-info. Handle an issue only once even if it appears in both. Show a one-line tally after each batch and continue until the user stops.

In microsoft/vscode, `*`-labels can make the triage bot close the issue and post its own canned comment. `apply` tolerates the bot having closed it already.

**Help:** when the user says "help" in a triage chat, show this skill's `triage-help.md` verbatim.

**Principles, rules and memory:** every triage decision follows [triage-principles.md](triage-principles.md), refined by the user's inbox rules (`rulesFile`, default `~/.copilot/github-inbox-rules.md`), which win on conflict. The user's inbox memory (`memoryFile`, default `~/.copilot/github-inbox-memory.md`) holds facts: people's GitHub logins, area owners, the user's team and preferences. Both files are shared with the github-inbox plugin; read them before triaging.

## The My Work canvas

The `my-issues-triage` canvas ("My Work", from the my-work plugin) has a left activity bar: **Today** (the daily queue), **My Work**, **Notifications**, **Cleanup** and **Implement** (agent-ready, bugs first). Each view shows one **batch** at a time (size configurable, default 10). Every button click (Approve / Dismiss / Done / Keep open / Defer / Skip / Start session / Route …) is the user's explicit per-item decision. Without an index, My Work and Notifications still work and the other views explain how to build it.

Canvas actions:
- `setNotificationTriage {items:[{id, group: action|route|auto|cleanup|dismiss|fyi, reason, rule?, routeTo?}], keepBatch?}`: `auto` = matches an auto-dismiss rule in the user's inbox rules (give `rule`, e.g. "A1. Merged own PR" from the triage principles or a numbered rule of the user); the panel offers a bulk **Auto-dismiss** / **Safe to dismiss** review. `route` = the issue/PR belongs to another owner per the user's routing rules: give `routeTo` (logins; `[]` = only unassign the user) and `rule`; the panel's **Route** list lets the user bulk **Route & dismiss**. Put uncertain owners in `action` with `replyToIssue` choices instead. This also sets the notification batch unless `keepBatch: true`. Answer "Panel request: classify these N notifications", "triage the next N untriaged notifications" and "re-check the classification" messages with one call and `keepBatch: true`, using `auto`/`dismiss` whenever a rule applies after reading the latest comments.
- `setBatch {tab, ids}`: show exactly these items as a tab's current batch.
- `setOpinion {key, action, reference?, confidence?, reasoning, evidence?}`: record a blind judgement (judge chats normally use `my_issues.py opinion`).
- `replyToIssue {key, text, choices?}`: answer a "Panel message about <issue>" in that issue's thread (markdown). `choices` (max 5) are one-click quick replies `{label, reply, style?: primary|secondary|danger, edit?}`. Always add choices when asking for approval or a decision.
- `judgeFailed {keys, error}`: report that a panel-requested judge chat could not be created.
- `getActivity {since?}`: what the user did in the panel. Check it before each batch.
- `focus {kind: notification|issue, id}`: select an item in the panel.
- `refresh`: reload after the chat acted. `getSummary`: counts, current batches and batch size.
- `setIssueRules {items:[{key, group: route|close|needs-info|keep, reason, rule?, routeTo?, closeAs?}]}`: the verdict of the user's inbox rules (the `rulesFile` in `my-work.config.json`, default `~/.copilot/github-inbox-rules.md`, shared with the github-inbox plugin) for issues in the Cleanup / Implement / Today views. Answer "Panel request: apply my inbox rules to these N issues" with one call after checking each issue live. Rules win over Sweeper. Only clear routing candidates are `route`; uncertain owners are `keep` with the doubt in the reason.
- `dismissNotifications {ids, unsubscribe?}`: dismiss notifications and update the panel at once. Always use this instead of `gh api` on notification threads.
- `getConfig`: built-in plus the user's **custom groups** (`{id, label, criteria, bulk}`); call it at the start of every triage chat. `defineGroup {id, label, criteria, bulk?, order?}` / `removeGroup {id}` manage custom groups.
- `getMyWork` / `updateMyWork {op, ...}` / `setMyWorkChat {link}`: the My Work board (below).

### My Work

- **Groups:** the current and next milestone of `planRepo` (live GitHub search), then **My priorities** (the user's own ordered list, stored locally; closed issues drop off), then **Active sessions** (collapsible; hide irrelevant ones). Pasted IcM links form an **MSRC** group at the top when `msrc.enabled`.
- **Adding work:** **Browse issues & PRs** (right pane: my bugs, feature requests, a feature area, PRs awaiting my review, all my issues; drag rows into a group or use the + buttons), *Add to My Work* in any issue's menu, or the **My Work chat** box at the bottom (pasted `#123`, issue URLs, IcM links and `agent-host-session://` links are added at once; anything else goes to the chat). Local placement never changes GitHub; *Plan for…* sets a GitHub milestone and is the user's explicit decision.
- **Sessions:** adding a session first resolves the issue it works on (session title `#N`, branch number, issues its PRs close, its first request, chat titles; only one open issue in a tier counts). If found, the **issue** is added with the session linked; otherwise the session is added and the My Work chat is asked to describe it (`updateMyWork {op: "describeSession", session, summary, issue?}`; pass `issue` only with explicit evidence). Session details are read locally from the Agents window session store and transcript (best effort; internal formats). Keep `#N` in session titles so they link.
- **MSRC items:** pasted IcM link + description, stored privately in the My Work data folder. **Start session** sends "Panel request: start a fix session for MSRC item IcM <id>": follow `msrc.fixWorkflow` from the config; always work privately (never a public repo, branch, PR or issue) and keep `IcM <id>` in the session title.
- **My Work chat:** its first message asks the triage chat to create a nested chat titled "My Work chat" and register it with `setMyWorkChat {link}`; later messages arrive as "Panel request: forward a My Work message" — just `send_message` them verbatim. The My Work chat uses `getMyWork` / `updateMyWork` (addIssue, pinSession, moveSession, unpinSession, describeSession, add/move/removePriority, addMsrc — local only, no approval needed) and replies with `replyToIssue {"key": "my-work", …}`. "The session I'm in" = the most recently active session other than the triage and My Work chats. If the nested chat is gone, call `setMyWorkChat {"link": null}`.
- **Start session** sends "Panel request: start a work session for <issue>": create an independent worktree session in the repository's configured local clone, titled `Fix #N: …` / `Implement #N: …`, record `fixing`, and reply with `replyToIssue`.

### Panel requests

- **"Panel request: start a nested judge chat"**: call `create_session` exactly as instructed (omit `relationship` so it is nested, no workspace), passing the enclosed prompt **verbatim**. Do not judge it yourself and do not add Sweeper context.
- **"Panel message about <issue>"**: handle it like any request from the user about that issue (GitHub changes still need explicit approval), then answer with `replyToIssue`.
- **"Start a fix session…"** / **"Panel request: start a fix or implementation session…"**: the click is explicit confirmation. Fetch the live issue and latest comments, decide bug vs feature, create an independent isolated-worktree session in the configured local clone, record `fixing` only after creation (and only for indexed issues), post the session link with `replyToIssue`, and do not dismiss the notification.
- **"Panel request: start a nested investigation chat"**: call `create_session` exactly as instructed (nested, no workspace), post its link with `replyToIssue`, and continue without waiting. Neither chat changes GitHub during the investigation.

### Standing instructions ("from now on…")

The daily triage chat is reused every day, but older history gets compacted, so persist lasting requests instead of remembering them. Show the user exactly what will be saved and where, and wait for OK. Then:
- **(a) Classification or handling rule:** append it as the next numbered rule in the user's rules file.
- **(a2) A lasting fact** (someone's GitHub login, who owns an area, the user's team): add it to the user's memory file in the matching section.
- **(b) New panel section or bulk list** (e.g. "group CODENOTIFY"): `defineGroup` with criteria a future chat can apply without asking, add the matching rule from (a), then reclassify today's notifications with `setNotificationTriage` and `keepBatch: true`.
- **(c) Panel UI or behaviour changes:** these are changes to the shared my-work plugin (microsoft/vscode-team-kit). Describe the change and offer to open an issue or pull request there; don't edit the installed plugin.

## Independent (blind) judgements

Judge chats get only the issue identity. They must not read Sweeper data or `my_issues.py get/proposal/checks/cleanup/list`. They record each verdict with `my_issues.py opinion …`, which writes one file per issue to `<board>/my-issue-opinions/`, so parallel judges never collide. The panel compares each verdict with Sweeper's proposal.

When the user asks for an independent judgement in chat, run `my_issues.py judge-prompt <issue...>` and call `create_session` with its `title` and `prompt` **verbatim**, **omitting `relationship`** and with **no workspace** (the judge reads the local clone read only). For a second round with Sweeper's evidence, use `judge-prompt --informed <issue>`; the judge records with `opinion <issue> --informed ...`.

## Rules

1. **The index can be up to a day old.** Before acting on GitHub (closing, commenting, labelling, assigning), fetch the live issue and its latest comments. The user's inbox rules still apply, including showing comment text for approval before posting.
2. **Sweeper is advisory.** Present its verdict as a proposal with its confidence. Never treat it as a decision.
3. **Record outcomes only on explicit user decisions.** Use `record` only after the user explicitly decides, or after the user-approved GitHub action has succeeded. `apply` records automatically after its approved action. Never record outcomes in bulk from Sweeper proposals, and never run `apply --confirm` without that issue's explicit approval. Decisions: `accepted`, `rejected`, `deferred`, `closed`, `needs-info-sent`, `routed`, `fixing`, `fixed`, `duplicate` (with `--canonical`), `wont-fix`. Put the reason in `--note`.
4. **Never edit `my-issues.json` directly.** The indexer owns it, and `record` is the only supported write.
5. Issues not assigned to the user are not in the index. Fall back to GitHub for those.
