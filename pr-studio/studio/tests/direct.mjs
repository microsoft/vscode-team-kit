// prs direct: the scenes.js it scaffolds has to load, whichever treatments it picks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { direct } from '../cli/lib/direct.mjs';
import { videoDir } from '../cli/lib/common.mjs';

test('a scaffold with a code treatment loads: the code() helper and the code treatments do not clash', async () => {
	const slug = '_test-direct';
	const dir = videoDir(slug);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	try {
		fs.writeFileSync(path.join(dir, 'storyboard.json'), JSON.stringify({
			pr: { repo: 'contoso/example', number: 1 },
			beats: [
				{ id: 'title', need: 'title', say: 'Title.', cues: {}, claims: [] },
				{ id: 'change', need: 'code', say: 'The change.', cues: {}, claims: [] },
			],
		}));
		await direct(slug, { use: 'change=code.diff', reason: 'test', motion: 'slides' });
		const source = fs.readFileSync(path.join(dir, 'scenes.js'), 'utf8');
		const loads = await esbuild.transform(source, { format: 'esm', loader: 'js' }).then(() => 'loads', error => error.errors.map(e => e.text).join('; '));
		assert.deepStrictEqual({ loads, change: source.match(/"change": ([\w.]+)\(/)?.[1] }, { loads: 'loads', change: 'codeSlides.diff' });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
