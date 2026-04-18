# VS Code Team Kit

A collection of useful [agent plugins](https://github.com/anthropics/open-plugin) the VS Code team uses for day-to-day development workflows.

## Installation

1. In VS Code, run **Chat: Install Plugin from Source**
2. Enter `microsoft/vscode-team-kit`
3. Then pick the plugin you'd like to install.

## Plugins

| Plugin | Description |
|---|---|
| [handy-commands](handy-commands/) | Helpful slash commands for common development workflows (`/pr-comments`, …) |
| [ban-ast](ban-ast/) | Ban code patterns via Tree Sitter AST queries — rejects edits unless justified |
| [component-explorer](component-explorer/) | Set up and use the VS Code Component Explorer for fixture-based visual testing with MCP-powered screenshots |
| [model-council](model-council/) | Multi-model council for code review and planning — model-pinned agents independently review or plan, then synthesize by consensus |
| [review-areas](review-areas/) | Area-focused code review — fans out parallel subagents across correctness, tests, security, performance, and product |
| [review-plan](review-plan/) | Review implementation plans before coding — fans out subagents across completeness, feasibility, sequencing, scope, and risk |
| [monitor-pr](monitor-pr/) | Monitor a pull request until CI finishes and Copilot's review arrives — via non-polling async terminal scripts |
| [github-inbox](github-inbox/) | Triage and act on your GitHub notifications — smart grouping, rules, memory, and sub-agents for review, triage, and investigation |

## Contributing

If you're a VS Code team member and have a flow you use across multiple repositories, please contribute it! If you have groups of flows that are opinionated, consider making a new plugin rather than adding it to an existing plugin so that developers can opt-in to enabling it.

This repository is of course set up for AI contributions, so you should be able to tell Copilot what to do, and it'll happen.
