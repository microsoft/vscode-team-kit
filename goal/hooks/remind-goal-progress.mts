/**
 * Hook: remind-goal-progress
 *
 * Fires after a write to goal.md in session storage.
 * Supports both:
 *   - VS Code `memory` tool (command + path fields)
 *   - CLI edit tools (create/edit with `path`, or create_file/replace_string_in_file with `filePath`)
 *
 * Injects a reminder that an active goal exists and the follow-goal loop
 * discipline applies (check stop condition, log checkpoints, respect
 * max_checkpoints).
 */

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

if (tool_name === 'memory') {
  // VS Code memory tool: { command: "create"|"str_replace"|"insert", path: "goal.md" }
  const { command, path } = tool_input as { command?: string; path?: string };
  const isWrite = command === 'create' || command === 'str_replace' || command === 'insert';
  targetsGoal = isWrite && isGoalPath(path);
} else {
  // CLI tools use `path` (create, edit) or `filePath` (create_file, replace_string_in_file)
  const targetPath = (tool_input.path ?? tool_input.filePath) as string | undefined;
  if (targetPath) {
    targetsGoal = isGoalPath(targetPath);
  } else if (tool_name === 'multi_replace_string_in_file') {
    const replacements = tool_input.replacements as Array<{ filePath?: string }> | undefined;
    targetsGoal = Array.isArray(replacements) && replacements.some((r) => isGoalPath(r.filePath));
  } else if (tool_name === 'apply_patch') {
    const patchInput = tool_input.input as string | undefined;
    targetsGoal = typeof patchInput === 'string' && /goal\.md/.test(patchInput);
  }
}

if (!targetsGoal) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `An active goal is recorded in session storage as goal.md. You MUST follow the 'follow-goal' skill's loop discipline: re-read the goal, run the validation commands, check the stop condition, append a checkpoint to the Progress Log, and increment 'checkpoints' in the frontmatter. Stop and ask the user when 'checkpoints' reaches 'max_checkpoints', when validation fails repeatedly, or when continuing would breach a Constraint.`,
    },
  }),
);
