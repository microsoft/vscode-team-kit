import { strictEqual, match } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

test('dependency installation cannot corrupt command-hook JSON stdout', {
  skip: process.platform === 'win32' ? 'POSIX npm fixture' : false,
}, t => {
  const directory = mkdtempSync(join(tmpdir(), 'team-kit-install-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'common'));
  mkdirSync(join(directory, 'bin'));
  writeFileSync(join(directory, 'package.json'), '{"private":true}');
  copyFileSync(new URL('./install-if-necessary.mts', import.meta.url), join(directory, 'common/install.mts'));
  writeFileSync(join(directory, 'bin/npm'), '#!/bin/sh\nmkdir node_modules\nprintf "install progress\\n"\n', { mode: 0o755 });
  const script = pathToFileURL(join(directory, 'common/install.mts')).href;
  const result = spawnSync(process.execPath, [
    '--input-type=module', '-e',
    `import install from ${JSON.stringify(script)}; await install(); process.stdout.write('{"ready":true}');`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(directory, 'bin')}${delimiter}${process.env.PATH ?? ''}` },
  });
  strictEqual(result.status, 0, result.stderr);
  strictEqual(result.stdout, '{"ready":true}');
  match(result.stderr, /install progress/);
});
