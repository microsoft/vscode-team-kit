// Unit tests for the pure parts of pr-studio: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeKey, fact, label, quote, ident, path as pathText, code, resolvePart, textOf, walkRefs, formatFact } from '../engine/text.js';
import { resolvePlaceholders, findPhrase, estimateTimeline, displayTokens } from '../cli/lib/timeline.mjs';
import { parseDiff } from '../cli/lib/code.mjs';
import { approversOf, deriveArea, isTestFile, lengthTier, prPictures, reviewDiscussion, symbolsFromDiff, testsFromDiff } from '../cli/lib/fetch.mjs';
import { parsePrRef, voicePace } from '../cli/lib/common.mjs';
import { defineVideo, defineTreatment, word } from '../engine/scene.js';

const facts = { number: 325804, additions: 1530, authorLogin: 'mcumming', state: 'OPEN', createdAt: '2026-07-14T14:35:26Z', files: [{ path: 'a.ts' }] };

test('text provenance resolves every kind and stamps its source', () => {
	assert.deepStrictEqual(
		[label('Hi'), fact('additions', { format: 'n', prefix: '+' }), quote('exact'), ident('fooBar()'), pathText('src/vs/a/b.ts'), pathText('src/vs/a/b.ts', { show: 'tail2' }), fact('createdAt', { format: 'date' }), fact('state', { format: 'state' })].map(v => resolvePart(v, facts)),
		[
			{ text: 'Hi', src: 'label' }, { text: '+1,530', src: 'fact:additions' }, { text: 'exact', src: 'quote:any' }, { text: 'fooBar()', src: 'ident' },
			{ text: 'b.ts', src: 'path' }, { text: 'a/b.ts', src: 'path' }, { text: '14 Jul 2026', src: 'fact:createdAt' }, { text: 'Open', src: 'fact:state' },
		],
	);
	assert.equal(textOf([label('PR #'), fact('number')], facts), 'PR #325804');
	assert.throws(() => resolvePart(fact('missing'), facts), /not in pr.json facts/);
	assert.equal(formatFact('REVIEW_REQUIRED', 'review'), 'Review required');
});

test('walkRefs finds text and code references in nested params', () => {
	const params = { title: label('T'), rows: [{ value: fact('number') }, { cells: { a: quote('q') } }], code: { block: code('x.ts', { from: 1, to: 3 }) }, at: word('401') };
	const found = [...walkRefs(params)].map(r => r.trail);
	assert.deepStrictEqual(found, ['title', 'rows[0].value', 'rows[1].cells.a', 'code.block']);
	assert.notEqual(codeKey(code('x.ts', { anchor: 'a' })), codeKey(code('x.ts', { anchor: 'a', diff: true })));
	assert.equal(codeKey(code('x.ts', { to: 3, from: 1 })), codeKey(code('x.ts', { from: 1, to: 3 })));
});

test('placeholders and cue phrases resolve like the voice pipeline', () => {
	assert.equal(resolvePlaceholders('PR {{facts.number}} adds {{facts.additions|n}} lines', facts), 'PR 325804 adds 1,530 lines');
	assert.throws(() => resolvePlaceholders('{{facts.nope}}', facts), /not in pr.json facts/);
	const tokens = displayTokens('One: request the index. Two: on a 401 or 403, read it. Two more.', facts);
	assert.equal(findPhrase(tokens, 'Two'), 4);
	assert.equal(findPhrase(tokens, 'two', 1), 12);
	assert.throws(() => findPhrase(tokens, 'Three'), /is not in/);
});

test('provisional timeline: ordered beats, cues on their words, a tail', () => {
	const sb = { beats: [{ id: 'a', say: 'Pull request {{facts.number}}, by {{facts.authorLogin}}.', cues: { author: 'by' } }, { id: 'b', say: 'One idea. Then another one.', cues: { then: 'Then' } }] };
	const tl = estimateTimeline(sb, facts);
	assert.equal(tl.beats.length, 2);
	assert.ok(tl.beats[0].end < tl.beats[1].start, 'beats do not overlap');
	assert.equal(tl.beats[0].cues.author, tl.beats[0].words[3].a);
	assert.equal(tl.beats[1].cues.then, tl.beats[1].words[2].a);
	assert.ok(tl.total > tl.beats[1].end + 2);
});

