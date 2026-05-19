---
description: Set, inspect, or control a durable goal — the agent keeps iterating across turns until the stop condition is met.
---

You are handling the `/goal` slash command. Invoke the **follow-goal** skill to do the actual work.

This command depends on the `memory` tool to persist goal state at `/memories/session/goal.md`. If the memory tool is not available, tell the user to enable it and stop — do not write the goal to the workspace.

Dispatch based on what the user typed after `/goal`:

- `/goal <objective text>` → **Set a new goal.** Follow the skill's "Set" flow: collect objective, verifiable stop condition, validation commands, and constraints (ask the user for anything missing), write `/memories/session/goal.md` with `status: active`, and start the loop.
- `/goal` (no extra args) → **Status only.** Read `/memories/session/goal.md` and report objective, stop condition, status, checkpoint count, and the last few progress-log lines. Do nothing else.
- `/goal pause` → Mark the goal `paused`. Stop iterating.
- `/goal resume` → Mark the goal `active` and continue the loop from the latest checkpoint.
- `/goal clear` → Mark the goal `cleared`. Leave the file in place for history.

Rules:

- If `/memories/session/goal.md` does not exist and the user typed something other than a new objective, tell them there is no active goal and show them the `/goal <objective>` syntax.
- If a goal is already `active` and the user sets a new one, ask whether to replace, pause, or clear the existing goal first.
- Never invent a stop condition the user didn't give you. If they can't articulate one, push back — a goal without a verifiable end state is not ready.
