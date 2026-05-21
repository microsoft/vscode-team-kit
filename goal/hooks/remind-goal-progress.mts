/**
 * Hook: remind-goal-progress (PostToolUse)
 *
 * Fires after a write to goal.md in session storage.
 * Branches on the goal state detected in the written content:
 *   - status: active (under budget) → emit "keep going" reminder
 *   - status: done|cleared|paused  → emit STOP instruction
 *   - checkpoints >= max_checkpoints → emit budget-exhausted STOP
 *
 * Supports both:
 *   - VS Code `memory` tool (command + path fields)
 *   - CLI edit tools (create_file, replace_string_in_file, multi_replace_string_in_file, apply_patch)
 *   - Copilot CLI tools (create, edit)
 */

import { extractEditInputs, isEditTool } from '../../common/edit-tools.mts';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

const input = await readStdin();

let event: { tool_name: string; tool_input?: Record<string, unknown> };
try {
  event = JSON.parse(input);
} catch {
  process.exit(0);
}

const { tool_name, tool_input = {} } = event;

// --- Detect whether this write targets goal.md ---

function isGoalPath(p: unknown): boolean {
  return typeof p === 'string' && (p === 'goal.md' || p.endsWith('/goal.md'));
}

let targetsGoal = false;
let writtenContent = '';

if (tool_name === 'memory') {
  const { command, path, file_text, new_str, insert_text } = tool_input as {
    command?: string;
    path?: string;
    file_text?: string;
    new_str?: string;
    insert_text?: string;
  };
  const isWrite = command === 'create' || command === 'str_replace' || command === 'insert';
  targetsGoal = isWrite && isGoalPath(path);
  if (targetsGoal) {
    if (command === 'create') writtenContent = file_text ?? '';
    else if (command === 'str_replace') writtenContent = new_str ?? '';
    else if (command === 'insert') writtenContent = insert_text ?? '';
  }
} else if (isEditTool(tool_name)) {
  const edits = extractEditInputs(tool_name, tool_input);
  for (const edit of edits) {
    if (isGoalPath(edit.filePath)) {
      targetsGoal = true;
      writtenContent = edit.newString;
      break;
    }
  }
}

if (!targetsGoal) process.exit(0);

// --- Determine goal state from written content ---

const statusMatch = writtenContent.match(/status:\s*(done|cleared|paused|active)/);
const status = statusMatch?.[1] ?? 'active';

const checkpointsMatch = writtenContent.match(/checkpoints:\s*(\d+)/);
const maxCheckpointsMatch = writtenContent.match(/max_checkpoints:\s*(\d+)/);
const checkpoints = checkpointsMatch ? parseInt(checkpointsMatch[1], 10) : -1;
const maxCheckpoints = maxCheckpointsMatch ? parseInt(maxCheckpointsMatch[1], 10) : -1;

// --- Branch output based on state ---

let additionalContext: string;

if (status === 'done') {
  additionalContext =
    'The goal status is now "done". The stop condition has been met. STOP iterating — report success to the user and call task_complete. Do not take further actions toward this goal.';
} else if (status === 'cleared') {
  additionalContext =
    'The goal has been cleared. STOP iterating — the goal is no longer active. Do not take further actions.';
} else if (status === 'paused') {
  additionalContext =
    'The goal is now paused. STOP iterating until the user resumes with `/goal resume`.';
} else if (checkpoints >= 0 && maxCheckpoints >= 0 && checkpoints >= maxCheckpoints) {
  additionalContext =
    `Checkpoint budget exhausted (${checkpoints}/${maxCheckpoints}). You MUST stop iterating immediately. Report current progress to the user and ask how to proceed (increase budget, adjust approach, or clear the goal).`;
} else {
  additionalContext =
    'An active goal is recorded in session storage as goal.md. You MUST follow the \'follow-goal\' skill\'s loop discipline: re-read the goal, run the validation commands, check the stop condition, append a checkpoint to the Progress Log, and increment \'checkpoints\' in the frontmatter. Stop and ask the user when \'checkpoints\' reaches \'max_checkpoints\', when validation fails repeatedly, or when continuing would breach a Constraint.';
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext,
    },
  }),
);
