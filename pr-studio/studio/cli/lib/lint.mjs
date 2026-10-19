// prs lint: renders many frames and checks layout and text provenance; decodes the end card QR; checks novelty.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { launch, openVideo } from './browser.mjs';
import { buildDir, readJson } from './common.mjs';
import { noveltyProblems } from './history.mjs';

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
	const browser = await launch();
	const problems = [];
	let qr = null;
	let meta = null;
	try {
		const workers = 4;
		let next = 0;
		await Promise.all(Array.from({ length: workers }, async (_, w) => {
			const v = await openVideo(browser, bdir);
			while (next < times.length) {
				const t = times[next++];
				await v.renderAt(t);
				for (const p of await v.page.evaluate(inspectFrame)) {
					problems.push({ t, ...p });
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
	const total = uniq.size + (qr ? 1 : 0) + novelty.length + late.length;
	console.log(`lint: ${times.length} frames checked, ${total} problem${total === 1 ? '' : 's'}`);
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
	fs.writeFileSync(path.join(bdir, 'lint.json'), JSON.stringify({ frames: times.length, problems: [...uniq.values()], qr, novelty }, null, 1));
	return total === 0;
}
