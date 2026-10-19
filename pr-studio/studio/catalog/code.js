// need: code. The code itself: the key lines, a diff, notes on what each part does.
import { defineTreatment } from '../engine/scene.js';
import { C, STEP, TONE } from '../theme/tokens.js';
import { badge, card, connector, el, svgLayer, tile, txt } from '../theme/primitives.js';
import { codePanel, diffPanel } from '../theme/code.js';
import { decel, enter, prog, standard } from '../engine/motion.js';
import { code as codeRef, label } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/** A code panel on the left; numbered notes on the right; the focus band moves to each note's lines. */
export const walkthrough = defineTreatment({
	id: 'code.walkthrough',
	need: 'code',
	name: 'Code walkthrough',
	when: 'One function (up to ~30 lines) is the heart of the PR; 2-4 notes explain its parts in order.',
	params: {
		eyebrow: 'label', title: 'label',
		block: 'code(file, { from, to }) or code(file, { anchor, block: true })',
		notes: '[{ lines: [from, to], title, text, at }]  (2-4)',
	},
	demo: () => ({
		eyebrow: label('The code'), title: label('One function does the work'),
		block: codeRef('demo/src/cache.ts', { from: 1, to: 16 }),
		notes: [{ lines: [3, 5], title: label('Look it up'), text: label('return the cached value when it is fresh') }, { lines: [7, 10], title: label('Load it'), text: label('read once, then remember') }, { lines: [12, 14], title: label('Invalidate'), text: label('drop it when the file changes') }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const block = ctx.code(p.block);
		const notes = p.notes ?? [];
		need(notes.length >= 1 && notes.length <= 4, 'code.walkthrough: 1-4 notes');
		const times = spread(ctx, notes, { lead: 1.0, tail: 1.4 });
		const panel = codePanel(root, block, { x: 96, y: 236, w: 1150, h: 664, revealAt: ctx.beat.start + 0.5, focus: notes.map((n, k) => ({ at: times[k], from: n.lines[0], to: n.lines[1] })) });
		const noteH = Math.min(150, (664 - (notes.length - 1) * 18) / notes.length);
		const noteEls = notes.map((n, k) => {
			const c = card(root, { left: 1282, top: 236 + k * (noteH + 18), width: 542, height: noteH, padding: '22px 26px 0 82px' });
			const bar = el('div', 'st-abs', c, { left: 0, top: 0, bottom: 0, width: 6, borderRadius: '18px 0 0 18px', background: STEP[k % STEP.length], transformOrigin: '50% 50%' });
			badge(c, { n: k + 1, size: 38, color: STEP[k % STEP.length], style: { position: 'absolute', left: 26, top: 22 } });
			txt(c, n.title, 'st-h4', { display: 'block', fontSize: 25, whiteSpace: 'nowrap' }, 'div');
			if (n.text) {
				txt(c, n.text, 'st-small', { display: 'block', marginTop: 6, fontSize: 19 }, 'div');
			}
			txt(c, label(`lines ${n.lines[0]}\u2013${n.lines[1]}`), 'st-mono st-abs', { right: 22, top: 26, fontSize: 15, color: C.muted }, 'div');
			return { c, bar };
		});
		return { h, panel, noteEls, times };
	},
	render(i, t) {
		i.h.render(t);
		i.panel.render(t);
		i.noteEls.forEach((n, k) => {
			const at = i.times[k];
			enter(n.c, t, at - 0.2, { dx: 16, dy: 0 });
			const next = i.times[k + 1] ?? Infinity;
			const active = t >= at && t < next;
			n.c.style.borderColor = active ? STEP[k % STEP.length] : C.line;
			n.c.style.opacity = String(Number(n.c.style.opacity) * (t >= next ? 0.55 : 1));
			n.bar.style.transform = `scaleY(${decel(prog(t, at, at + 0.4))})`;
		});
	},
});

/** The diff itself: removed and added lines, with callouts pinned to the lines that matter. */
export const diff = defineTreatment({
	id: 'code.diff',
	need: 'code',
	name: 'Diff with callouts',
	when: 'The change is small and the exact lines tell the story (a condition flipped, a guard added, a value changed). Up to ~18 diff lines.',
	params: {
		eyebrow: 'label', title: 'label',
		hunk: 'code(file, { diff: true, anchor })  (optionally from/to to trim)',
		callouts: '[{ line: line number (new, or old for a removed line), text, tone, at }]  (1-4)',
	},
	demo: () => ({
		eyebrow: label('The change'), title: label('The guard moves before the write'),
		hunk: codeRef('demo/src/cache.ts', { diff: true, anchor: 'isStale' }),
		callouts: [{ line: 4, text: label('checked first now'), tone: 'green' }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const hunk = ctx.code(p.hunk);
		need(hunk.kind === 'diff', 'code.diff needs code(file, { diff: true, ... })');
		const panel = diffPanel(root, hunk, { x: 96, y: 236, w: 1180, h: 664, revealAt: ctx.beat.start + 0.5 });
		const svg = svgLayer(root);
		const callouts = p.callouts ?? [];
		need(callouts.length <= 4, 'code.diff: at most 4 callouts');
		const times = spread(ctx, callouts, { lead: 1.6, tail: 1.2 });
		let floor = 236;
		const els = callouts.map((c, k) => {
			const idx = hunk.lines.findIndex(l => l.new === c.line && l.type !== '-') >= 0 ? hunk.lines.findIndex(l => l.new === c.line && l.type !== '-') : hunk.lines.findIndex(l => l.old === c.line);
			need(idx >= 0, `callout line ${c.line} is not in the hunk`);
			const rowY = 236 + 58 + 10 + idx * panel.ROW + panel.ROW / 2;
			const y = Math.max(floor, rowY - 40);
			const tone = c.tone ?? 'blue';
			const box = tile(root, tone, { left: 1340, top: y, width: 484, height: 80, display: 'flex', alignItems: 'center', padding: '0 24px' });
			txt(box, c.text, '', { fontSize: 22, fontWeight: 600, color: C.ink, lineHeight: 1.25 });
			floor = y + 96;
			const line = connector(svg, [[1284, rowY], [1312, rowY], [1312, y + 40], [1332, y + 40]], { color: TONE[tone].fg, width: 2.5, head: false, radius: 8 });
			const row = panel.rows[idx];
			return { box, line, row, tone };
		});
		return { h, panel, els, times };
	},
	render(i, t) {
		i.h.render(t);
		i.panel.render(t);
		i.els.forEach((e, k) => {
			const at = i.times[k];
			e.line.render(t, at, 0.4);
			enter(e.box, t, at + 0.2, { dx: 14, dy: 0 });
			const glow = standard(prog(t, at, at + 0.3));
			e.row.style.boxShadow = glow > 0.5 ? `inset 4px 0 0 ${TONE[e.tone].fg}` : 'none';
		});
	},
});

