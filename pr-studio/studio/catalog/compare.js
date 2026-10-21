// need: compare. Behavior before and after the change.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { card, el, icon, iconTile, pill, tile, txt } from '../theme/primitives.js';
import { clamp, enter, lerp, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/** Before | After, row by row; rows that change are tinted. Optional bottom line with the takeaway. */
export const split = defineTreatment({
	id: 'compare.split',
	need: 'compare',
	name: 'Before and after',
	when: 'Behavior that differs on 2-5 aspects (what the user sees, what is sent, what is cached). The narration names the aspects in order, a sentence each, and each row lands on its word; or it tells the old way first and turns on "Now" (afterAt: the whole new column then).',
	params: {
		eyebrow: 'label', title: 'label',
		before: '{ title, icon }', after: '{ title, icon }',
		rows: '[{ aspect, before, after, changed (default true), mono, at, afterAt }]  (1-5; mono is for the whole row)',
		afterAt: 'time the new column appears, row after row (optional: by default each row\'s new side follows its old one)',
		takeaway: '{ text, tone, at }  (optional)',
	},
	demo: () => ({
		eyebrow: label('What changes'), title: label('Same request, safer result'),
		before: { title: label('Before') }, after: { title: label('Now') },
		rows: [{ aspect: label('Error shown'), before: label('Access denied'), after: label('Sign in to continue') }, { aspect: label('User can fix it'), before: label('no'), after: label('yes') }, { aspect: label('Requests sent'), before: label('one'), after: label('one'), changed: false }],
		takeaway: { text: label('The fix is in the message, not the request') },
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const rows = p.rows ?? [];
		need(rows.length >= 1 && rows.length <= 5, 'compare.split: 1-5 rows');
		const aspectW = 380, colW = (1728 - aspectW - 2 * 24) / 2;
		const xB = 96 + aspectW + 24, xA = xB + colW + 24;
		const top = 250;
		const headB = tile(root, 'neutral', { left: xB, top, width: colW, height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px' });
		icon(headB, p.before?.icon ?? 'history', 28, C.body);
		txt(headB, p.before?.title ?? label('Before'), '', { fontSize: 24, fontWeight: 600, color: C.body });
		const headA = tile(root, 'blue', { left: xA, top, width: colW, height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 26px' });
		icon(headA, p.after?.icon ?? 'sparkle', 28, C.blue);
		txt(headA, p.after?.title ?? label('After'), '', { fontSize: 24, fontWeight: 600, color: C.blue });
		const rowH = Math.min(104, (p.takeaway ? 520 : 620) / rows.length);
		const rowEls = rows.map((r, k) => {
			const y = top + 88 + k * rowH;
			const changed = r.changed !== false;
			const aspect = txt(root, r.aspect, 'st-abs', { left: 96, top: y, width: aspectW, height: rowH - 14, display: 'flex', alignItems: 'center', fontSize: 23, fontWeight: 600, color: C.ink }, 'div');
			const b = card(root, { left: xB, top: y, width: colW, height: rowH - 14, display: 'flex', alignItems: 'center', padding: '0 26px' });
			txt(b, r.before, r.mono ? 'st-mono' : '', { fontSize: r.mono ? 21 : 23, color: changed ? C.body : C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
			const a = card(root, { left: xA, top: y, width: colW, height: rowH - 14, display: 'flex', alignItems: 'center', padding: '0 26px', gap: 14 });
			if (changed) {
				icon(a, 'arrowRight', 22, C.green);
			}
			txt(a, r.after, r.mono ? 'st-mono' : '', { fontSize: r.mono ? 21 : 23, fontWeight: changed ? 600 : 400, color: changed ? C.green : C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
			return { aspect, b, a, changed, afterAt: r.afterAt !== undefined ? ctx.at(r.afterAt) : null };
		});
		let take = null;
		if (p.takeaway) {
			const tone = p.takeaway.tone ?? 'green';
			take = tile(root, tone, { left: 96, top: top + 88 + rows.length * rowH + 22, width: 1728, height: 76, display: 'flex', alignItems: 'center', gap: 16, padding: '0 30px' });
			icon(take, 'check', 28, TONE[tone].fg);
			txt(take, p.takeaway.text, '', { fontSize: 25, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' });
		}
		const times = spread(ctx, rows, { lead: 1.2, tail: p.takeaway ? 2.6 : 1.2 });
		// When the new side shows: the row's own afterAt, else the column's (row after row), else just after its old side.
		const column = p.afterAt !== undefined ? ctx.at(p.afterAt) : null;
		const afterTimes = rowEls.map((r, k) => r.afterAt ?? (column !== null ? column + k * 0.3 : times[k] + 0.35));
		// Without its own time, the takeaway comes after the last row, never before it.
		const takeAt = !p.takeaway ? 0 : p.takeaway.at !== undefined ? ctx.at(p.takeaway.at) : Math.max(ctx.at(undefined, Math.max(1, ctx.beat.duration - 2)), Math.max(...times, ...afterTimes) + 0.8);
		return { h, headB, headA, rowEls, take, times, afterTimes, takeAt, headAt: column !== null ? column - 0.25 : ctx.beat.start + 0.55 };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		enter(i.headB, t, s + 0.4, { dy: 10 });
		enter(i.headA, t, i.headAt, { dy: 10 });
		i.rowEls.forEach((r, k) => {
			const at = i.times[k];
			enter(r.aspect, t, at - 0.3, { dx: -10, dy: 0 });
			enter(r.b, t, at - 0.2, { dy: 8 });
			const q = enter(r.a, t, i.afterTimes[k], { dx: -16, dy: 0 });
			r.a.style.background = r.changed && q > 0.5 ? C.greenTint : '#fff';
			r.a.style.borderColor = r.changed && q > 0.5 ? 'transparent' : C.line;
		});
		if (i.take) {
			enter(i.take, t, i.takeAt, { dy: 12 });
		}
	},
});

function screen(root, side, { x, y, w, h, tone }) {
	const c = card(root, { left: x, top: y, width: w, height: h, overflow: 'hidden' });
	const bar = el('div', '', c, { height: 64, display: 'flex', alignItems: 'center', gap: 14, padding: '0 28px', borderBottom: `1.5px solid ${C.line}`, background: '#fff' });
	iconTile(bar, side.icon ?? 'window', { tone, size: 40 });
	txt(bar, side.title, '', { fontSize: 23, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' });
	const list = el('div', '', c, { padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 16 });
	for (const it of side.items ?? []) {
		const row = el('div', '', list, { display: 'flex', alignItems: 'center', gap: 18, height: 72, borderRadius: 12, background: TONE[it.tone ?? 'neutral'].tint, padding: '0 26px', flex: 'none' });
		row.dataset.box = 'tile';
		if (it.icon) {
			icon(row, it.icon, 26, TONE[it.tone ?? 'neutral'].fg);
		}
		txt(row, it.text, it.mono ? 'st-mono' : '', { fontSize: it.mono ? 23 : 26, color: C.ink, whiteSpace: 'nowrap', fontWeight: it.tone && it.tone !== 'neutral' ? 600 : 400 });
	}
	return c;
}

/** The same panel before and after: a wipe line sweeps across and reveals the new state in place. */
export const wipe = defineTreatment({
	id: 'compare.wipe',
	need: 'compare',
	name: 'Wipe reveal',
	when: 'One screen, list or result that looks different after the change; the viewer sees it flip in place. The narration says what it was, then what it is now: the wipe lands on the word that turns ("Now"). The whole panel turns at once, and its items flip in place: give before and after the same rows in the same order.',
	params: {
		eyebrow: 'label', title: 'label',
		before: '{ title, icon, items: [{ icon, text, tone, mono }] }  (2-6 items)',
		after: '{ title, icon, items: [...] }',
		at: 'time of the wipe', note: '{ before, after }  (labels under the panel)',
	},
	demo: () => ({
		eyebrow: label('The result'), title: label('Search now ranks exact matches first'),
		before: { title: label('Results'), items: [{ icon: 'document', text: label('readme-old.md') }, { icon: 'document', text: label('my-readme.txt') }, { icon: 'document', text: label('README.md') }] },
		after: { title: label('Results'), items: [{ icon: 'document', text: label('README.md'), tone: 'green' }, { icon: 'document', text: label('readme-old.md') }, { icon: 'document', text: label('my-readme.txt') }] },
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		need(p.before && p.after, 'compare.wipe needs before and after');
		const w = 1320, x = (1920 - w) / 2, y = 250;
		const n = Math.max(p.before.items?.length ?? 0, p.after.items?.length ?? 0);
		need(n <= 6, 'compare.wipe: at most 6 items');
		const hh = Math.min(580, 64 + 52 + n * 88);
		const before = screen(root, p.before, { x, y, w, h: hh, tone: 'neutral' });
		const after = screen(root, p.after, { x, y, w, h: hh, tone: 'blue' });
		before.dataset.exclusive = 'wipe:before';
		after.dataset.exclusive = 'wipe:after';
		const line = el('div', 'st-abs', root, { left: x, top: y - 14, width: 4, height: hh + 28, borderRadius: 2, background: C.blue });
		const handle = el('div', 'st-abs', root, { left: x - 60, top: y + hh / 2 - 17, width: 120, display: 'flex', justifyContent: 'center' });
		// It sweeps across the rows on purpose: a moving part, which the overlap check leaves alone.
		handle.dataset.flight = 'wipe';
		pill(handle, { tone: 'blue', text: label('after'), solid: true, size: 's' });
		const tagB = el('div', 'st-abs', root, { left: x, top: y + hh + 26 });
		pill(tagB, { tone: 'neutral', text: p.note?.before ?? label('before'), size: 's' });
		const tagA = el('div', 'st-abs', root, { right: 1920 - x - w, top: y + hh + 26 });
		pill(tagA, { tone: 'blue', text: p.note?.after ?? label('after this PR'), size: 's' });
		return { h, before, after, line, handle, tagB, tagA, x, w, at: ctx.at(p.at, Math.max(1.5, ctx.beat.duration * 0.45)) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		enter(i.before, t, s + 0.45, { dy: 16 });
		enter(i.tagB, t, s + 0.8, { dy: 6 });
		const p = standard(prog(t, i.at, i.at + 1.1));
		const edge = lerp(i.w, 0, p);
		i.after.style.clipPath = `inset(0 0 0 ${edge}px round 18px)`;
		i.after.style.opacity = p > 0 ? '1' : '0';
		i.before.style.clipPath = `inset(0 ${i.w - edge}px 0 0 round 18px)`;
		if (p >= 1) {
			i.before.style.opacity = '0';
		}
		const visible = clamp(prog(t, i.at - 0.2, i.at)) * (1 - clamp(prog(t, i.at + 1.1, i.at + 1.4)));
		i.line.style.transform = `translateX(${edge - 2}px)`;
		i.line.style.opacity = String(visible);
		i.handle.style.transform = `translateX(${edge}px)`;
		i.handle.style.opacity = String(visible);
		i.tagB.style.opacity = String(Number(i.tagB.style.opacity) * (1 - p));
		enter(i.tagA, t, i.at + 1.0, { dy: 6 });
	},
});
