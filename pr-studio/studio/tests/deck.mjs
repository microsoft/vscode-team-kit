// Slide decks: pages per click, a deck's own designs, and the layout samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deckPages } from '../deck/pages.mjs';
import { loadDesigns } from '../deck/designs.mjs';
import { BUILT_IN, loadDeck, prChecks } from '../deck/build.mjs';
import { prDeckSource, span, statusNodes, statusNotes } from '../cli/lib/deck.mjs';
import * as kit from '../deck/kit.mjs';

test('a slide becomes one page per click; layouts with their own steps stay one page; a poll gets its answer page', () => {
	const deck = {
		sections: [{
			id: 'deck', slides: [
				{ id: 'list', layout: 'steps', steps: [{ title: 'One' }, { title: 'Two' }] },
				{ id: 'build', layout: 'my-build', clicks: [{ caption: 'A', say: 'a' }, { caption: 'B', say: 'b' }] },
				{ id: 'quiz', layout: 'poll', options: [{ text: 'Yes', correct: true }], answer: 'Yes' },
			],
		}],
	};
	const { pages, slides } = deckPages(deck);
	assert.deepEqual({ slides, pages: pages.map(p => [p.s.id, p.slideNo, p.step, !!p.reveal]) }, {
		slides: 3,
		pages: [['list', 1, null, false], ['build', 2, 1, false], ['build', 2, 2, false], ['quiz', 3, null, false], ['quiz', 3, undefined, true]],
	});
});

test('a deck folder: its designs load (function or object form), and problems are reported instead of thrown', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-deck-'));
	try {
		fs.mkdirSync(path.join(dir, 'designs'));
		fs.writeFileSync(path.join(dir, 'designs', 'a.mjs'), 'export function designs(kit) { return { \'demo-card\': { css: \'.demo-card { color: red; }\', render: s => kit.heading(s) } }; }\n');
		fs.writeFileSync(path.join(dir, 'designs', 'b.mjs'), 'export const designs = { statement: { render: () => \'\' }, \'demo-loose\': { css: \'.other { box-shadow: 0 2px 8px #000; }\', render: () => \'\' } };\n');
		fs.writeFileSync(path.join(dir, 'designs', 'c.mjs'), 'export const designs = {;\n');
		fs.writeFileSync(path.join(dir, 'deck.mjs'), 'export default { title: \'T\', slides: [{ id: \'a\', layout: \'statement\', text: \'Hi\' }] };\n');
		const own = await loadDesigns(dir, BUILT_IN, kit);
		const deck = await loadDeck(dir);
		assert.deepEqual({
			designs: Object.keys(own.designs).sort(),
			problems: own.problems.map(p => `${p.file}: ${p.kind.split(' (')[0].split(':')[0]}`),
			deck: { slug: deck.slug, ref: deck.ref, sections: deck.sections.map(s => s.slides.length) },
		}, {
			designs: ['demo-card', 'demo-loose'],
			problems: [
				'b.mjs: design "statement" in designs/b.mjs has the name of a built-in layout',
				'b.mjs: CSS selector in design "demo-loose"',
				'b.mjs: soft shadow in design "demo-loose"',
				'c.mjs: designs/c.mjs does not load',
			],
			deck: { slug: path.basename(dir), ref: 'T', sections: [1] },
		});
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('the samples show every built-in layout', async () => {
	const deck = await loadDeck(path.join(import.meta.dirname, '..', 'deck', 'samples'));
	const used = new Set(deck.sections.flatMap(s => s.slides.map(x => x.layout)));
	// html (raw HTML) is there for emergencies only; the guide tells writers to avoid it.
	assert.deepEqual(Object.keys(BUILT_IN).filter(name => !used.has(name) && name !== 'html'), []);
});

test('a deck about a PR: its status comes from the PR, and code or paths the PR lacks are flagged, in the notes too', () => {
	const facts = { authorLogin: 'mona', authorName: 'Mona Lisa', commitCount: 2, reviewers: ['mona', 'hubot', 'copilot-pull-request-reviewer[bot]'], approvers: ['hubot'], reviewDecision: 'APPROVED', state: 'MERGED', createdAt: '2026-10-15T07:59:00Z', mergedAt: '2026-10-15T09:29:39Z' };
	const open = { ...facts, reviewers: [], reviewDecision: 'REVIEW_REQUIRED', state: 'OPEN', updatedAt: '2026-10-14T10:00:00Z' };
	const slide = (n, s) => ({ s, first: true, reveal: false, slideNo: n });
	const pages = [
		slide(1, { layout: 'code', file: 'cache.ts', code: 'if (fresh) {\n\treturn cached; // \u2026\n}\nreturn compute();' }),
		slide(2, { layout: 'statement', text: 'Uses `readCache` and `writeCacheFast` in src/cache.ts and src/missing.ts', notes: '`readCache` and `readCash` in the notes; the picture is assets/before.png, the code src/gone.ts' }),
	];
	const pr = { paths: ['src/cache.ts'], corpus: '+ if (fresh) { + return cached; // keep it + } return computeAll(); readCache' };
	assert.deepEqual({
		merged: statusNodes(facts, new Date('2026-12-01T00:00:00Z')).map(n => `${n.title}: ${n.sub} (${n.tone})`),
		nextYear: statusNodes(facts, new Date('2027-02-01T00:00:00Z'))[0].sub,
		notes: statusNotes(facts),
		spans: [span('2026-10-14T21:48:00Z', '2026-10-15T00:36:00Z'), span('2026-10-14T21:48:00Z', '2026-10-14T23:48:00Z'), span('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z')],
		open: statusNodes(open).map(n => n.title),
		problems: prChecks(pages, pr).map(p => `${p.n} ${p.text}`),
	}, {
		merged: ['Opened: 15 Oct \u00b7 2 commits (blue)', 'Reviewed: @hubot and Copilot (purple)', 'Approved: by @hubot (green)', 'Merged: 15 Oct (green)'],
		nextYear: '15 Oct 2026 \u00b7 2 commits',
		notes: 'Opened on 15 Oct 2026 by @mona (Mona Lisa); reviewed by @hubot, Copilot; approved by @hubot; merged on 15 Oct 2026, 91 minutes after it was opened.',
		spans: ['2 hours 48 minutes', '2 hours', '3 days'],
		open: ['Opened', 'Review required', 'Not merged yet'],
		problems: ['1 return compute();', '2 writeCacheFast', '2 src/missing.ts', '2 readCash', '2 src/gone.ts'],
	});
});

test('a deck about a PR starts with its title and status, and no end slide: the status carries the QR code', async () => {
	const facts = {
		repo: 'contoso/example', number: 7, title: 'Keep the layout', url: 'https://github.com/contoso/example/pull/7', state: 'OPEN', isDraft: false,
		createdAt: '2026-10-15T07:59:00Z', authorLogin: 'mona', authorName: 'Mona Lisa', commitCount: 1, reviewers: [], approvers: [], reviewDecision: 'REVIEW_REQUIRED',
		additions: 12, deletions: 3, changedFiles: 2, testFiles: 1, areas: [{ name: 'src', additions: 12, deletions: 3 }],
		files: [{ path: 'src/a.ts', additions: 10, deletions: 3 }, { path: 'src/a.test.ts', additions: 2, deletions: 0 }],
	};
	const { default: deck } = await import(`data:text/javascript,${encodeURIComponent(prDeckSource(facts))}`);
	assert.deepEqual(deck.slides.map(s => [s.id, s.layout, s.link?.url ?? null]), [['title', 'title', null], ['status', 'journey', facts.url]]);
});
