// Offline mode (PRS_OFFLINE=1): a video is made without network, from what prs new downloaded before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardOffline, videoDir, writeJson } from '../cli/lib/common.mjs';
import { request } from '../cli/lib/github.mjs';
import { fileAtHead } from '../cli/lib/code.mjs';
import { newVideo } from '../cli/lib/fetch.mjs';

process.env.PRS_OFFLINE = '1';
guardOffline();

test('no network at all: what was not downloaded before fails at once, and so does any other request', async () => {
	const results = await Promise.allSettled([
		request('https://api.github.com/repos/contoso/example/pulls/7?never-downloaded'),
		fetch('https://example.com/'),
	]);
	assert.deepStrictEqual(results.map(r => r.reason?.message), [
		'Offline (PRS_OFFLINE): https://api.github.com/repos/contoso/example/pulls/7?never-downloaded was not downloaded before this run',
		'Offline (PRS_OFFLINE): no network for https://example.com/',
	]);
});

test('prs new continues from what was downloaded before, and only the saved files can be shown', async () => {
	const facts = { repo: 'contoso/example', number: 7, title: 'An example', headSha: 'f'.repeat(40), headSha9: 'f'.repeat(9), files: [{ path: 'src/a.ts', status: 'modified' }] };
	const dir = videoDir('contoso-example-7');
	fs.rmSync(dir, { recursive: true, force: true });
	try {
		const before = await newVideo('contoso/example#7').catch(error => error.message);
		writeJson(path.join(dir, 'pr.json'), { facts, body: '', symbols: [], tests: [], tier: { name: 'small' } });
		const saved = path.join(dir, 'build', 'src', facts.headSha9, 'src', 'a.ts');
		fs.mkdirSync(path.dirname(saved), { recursive: true });
		fs.writeFileSync(saved, 'export const a = 1;\n');
		const after = await newVideo('https://github.com/contoso/example/pull/7');
		let other;
		try {
			fileAtHead('contoso-example-7', facts, 'src/other.ts');
		} catch (error) {
			other = error.message;
		}
		assert.deepStrictEqual({ before, reused: after.reused, title: after.data.facts.title, saved: fileAtHead('contoso-example-7', facts, 'src/a.ts'), other }, {
			before: 'Offline (PRS_OFFLINE): contoso/example#7 was not downloaded before this run (prs new needs the network once)',
			reused: true,
			title: 'An example',
			saved: 'export const a = 1;\n',
			other: 'src/other.ts is not available offline: only the files this PR changes were downloaded before this run (videos/contoso-example-7/build/src/fffffffff/). Show one of those instead.',
		});
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
