// prs deck: slide decks in the studio look. A deck is a folder decks/<slug>/ with deck.mjs (the slides, as plain data),
// and optionally designs/ (layouts of its own) and assets/ (pictures). deck/build.mjs turns it into a 16:9 PDF, one PNG
// per page, a contact sheet, speaker notes and a checks report, in decks/<slug>/out/, and delivers the PDF, the contact
// sheet, the notes and a picture per slide (slides/) to ~/Downloads/pr-decks/<slug>/. A deck about a pull request (prs deck new --pr) starts from the
// PR's real data, and its build checks the code and paths on the slides against the PR.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAP, ROOT, loadConfig, parsePrRef, readJson, videoDir } from './common.mjs';

const SAMPLES = path.join(ROOT, 'deck', 'samples');

export function deckDir(slug) {
	return path.join(ROOT, 'decks', slug);
}

/** The deck a command is about: the slug given, else the deck changed last. */
function resolveDeck(arg) {
	if (arg) {
		if (!fs.existsSync(path.join(deckDir(arg), 'deck.mjs'))) {
			throw new Error(`No deck "${arg}": decks/${arg}/deck.mjs is missing (prs deck new ${arg} starts one)`);
		}
		return arg;
	}
	const root = path.join(ROOT, 'decks');
	const all = fs.existsSync(root) ? fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'deck.mjs'))) : [];
	if (!all.length) {
		throw new Error('No decks yet: prs deck new <slug> starts one');
	}
	return all.sort((a, b) => fs.statSync(path.join(root, b, 'deck.mjs')).mtimeMs - fs.statSync(path.join(root, a, 'deck.mjs')).mtimeMs)[0];
}

/** The deck a `prs deck` command is about, for its run log; null when there is none (or none yet). */
export function deckOfCommand(args) {
	const [sub, first] = args._;
	try {
		if (sub === 'new') {
			return first ?? (typeof args.pr === 'string' ? parsePrRef(args.pr).slug : null);
		}
		return ['build', 'grid', 'review'].includes(sub) ? resolveDeck(first) : null;
	} catch {
		return null;
	}
}

function template({ title, ref }) {
	const q = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
	return `// ${title}: the slides as plain data. Build it with prs deck build. Layouts and their fields: layouts.md of the
// presentation skill, and the samples (prs deck samples). Every number needs a source; every slide needs notes.
export default {
	title: ${q(title)},
	ref: ${q(ref)},
	slides: [
		{
			id: 'title', layout: 'title',
			eyebrow: 'TODO: the occasion, 2-4 words',
			title: ${q(title)},
			quote: 'TODO: one sentence on what the audience gets',
			speaker: { initials: 'TODO', name: 'TODO', role: 'TODO' },
			notes: 'TODO: what to say while this slide is up.',
		},
		{
			id: 'end', layout: 'end', title: 'Questions?', url: 'TODO: a link worth keeping', meta: 'TODO: what the link is',
			notes: 'TODO',
		},
	],
};
`;
}

