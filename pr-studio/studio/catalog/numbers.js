// need: numbers. Sizes and counts: lines, files, measurements.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { el, factsContext, tile, txt } from '../theme/primitives.js';
import { count, decel, enter, fmt, prog } from '../engine/motion.js';
import { label, fact, textOf } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/** 2-4 big numbers that count up when the narration says them. Numbers must come from fact() or quote(). */
export const counters = defineTreatment({
	id: 'numbers.counters',
	need: 'numbers',
	name: 'Big numbers',
	when: 'A few numbers carry the point (lines removed, ms saved, files touched). Each value comes from fact() or quote().',
	params: { eyebrow: 'label', title: 'label', stats: '[{ value: fact()|quote(), label, sub, tone, at }]  (2-4)', note: 'label (optional line under the tiles)' },
	demo: () => ({ eyebrow: label('By the numbers'), title: label('Smaller and faster'), stats: [{ value: fact('additions'), label: label('lines added'), tone: 'green' }, { value: fact('deletions'), label: label('lines removed'), tone: 'red' }, { value: fact('changedFiles'), label: label('files'), tone: 'blue' }] }),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const stats = p.stats ?? [];
		need(stats.length >= 1 && stats.length <= 4, 'numbers.counters: 1-4 stats');
		const gap = 28, w = (1728 - gap * (stats.length - 1)) / stats.length;
		const top = 300, height = 420;
		const els = stats.map((s, k) => {
			const tone = s.tone ?? ['blue', 'green', 'purple', 'orange'][k];
			const c = tile(root, tone, { left: 96 + k * (w + gap), top, width: w, height, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 30px' });
			const text = textOf(s.value, factsContext());
			const m = text.match(/^([+\u2212-]?)([\d,]+)(.*)$/);
			const num = txt(c, s.value, 'st-num', { fontSize: stats.length > 3 ? 104 : 128, color: TONE[tone].fg, whiteSpace: 'nowrap' }, 'div');
			txt(c, s.label, '', { display: 'block', fontSize: 28, fontWeight: 600, color: C.ink, marginTop: 18 }, 'div');
			if (s.sub) {
				txt(c, s.sub, 'st-small', { display: 'block', fontSize: 20, marginTop: 6 }, 'div');
			}
			return { c, num, parts: m ? { sign: m[1], value: Number(m[2].replace(/,/g, '')), rest: m[3] } : null };
		});
		let note = null;
		if (p.note) {
			note = txt(root, p.note, 'st-abs', { left: 96, width: 1728, top: top + height + 40, textAlign: 'center', fontSize: 25, color: C.body }, 'div');
		}
		return { h, els, note, times: spread(ctx, stats, { lead: 1.0, tail: 1.5 }) };
	},
	render(i, t) {
		i.h.render(t);
		i.els.forEach((e, k) => {
			const at = i.times[k];
			enter(e.c, t, at - 0.3, { dy: 18 });
			if (e.parts) {
				e.num.textContent = `${e.parts.sign}${fmt(count(t, at - 0.1, 1.0, e.parts.value))}${e.parts.rest}`;
			}
		});
		if (i.note) {
			enter(i.note, t, i.times.at(-1) + 0.9, { dy: 8 });
		}
	},
});

function squarify(items, x, y, w, h) {
	const total = items.reduce((a, b) => a + b.value, 0);
	const out = [];
	let rest = items.map(it => ({ ...it, area: (it.value / total) * w * h }));
	let rx = x, ry = y, rw = w, rh = h;
	const worst = (row, side) => {
		const s = row.reduce((a, b) => a + b.area, 0);
		const max = Math.max(...row.map(r => r.area)), min = Math.min(...row.map(r => r.area));
		return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
	};
	while (rest.length) {
		const side = Math.min(rw, rh);
		let row = [rest[0]];
		let i = 1;
		while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) {
			row.push(rest[i++]);
		}
		const s = row.reduce((a, b) => a + b.area, 0);
		if (rw >= rh) {
			const cw = s / rh;
			let cy = ry;
			for (const r of row) {
				const ch = r.area / cw;
				out.push({ ...r, x: rx, y: cy, w: cw, h: ch });
				cy += ch;
			}
			rx += cw;
			rw -= cw;
		} else {
			const ch = s / rw;
			let cx = rx;
			for (const r of row) {
				const cw = r.area / ch;
				out.push({ ...r, x: cx, y: ry, w: cw, h: ch });
				cx += cw;
			}
			ry += ch;
			rh -= ch;
		}
		rest = rest.slice(i);
	}
	return out;
}

