/**
 * Hook: remind-plan-review
 *
 * Fires after the memory tool writes a plan.md file.
 * Injects a reminder into the conversation to run the review-plan skill
 * before proceeding to implementation.
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

// Only fire on the memory tool
if (tool_name !== 'memory') process.exit(0);

const { command, path } = tool_input;

// Only fire on write operations
const isWrite = command === 'create' || command === 'str_replace' || command === 'insert';
if (!isWrite) process.exit(0);

// Only fire when the target path is a plan.md file
const isPlanMd = typeof path === 'string' && (path === 'plan.md' || path.endsWith('/plan.md'));
if (!isPlanMd) process.exit(0);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        `Unless the plan is trivial, you MUST now use the 'review-plan' skill to review the plan before presenting it to the user to ensure its feasibility and completeness.`,
    },
  }),
);