const q = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
const day = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** A date for a slide: without the year when it is the year of the deck (the slides' header shows it). */
const short = (iso, now = new Date()) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(iso).getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }) });
/** A time span in words: '45 minutes', '2 hours 48 minutes', '3 days'. */
export function span(fromIso, toIso) {
	const minutes = Math.max(1, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
	const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
	if (minutes < 120) {
		return plural(minutes, 'minute');
	}
	if (minutes < 48 * 60) {
		return [plural(Math.floor(minutes / 60), 'hour'), minutes % 60 ? plural(minutes % 60, 'minute') : ''].filter(Boolean).join(' ');
	}
	return plural(Math.round(minutes / 1440), 'day');
}

/** What the status slide's notes start from: the PR's history in one sentence, from its data. */
export function statusNotes(facts) {
	const people = (facts.reviewers ?? []).filter(r => r !== facts.authorLogin).map(reviewerName);
	const who = `@${facts.authorLogin.replace(/\[bot\]$/, '')}${facts.authorName ? ` (${facts.authorName})` : ''}`;
	const parts = [`Opened on ${day(facts.createdAt)} by ${who}`];
	if (people.length) {
		parts.push(`reviewed by ${people.join(', ')}`);
	}
	if (facts.reviewDecision === 'APPROVED') {
		const approvers = (facts.approvers ?? []).map(reviewerName);
		parts.push(approvers.length ? `approved by ${approvers.join(', ')}` : 'approved');
	} else if (facts.reviewDecision === 'CHANGES_REQUESTED') {
		parts.push('changes requested');
	}
	if (facts.state === 'MERGED') {
		parts.push(`merged on ${day(facts.mergedAt)}, ${span(facts.createdAt, facts.mergedAt)} after it was opened`);
	} else if (facts.state === 'CLOSED') {
		parts.push('closed without merging');
	} else {
		parts.push(`not merged yet (last updated ${day(facts.updatedAt)})`);
	}
	return `${parts.join('; ')}.`;
}

/** An object as a one-line JavaScript literal: { key: 'text', n: 1 }. */
const literal = o => `{ ${Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'string' ? q(v) : v}`).join(', ')} }`;

/** How a reviewer's login reads on a slide: '@login', and 'Copilot' for its code review bot. */
export function reviewerName(login) {
	return /^copilot/i.test(login) ? 'Copilot' : `@${login.replace(/\[bot\]$/, '')}`;
}

/** The status of a pull request as the stops of a journey: opened, reviewed, the decision, merged (or where it stands). */
export function statusNodes(facts, now = new Date()) {
	const commits = facts.commitCount ?? facts.commits?.length ?? 0;
	const nodes = [{ icon: 'pr', title: facts.isDraft ? 'Opened as a draft' : 'Opened', sub: `${short(facts.createdAt, now)} \u00b7 ${commits} commit${commits === 1 ? '' : 's'}`, tone: 'blue' }];
	const people = (facts.reviewers ?? []).filter(r => r !== facts.authorLogin).map(reviewerName);
	if (people.length) {
		const humans = people.filter(n => n !== 'Copilot');
		const shown = humans.slice(0, 2).join(', ') + (humans.length > 2 ? ` +${humans.length - 2}` : '');
		const sub = [shown, people.includes('Copilot') ? 'Copilot' : ''].filter(Boolean).join(' and ');
		nodes.push({ icon: humans.length ? 'people' : 'bot', title: 'Reviewed', sub, tone: 'purple' });
	}
	const decision = { APPROVED: ['Approved', 'check', 'green'], CHANGES_REQUESTED: ['Changes requested', 'warning', 'orange'], REVIEW_REQUIRED: ['Review required', 'eye', 'neutral'] }[facts.reviewDecision];
	if (decision) {
		const approvers = (facts.approvers ?? []).map(reviewerName);
		const sub = facts.reviewDecision === 'APPROVED' && approvers.length ? `by ${approvers.slice(0, 2).join(', ')}${approvers.length > 2 ? ` +${approvers.length - 2}` : ''}` : 'the review decision';
		nodes.push({ icon: decision[1], title: decision[0], sub, tone: decision[2] });
	}
	if (facts.state === 'MERGED') {
		nodes.push({ icon: 'merge', title: 'Merged', sub: short(facts.mergedAt, now), tone: 'green', result: 'merged', resultTone: 'green' });
	} else if (facts.state === 'CLOSED') {
		nodes.push({ icon: 'dismiss', title: 'Closed', sub: 'not merged', tone: 'red', result: 'closed', resultTone: 'red' });
	} else {
		nodes.push({ icon: 'clock', title: 'Not merged yet', sub: `updated ${short(facts.updatedAt, now)}`, tone: 'neutral', result: 'open', resultTone: 'blue' });
	}
	return nodes;
}

/** The deck.mjs a deck about a pull request starts from: the title card and the status from the PR's real data, and a
 * TODO for the slides that explain it. No end slide: the status carries the link and its QR code. */
export function prDeckSource(facts) {
	const pr = `${facts.repo}#${facts.number}`;
	const url = facts.url;
	const state = { MERGED: { text: 'Merged', tone: 'green', icon: 'merge' }, CLOSED: { text: 'Closed', tone: 'red', icon: 'dismiss' } }[facts.state]
		?? (facts.isDraft ? { text: 'Draft', tone: 'neutral', icon: 'edit' } : { text: 'Open', tone: 'blue', icon: 'pr' });
	const when = day(facts.mergedAt ?? facts.updatedAt ?? facts.createdAt);
	const areas = [...(facts.areas ?? [])].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, 4);
	const tests = typeof facts.testFiles === 'number' ? facts.testFiles : (facts.testFiles?.length ?? 0);
	// By area, or by file when the PR stays in one area (one bar says nothing).
	const files = [...(facts.files ?? [])].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, 4);
	const byFile = areas.length < 2 && files.length > 1;
	const rows = (byFile ? files.map(f => ({ name: f.path.split('/').pop(), additions: f.additions, deletions: f.deletions })) : areas)
		.map(a => `\t\t\t\t\t{ title: ${q(a.name)}, value: ${a.additions + a.deletions}, note: ${q(`+${a.additions} \u2212${a.deletions}`)} },`).join('\n');
	const nodes = statusNodes(facts).map(n => `\t\t\t\t${literal(n)},`).join('\n');
	const login = facts.authorLogin.replace(/\[bot\]$/, '');
	// The name on the author's profile when there is one ("Ben Villalobos", BV), else the login.
	const words = String(facts.authorName ?? '').trim().split(/\s+/).filter(Boolean);
	const initials = words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}`.toUpperCase() : (words[0] ?? login).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
	const speaker = words.length ? { initials, name: words.join(' '), role: `@${login}  \u00b7  author` } : { initials, name: `@${login}`, role: 'author' };
	const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	return `// ${facts.title}
