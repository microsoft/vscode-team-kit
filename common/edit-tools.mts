/**
 * Describes the built-in file-editing tools and provides helpers for
 * pre-tool-use hooks to introspect their inputs.
 *
 * Usage in a hook script:
 *
 *   import { extractEditInputs } from '<team-kit>/common/edit-tools.mts';
 *
 *   const event = JSON.parse(await readStdin());
 *   const edits = extractEditInputs(event.tool_name, event.tool_input);
 *   // edits is an array of { filePath, oldString, newString } (or patches)
 */

// ---------------------------------------------------------------------------
// Tool names
// ---------------------------------------------------------------------------

export const EDIT_TOOL_NAMES = [
  'replace_string_in_file',
  'multi_replace_string_in_file',
  'apply_patch',
] as const;

export type EditToolName = (typeof EDIT_TOOL_NAMES)[number];

export function isEditTool(toolName: string): toolName is EditToolName {
  return (EDIT_TOOL_NAMES as readonly string[]).includes(toolName);
}

// ---------------------------------------------------------------------------
// Tool input shapes (as provided in tool_input on stdin)
// ---------------------------------------------------------------------------

export interface ReplaceStringInput {
  filePath: string;
  oldString: string;
  newString: string;
  explanation?: string;
}

export interface MultiReplaceStringInput {
  explanation?: string;
  replacements: ReplaceStringInput[];
}

export interface ApplyPatchInput {
  input: string;
  explanation?: string;
}

// ---------------------------------------------------------------------------
// Normalised output
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// V4A patch parser (extracts per-file entries)
// ---------------------------------------------------------------------------

const FILE_HEADER_RE =
  /^\*{3}\s+(?:Add|Update|Delete)\s+File:\s+(.+)$/;

function parsePatchFiles(patch: string): PatchEdit[] {
  const lines = patch.split('\n');
  const edits: PatchEdit[] = [];
  let currentFile: string | undefined;
  let currentLines: string[] = [];

  function flush() {
    if (currentFile !== undefined) {
      const removed: string[] = [];
      const added: string[] = [];
      for (const l of currentLines) {
        if (l.startsWith('-')) {
          removed.push(l.slice(1));
        } else if (l.startsWith('+')) {
          added.push(l.slice(1));
        }
      }
      edits.push({
        type: 'patch',
        filePath: currentFile,
        patch: currentLines.join('\n'),
        oldString: removed.join('\n'),
        newString: added.join('\n'),
      });
    }
  }

  for (const line of lines) {
    const m = FILE_HEADER_RE.exec(line);
    if (m) {
      flush();
      currentFile = m[1].trim();
      currentLines = [line];
    } else if (currentFile !== undefined) {
      currentLines.push(line);
    }
  }
  flush();
  return edits;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Given a tool name and its raw input object (from `event.tool_input`),
 * returns a normalised array of edits the tool will perform.
 *
 * Returns an empty array if the tool is not a recognised edit tool.
 */
export function extractEditInputs(
  toolName: string,
  toolInput: unknown,
): EditInput[] {
  if (!toolInput || typeof toolInput !== 'object') {
    return [];
  }

  switch (toolName) {
    case 'replace_string_in_file': {
      const input = toolInput as ReplaceStringInput;
      if (!input.filePath) return [];
      return [
        {
          type: 'string',
          filePath: input.filePath,
          oldString: input.oldString ?? '',
          newString: input.newString ?? '',
        },
      ];
    }

    case 'multi_replace_string_in_file': {
      const input = toolInput as MultiReplaceStringInput;
      if (!Array.isArray(input.replacements)) return [];
      return input.replacements
        .filter((r) => r.filePath)
        .map((r) => ({
          type: 'string' as const,
          filePath: r.filePath,
          oldString: r.oldString ?? '',
          newString: r.newString ?? '',
        }));
    }

    case 'apply_patch': {
      const input = toolInput as ApplyPatchInput;
      if (typeof input.input !== 'string') return [];
      return parsePatchFiles(input.input);
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Convenience: collect unique file paths from edits
// ---------------------------------------------------------------------------

export function editedFilePaths(edits: EditInput[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of edits) {
    if (!seen.has(e.filePath)) {
      seen.add(e.filePath);
      result.push(e.filePath);
    }
  }
  return result;
}
