/**
 * Hook: remind-goal-progress
 *
 * Fires after the memory tool writes /memories/session/goal.md.
 * Injects a reminder telling the agent that an active goal exists and
 * the follow-goal loop discipline applies (check stop condition, log
 * checkpoints, respect max_checkpoints).
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

let event: { tool_name: string; tool_input?: { command?: string; path?: string } };
try {
  event = JSON.parse(input);
} catch {
  process.exit(0);
}

const { tool_name, tool_input = {} } = event;

if (tool_name !== 'memory') process.exit(0);

const { command, path } = tool_input;

const isWrite = command === 'create' || command === 'str_replace' || command === 'insert';
if (!isWrite) process.exit(0);

const isGoalFile = typeof path === 'string' && (path === 'goal.md' || path.endsWith('/goal.md'));
if (!isGoalFile) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `An active goal is recorded in /memories/session/goal.md. You MUST follow the 'follow-goal' skill's loop discipline: re-read the goal, run the validation commands, check the stop condition, append a checkpoint to the Progress Log, and increment 'checkpoints' in the frontmatter. Stop and ask the user when 'checkpoints' reaches 'max_checkpoints', when validation fails repeatedly, or when continuing would breach a Constraint.`,
    },
  }),
);
