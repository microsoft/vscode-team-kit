// prs lint: renders many frames and checks layout and text provenance; decodes the end card QR; checks novelty.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { launch, openVideo } from './browser.mjs';
import { buildDir, readJson } from './common.mjs';
import { noveltyProblems } from './history.mjs';

// What the reviewers kept catching, as checks. Text needs time to be read before its beat leaves (a problem). An element
// the narration names should be on screen by then, and a beat should not show only its heading for long (warnings: a
// name can be said early on purpose, and a list can come in row by row).
const NAMED_LATE = 3;
const READ_MIN = 1.5;
const READ_PER_WORD = 0.2;
const HEADING_ONLY = 2.5;
const TIMING_STEP = 0.25;
const STOP = new Set(['this', 'that', 'these', 'those', 'with', 'from', 'into', 'onto', 'when', 'then', 'than', 'they', 'them', 'their', 'there', 'what', 'which', 'where', 'while', 'have', 'been', 'were', 'will', 'would', 'could', 'should', 'each', 'every', 'only', 'also', 'just', 'more', 'most', 'some', 'such', 'over', 'under', 'after', 'before', 'about', 'other', 'your', 'here', 'does', 'done', 'make', 'makes', 'made', 'like', 'once', 'same', 'both', 'very']);

function sampleTimes(project, every) {
	const times = new Set();
	const add = t => {
		if (t >= 0 && t < project.video.total) {
			times.add(+t.toFixed(2));
		}
	};
	for (const b of project.beats) {
		for (let k = 1; k <= 12; k++) {
			add(b.start + ((b.end - b.start) * k) / 13);
		}
		for (const c of Object.values(b.cues)) {
			add(c + 0.7);
			add(c + 1.6);
		}
		add(b.end - 0.05);
	}
	for (const d of [0.4, 1, 2, 3]) {
		add(project.video.total - d);
	}
	add(0);
	if (every) {
		for (let t = 0; t < project.video.total; t += every) {
			add(t);
		}
	}
	return [...times].sort((a, b) => a - b);
}

