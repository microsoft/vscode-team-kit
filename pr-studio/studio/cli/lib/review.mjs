// prs review-pack (videos) and prs deck review (decks): what a reviewer needs, ready to read. For a video: the checks,
// each beat's cues and what comes on screen when, each claim beside the line it rests on, and a still at every cue. For
// a deck: the checks and every slide with its notes and sources. Each run is a round (build/review/round-<n>/); from
// the second on, only the beats or slides that changed since the last round (and their neighbours) are to look at again.
import fs from 'node:fs';
import path from 'node:path';
import { buildDir, loadConfig, readJson, sha256, sha256File, videoDir, writeJson } from './common.mjs';

/** The rounds made so far in `root`, and the next one's number. */
function rounds(root) {
	const done = fs.existsSync(root) ? fs.readdirSync(root).filter(d => /^round-\d+$/.test(d)).map(d => Number(d.slice(6))).sort((a, b) => a - b) : [];
	return { last: done.at(-1) ?? 0, next: (done.at(-1) ?? 0) + 1 };
}

/** What to look at this round: everything in the first round, or when much changed; else what changed and its
 * neighbours. `changed` and `retold` are ids; `ids` in order. */
export function reviewScope(ids, { first, global = false, changed = [], retold = [] }) {
	if (first) {
		return { scope: 'full', why: 'the first round', look: ids };
	}
	if (global) {
		return { scope: 'full', why: 'the motion or the layout changed', look: ids };
	}
	if (changed.length > ids.length / 2) {
		return { scope: 'full', why: `${changed.length} of ${ids.length} changed`, look: ids };
	}
	if (retold.length >= 2) {
		return { scope: 'full', why: `the narration of ${retold.length} beats changed`, look: ids };
	}
	const look = ids.filter((id, k) => changed.includes(id) || changed.includes(ids[k - 1]) || changed.includes(ids[k + 1]));
	return { scope: 'incremental', why: changed.length ? `changed: ${changed.join(', ')}` : 'nothing changed', look };
}

const quote = t => `"${String(t).replace(/\s+/g, ' ').trim()}"`;