// A deck about ${pr}, for people who won't read the pull request.
// The facts: videos/${parsePrRef(pr).slug}/ in the engine's folder: brief.md (read all of it), pr.diff (search it) and
// the changed files at the head commit (build/src/). The build checks every code line, \`inline code\` and file path on
// the slides against them. The title card and the status come from the PR's data: keep their facts.
export default {
	title: ${q(facts.title)},
	ref: ${q(`${pr}  \u00b7  ${month}`)},
	pr: ${q(pr)},
	slides: [
		{
			id: 'title', layout: 'title',
			eyebrow: ${q(`Pull request #${facts.number}`)},
			title: 'TODO: the point of the PR in at most 8 plain words',
			sub: 'TODO: one sentence: what changes, for whom',
			speaker: ${literal(speaker)},
			pills: [{ text: ${q(state.text)}, tone: ${q(state.tone)}, icon: ${q(state.icon)} }, { text: ${q(when)}, tone: 'neutral', icon: 'calendar' }],
			card: {
				label: ${q(byFile ? 'What changed, by file' : 'What changed, by area')}, big: ${q(`+${facts.additions} \u2212${facts.deletions}`)}, sub: ${q(`${facts.changedFiles} file${facts.changedFiles === 1 ? '' : 's'}${tests ? `  \u00b7  ${tests === facts.changedFiles ? 'all' : tests} of them tests` : ''}`)},
				rows: [
${rows}
				],
			},
			notes: 'TODO: what to say while this slide is up.',
		},
		// TODO: the slides that explain it, as few as give the six answers of the skill's contract (at most ${CAP.slides} slides
		// in all, these two included), in the order of "The slides" in its SKILL.md: what it looks like or does (before and
		// after), how it works, what could break. One idea per slide, a different picture on each; the details go in the notes.
		{
			id: 'status', layout: 'journey', eyebrow: 'Status', title: 'TODO: where to start reading, or what is still open, in a few words',
			nodes: [
${nodes}
			],
			link: { url: ${q(url)}, label: ${q(`PR #${facts.number}`)}, logo: 'github' },
			sources: [${q(`${pr} | ${url}`)}],
			notes: ${q(`${statusNotes(facts)} The QR code opens the pull request. TODO: what is in scope, what follows separately, how it is tested, what is still open, and where to start reading.`)},
		},
	],
};
`;
}

/** prs deck new --pr <PR> [slug]: fetches the PR as prs new does (into videos/<slug>/, which a video of the same PR
 * shares) unless it is there already, and starts decks/<slug>/deck.mjs from its data. */
async function newPrDeck(input, slugArg, { force }) {
	const ref = parsePrRef(input);
	const slug = slugArg ?? ref.slug;
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
		throw new Error(`Not a deck name: "${slug}" (short kebab-case)`);
	}
	const file = path.join(deckDir(slug), 'deck.mjs');
	if (fs.existsSync(file) && !force) {
		throw new Error(`decks/${slug}/deck.mjs exists already (--force replaces it)`);
	}
	const prJson = path.join(videoDir(ref.slug), 'pr.json');
	let data;
	if (fs.existsSync(prJson)) {
		data = readJson(prJson);
		console.log(`${ref.full}#${ref.number}: using the data fetched before (videos/${ref.slug}/)`);
	} else {
		const { newVideo } = await import('./fetch.mjs');
		data = (await newVideo(input, undefined, { skeleton: false })).data;
		console.log(`${ref.full}#${ref.number}: fetched into videos/${ref.slug}/ (brief.md, pr.diff, the changed files)`);
	}
	const { facts } = data;
	fs.mkdirSync(path.join(deckDir(slug), 'assets'), { recursive: true });
	fs.mkdirSync(path.join(deckDir(slug), 'designs'), { recursive: true });
	fs.writeFileSync(file, prDeckSource(facts));
	console.log(`decks/${slug}/deck.mjs: "${facts.title}"`);
	console.log(`  from the PR: the title card (state, size by area), the status (${statusNodes(facts).map(n => n.title).join(' -> ')}) with the PR's QR code`);
	console.log(`  to write: the TODOs, and the slides that explain it: as few as cover the six answers, at most ${CAP.slides} in all (read videos/${ref.slug}/brief.md first)`);
	console.log(`  the folder: ${deckDir(slug)} (pictures in assets/, designs of its own in designs/)`);
	console.log(`  build: prs deck build ${slug}`);
}

