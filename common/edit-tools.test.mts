import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';
import { editedFilePaths, extractEditInputs, isEditTool, parseToolEvent } from './edit-tools.mts';

describe('native Copilot tool events', () => {
  it('reads camelCase arguments and the execution directory', () => {
    deepStrictEqual(parseToolEvent(JSON.stringify({
      toolName: 'edit', toolArgs: { path: 'src/index.ts' }, cwd: '/workspace',
    })), { toolName: 'edit', toolArgs: { path: 'src/index.ts' }, cwd: '/workspace' });
  });

  it('rejects Local events and malformed payloads explicitly', () => {
    for (const input of [
      'not-json', '{}', 'null', '[]',
      '{"tool_name":"edit","tool_input":{},"cwd":"/workspace"}',
      '{"toolName":"edit","toolArgs":null,"cwd":"/workspace"}',
      '{"toolName":"edit","toolArgs":[],"cwd":"/workspace"}',
      '{"toolName":"edit","toolArgs":"{}","cwd":"/workspace"}',
      '{"toolName":"edit","toolArgs":{}}',
    ]) throws(() => parseToolEvent(input));
  });
});

describe('native Copilot file edits', () => {
  it('recognizes native tools, not Local or Claude aliases', () => {
    for (const tool of ['create', 'edit', 'apply_patch']) strictEqual(isEditTool(tool), true);
    for (const tool of ['create_file', 'replace_string_in_file', 'multi_replace_string_in_file', 'Edit', 'Write', 'view']) {
      strictEqual(isEditTool(tool), false);
      deepStrictEqual(extractEditInputs(tool, {}), []);
    }
  });

  it('extracts create and edit text including intentional empty strings', () => {
    deepStrictEqual(extractEditInputs('create', { path: '/new.ts', file_text: 'const x = 1;' }), [
      { type: 'string', filePath: '/new.ts', oldString: '', newString: 'const x = 1;' },
    ]);
    deepStrictEqual(extractEditInputs('edit', { path: '/old.ts', old_str: 'old', new_str: '' }), [
      { type: 'string', filePath: '/old.ts', oldString: 'old', newString: '' },
    ]);
  });

  it('rejects malformed supported edits rather than skipping enforcement', () => {
    for (const input of [undefined, null, 'string', [], {}, { path: '' }, { path: 5 }, { path: '/f', file_text: 5 }]) {
      throws(() => extractEditInputs('create', input));
    }
    throws(() => extractEditInputs('edit', { path: '/f', new_str: 'text' }));
    throws(() => extractEditInputs('edit', { path: '/f', old_str: 'text' }));
    throws(() => extractEditInputs('apply_patch', { input: 5 }));
    throws(() => extractEditInputs('apply_patch', { input: 'not a patch' }));
  });

  it('extracts every file in a native patch', () => {
    const patch = [
      '*** Begin Patch', '*** Update File: /a.ts', '@@',
      '-old', '+new', '*** Add File: /b.ts', '+content',
      '*** Delete File: /c.ts', '*** End Patch',
    ].join('\n');
    const edits = extractEditInputs('apply_patch', { input: patch });
    deepStrictEqual(edits.map(({ filePath, oldString, newString }) => ({ filePath, oldString, newString })), [
      { filePath: '/a.ts', oldString: 'old', newString: 'new' },
      { filePath: '/b.ts', oldString: '', newString: 'content' },
      { filePath: '/c.ts', oldString: '', newString: '' },
    ]);
    deepStrictEqual(editedFilePaths([...edits, edits[0]]), ['/a.ts', '/b.ts', '/c.ts']);
  });
});
