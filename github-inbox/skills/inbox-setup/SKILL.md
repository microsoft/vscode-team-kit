---
name: inbox-setup
description: Set up the Inbox agent with recommended VS Code settings and gh CLI configuration
tools:
  - execute
  - bash
  - vscode
  - agent
  - memory
  - askQuestions
  - ask_user
---

# Inbox Agent Setup

Before running any setup steps, use `#askQuestions` to ask: "Some required settings are missing for the Inbox agent. Would you like me to configure them automatically?" with choices "Yes, set up now" and "Skip for now".

If the user skips, stop and let them proceed without setup.

## Step 1: Check gh CLI

```
gh --version
```

If not installed, see the `inbox-install-gh-cli` skill.

## Step 2: Configure VS Code settings

1. Ask the user for their VS Code settings.json path if needed, or check common locations (`~/Library/Application Support/Code/User/settings.json` on macOS, `~/.config/Code/User/settings.json` on Linux, `%APPDATA%\Code\User\settings.json` on Windows)
2. Read settings using the `read` tool
3. Check which of the required settings below are missing
4. If ALL required settings are already present with correct values, skip this step
5. If any are missing, use VS Code's `editFile` tool to insert ONLY the missing keys into the user's settings.json. This is safer than terminal writes for JSON files.

**CRITICAL:** `settings.json` contains the user's entire VS Code configuration. You MUST NOT remove any existing content. Only ADD the specific missing keys. If `chat.tools.terminal.autoApprove` already exists with some rules, merge the new rules into the existing object — don't replace it.

Required settings to add if missing:

```json
{
  "chat.customAgentInSubagent.enabled": true,
  "github.copilot.chat.githubMcpServer.enabled": true,
  "chat.tools.terminal.enableAutoApprove": true,
  "chat.tools.terminal.autoApprove": {
    "/^gh api (?!.*--method (PATCH|PUT|POST|DELETE))/": true,
    "/^gh search /": true,
    "gh issue view": true,
    "gh pr view": true,
    "gh --version": true,
    "gh config set": true
  }
}
```

Tell the user what was added and why:
- **`chat.customAgentInSubagent.enabled`** — Required. Enables sub-agent delegation (reviewer, triager, memory, investigator).
- **`github.copilot.chat.githubMcpServer.enabled`** — Enables richer features: PR reviews, comments, labels, assignees.
- **`chat.tools.terminal.enableAutoApprove`** + **`chat.tools.terminal.autoApprove`** — Auto-approves read-only `gh` commands.

## Step 3: Enable auto-approve

After updating settings, tell the user:

"✅ Settings updated! One last step — I need to enable auto-approve so read-only commands don't prompt you every time.

👉 When you see the **'Run command?'** prompt below, click the **Allow ▾** dropdown and select **'Enable Auto Approve'**.

This is a one-time opt-in. After this, read-only `gh` commands will run automatically."

Then run:

```
gh api /notifications --jq 'length'
```

This command matches the auto-approve rules. Wait for the user to click "Enable Auto Approve" before proceeding.

## Step 4: Verify GitHub MCP server

Check if the GitHub MCP server is running. If `github.copilot.chat.githubMcpServer.enabled` was just added, tell the user:

"Make sure the GitHub MCP server is started and running. This gives you access to richer features like PR reviews, comments, and labels."

## Step 5: Save setup status

After setup is complete, save to memory that setup has been completed:

Use the `inbox-memory` skill to save setup status:

Write to memory: `"# Inbox Memory\n\n## Setup State\n- Setup completed on <date>\n- All required VS Code settings are present and verified\n"`

If the memory file already exists, use `delete` first, then `create` with the merged content.