/** Runs inside the page: returns layout and provenance problems of the current frame. */
function inspectFrame() {
	const opacityOf = el => {
		let o = 1;
		for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
			const s = getComputedStyle(e);
			if (s.display === 'none' || s.visibility === 'hidden') {
				return 0;
			}
			o *= Number(s.opacity);
		}
		return o;
	};
	const texts = [];
	const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
	const seen = new Map();
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (!n.textContent.trim()) {
			continue;
		}
		const el = n.parentElement;
		const op = opacityOf(el);
		if (op < 0.35) {
			continue;
		}
		const range = document.createRange();
		range.selectNodeContents(n);
		let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
		const lines = [];
		for (const rc of range.getClientRects()) {
			if (rc.width < 0.5) {
				continue;
			}
			lines.push({ l: rc.left, t: rc.top, r: rc.right, b: rc.bottom });
			l = Math.min(l, rc.left); t = Math.min(t, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
		}
		if (!isFinite(l)) {
			continue;
		}
		const entry = seen.get(el) ?? { el, rect: { l, t, r, b }, text: '', lines: [] };
		entry.lines.push(...lines);
		entry.rect = { l: Math.min(entry.rect.l, l), t: Math.min(entry.rect.t, t), r: Math.max(entry.rect.r, r), b: Math.max(entry.rect.b, b) };
		entry.text = (entry.text + n.textContent).slice(0, 80);
		seen.set(el, entry);
	}
	texts.push(...seen.values());
	const out = [];
	// While the camera flies between panels (canvas mode), text crossing the frame edge is expected.
	const moving = (window.__moving ?? 0) > 0.001;
	const R = x => [x.l, x.t, x.r, x.b].map(Math.round);
	for (const x of texts) {
		const { l, t, r, b } = x.rect;
		const inCode = !!x.el.closest('[data-box="code"]');
		const inCaptions = !!x.el.closest('.st-captions');
		if (!x.el.closest('[data-src]')) {
			out.push({ kind: 'no-provenance', text: x.text, rect: R(x.rect) });
		}
		if (!moving && (l < -0.5 || t < -0.5 || r > 1920.5 || b > 1080.5)) {
			out.push({ kind: 'offscreen', text: x.text, rect: R(x.rect) });
		}
		const box = x.el.closest('[data-box]');
		if (box && !inCaptions) {
			const br = box.getBoundingClientRect();
			const horiz = l < br.left + 1.5 || r > br.right - 1.5;
			const vert = !inCode && (t < br.top - 0.5 || b > br.bottom + 0.5);
			if (horiz || vert) {
				out.push({ kind: 'outside-box', text: x.text, rect: R(x.rect), box: [br.left, br.top, br.right, br.bottom].map(Math.round), boxKind: box.dataset.box });
			}
		}
		for (let e = x.el.parentElement; e && e.id !== 'app'; e = e.parentElement) {
			const s = getComputedStyle(e);
			if (s.overflowX === 'visible' && s.overflowY === 'visible') {
				continue;
			}
			const er = e.getBoundingClientRect();
			const clippedX = l < er.left - 0.5 || r > er.right + 0.5;
			const clippedY = !inCode && (t < er.top - 0.5 || b > er.bottom + 0.5);
			if (clippedX || clippedY) {
				// An ellipsis on purpose (text-overflow) is fine for secondary text like paths.
				if (getComputedStyle(x.el).textOverflow === 'ellipsis' && x.el.scrollWidth > x.el.clientWidth) {
					break;
				}
				out.push({ kind: 'clipped', text: x.text, rect: R(x.rect), by: e.className || e.tagName });
				break;
			}
		}
		if (!moving && !inCaptions && b > 935) {
			out.push({ kind: 'caption-band', text: x.text, rect: R(x.rect) });
		}
	}
	for (let a = 0; a < texts.length; a++) {
		for (let c = a + 1; c < texts.length; c++) {
			const A = texts[a], B = texts[c];
			if (A.el.contains(B.el) || B.el.contains(A.el)) {
				continue;
			}
			// The morph object takes off from and lands on its anchors: overlapping them is the point.
			if (A.el.closest('[data-flight]') || B.el.closest('[data-flight]')) {
				continue;
			}
			// Layers that are never both visible in the same place (a wipe's before/after) don't collide.
			const xa = A.el.closest('[data-exclusive]')?.dataset.exclusive, xb = B.el.closest('[data-exclusive]')?.dataset.exclusive;
			if (xa && xb && xa.split(':')[0] === xb.split(':')[0] && xa !== xb) {
				continue;
			}
			let worst = null;
			for (const a1 of A.lines) {
				for (const b1 of B.lines) {
					const w = Math.min(a1.r, b1.r) - Math.max(a1.l, b1.l);
					const h = Math.min(a1.b, b1.b) - Math.max(a1.t, b1.t);
					if (w > 2 && h > 2 && (!worst || w * h > worst[0] * worst[1])) {
						worst = [Math.round(w), Math.round(h)];
					}
				}
			}
			if (worst) {
				out.push({ kind: 'text-overlap', text: `${A.text}  \u00d7  ${B.text}`, rect: worst });
			}
		}
	}
	return out;
}

/** Runs inside the page: for each beat on screen, the text of its body (not its heading or code) visible now, by an id
 * that is the same in every page (the element's place in its beat), and whether anything of the body shows at all. */
function inspectTiming() {
	const shown = el => {
		let o = 1;
		for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
			const s = getComputedStyle(e);
			if (s.display === 'none' || s.visibility === 'hidden') {
				return 0;
			}
			o *= Number(s.opacity);
		}
		return o;
	};
	const out = {};
	for (const host of document.querySelectorAll('[data-beat]')) {
		if (getComputedStyle(host).display === 'none') {
			continue;
		}
		const texts = [];
		let body = false;
		host.querySelectorAll('*').forEach((el, i) => {
			if (el.closest('[data-head]')) {
				return;
			}
			const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
			const shape = ['IMG', 'CANVAS', 'VIDEO', 'svg'].includes(el.tagName);
			if (!own && !shape) {
				return;
			}
			const r = el.getBoundingClientRect();
			if (r.width < 1 || r.height < 1 || shown(el) < 0.5) {
				return;
			}
			body = true;
			if (own && !el.closest('[data-box="code"]')) {
				texts.push([i, own.slice(0, 80)]);
			}
		});
		out[host.dataset.beat] = { body, texts };
	}
	return out;
}

