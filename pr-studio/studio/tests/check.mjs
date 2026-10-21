// The length is a cap with no minimum: prs check fails past it, prs publish won't deliver past it; the title and status
// beats are one sentence each.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CAP, videoDir, writeJson } from '../cli/lib/common.mjs';
import { checkStory } from '../cli/lib/check.mjs';
import { publish } from '../cli/lib/publish.mjs';

const facts = { repo: 'contoso/example', number: 9, title: 'An example', additions: 12, deletions: 3, changedFiles: 2, authorLogin: 'mona', files: [{ path: 'src/a.ts' }] };

async function check(t, beats) {
	const slug = '_test-check';
	const dir = videoDir(slug);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const lines = [];
	t.mock.method(console, 'log', line => lines.push(String(line)));
	try {
		writeJson(path.join(dir, 'pr.json'), { facts, body: '', symbols: [], tests: [], tier: { name: 'small', beats: 4 } });
		writeJson(path.join(dir, 'storyboard.json'), { pr: { repo: facts.repo, number: facts.number }, pronounce: {}, beats });
		const ready = await checkStory(slug);
		return { ready, lines: lines.filter(l => /^(length|warning|error)/.test(l)).map(l => l.replace(/about \d+ s \(\d+ words/, 'about N s (N words')) };
	} finally {
		t.mock.restoreAll();
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('a short storyboard is ready; one past the cap is not; a long title or status beat is flagged', async t => {
	const status = { id: 'status', need: 'status', say: 'It is merged, with two new tests.', cues: {}, claims: [] };
	const short = await check(t, [{ id: 'title', need: 'title', say: 'Saves the layout when the window closes.', cues: {}, claims: [] }, status]);
	const long = await check(t, [{ id: 'title', need: 'title', say: `Pull request {{facts.number}} adds {{facts.additions}} lines. ${'It explains one more thing at length. '.repeat(70)}`, cues: {}, claims: [] }, status]);
	assert.deepStrictEqual({ short, long }, {
		short: { ready: true, lines: [`length: the last word should end at about N s (N words; an estimate: prs voice measures it), within the ${CAP.seconds} s cap`] },
		long: {
			ready: false,
			lines: [
				'warning: beat title: 71 sentences; the title beat says one, the screen carries the rest',
				'warning: beat title: the title card shows number, additions: say what the PR does instead',
				`error: the last word should end at about N s (N words; an estimate: prs voice measures it), past the ${CAP.seconds} s cap (${CAP.fileSeconds} s with the end card): cut what answers none of the six questions, and what the screen already shows`,
			],
		},
	});
});

test('a claim needs its text and its evidence: one written as bare evidence is an error', async t => {
	const title = { id: 'title', need: 'title', say: 'Saves the layout when the window closes.', cues: {}, claims: [] };
	const status = { id: 'status', need: 'status', say: 'It is merged, with two new tests.', cues: {}, claims: [{ file: 'src/a.ts', anchor: 'save' }] };
	const result = await check(t, [title, status]);
	assert.deepStrictEqual(result, {
		ready: false,
		lines: ['error: beat status: a claim is { "text": "what is stated", "evidence": [{ "file", "anchor" }, { "body" }, ...] }, with evidence: {"file":"src/a.ts","anchor":"save"}'],
	});
});

test('a cue phrase said twice is flagged unless nth picks one', async t => {
	const title = { id: 'title', need: 'title', say: 'Saves the layout when the window closes.', cues: {}, claims: [] };
	const status = { id: 'status', need: 'status', say: 'Scroll down, then scroll back up.', cues: { first: 'scroll', second: { phrase: 'scroll', nth: 1 } }, claims: [] };
	const result = await check(t, [title, status]);
	assert.deepStrictEqual(result.lines.filter(l => /cue/.test(l)), ['warning: beat status: cue "first": "scroll" is said 2 times and cues the first; for another, write { "phrase": "scroll", "nth": 1 } (counted from 0)']);
});

test('a video past the cap is not delivered', async () => {
	const slug = '_test-publish-cap';
	const dir = videoDir(slug);
	fs.rmSync(dir, { recursive: true, force: true });
	try {
		writeJson(path.join(dir, 'build', 'project.json'), { video: { total: CAP.fileSeconds + 4.2 } });
		await assert.rejects(publish(slug), { message: `The video runs ${(CAP.fileSeconds + 4.2).toFixed(1)} s, past the ${CAP.fileSeconds} s cap: cut the narration (its last word ends by ${CAP.seconds} s), then prs voice, prs render and prs publish again. Not delivered.` });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
