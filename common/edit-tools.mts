/**
 * Normalize native Copilot tool events and file edits for command hooks.
 * See https://docs.github.com/en/copilot/reference/hooks-reference.
 */
export const EDIT_TOOL_NAMES = ['create', 'edit', 'apply_patch'] as const;
export type EditToolName = (typeof EDIT_TOOL_NAMES)[number];

export function isEditTool(toolName: string): toolName is EditToolName {
  return (EDIT_TOOL_NAMES as readonly string[]).includes(toolName);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseToolEvent(input: string): {
  toolName: string;
  toolArgs: Record<string, unknown>;
  cwd: string;
} {
  const event: unknown = JSON.parse(input);
  if (!isObject(event) || typeof event.toolName !== 'string' || !event.toolName
    || !isObject(event.toolArgs) || typeof event.cwd !== 'string' || !event.cwd) {
    throw new Error('Expected a Copilot tool event with toolName, object toolArgs, and cwd.');
  }
  return { toolName: event.toolName, toolArgs: event.toolArgs, cwd: event.cwd };
}

export interface StringEdit {
  type: 'string';
  filePath: string;
  oldString: string;
  newString: string;
}

export interface PatchEdit {
  type: 'patch';
  filePath: string;
  patch: string;
  oldString: string;
  newString: string;
}

export type EditInput = StringEdit | PatchEdit;

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected edit argument "${key}" to be a string.`);
  }
  return value;
}

function parsePatchFiles(patch: string): PatchEdit[] {
  const edits: PatchEdit[] = [];
  let current: PatchEdit | undefined;
  for (const line of patch.split('\n')) {
    const header = /^\*{3} (?:Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      current = {
        type: 'patch', filePath: header[1].trim(), patch: line,
        oldString: '', newString: '',
      };
      edits.push(current);
    } else if (current) {
      current.patch += `\n${line}`;
      if (line.startsWith('-')) current.oldString += `${line.slice(1)}\n`;
      if (line.startsWith('+')) current.newString += `${line.slice(1)}\n`;
    }
  }
  for (const edit of edits) {
    edit.oldString = edit.oldString.replace(/\n$/, '');
    edit.newString = edit.newString.replace(/\n$/, '');
  }
  if (edits.length === 0) throw new Error('Expected apply_patch input to contain file headers.');
  return edits;
}

/** Unknown tools are ignored; malformed arguments for supported edits fail explicitly. */
export function extractEditInputs(toolName: string, toolInput: unknown): EditInput[] {
  if (!isEditTool(toolName)) return [];
  if (!isObject(toolInput)) throw new Error(`Expected object arguments for ${toolName}.`);
  if (toolName === 'apply_patch') {
    return parsePatchFiles(requiredString(toolInput, 'input'));
  }
  const filePath = requiredString(toolInput, 'path');
  if (!filePath.trim()) throw new Error('Expected a nonempty edit path.');
  return [{
    type: 'string',
    filePath,
    oldString: toolName === 'edit' ? requiredString(toolInput, 'old_str') : '',
    newString: requiredString(toolInput, toolName === 'edit' ? 'new_str' : 'file_text'),
  }];
}

export function editedFilePaths(edits: EditInput[]): string[] {
  return [...new Set(edits.map(edit => edit.filePath))];
}