/** prs deck new <slug> [--title "..."] [--force] */
function newDeck(slug, { title, force }) {
	if (!slug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
		throw new Error('Give the deck a short kebab-case name: prs deck new <slug> (for example prs deck new changelog-videos)');
	}
	const dir = deckDir(slug);
	const file = path.join(dir, 'deck.mjs');
	if (fs.existsSync(file) && !force) {
		throw new Error(`decks/${slug}/deck.mjs exists already (--force replaces it)`);
	}
	const name = typeof title === 'string' && title.trim() ? title.trim() : slug.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
	const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
	fs.writeFileSync(file, template({ title: name, ref: `${name}  \u00b7  ${month}` }));
	console.log(`decks/${slug}/deck.mjs: a title slide and an end slide to start from.`);
	console.log(`  pictures go in decks/${slug}/assets/, designs of its own in decks/${slug}/designs/`);
	console.log(`  build: prs deck build ${slug}  (the folder: ${dir})`);
}

/** prs deck grid <slug> <assets/x.png> [--vs <assets/y.png>]: the picture with a labelled grid of its own pixels, to
 * read crop, pin and ring coordinates from. With --vs (a before and an after of the same screen), it also outlines where
 * the two differ and prints that box. Writes decks/<slug>/out/grid/<name>.png. */
