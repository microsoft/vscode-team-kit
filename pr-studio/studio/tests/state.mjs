// Outside the repository (PRS_HOME set, or a copy the plugin installed), the history lives in the state folder: one
// entry per video (the newest wins), outlasting updates of the engine copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('the history lives in PRS_HOME and keeps one entry per video', async () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-home-'));
	process.env.PRS_HOME = home;
	try {
		const { HISTORY, addToHistory, readHistory, mergeHistory } = await import('../cli/lib/history.mjs');
		addToHistory({ slug: 'a', date: '2026-10-01', treatments: {} });
		addToHistory({ slug: 'b', date: '2026-10-02', treatments: {} });
		addToHistory({ slug: 'a', date: '2026-10-03', treatments: {} });
		assert.deepEqual({
			file: path.relative(home, HISTORY),
			slugs: readHistory().map(e => e.slug),
			merged: mergeHistory([{ slug: 'x', date: '1' }], [{ slug: 'x', date: '2' }]).map(e => e.date),
		}, { file: 'history.jsonl', slugs: ['b', 'a'], merged: ['2'] });
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});
