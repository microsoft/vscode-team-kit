---
name: goal
description: "Set, inspect, or control a durable goal — the agent keeps iterating across turns until the stop condition is met."
argument-hint: Set a new objective (verifiable stop condition, validation commands, and constraints)
disable-model-invocation: true
---

You are handling the `/goal` command. Invoke the **follow-goal** skill to do the actual work.

Persist goal state into session storage as `goal.md`. Do not write the goal to the workspace.

Dispatch based on what the user typed after `/goal`:

- `/goal <objective text>` → **Set a new goal.** Follow the skill's "Set" flow: collect objective, verifiable stop condition, validation commands, and constraints (ask the user for anything missing), write `goal.md` with `status: active`, and start the loop.
- `/goal` (no extra args) → **Status only.** Read `goal.md` and report objective, stop condition, status, checkpoint count, and the last few progress-log lines. Do nothing else.
- `/goal pause` → Mark the goal `paused`. Stop iterating.
- `/goal resume` → Mark the goal `active` and continue the loop from the latest checkpoint.
- `/goal clear` → Mark the goal `cleared`. Leave the file in place for history.

Rules:

- If `goal.md` does not exist in session storage and the user typed something other than a new objective, tell them there is no active goal and show them the `/goal <objective>` syntax.
- If a goal is already `active` and the user sets a new one, ask whether to replace, pause, or clear the existing goal first.
- Never invent a stop condition the user didn't give you. If they can't articulate one, push back — a goal without a verifiable end state is not ready.