/** Where the lines went: one rectangle per area, sized by changed lines; highlighted areas light up on cue. */
export const treemap = defineTreatment({
	id: 'numbers.treemap',
	need: 'numbers',
	name: 'Treemap of the change',
	when: 'A big or cross-cutting PR: show which areas carry most of the change (data comes from the PR, nothing to type).',
	params: { eyebrow: 'label', title: 'label', highlight: '[{ area, note, at }]  (optional: areas to call out)' },
	demo: () => ({ eyebrow: label('Where the change is'), title: label('Most of it is in one service') }),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const F = ctx.facts;
		const areas = [...F.areas].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
		const top = areas.slice(0, 9).map(a => ({ name: a.name, value: Math.max(1, a.additions + a.deletions), a }));
		if (areas.length > 9) {
			const rest = areas.slice(9);
			top.push({ name: `${rest.length} more areas`, value: rest.reduce((s, a) => s + a.additions + a.deletions, 0), a: null });
		}
		const rects = squarify(top, 96, 250, 1728, 640);
		const tones = ['blue', 'purple', 'green', 'orange', 'neutral'];
		const els = rects.map((r, k) => {
			const tone = tones[k % tones.length];
			const box = tile(root, tone, { left: r.x + 4, top: r.y + 4, width: r.w - 8, height: r.h - 8, padding: '18px 20px', overflow: 'hidden' });
			box.style.border = '2px solid transparent';
			const big = r.w > 260 && r.h > 110;
			const nameEl = big || (r.w > 150 && r.h > 60) ? txt(box, label(r.name), 'st-mono', { display: 'block', fontSize: big ? 21 : 16, fontWeight: 600, color: TONE[tone].fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 'div') : null;
			if (nameEl) {
				nameEl.dataset.src = 'fact:areas';
			}
			if (r.a && big) {
				const n = txt(box, label(`+${fmt(r.a.additions)} \u2212${fmt(r.a.deletions)} \u00b7 ${r.a.files} ${r.a.files === 1 ? 'file' : 'files'}`), 'st-mono', { display: 'block', marginTop: 8, fontSize: 17, color: C.body, whiteSpace: 'nowrap' }, 'div');
				n.dataset.src = 'fact:areas';
			}
			return { box, r, tone };
		});
		const highlights = (p.highlight ?? []).map(hl => {
			const e = els.find(x => x.r.name === hl.area);
			need(e, `highlight: no area "${hl.area}" (areas: ${top.map(x => x.name).join(', ')})`);
			let note = null;
			if (hl.note) {
				note = el('div', 'st-abs', root, { left: e.r.x + 18, top: e.r.y + e.r.h - 64 });
				const pillEl = el('div', 'st-pill', note, { background: '#fff', color: TONE[e.tone].fg, height: 40, fontSize: 18, border: `2px solid ${TONE[e.tone].fg}` });
				pillEl.dataset.box = 'pill';
				txt(pillEl, hl.note);
			}
			return { e, note, at: hl.at };
		});
		return { h, els, highlights, times: spread(ctx, highlights, { lead: 2, tail: 1.2 }) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.els.forEach((e, k) => {
			const q = decel(prog(t, s + 0.4 + k * 0.08, s + 1.0 + k * 0.08));
			e.box.style.opacity = String(q);
			e.box.style.transform = `scale(${0.96 + 0.04 * q})`;
		});
		const any = i.highlights.some((hl, k) => t >= i.times[k]);
		i.els.forEach(e => {
			const lit = i.highlights.some((hl, k) => hl.e === e && t >= i.times[k]);
			if (any && !lit) {
				e.box.style.opacity = String(Number(e.box.style.opacity) * 0.45);
			}
			e.box.style.borderColor = lit ? TONE[e.tone].fg : 'transparent';
		});
		i.highlights.forEach((hl, k) => {
			if (hl.note) {
				enter(hl.note, t, i.times[k] + 0.2, { dy: 8 });
			}
		});
	},
});
