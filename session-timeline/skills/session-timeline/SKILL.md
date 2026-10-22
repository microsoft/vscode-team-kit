---
name: session-timeline
description: 'Open a live timeline canvas for the current Copilot session. Use when asked to inspect session events, system prompts, reasoning, tool executions, or subagent activity in a session timeline.'
---

# Session timeline

1. Inspect the capabilities of canvas `vscode-session-timeline`.
2. Open it with instance ID `session-timeline` and no input. Reuse that instance when asked to show it again.
3. Use `setFilter` to change the search text or visible categories when requested. Categories are `system`, `user`, `assistant`, `tool`, and `subagent`. An empty category list intentionally shows no events.
4. Use `refresh` to reload SDK history, or `getStatus` to inspect counts and loading errors.

The canvas reads the joined session through the Copilot SDK, not a VS Code session directory. It updates automatically; do not repeatedly call refresh. Expanding an event shows its readable details and original SDK records. The user can download the SDK events as JSONL with **Export events**.

System-prompt tool guidance describes prompt text, not an authoritative inventory of tools offered to the model. Reasoning and other optional fields are available only when the runtime emits them. History does not recover past ephemeral streaming events.

If the canvas is unavailable, report that this plugin requires a Copilot host with canvas extensions enabled. Do not substitute a guessed filesystem path or install another copy of the extension.
