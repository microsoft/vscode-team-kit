# github-inbox

Triage GitHub notifications with smart grouping, rules, memory, and agents for review and investigation.

## Skills and agents

The [Inbox agent](com.github.copilot/agents/inbox.agent.md) coordinates triage and delegates to investigator, reviewer, summarizer, memory, project-board, and triager agents.

## How it works

Open the Inbox agent to group notifications by repository, inspect the relevant issues and pull requests, and apply your triage rules. Its specialist agents handle individual notifications without mixing their context into the main triage conversation.

## Plugin structure

```text
github-inbox/
├── plugin.json
├── CHANGELOG.md
├── README.md
├── com.github.copilot/
│   └── agents/
│       ├── inbox.agent.md
│       ├── inbox-investigator.agent.md
│       ├── inbox-memory.agent.md
│       ├── inbox-project-board.agent.md
│       ├── inbox-reviewer.agent.md
│       ├── inbox-summarizer.agent.md
│       └── inbox-triager.agent.md
└── skills/
```