async function gridPicture(slug, src, { vs } = {}) {
	const file = path.resolve(deckDir(slug), src ?? '');
	if (!src || !fs.existsSync(file)) {
		throw new Error(`No picture "${src}" in decks/${slug}/ (give its path in the deck, for example assets/dialog.png)`);
	}
	const other = typeof vs === 'string' ? path.resolve(deckDir(slug), vs) : null;
	if (other && !fs.existsSync(other)) {
		throw new Error(`No picture "${vs}" in decks/${slug}/`);
	}
	const { pngSize } = await import('../../deck/layouts.mjs');
	const { width, height } = pngSize(file);
	if (other) {
		const o = pngSize(other);
		if (o.width !== width || o.height !== height) {
			throw new Error(`--vs: the pictures differ in size (${width} x ${height} and ${o.width} x ${o.height}): compare two shots of the same screen`);
		}
	}
	// Data URLs: a canvas may read their pixels (file URLs would taint it).
	const dataUrl = f => `data:image/${/\.jpe?g$/i.test(f) ? 'jpeg' : 'png'};base64,${fs.readFileSync(f).toString('base64')}`;
	// Lines every `step` pixels of the picture, labelled; a small picture is drawn twice as big and a large one at most
	// 2400 px wide, the labels always in the picture's own pixels.
	const step = Math.max(width, height) <= 1000 ? 50 : Math.max(width, height) <= 2400 ? 100 : 200;
	const k = Math.min(2400 / width, width < 1200 ? 2 : 1);
	const lines = [];
	for (let x = 0; x <= width; x += step) {
		lines.push(`<div class="v${x % (step * 2) ? '' : ' major'}" style="left:${x * k}px"></div><span class="lx" style="left:${x * k + 3}px">${x}</span>`);
	}
	for (let y = 0; y <= height; y += step) {
		lines.push(`<div class="h${y % (step * 2) ? '' : ' major'}" style="top:${y * k}px"></div><span class="ly" style="top:${y * k + 2}px">${y}</span>`);
	}
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0} .wrap{position:relative;width:${width * k}px;height:${height * k}px;font:600 13px/1 Menlo,monospace}
img{position:absolute;inset:0;width:100%;height:100%}
.v,.h{position:absolute;background:rgba(255,0,140,.38)} .v{top:0;bottom:0;width:1px} .h{left:0;right:0;height:1px}
.major{background:rgba(255,0,140,.7)}
.lx,.ly{position:absolute;padding:1px 3px;background:#ff008c;color:#fff;border-radius:3px}
.lx{top:2px} .ly{left:2px}
.diff{position:absolute;box-shadow:0 0 0 3px #00b7ff;border-radius:4px}
</style></head><body><div class="wrap"><img id="a" src="${dataUrl(file)}">${lines.join('')}</div>${other ? `<img id="b" src="${dataUrl(other)}" style="display:none">` : ''}
<script>
window.__diff = null;
window.__ready = (async () => {
	const imgs = [...document.images];
	await Promise.all(imgs.map(i => i.decode()));
	if (imgs.length < 2) return;
	const px = img => { const c = document.createElement('canvas'); c.width = ${width}; c.height = ${height}; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, ${width}, ${height}).data; };
	const a = px(imgs[0]), b = px(imgs[1]);
	let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
	for (let y = 0; y < ${height}; y++) for (let x = 0; x < ${width}; x++) {
		const i = (y * ${width} + x) * 4;
		if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
	}
	if (x1 < 0) return;
	window.__diff = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
	const d = document.createElement('div'); d.className = 'diff';
	Object.assign(d.style, { left: x0 * ${k} + 'px', top: y0 * ${k} + 'px', width: (x1 - x0 + 1) * ${k} + 'px', height: (y1 - y0 + 1) * ${k} + 'px' });
	document.querySelector('.wrap').append(d);
})();
</script></body></html>`;
	const out = path.join(deckDir(slug), 'out', 'grid');
	fs.mkdirSync(out, { recursive: true });
	const htmlFile = path.join(out, `${path.basename(file).replace(/\.[^.]+$/, '')}.html`);
	fs.writeFileSync(htmlFile, html);
	const { launch } = await import('./browser.mjs');
	const browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: Math.ceil(width * k), height: Math.ceil(height * k) } });
		await page.goto(pathToFileURL(htmlFile).href);
		await page.evaluate(() => window.__ready);
		const png = htmlFile.replace(/\.html$/, '.png');
		await page.locator('.wrap').screenshot({ path: png });
		console.log(`${path.relative(deckDir(slug), png)}: ${width} x ${height} px, a line every ${step} px (labels in the picture's own pixels)`);
		if (other) {
			const diff = await page.evaluate(() => window.__diff);
			console.log(diff ? `They differ in [${diff.join(', ')}] ([x, y, w, h], outlined in blue): ring that region on both (box), and crop around it.` : 'The two pictures are the same.');
		}
	} finally {
		await browser.close();
	}
}

