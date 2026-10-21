// The timing checks of prs lint (what reviewers kept catching), and a beat's hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { timingProblems } from '../cli/lib/lint.mjs';
import { estimateTimeline } from '../cli/lib/timeline.mjs';

const words = list => list.map(([display, a]) => ({ display, a, b: a + 0.3 }));

/** Frames every quarter second: each element is [id, text, from, until]. */
function framesOf(beat, elements, body = 0) {
	const out = [];
	for (let t = 0; t < 14; t += 0.25) {
		out.push({ t, beats: { [beat]: { body: t >= body, texts: elements.filter(([, , from, until]) => t >= from && t < (until ?? 99)).map(([id, text]) => [id, text]) } } });
	}
	return out;
}

test('lint times what is on screen: text read too briefly is a problem; a named element shown late, or a bare heading, a warning', () => {
	const project = {
		video: { endAt: 13 },
		beats: [
			{ id: 'how', need: 'flow', start: 0, end: 8, words: words([['The', 0.5], ['list', 1], ['group', 1.2], ['reads', 1.4], ['the', 4], ['diffs', 4.4]]) },
			{ id: 'status', need: 'status', start: 8, end: 12.5, words: words([['Merged', 8.5]]) },
		],
	};
	const frames = [
		...framesOf('how', [[1, 'File list', 5], [2, 'reads the diffs', 2], [3, '400 px group', 4.5], [4, '600 px group', 5], [5, 'row', 4.5]], 3.6).filter(f => f.t < 8),
		...framesOf('status', [[1, 'Start reading here', 8.5], [2, 'MultiDiffEditorFileList', 12]], 8.25).filter(f => f.t >= 8),
	];
	const { problems, warnings } = timingProblems(project, frames);
	assert.deepEqual({
		problems: problems.map(p => `${p.kind} ${p.beat} ${p.text}`),
		warnings: warnings.map(p => `${p.kind} ${p.beat} ${p.text}`),
	}, {
		// The id comes in a second before the end card.
		problems: ['reading-time status MultiDiffEditorFileList'],
		// "list" is said at 1 s and the list shows at 5 s. The "group" rows come in one by one after "group", as a list does.
		warnings: ['heading-only how ', 'named-late how File list'],
	});
});

test('a hold keeps a beat up after its last word, and the next beat starts after it', () => {
	const facts = { number: 1 };
	const plain = estimateTimeline({ beats: [{ id: 'a', say: 'One two three.' }, { id: 'b', say: 'Four.' }] }, facts);
	const held = estimateTimeline({ beats: [{ id: 'a', say: 'One two three.', hold: 2 }, { id: 'b', say: 'Four.' }] }, facts);
	const after = (t, k) => +(k === 'end' ? t.beats[0].end - t.beats[0].words.at(-1).b : t.beats[1].start - t.beats[0].words.at(-1).b).toFixed(3);
	// Without a hold the beat ends on its last word, and the next starts after the full stop's pause and the gap.
	assert.deepEqual({ plain: [after(plain, 'end'), after(plain, 'next')], held: [after(held, 'end'), after(held, 'next')] }, { plain: [0, 0.67], held: [2, 2.35] });
});