test('the voice pace shortens the words and their pauses, not the gaps between beats', () => {
	const sb = { beats: [{ id: 'a', say: 'One idea, said in full', cues: {} }, { id: 'b', say: 'Then another one', cues: {} }] };
	const [own, fast] = [1, 1.1].map(pace => estimateTimeline(sb, facts, { pace }));
	const spoken = tl => tl.beats.map(b => b.end - b.start);
	const gap = tl => tl.beats[1].start - tl.beats[0].end;
	const near = (a, b) => Math.abs(a - b) < 0.005;
	assert.deepStrictEqual({ words: spoken(own).every((s, i) => near(s, spoken(fast)[i] * 1.1)), gaps: near(gap(own), gap(fast)) }, { words: true, gaps: true });
	// A recording, or silent captions, keep their own pace; a pace out of range is refused.
	assert.deepStrictEqual([{ pace: 1.1 }, { pace: 1.1, provider: 'recording' }, {}].map(voice => voicePace({ voice })), [1.1, 1, 1]);
	assert.throws(() => voicePace({ voice: { pace: 3 } }), /must be between 0.5 and 2/);
});

test('diff parsing keeps old and new line numbers and the added set', () => {
	const diff = 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,4 @@ class A {\n a\n-b\n+B\n+C\n c\n';
	const files = parseDiff(diff);
	const f = files.get('f.ts');
	assert.deepStrictEqual(f.hunks[0].lines.map(l => [l.type, l.old, l.new]), [[' ', 1, 1], ['-', 2, null], ['+', null, 2], ['+', null, 3], [' ', 3, 4]]);
	assert.deepStrictEqual([...f.added], [2, 3]);
	assert.equal(f.hunks[0].header, 'class A {');
});

test('symbols and tests come out of the diff', () => {
	const diff = 'diff --git a/s.ts b/s.ts\n--- a/s.ts\n+++ b/s.ts\n@@ -1,2 +1,4 @@ export class Svc {\n+\tprivate isSameSecureOrigin(a: string): boolean {\n-\tfunction old() {\ndiff --git a/t/x.test.ts b/t/x.test.ts\n--- a/t/x.test.ts\n+++ b/t/x.test.ts\n@@ -1 +1,2 @@\n+\ttest(\'attaches the bearer\', () => {\n';
	const files = parseDiff(diff);
	const sym = symbolsFromDiff(files).find(s => s.path === 's.ts');
	assert.deepStrictEqual(sym.added, ['isSameSecureOrigin']);
	assert.deepStrictEqual(sym.removed, ['old']);
	assert.deepStrictEqual(sym.changed, ['Svc']);
	assert.deepStrictEqual(testsFromDiff(files), [{ path: 't/x.test.ts', names: ['attaches the bearer'] }]);
});

test('areas, tests and the length tier', () => {
	assert.equal(deriveArea('src/vs/workbench/services/extensionManagement/x/y.ts'), 'workbench/services/extensionManagement');
	assert.equal(deriveArea('src/vs/platform/files/node/watcher.ts'), 'platform/files');
	assert.equal(deriveArea('extensions/git/src/main.ts'), 'extensions/git');
	assert.ok(isTestFile('src/vs/a/test/common/b.test.ts'));
	assert.ok(!isTestFile('src/vs/a/b.ts'));
	const small = lengthTier({ title: 'Fix a typo', files: [{ isTest: false, additions: 20, deletions: 3 }], areas: [{}] });
	assert.equal(small.name, 'small');
	const bumped = lengthTier({ title: 'Authenticate marketplace requests', files: [{ isTest: false, additions: 300, deletions: 20 }], areas: [{}, {}, {}] }, 'token negotiation');
	assert.equal(bumped.name, 'large');
	// How it was tested isn't what it does: a sign-in step in the Validation section doesn't make a UI fix sensitive.
	const tested = lengthTier({ title: 'Polish the dialog', files: [{ isTest: false, additions: 120, deletions: 30 }], areas: [{}] }, 'Tidies the cards.\n\n## Validation\n- Signed in as an authenticated user');
	assert.equal(tested.name, 'small');
	// A size only sets how many beats the skeleton starts with: the length is a cap, the same for every size.
	assert.deepStrictEqual([small, bumped, tested].map(t => Object.keys(t).sort().join() + `:${t.beats}`), ['beats,name,reasons:4', 'beats,name,reasons:6', 'beats,name,reasons:4']);
});

test('what people said and showed on a PR: approvals, the discussion, the pictures', () => {
	const user = login => ({ login });
	const reviews = [
		{ user: user('ana'), state: 'APPROVED', body: '' },
		{ user: user('bo'), state: 'CHANGES_REQUESTED', body: 'Please add a test.' },
		{ user: user('bo'), state: 'APPROVED', body: '' },
		{ user: user('ana'), state: 'COMMENTED', body: 'One more thought.' },
		{ user: user('cy'), state: 'APPROVED', body: '' },
		{ user: user('cy'), state: 'DISMISSED', body: '' },
	];
	const long = `Why: ${'x'.repeat(1600)} [comment authored by copilot]`;
	const comments = [
		{ user: user('github-actions[bot]'), created_at: '2026-10-14T10:00:00Z', body: '<!-- screenshot-diff-report -->\n## Screenshot Changes\n<details open><summary><code>app/dialog/Light</code></summary>\n\n| Before | After |\n|---|---|\n| ![before](https://shots.example/a) | ![after](https://shots.example/b) |\n</details>' },
		{ user: user('dee'), created_at: '2026-10-14T11:00:00Z', body: 'Looks like this now: ![the dialog](https://example.com/d.png)' },
		{ user: user('ana'), created_at: '2026-10-14T12:00:00Z', body: long },
	];
	const talk = reviewDiscussion(reviews.map((r, i) => ({ ...r, submitted_at: `2026-10-14T0${i}:00:00Z` })), [], comments);
	assert.deepEqual({
		approvers: approversOf(reviews),
		talk: talk.map(t => `${t.who}: ${t.body.slice(0, 18)}`),
		kept: talk.at(-1).body.endsWith('[comment authored by copilot]') && talk.at(-1).body.length < 1500,
		pictures: prPictures('Before: ![old](https://example.com/old.png)', comments, []),
	}, {
		approvers: ['ana', 'bo'],
		talk: ['bo: Please add a test.', 'ana: One more thought.', 'dee: Looks like this no', 'ana: Why: xxxxxxxxxxxxx'],
		kept: true,
		pictures: [
			{ source: 'description', alt: 'old', url: 'https://example.com/old.png' },
			{ source: 'ci', name: 'app/dialog/Light', before: 'https://shots.example/a', after: 'https://shots.example/b' },
			{ source: 'comment', who: 'dee', alt: 'the dialog', url: 'https://example.com/d.png' },
		],
	});
});

test('PR references in every accepted form', () => {
	assert.deepStrictEqual(parsePrRef('https://github.com/microsoft/vscode/pull/325804'), { owner: 'microsoft', repo: 'vscode', number: 325804, full: 'microsoft/vscode', slug: 'microsoft-vscode-325804' });
	assert.equal(parsePrRef('microsoft/vscode#1').slug, 'microsoft-vscode-1');
	assert.equal(parsePrRef('microsoft/vscode', '7').number, 7);
	assert.throws(() => parsePrRef('not a pr'), /Not a pull request/);
});

test('defineVideo and defineTreatment validate their input', () => {
	const t = defineTreatment({ id: 'x.y', need: 'flow', name: 'X', when: 'w', mount() {}, render() {} });
	assert.equal(t({}).treatment, 'x.y');
	assert.throws(() => defineVideo({ motion: 'spin', beats: {} }), /Unknown motion/);
	assert.throws(() => defineVideo({ motion: 'morph', beats: {} }), /needs carry/);
	assert.throws(() => defineVideo({ beats: { a: { foo: 1 } } }), /must be a catalog treatment/);
	assert.throws(() => defineTreatment({ id: 'q', need: 'nope', name: 'n', when: 'w', mount() {}, render() {} }), /unknown need/);
});
