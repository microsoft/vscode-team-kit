import { basename, win32 } from 'node:path';
import { extractEditInputs, parseToolEvent } from '../../common/edit-tools.mts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { toolName, toolArgs } = parseToolEvent(input);
const edits = extractEditInputs(toolName, toolArgs);
const isPlan = edits.some(edit =>
  (basename(edit.filePath) === 'plan.md' || win32.basename(edit.filePath) === 'plan.md')
  && edit.newString.length > 0);

process.stdout.write(JSON.stringify(isPlan ? {
  additionalContext:
    "Unless the plan is trivial, you MUST now use the 'review-plan' skill to review the plan before presenting it to the user to ensure its feasibility and completeness.",
} : {}));
