import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import {
  extractEditInputs,
  isEditTool
} from './edit-tools.mts';

describe('isEditTool', () => {
  it('returns true for known edit tools', () => {
    strictEqual(isEditTool('replace_string_in_file'), true);
    strictEqual(isEditTool('multi_replace_string_in_file'), true);
    strictEqual(isEditTool('apply_patch'), true);
  });

  it('returns false for other tools', () => {
    strictEqual(isEditTool('read_file'), false);
    strictEqual(isEditTool(''), false);
  });
});

describe('extractEditInputs', () => {
  it('returns empty for null/undefined input', () => {
    deepStrictEqual(extractEditInputs('replace_string_in_file', null), []);
    deepStrictEqual(extractEditInputs('replace_string_in_file', undefined), []);
    deepStrictEqual(extractEditInputs('replace_string_in_file', 'string'), []);
  });

  it('returns empty for unknown tool', () => {
    deepStrictEqual(extractEditInputs('read_file', { filePath: '/a' }), []);
  });

  describe('replace_string_in_file', () => {
    it('extracts a single edit', () => {
      const input = {
        filePath: '/src/index.ts',
        oldString: 'foo',
        newString: 'bar',
      };
      deepStrictEqual(extractEditInputs('replace_string_in_file', input), [
        { type: 'string', filePath: '/src/index.ts', oldString: 'foo', newString: 'bar' },
      ]);
    });

    it('returns empty when filePath is missing', () => {
      deepStrictEqual(
        extractEditInputs('replace_string_in_file', { oldString: 'a', newString: 'b' }),
        [],
      );
    });

    it('defaults missing oldString/newString to empty string', () => {
      const result = extractEditInputs('replace_string_in_file', { filePath: '/f' });
      deepStrictEqual(result, [
        { type: 'string', filePath: '/f', oldString: '', newString: '' },
      ]);
    });
  });

  describe('multi_replace_string_in_file', () => {
    it('extracts multiple edits', () => {
      const input = {
        explanation: 'rename vars',
        replacements: [
          { filePath: '/a.ts', oldString: 'x', newString: 'y' },
          { filePath: '/b.ts', oldString: 'p', newString: 'q' },
        ],
      };
      deepStrictEqual(extractEditInputs('multi_replace_string_in_file', input), [
        { type: 'string', filePath: '/a.ts', oldString: 'x', newString: 'y' },
        { type: 'string', filePath: '/b.ts', oldString: 'p', newString: 'q' },
      ]);
    });

    it('returns empty when replacements is not an array', () => {
      deepStrictEqual(
        extractEditInputs('multi_replace_string_in_file', { replacements: 'bad' }),
        [],
      );
    });

    it('skips entries without filePath', () => {
      const input = {
        replacements: [
          { filePath: '/a.ts', oldString: 'x', newString: 'y' },
          { oldString: 'p', newString: 'q' },
        ],
      };
      deepStrictEqual(extractEditInputs('multi_replace_string_in_file', input), [
        { type: 'string', filePath: '/a.ts', oldString: 'x', newString: 'y' },
      ]);
    });
  });

  describe('apply_patch', () => {
    it('parses a single-file patch', () => {
      const patch = [
        '*** Begin Patch',
        '*** Update File: /src/index.ts',
        '@@ context line',
        '- old line',
        '+ new line',
        '*** End Patch',
      ].join('\n');
      const result = extractEditInputs('apply_patch', { input: patch });
      strictEqual(result.length, 1);
      strictEqual(result[0].type, 'patch');
      strictEqual(result[0].filePath, '/src/index.ts');
      strictEqual(result[0].oldString, ' old line');
      strictEqual(result[0].newString, ' new line');
    });

    it('parses a multi-file patch', () => {
      const patch = [
        '*** Begin Patch',
        '*** Update File: /a.ts',
        '@@ context',
        '- old',
        '+ new',
        '*** Add File: /b.ts',
        '+ content',
        '*** Delete File: /c.ts',
        '*** End Patch',
      ].join('\n');
      const result = extractEditInputs('apply_patch', { input: patch });
      strictEqual(result.length, 3);
      deepStrictEqual(
        result.map((e) => e.filePath),
        ['/a.ts', '/b.ts', '/c.ts'],
      );
      strictEqual((result[0] as any).oldString, ' old');
      strictEqual((result[0] as any).newString, ' new');
      strictEqual((result[1] as any).oldString, '');
      strictEqual((result[1] as any).newString, ' content');
      strictEqual((result[2] as any).oldString, '');
      strictEqual((result[2] as any).newString, '');
    });

    it('returns empty when input is not a string', () => {
      deepStrictEqual(extractEditInputs('apply_patch', { input: 123 }), []);
    });
  });
});
