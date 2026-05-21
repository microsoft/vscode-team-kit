# VS Code Team Kit

These are the agent plugins the VS Code team uses to build VS Code — code reviews, PR workflows, notification triage, and code quality guardrails, all running inside Copilot's agent mode.

We're sharing them because they're useful and because we think seeing how a team actually works with AI agents is more helpful than docs alone.

## Getting Started

Install any plugin directly in VS Code:

1. Run **Chat: Install Plugin from Source**
2. Enter `microsoft/vscode-team-kit`
3. Pick the plugin you want

**If you install one thing**, make it [review-areas](review-areas/). It runs an area-focused code review after any non-trivial change — correctness, security, tests, performance — and catches things a single-pass review misses. Just say "review my code" in agent mode.

**If you install three things**, add [monitor-pr](monitor-pr/) (watches CI and Copilot's review in the background so you can move on) and [handy-commands](handy-commands/) (slash commands for creating PRs, addressing review comments, and fixing issues end-to-end).

## Plugins

### Review — catch problems before they ship

| Plugin | What it does |
|---|---|
| [review-areas](review-areas/) | Fans out parallel subagents across correctness, tests, security, performance, and product — then synthesizes only the findings worth blocking a PR for |
| [model-council](model-council/) | Sends the same review to GPT, Claude, and Gemini independently, then surfaces where they agree and where they disagree |
| [review-plan](review-plan/) | Reviews implementation plans *before* you start coding — checks completeness, feasibility, sequencing, scope creep, and risk |
| [rubber-duck](rubber-duck/) | Constructive devil's advocate — critically reviews proposals, designs, code, or tests and categorizes findings by severity |

### Ship — from commit to merge

| Plugin | What it does |
|---|---|
| [monitor-pr](monitor-pr/) | Launches background terminals that watch CI and Copilot's code review, then notifies the agent when either finishes — no polling, no tab-switching |
| [handy-commands](handy-commands/) | Slash commands for the things you do every day: `/commit-and-pr`, `/pr-comments`, `/fix-issue` |
| [goal](goal/) | `/goal` slash command that gives the agent a durable objective with a verifiable stopping condition — keeps iterating checkpoint-by-checkpoint across turns until done |

### Triage — stay on top of GitHub

| Plugin | What it does |
|---|---|
| [github-inbox](github-inbox/) | Smart notification triage with sub-agents for review, investigation, and memory — groups by repo, applies rules, acts on your behalf |

### Guard — enforce standards automatically

| Plugin | What it does |
|---|---|
| [ban-ast](ban-ast/) | Bans code patterns via Tree Sitter AST queries — intercepts edits and rejects banned patterns unless the change includes a justification |

### Explore — visibility into builds and components

| Plugin | What it does |
|---|---|
| [build-health](build-health/) | Analyzes VS Code's rolling build pipeline on Azure DevOps — finds failures, shows break/fix transitions, links to commits |
| [component-explorer](component-explorer/) | Sets up fixture-based visual testing with MCP-powered screenshot comparison for UI components |

### Debug — drive debuggers from agent mode

| Plugin | What it does |
|---|---|
| [dap-cli](https://github.com/roblourens/dap-cli) ↗ | Drives any DAP debugger (Node.js, Python, Chrome) from the CLI — breakpoints, stepping, variable inspection, launch.json support |

## How we use these

Every plugin here runs in our daily workflow. A few patterns that emerged:

- **review-areas after every non-trivial change.** It's the default. We run it before pushing, not after — fixing issues locally is cheaper than addressing PR comments.
- **rubber-duck early and often.** Get a quick second opinion on a design or plan before investing in implementation. It's lighter than a full review-areas pass.
- **review-plan before implementing.** Plan-mode produces a plan; review-plan stress-tests it. Catching a bad assumption before coding saves hours.
- **monitor-pr to stay in flow.** Push the PR, start the monitor, move to the next task. The agent tells you when something needs attention.
- **ban-ast for rules the team agrees on.** Instead of documenting "don't use X" in a wiki nobody reads, we encode it as a hook that blocks the edit and explains why.

## Contributing

We'd love contributions. Each plugin is self-contained in its own directory with a `.plugin/plugin.json`, skills, and optionally hooks or scripts — look at any existing plugin for the pattern.

A few guidelines:
- **New plugin?** Open an issue first to discuss scope. We keep the collection focused, so a quick conversation helps.
- **Improving an existing plugin?** PRs welcome — bug fixes, better docs, new eval cases.
- **Have a workflow idea but not sure how to build it?** Open an issue describing the problem. This repo is set up for AI contributions, so a clear description often goes further than you'd expect.

## Plugin combos and overlap

Plugins work independently, but some are better together:

- **review-areas → monitor-pr** — Review your code, push the PR, monitor CI and Copilot's review in one flow.
- **rubber-duck → review-plan → review-areas** — Quick critique on the idea, thorough plan review, then deep code review. Progressive depth.
- **review-plan → review-areas** — Review the plan before coding, review the code after. Catches issues at both stages.
- **ban-ast + review-areas** — Ban patterns enforce rules on every edit; review-areas catches what slips through.
- **handy-commands + monitor-pr** — `/pr-comments` to address feedback, then monitor the resulting CI run.

**review-areas vs. model-council:** Both do code review. review-areas uses one model with parallel area-focused subagents. model-council sends the same review to GPT, Claude, and Gemini for consensus. Use review-areas daily; reach for model-council on high-stakes changes.
