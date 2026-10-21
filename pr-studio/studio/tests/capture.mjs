// The capture kit's element suggestions, and how prs app finds the first Insiders build with a merge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closest } from '../capture/kit.mjs';
import { boundary } from '../cli/lib/app.mjs';

test('a missed element is answered with the closest ones the window has', () => {
	const snapshot = ['- toolbar "Editor actions":', '  - button "Toggle Files"', '  - button "Next Change"', '- tree "Files":', '  - treeitem "routes.ts src"', '- tab "Explorer (⇧⌘E)"'].join('\n');
	assert.deepEqual({ toggle: closest(snapshot, 'Toggle File List'), file: closest(snapshot, 'routes.ts', 1) }, { toggle: ['button "Toggle Files"', 'tree "Files"'], file: ['treeitem "routes.ts src"'] });
});

test('the first build with the merge is found in a few comparisons; no build or every build is reported as such', async () => {
	const builds = Array.from({ length: 200 }, (_, i) => `b${199 - i}`); // newest first
	let calls = 0;
	const since = n => async build => (calls++, Number(build.slice(1)) >= n);
	const found = await boundary(builds, since(120));
	assert.deepEqual({
		found, calls,
		none: await boundary(builds, since(500)),
		all: await boundary(builds, since(0)),
	}, { found: { after: 'b120', before: 'b119' }, calls: 10, none: { after: null, before: 'b199' }, all: { after: 'b0', before: null } });
});

test('footage with marks: each action plays at its cue at real speed; the frame before the next action holds, or idle time is cut', async () => {
	const { footageTime } = await import('../catalog/ui.js');
	// Marked at 2 s and 5 s of the recording; cued at 10 s and 15 s of the video (a hold), then at 10 s and 11 s (a cut).
	const hold = [{ T: 10, r: 2 }, { T: 15, r: 5 }];
	const cut = [{ T: 10, r: 2 }, { T: 11, r: 5 }];
	const at = (a, ts) => ts.map(t => +footageTime(a, t).toFixed(3));
	assert.deepEqual({
		hold: at(hold, [7, 9, 10, 12, 13.5, 14.9, 15, 16]),
		cut: at(cut, [10, 10.5, 11, 12]),
	}, {
		// Before the first cue it leads in at 1x from the recording's start, holding frame 0 earlier on.
		hold: [0, 1, 2, 4, 4.967, 4.967, 5, 6],
		cut: [2, 2.5, 5, 6],
	});
});

test('a marked action that the narration gives too little time is reported, and so are marks out of order', async () => {
	const { marksFit } = await import('../cli/lib/prepare.mjs');
	const timed = { start: 10, cues: { toggle: 11, click: 11.6, scroll: 15 } };
	assert.deepEqual(marksFit('demo', 'after', { toggle: 'toggle', click: 'click', scroll: 'scroll' }, { toggle: 2, click: 4.2, scroll: 7 }, timed).map(w => w.replace(/: .*/, '')), ['demo.after']);
	assert.deepEqual(marksFit('demo', 'after', { toggle: 'scroll', click: 'toggle' }, { toggle: 2, click: 4 }, timed).length, 1);
	assert.deepEqual(marksFit('demo', 'after', { toggle: 'toggle', scroll: 'scroll' }, { toggle: 2, scroll: 5 }, timed), []);
});
