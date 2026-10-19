// need: ui. Something the user sees: a notification, a message, a setting.
import { defineTreatment } from '../engine/scene.js';
import { C } from '../theme/tokens.js';
import { el, icon, picture, pill, txt } from '../theme/primitives.js';
import { enter, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { header, need } from './kit.js';

const SEVERITY = { error: { icon: 'error', color: '#e51400' }, warning: { icon: 'warning', color: '#bf8803' }, info: { icon: 'info', color: '#1a85ff' } };

/** A VS Code notification as the user sees it (light theme). */
function toast(parent, spec, { x, y, w }) {
	const sev = SEVERITY[spec.severity ?? 'info'];
	need(sev, `severity must be error, warning or info, not ${spec.severity}`);
	const box = el('div', 'st-abs', parent, { left: x, top: y, width: w, background: '#fff', borderRadius: 10, boxShadow: '0 0 0 1px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.16)', padding: '24px 26px 22px' });
	box.dataset.box = 'card';
	const row = el('div', '', box, { display: 'flex', gap: 16, alignItems: 'flex-start' });
	icon(row, sev.icon, 30, sev.color, { marginTop: 1 });
	const col = el('div', '', row, { flex: 1, minWidth: 0 });
	txt(col, spec.message, '', { display: 'block', fontSize: 25, lineHeight: 1.4, color: '#3b3b3b' }, 'div');
	if (spec.source) {
		txt(col, [label('Source: '), spec.source], '', { display: 'block', marginTop: 10, fontSize: 17, color: '#717171' }, 'div');
	}
	if (spec.actions?.length) {
		const actions = el('div', '', box, { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 });
		spec.actions.forEach((a, k) => {
			const btn = el('div', '', actions, { height: 40, padding: '0 18px', borderRadius: 4, display: 'flex', alignItems: 'center', fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap', background: k === 0 ? '#005fb8' : '#e5e5e5', color: k === 0 ? '#fff' : '#3b3b3b' });
			btn.dataset.box = 'pill';
			txt(btn, a);
		});
	}
	return box;
}

/** The notification the user got before vs the one they get now. */
export const toasts = defineTreatment({
	id: 'ui.toasts',
	need: 'ui',
	name: 'Notification before and after',
	when: 'The PR changes a message, error or prompt the user sees (and maybe what they can do about it).',
	params: {
		eyebrow: 'label', title: 'label',
		before: '{ severity: error|warning|info, message, source, actions: [labels], caption, at }',
		after: '{ severity, message, source, actions, caption, at }',
	},
	demo: () => ({
		eyebrow: label('What the user sees'), title: label('A way out instead of a dead end'),
		before: { severity: 'error', message: label('Access denied. Contact your administrator.'), source: label('Extensions'), caption: label('Before') },
		after: { severity: 'info', message: label('Sign in to access this marketplace.'), source: label('Extensions'), actions: [label('Sign In'), label('Cancel')], caption: label('Now') },
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		need(p.before && p.after, 'ui.toasts needs before and after');
		const make = (spec, x, tone) => {
			const frame = el('div', 'st-abs', root, { left: x, top: 270, width: 820, height: 480, borderRadius: 22, background: '#f3f3f3', overflow: 'hidden' });
			frame.dataset.box = 'tile';
			const bar = el('div', '', frame, { height: 44, background: '#e8e8e8', display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px' });
			for (const c of ['#ff5f57', '#febc2e', '#28c840']) {
				el('div', '', bar, { width: 13, height: 13, borderRadius: 7, background: c });
			}
			el('div', '', frame, { position: 'absolute', left: 0, right: 0, bottom: 0, height: 30, background: '#005fb8' });
			const t = toast(frame, spec, { x: 820 - 680 - 26, y: 0, w: 680 });
			const cap = el('div', 'st-abs', root, { left: x, top: 774 });
			pill(cap, { tone, text: spec.caption ?? label(tone === 'blue' ? 'Now' : 'Before'), size: 's' });
			return { frame, t, cap };
		};
		const before = make(p.before, 96, 'neutral');
		const after = make(p.after, 1004, 'blue');
		for (const side of [before, after]) {
			side.t.style.top = `${480 - 30 - 26 - side.t.offsetHeight}px`;
		}
		return { h, before, after, beforeAt: ctx.at(p.before.at, 0.8), afterAt: ctx.at(p.after.at, Math.max(1.6, ctx.beat.duration * 0.5)) };
	},
	render(i, t) {
		i.h.render(t);
		enter(i.before.frame, t, i.beforeAt - 0.3, { dy: 14 });
		enter(i.before.t, t, i.beforeAt, { dy: 24 });
		enter(i.before.cap, t, i.beforeAt + 0.2, { dy: 6 });
		enter(i.after.frame, t, i.afterAt - 0.3, { dy: 14 });
		enter(i.after.t, t, i.afterAt, { dy: 24 });
		enter(i.after.cap, t, i.afterAt + 0.2, { dy: 6 });
		const dim = standard(prog(t, i.afterAt, i.afterAt + 0.5));
		i.before.frame.style.opacity = String(Number(i.before.frame.style.opacity) * (1 - 0.35 * dim));
	},
});

/**
 * The real app, recorded with Playwright: one recording, or the same steps before and after the change side by side.
 * prs prepare extracts each clip's frames (30 a second, cropped) into build/footage/; this shows the one for each time.
 */
export const footage = defineTreatment({
	id: 'ui.footage',
	need: 'ui',
	name: 'Footage of the real app',
	when: 'The real app doing what the PR is about, recorded with Playwright: one recording, or the same steps before and after the change, side by side. Only for a beat with "footage": true in the storyboard (prs direct gives it this). Each clip starts playing on its at cue and holds its last frame; the narration says what happens as it happens.',
	params: {
		eyebrow: 'label', title: 'label',
		after: '{ src, from, to, at, speed, label, note, crop }  (src: the recording, in footage/; from, to: the seconds of it to show; at: when it starts playing; speed: 1 by default; crop: [x, y, w, h] in its pixels)',
		before: 'the same, recorded without the change (optional): the two start at the same action',
		layout: "'columns' (default) or 'rows' (for a part that changes that is wide and short)",
	},
	mount(root, p, ctx) {
		need(p.after?.src, 'ui.footage: after: { src } is required');
		const h = header(root, p, ctx);
		const meta = ctx.project.footage?.[ctx.beat.id] ?? {};
		const sides = (p.before ? ['before', 'after'] : ['after']).map(side => {
			need(meta[side], `ui.footage: the ${side} footage of beat "${ctx.beat.id}" is not prepared (prs prepare extracts it)`);
			return { side, spec: p[side], meta: meta[side] };
		});
		const pair = sides.length === 2, rows = pair && p.layout === 'rows';
		// The body: below the heading, above the caption band.
		const top = 236, bottom = 912, left = 96, width = 1728, gap = 48, labelH = 52;
		const noteH = sides.some(s => s.spec.note) ? 44 : 0;
		const cellW = pair && !rows ? (width - gap) / 2 : width;
		const cellH = rows ? (bottom - top - gap) / 2 : bottom - top;
		const items = sides.map((s, k) => {
			const x0 = rows || !pair ? left : left + k * (cellW + gap);
			const y0 = rows ? top + k * (cellH + gap) : top;
			const maxH = cellH - labelH - noteH;
			const scale = Math.min(cellW / s.meta.w, maxH / s.meta.h);
			const w = Math.round(s.meta.w * scale), hgt = Math.round(s.meta.h * scale);
			// Centred in its cell, with its label above and its note below.
			const x = Math.round(x0 + (cellW - w) / 2), y = Math.round(y0 + labelH + (maxH - hgt) / 2);
			const after = s.side === 'after';
			const lab = el('div', 'st-abs', root, { left: x, top: y - labelH, height: labelH - 12, display: 'flex', alignItems: 'center' });
			pill(lab, { tone: after ? 'blue' : 'neutral', text: s.spec.label ?? label(after ? (pair ? 'After' : 'The app') : 'Before'), size: 's' });
			const box = el('div', 'st-abs', root, { left: x, top: y, width: w, height: hgt, borderRadius: 12, overflow: 'hidden', background: '#fff', boxShadow: `0 0 0 1.5px ${C.line}` });
			box.dataset.box = 'card';
			const img = el('img', '', box, { position: 'absolute', left: 0, top: 0, width: w, height: hgt, display: 'block' });
			const note = s.spec.note ? txt(root, s.spec.note, 'st-abs', { left: x, top: y + hgt + 12, width: w, fontSize: 20, lineHeight: 1.3, color: C.body }, 'div') : null;
			return { ...s, lab, box, img, note, start: ctx.at(s.spec.at, 0.4), speed: s.spec.speed ?? 1 };
		});
		return { h, items };
	},
	render(i, t, ctx) {
		i.h.render(t);
		i.items.forEach((it, k) => {
			const at = ctx.beat.start + 0.25 + k * 0.15;
			enter(it.lab, t, at, { dy: 8 });
			enter(it.box, t, at, { dy: 14 });
			if (it.note) {
				enter(it.note, t, at + 0.2, { dy: 6 });
			}
			const n = Math.min(it.meta.frames - 1, Math.floor(Math.max(0, t - it.start) * it.speed * 30));
			picture(it.img, `${it.meta.dir}/${String(n + 1).padStart(5, '0')}.jpg`);
		});
	},
});