async function build(dir, { deliverDir, pdf = true, outName = 'out', show = outName }) {
	const { buildDeck } = await import('../../deck/build.mjs');
	const result = await buildDeck(dir, { deliverDir, pdf, outName });
	const shown = f => f.replace(`${path.sep}${outName}${path.sep}`, `${path.sep}${show}${path.sep}`).replace(new RegExp(`(^|[ /])${outName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g'), `$1${show}/`);
	console.log(result.report.filter(l => !/^ {2}(ink|body|muted|blue|green|red|orange|purple|yellow|on dark|on blue) /.test(l) && l !== 'Text colours (WCAG contrast):').map(shown).join('\n'));
	console.log(`Contact sheet: ${shown(result.files.contact)}`);
	console.log(`Pages: ${shown(result.files.slides)}/NNN.png  \u00b7  checks: ${shown(result.files.checks)}`);
	return result.lint.length === 0 && result.pageErrors.length === 0;
}

/** prs deck samples: built in a folder of this run, then swapped in for deck/samples/out/, so sessions that share the
 * engine never read a half-built set of pages. */
async function buildSamples({ pdf }) {
	const tmp = `out.${process.pid}`, old = `out.old.${process.pid}`;
	fs.rmSync(path.join(SAMPLES, tmp), { recursive: true, force: true });
	const ok = await build(SAMPLES, { deliverDir: null, pdf, outName: tmp, show: 'out' });
	if (fs.existsSync(path.join(SAMPLES, 'out'))) {
		fs.renameSync(path.join(SAMPLES, 'out'), path.join(SAMPLES, old));
	}
	fs.renameSync(path.join(SAMPLES, tmp), path.join(SAMPLES, 'out'));
	fs.rmSync(path.join(SAMPLES, old), { recursive: true, force: true });
	return ok;
}

/** prs deck <new|build|samples|list> ... Returns the exit code. */
export async function deckCommand(args) {
	const [sub, ...rest] = args._;
	if (['build', 'samples', 'grid'].includes(sub)) {
		await (await import('./doctor.mjs')).ensureTools();
	}
	switch (sub) {
		case 'new':
			if (typeof args.pr === 'string') {
				await newPrDeck(args.pr, rest[0], { force: !!args.force });
			} else {
				newDeck(rest[0], { title: args.title, force: !!args.force });
			}
			return 0;
		case 'build': {
			const slug = resolveDeck(rest[0]);
			const deliverDir = args['no-deliver'] ? null : path.join(loadConfig().deliverDecks, slug);
			return (await build(deckDir(slug), { deliverDir, pdf: !args['no-pdf'] })) ? 0 : 1;
		}
		case 'samples':
			return (await buildSamples({ pdf: !args['no-pdf'] })) ? 0 : 1;
		case 'review': {
			const { deckReviewPack } = await import('./review.mjs');
			await deckReviewPack(deckDir(resolveDeck(rest[0])));
			return 0;
		}
		case 'grid':
			await gridPicture(resolveDeck(rest[0]), rest[1], { vs: args.vs });
			return 0;
		case 'list': {
			const root = path.join(ROOT, 'decks');
			const all = fs.existsSync(root) ? fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'deck.mjs'))) : [];
			console.log(all.length ? all.map(d => `decks/${d}`).join('\n') : 'No decks yet: prs deck new <slug> starts one');
			return 0;
		}
		default:
			console.error('prs deck new --pr <PR> [slug] | new <slug> [--title "..."] | build [slug] [--no-deliver] | review <slug> | grid <slug> <assets/x.png> [--vs <assets/y.png>] | samples | list');
			return 2;
	}
}