/** prs review-pack <slug>: a video's review pack, as the next round. Returns its folder. */
export async function reviewPack(slug) {
	const bdir = buildDir(slug);
	const { prepare } = await import('./prepare.mjs');
	const { project } = await prepare(slug, { quiet: true });
	const { lint } = await import('./lint.mjs');
	await lint(slug, {});
	const linted = readJson(path.join(bdir, 'lint.json'));
	const state = readJson(path.join(bdir, 'beats.json'));
	const storyboard = readJson(path.join(videoDir(slug), 'storyboard.json'));
	const pr = readJson(path.join(videoDir(slug), 'pr.json'));
	const root = path.join(bdir, 'review');
	const { last, next } = rounds(root);
	const prev = last ? readJson(path.join(root, `round-${last}`, 'state.json')) : null;
	const ids = project.beats.map(b => b.id);
	const changed = prev ? ids.filter(id => prev.beats?.[id] !== state.beats[id]) : ids;
	const retold = prev ? ids.filter(id => prev.say?.[id] !== state.say[id]) : ids;
	const global = !!prev && (prev.motion !== state.motion || prev.layout !== state.layout || prev.carry !== state.carry);
	const { scope, why, look } = reviewScope(ids, { first: !prev, global, changed, retold });
	const dir = path.join(root, `round-${next}`);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(path.join(dir, 'stills'), { recursive: true });

	// A still just after every cue and near the end of each beat to look at, at half size, with a contact sheet.
	const shots = [];
	project.beats.forEach((b, k) => {
		if (!look.includes(b.id)) {
			return;
		}
		const leave = k === project.beats.length - 1 ? project.video.endAt : b.end;
		for (const [name, t] of Object.entries(b.cues).sort((x, y) => x[1] - y[1])) {
			shots.push({ t: +Math.min(t + 0.7, leave - 0.15).toFixed(2), beat: b.id, what: `cue ${name}` });
		}
		shots.push({ t: +(leave - 0.3).toFixed(2), beat: b.id, what: 'end' });
	});
	const { launch, openVideo } = await import('./browser.mjs');
	const { contactSheet } = await import('./stills.mjs');
	const browser = await launch();
	try {
		let i = 0;
		await Promise.all(Array.from({ length: Math.min(4, shots.length) }, async () => {
			const v = await openVideo(browser, bdir, { scale: 0.5 });
			while (i < shots.length) {
				const s = shots[i++];
				s.file = path.join(dir, 'stills', `${String(shots.indexOf(s) + 1).padStart(3, '0')}-${s.beat}-${s.what.replace(/\W+/g, '-')}.png`);
				await v.renderAt(s.t);
				await v.page.screenshot({ path: s.file });
			}
			await v.page.close();
		}));
		if (shots.length) {
			await contactSheet(browser, dir, shots.map(s => ({ file: s.file, label: `${s.beat} \u00b7 ${s.what} \u00b7 ${s.t} s` })), path.join(dir, 'contact.png'), { cols: 4, width: 480 });
		}
	} finally {
		await browser.close();
	}

	// The checks, then each beat.
	const sync = fs.existsSync(path.join(bdir, 'sync.txt')) ? fs.readFileSync(path.join(bdir, 'sync.txt'), 'utf8') : '';
	const gate = /SYNC GATE: (.+)/.exec(sync)?.[1] ?? 'not run yet (prs publish runs it)';
	const match = Object.fromEntries([...sync.matchAll(/^(\S+)\s+text match ([\d.]+)\s+differences: (.*)$/gm)].map(m => [m[1], { ratio: m[2], diff: m[3] }]));
	const problems = (linted.problems?.length ?? 0) + (linted.qr ? 1 : 0) + (linted.novelty?.length ?? 0) + (linted.late?.length ?? 0) + (linted.timing?.problems?.length ?? 0);
	const lastWord = Math.max(...project.beats.flatMap(b => b.words.map(w => w.b)));
	const mp4 = path.join(loadConfig().deliver, slug, `${slug}.mp4`);
	const { evidenceLine } = await import('./evidence.mjs');
	const lines = [
		`# Review pack: ${pr.facts.repo}#${pr.facts.number}, round ${next}`,
		'',
		`**Scope: ${scope}** (${why}).${scope === 'incremental' ? ` Look again at: ${look.join(', ') || 'nothing'}. The other beats are as the last round reviewed them; reopen the full review if you find a reason to.` : ''}`,
		'',
		`- **Video:** ${project.video.total.toFixed(1)} s with the end card, the last word at ${lastWord.toFixed(1)} s; motion ${project.video.motion}.${fs.existsSync(mp4) ? ` Delivered: ${mp4}` : ''}`,
		`- **Lint:** ${problems} problem${problems === 1 ? '' : 's'}, ${linted.timing?.warnings?.length ?? 0} warning${linted.timing?.warnings?.length === 1 ? '' : 's'}; the QR ${linted.qr ? `fails: ${linted.qr}` : 'opens the PR'}.`,
		`- **Sync gate:** ${gate}.`,
		`- **Stills:** \`stills/\` and \`contact.png\` here (half size; \`prs stills ${slug} --at <t>\` for full size). The contact sheet of the whole video: \`build/stills/contact.png\`.`,
		'',
	];
	for (const [k, b] of project.beats.entries()) {
		const sb = storyboard.beats[k];
		const tag = scope === 'full' ? '' : changed.includes(b.id) ? ' (changed)' : look.includes(b.id) ? ' (next to a change)' : ' (unchanged)';
		lines.push(`## ${b.id}${tag}: ${b.need}, ${b.start.toFixed(1)}\u2013${b.end.toFixed(1)} s`, '');
		if (!look.includes(b.id)) {
			lines.push('As the last round reviewed it.', '');
			continue;
		}
		lines.push(`Says: ${quote(sb.say)}${sb.hold ? ` (then holds ${sb.hold} s)` : ''}`, '');
		if (match[b.id]) {
			lines.push(`Heard: text match ${match[b.id].ratio}${match[b.id].diff !== '[]' ? `, differences ${match[b.id].diff}` : ''}`, '');
		}
		const cues = Object.entries(b.cues).sort((x, y) => x[1] - y[1]);
		if (cues.length) {
			lines.push(`Cues: ${cues.map(([n, t]) => `${n} ${t.toFixed(1)} s`).join(' \u00b7 ')}`, '');
		}
		const shown = linted.timing?.appear?.[b.id] ?? [];
		if (shown.length) {
			lines.push('On screen (from, until):', ...shown.slice(0, 16).map(e => `- ${e.from.toFixed(1)}\u2013${e.until.toFixed(1)} s ${quote(e.text)}`), ...(shown.length > 16 ? [`- and ${shown.length - 16} more`] : []), '');
		}
		const notes = [...(linted.timing?.problems ?? []), ...(linted.timing?.warnings ?? [])].filter(p => p.beat === b.id);
		if (notes.length) {
			lines.push('Timing:', ...notes.map(p => `- ${p.kind}: ${p.text ? `${quote(p.text)} ` : ''}${p.detail}`), '');
		}
		const claims = sb.claims ?? [];
		if (claims.length) {
			lines.push('Claims:', ...claims.flatMap(c => [`- ${quote(c.text)}`, ...(c.evidence ?? []).map(ev => `  - ${evidenceLine(slug, pr, ev)}`)]), '');
		}
		const mine = shots.filter(s => s.beat === b.id);
		if (mine.length) {
			lines.push(`Stills: ${mine.map(s => `\`${path.basename(s.file)}\` (${s.what}, ${s.t} s)`).join(', ')}`, '');
		}
	}
	fs.writeFileSync(path.join(dir, 'pack.md'), `${lines.join('\n')}\n`);
	writeJson(path.join(dir, 'state.json'), { ...state, round: next, at: new Date().toISOString(), scope });
	console.log(`review pack, round ${next} (${scope}: ${why}): ${path.join(dir, 'pack.md')}`);
	return dir;
}

/** prs deck review <slug>: a deck's review pack, as the next round. Returns its folder. */
export async function deckReviewPack(deckDirectory) {
	const { loadDeck } = await import('../../deck/build.mjs');
	const { deckPages } = await import('../../deck/pages.mjs');
	const deck = await loadDeck(deckDirectory);
	const { pages } = deckPages(deck);
	const out = path.join(deckDirectory, 'out');
	if (!fs.existsSync(path.join(out, 'slides'))) {
		throw new Error('build the deck first: prs deck build <slug> --no-deliver');
	}
	const slides = [];
	pages.forEach((p, i) => {
		const png = path.join(out, 'slides', `${String(i + 1).padStart(3, '0')}.png`);
		if (p.first) {
			slides.push({ s: p.s, n: p.slideNo, pages: [], pngs: [] });
		}
		slides.at(-1)?.pages.push(i + 1);
		slides.at(-1)?.pngs.push(fs.existsSync(png) ? sha256File(png).slice(0, 16) : 'missing');
	});
	const id = sl => sl.s.id ?? `slide-${sl.n}`;
	const state = { slides: Object.fromEntries(slides.map(sl => [id(sl), sha256(JSON.stringify(sl.s) + sl.pngs.join()).slice(0, 16)])) };
	const root = path.join(deckDirectory, 'review');
	const { last, next } = rounds(root);
	const prev = last ? readJson(path.join(root, `round-${last}`, 'state.json')) : null;
	const ids = slides.map(id);
	const changed = prev ? ids.filter(x => prev.slides?.[x] !== state.slides[x]) : ids;
	const { scope, why, look } = reviewScope(ids, { first: !prev, changed });
	const dir = path.join(root, `round-${next}`);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const checks = fs.existsSync(path.join(out, 'checks.txt')) ? fs.readFileSync(path.join(out, 'checks.txt'), 'utf8') : '';
	const verdict = /Checks: .+/.exec(checks)?.[0] ?? 'Checks: see out/checks.txt';
	const plain = t => String(t ?? '').replace(/\{\{\w+\|([^}]*)\}\}/g, '$1').replace(/\s+/g, ' ').trim();
	const lines = [
		`# Review pack: ${deck.pr ?? deck.title}, round ${next}`,
		'',
		`**Scope: ${scope}** (${why}).${scope === 'incremental' ? ` Look again at: ${look.join(', ') || 'nothing'}. The other slides are as the last round reviewed them; reopen the full review if you find a reason to.` : ''}`,
		'',
		`- **Build:** ${verdict}. Pages: \`out/slides/NNN.png\`; all of them: \`out/contact.png\`.`,
		'',
	];
	for (const sl of slides) {
		const tag = scope === 'full' ? '' : changed.includes(id(sl)) ? ' (changed)' : look.includes(id(sl)) ? ' (next to a change)' : ' (unchanged)';
		lines.push(`## ${sl.n}. ${id(sl)}${tag}: ${sl.s.layout}, page${sl.pages.length > 1 ? 's' : ''} ${sl.pages.join(', ')}`, '');
		if (!look.includes(id(sl))) {
			lines.push('As the last round reviewed it.', '');
			continue;
		}
		lines.push(`Title: ${quote(plain(sl.s.title))}`, '');
		if (sl.s.notes) {
			lines.push(`Notes: ${plain(sl.s.notes)}`, '');
		}
		if (sl.s.sources?.length) {
			lines.push(`Sources: ${sl.s.sources.join(' \u00b7 ')}`, '');
		}
	}
	fs.writeFileSync(path.join(dir, 'pack.md'), `${lines.join('\n')}\n`);
	writeJson(path.join(dir, 'state.json'), { ...state, round: next, at: new Date().toISOString(), scope });
	console.log(`review pack, round ${next} (${scope}: ${why}): ${path.join(dir, 'pack.md')}`);
	return dir;
}