/** The words of a text, as lint compares them: lower case, camelCase split, a plural's s dropped. */
function contentWords(text) {
	return String(text).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
		.filter(w => w.length >= 4 && !STOP.has(w)).map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Named-late, reading-time and heading-only findings, from the body text visible in each beat over time. */
export function timingProblems(project, frames) {
	const problems = [], warnings = [], appear = {};
	project.beats.forEach((b, k) => {
		if (b.need === 'title') {
			return;
		}
		const leave = k === project.beats.length - 1 ? project.video.endAt : b.end;
		const mine = frames.filter(f => f.t >= b.start && f.t < leave && f.beats[b.id]).sort((x, y) => x.t - y.t);
		if (!mine.length) {
			return;
		}
		const lastT = mine.at(-1).t;
		const firstBody = mine.find(f => f.beats[b.id].body)?.t;
		if (firstBody === undefined || firstBody - b.start > HEADING_ONLY + 0.5) {
			warnings.push({ kind: 'heading-only', beat: b.id, text: '', detail: `only the heading shows for ${((firstBody ?? leave) - b.start).toFixed(1)} s: bring the first part of the body in sooner` });
		}
		const seen = new Map();
		for (const f of mine) {
			for (const [id, text] of f.beats[b.id].texts) {
				const e = seen.get(id) ?? { first: f.t, last: f.t, text };
				e.last = f.t;
				e.text = text;
				seen.set(id, e);
			}
		}
		const said = (b.words ?? []).map(w => ({ a: w.a, word: contentWords(w.display)[0] })).filter(w => w.word);
		appear[b.id] = [...seen.values()].map(e => ({ text: e.text, from: +e.first.toFixed(2), until: +e.last.toFixed(2) })).sort((x, y) => x.from - y.from);
		const lateFor = e => {
			const head = contentWords(e.text).at(-1);
			const named = e.text.split(/\s+/).filter(Boolean).length <= 6 && head ? said.find(w => w.word === head) : null;
			return named && e.first - named.a > NAMED_LATE && e.first > b.start + 0.6 ? { head, named } : null;
		};
		// Late elements that share a head word but come in at different times are a list shown row by row: not late.
		const lateTimes = new Map();
		for (const e of seen.values()) {
			const late = lateFor(e);
			if (late) {
				lateTimes.set(late.head, [...(lateTimes.get(late.head) ?? []), e.first]);
			}
		}
		const rows = head => Math.max(...lateTimes.get(head)) - Math.min(...lateTimes.get(head)) > 0.3;
		for (const e of seen.values()) {
			const words = e.text.split(/\s+/).filter(Boolean).length;
			const late = lateFor(e);
			const head = late?.head, named = late?.named;
			if (late && !rows(head)) {
				warnings.push({ kind: 'named-late', beat: b.id, text: e.text, detail: `appears ${(e.first - named.a).toFixed(1)} s after "${head}" is said (${named.a.toFixed(1)} s): if a viewer would look for it then, time it to the word, at: word('${head}')`, t: e.first });
			}
			const need = Math.max(READ_MIN, READ_PER_WORD * words);
			if (e.last >= lastT - TIMING_STEP * 1.5 && leave - e.first < need - 0.05) {
				problems.push({ kind: 'reading-time', beat: b.id, text: e.text, detail: `is up ${(leave - e.first).toFixed(1)} s before the beat leaves; reading it takes ${need.toFixed(1)} s: bring it in sooner, or give the beat a "hold" in the storyboard`, t: e.first });
			}
		}
	});
	return { problems, warnings, appear };
}

async function checkQr(v, project) {
	const at = project.video.endAt + 2;
	await v.renderAt(at);
	const rect = await v.page.evaluate(() => {
		const svg = document.querySelector('svg[data-qr]');
		if (!svg) {
			return null;
		}
		const r = svg.getBoundingClientRect();
		return { x: r.left - 20, y: r.top - 20, width: r.width + 40, height: r.height + 40, want: svg.dataset.qr };
	});
	if (!rect) {
		return 'no QR code on the end card';
	}
	const buf = await v.page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
	const png = PNG.sync.read(buf);
	const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
	if (!code) {
		return 'the end card QR code does not decode';
	}
	return code.data === project.pr.facts.url ? null : `the QR code opens ${code.data}, not ${project.pr.facts.url}`;
}

export async function lint(slug, { every = 0 } = {}) {
	const bdir = buildDir(slug);
	const project = readJson(path.join(bdir, 'project.json'));
	const times = sampleTimes(project, every);
	// The timing checks look at each beat every quarter second, from its start until it leaves.
	const timing = new Set();
	project.beats.forEach((b, k) => {
		const leave = k === project.beats.length - 1 ? project.video.endAt : b.end;
		for (let t = b.start; t < leave; t += TIMING_STEP) {
			timing.add(+t.toFixed(2));
		}
	});
	const layout = new Set(times);
	const tasks = [...new Set([...times, ...timing])].sort((a, b) => a - b);
	const browser = await launch();
	const problems = [];
	const frames = [];
	let qr = null;
	let meta = null;
	try {
		const workers = 4;
		let next = 0;
		await Promise.all(Array.from({ length: workers }, async (_, w) => {
			const v = await openVideo(browser, bdir);
			while (next < tasks.length) {
				const t = tasks[next++];
				await v.renderAt(t);
				if (layout.has(t)) {
					for (const p of await v.page.evaluate(inspectFrame)) {
						problems.push({ t, ...p });
					}
				}
				if (timing.has(t)) {
					frames.push({ t, beats: await v.page.evaluate(inspectTiming) });
				}
			}
			if (w === 0) {
				qr = await checkQr(v, project);
				meta = await v.meta();
			}
			await v.page.close();
		}));
	} finally {
		await browser.close();
	}
	const uniq = new Map();
	for (const p of problems.sort((a, b) => a.t - b.t)) {
		const key = `${p.kind}|${p.text}`;
		if (!uniq.has(key)) {
			uniq.set(key, { ...p, times: [p.t] });
		} else {
			uniq.get(key).times.push(p.t);
		}
	}
	const novelty = slug.startsWith('_') ? [] : noveltyProblems(slug, meta); // _catalog, _smoke: not real videos
	const late = meta?.late ?? [];
	const timed = timingProblems(project, frames);
	const total = uniq.size + (qr ? 1 : 0) + novelty.length + late.length + timed.problems.length;
	console.log(`lint: ${times.length} frames checked, ${total} problem${total === 1 ? '' : 's'}${timed.warnings.length ? `, ${timed.warnings.length} warning${timed.warnings.length === 1 ? '' : 's'} (worth a look; they don't block publishing)` : ''}`);
	for (const p of uniq.values()) {
		const { t, times: ts, kind, text, ...rest } = p;
		void t;
		const beat = project.beats.findLast(b => ts[0] >= b.start - 0.4)?.id ?? '?';
		console.log(`  ${kind.padEnd(14)} ${beat.padEnd(12)} at ${ts.slice(0, 3).map(x => `${x}s`).join(', ')}${ts.length > 3 ? ` (+${ts.length - 3})` : ''}  "${text}"  ${JSON.stringify(rest)}`);
	}
	if (qr) {
		console.log(`  qr             ${qr}`);
	}
	for (const n of novelty) {
		console.log(`  novelty        ${n}`);
	}
	for (const l of late) {
		console.log(`  late           ${l.beat.padEnd(12)} ${l.ref} is at ${l.at}s but the beat starts leaving at ${l.leaves}s: time it earlier`);
	}
	for (const p of timed.problems) {
		console.log(`  ${p.kind.padEnd(14)} ${p.beat.padEnd(12)} "${p.text}" ${p.detail}`);
	}
	for (const p of timed.warnings) {
		console.log(`  ${`${p.kind} (warning)`.padEnd(24)} ${p.beat.padEnd(12)} ${p.text ? `"${p.text}" ` : ''}${p.detail}`);
	}
	fs.writeFileSync(path.join(bdir, 'lint.json'), JSON.stringify({ frames: times.length, problems: [...uniq.values()], qr, novelty, late, timing: timed }, null, 1));
	return total === 0;
}
