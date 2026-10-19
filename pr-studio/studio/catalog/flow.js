// need: flow. Steps in order: a pipeline, a process, a branch.
import { defineTreatment } from '../engine/scene.js';
import { C, STEP, TONE } from '../theme/tokens.js';
import { badge, card, cardHead, connector, el, iconTile, svgLayer, tile, txt } from '../theme/primitives.js';
import { enter, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/**
 * Stages left to right; each lights up when the narration reaches it, finished ones turn green.
 * One stage may branch down to an alternative outcome.
 */
export const pipeline = defineTreatment({
	id: 'flow.pipeline',
	need: 'flow',
	name: 'Pipeline',
	when: '2-5 steps that run in order (a build, a request path, a migration), optionally with one branch.',
	params: {
		eyebrow: 'label', title: 'label',
		stages: '[{ icon, title, sub, code, tone, at }]  (2-5)',
		branch: '{ from: stage number, label, title, sub, tone, icon, at }  (optional)',
	},
	demo: () => ({
		eyebrow: label('The fix'), title: label('Every save now goes through one queue'),
		stages: [{ icon: 'edit', title: label('Edit'), sub: label('user types') }, { icon: 'tasks', title: label('Queue'), sub: label('one write at a time') }, { icon: 'save', title: label('Write'), sub: label('to disk') }, { icon: 'check', title: label('Done'), sub: label('editor clean') }],
		branch: { from: 3, label: label('if the disk is full'), title: label('Retry later'), icon: 'warning', tone: 'orange' },
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const stages = p.stages ?? [];
		need(stages.length >= 2 && stages.length <= 5, 'flow.pipeline: 2-5 stages');
		const gap = 76, w = (1728 - gap * (stages.length - 1)) / stages.length;
		const top = p.branch ? 300 : 380, height = 250;
		const svg = svgLayer(root);
		const cards = stages.map((s, k) => {
			const x = 96 + k * (w + gap);
			const c = card(root, { left: x, top, width: w, height, padding: '28px 26px' });
			const row = el('div', '', c, { display: 'flex', alignItems: 'center', justifyContent: 'space-between' });
			const b = badge(row, { n: k + 1, size: 40, color: C.faint });
			iconTile(row, s.icon ?? 'box', { tone: s.tone ?? 'blue', size: 50 });
			txt(c, s.title, 'st-h3', { display: 'block', marginTop: 36, fontSize: stages.length > 4 ? 25 : 29, whiteSpace: 'nowrap' }, 'div');
			if (s.sub) {
				txt(c, s.sub, 'st-small', { display: 'block', marginTop: 6, fontSize: 19 }, 'div');
			}
			if (s.code) {
				const box = el('div', '', c, { position: 'absolute', left: 26, right: 26, bottom: 22, height: 40, borderRadius: 10, background: C.surface, display: 'flex', alignItems: 'center', padding: '0 14px', overflow: 'hidden' });
				box.dataset.box = 'tile';
				txt(box, s.code, 'st-mono', { fontSize: 16, color: C.ink, whiteSpace: 'nowrap' });
			}
			const arrow = k < stages.length - 1 ? connector(svg, [[x + w + 10, top + height / 2], [x + w + gap - 12, top + height / 2]], { color: C.connectorStrong, radius: 0 }) : null;
			return { c, b, arrow, x };
		});
		const times = spread(ctx, stages, { lead: 0.9, tail: p.branch ? 3 : 1.5 });
		let branch = null;
		if (p.branch) {
			const from = cards[(p.branch.from ?? stages.length) - 1];
			need(from, 'branch.from: no such stage');
			const cx = from.x + w / 2;
			const bw = Math.max(w, 380);
			const bx = Math.min(1824 - bw, Math.max(96, cx - bw / 2));
			const tone = p.branch.tone ?? 'orange';
			const line = connector(svg, [[cx, top + height + 10], [cx, 690]], { color: TONE[tone].fg, radius: 0 });
			const lab = txt(root, p.branch.label, 'st-abs', { left: cx + 18, top: top + height + 34, fontSize: 19, fontWeight: 600, color: TONE[tone].fg, whiteSpace: 'nowrap' }, 'div');
			const end = tile(root, tone, { left: bx, top: 704, width: bw, height: 120, display: 'flex', alignItems: 'center', padding: '0 28px' });
			cardHead(end, { iconName: p.branch.icon ?? 'warning', title: p.branch.title, sub: p.branch.sub, tone });
			branch = { line, lab, end, at: ctx.at(p.branch.at, Math.max(1, ctx.beat.duration - 2.6)) };
		}
		return { h, cards, times, branch };
	},
	render(i, t) {
		i.h.render(t);
		i.cards.forEach((c, k) => {
			const at = i.times[k];
			enter(c.c, t, at - 0.35, { dy: 16 });
			const on = standard(prog(t, at, at + 0.4));
			const done = k < i.cards.length - 1 ? standard(prog(t, i.times[k + 1], i.times[k + 1] + 0.4)) : 0;
			c.c.style.borderColor = on > 0.5 && done < 0.5 ? C.blue : C.line;
			c.c.style.boxShadow = on > 0.5 && done < 0.5 ? '0 10px 30px rgba(0, 95, 184, .12)' : 'none';
			c.b.style.background = done > 0.5 ? C.green : on > 0.5 ? C.blue : C.faint;
			if (c.arrow) {
				c.arrow.render(t, i.times[k + 1] - 0.45, 0.45);
			}
		});
		if (i.branch) {
			i.branch.line.render(t, i.branch.at, 0.5);
			enter(i.branch.lab, t, i.branch.at + 0.2, { dx: -8, dy: 0 });
			enter(i.branch.end, t, i.branch.at + 0.45, { dy: 12 });
		}
	},
});

/** A vertical list of numbered steps on a rail that fills as the narration moves down. */
export const numbered = defineTreatment({
	id: 'flow.numbered',
	need: 'flow',
	name: 'Numbered steps',
	when: '3-6 steps with a sentence each, where reading order matters more than a picture of the flow.',
	params: { eyebrow: 'label', title: 'label', steps: '[{ title, text, code, at }]  (2-6)' },
	demo: () => ({
		eyebrow: label('How it works'), title: label('Four steps on startup'),
		steps: [{ title: label('Read the settings'), text: label('once, when the window opens') }, { title: label('Find the cache'), text: label('in the user data folder'), code: label('cache.json') }, { title: label('Compare versions'), text: label('skip the cache if the format changed') }, { title: label('Load'), text: label('everything else is lazy') }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const steps = p.steps ?? [];
		need(steps.length >= 2 && steps.length <= 6, 'flow.numbered: 2-6 steps');
		const top = 256, rowH = Math.min(124, 640 / steps.length);
		const rail = el('div', 'st-abs', root, { left: 141, top: top + 24, width: 4, height: (steps.length - 1) * rowH, borderRadius: 2, background: C.track });
		const fill = el('div', '', rail, { width: 4, height: '100%', borderRadius: 2, background: C.blue, transformOrigin: '50% 0', transform: 'scaleY(0)' });
		const rows = steps.map((s, k) => {
			const y = top + k * rowH;
			const dot = badge(root, { n: k + 1, size: 48, color: C.faint, style: { position: 'absolute', left: 119, top: y } });
			const col = el('div', 'st-abs', root, { left: 204, top: y - 2, width: s.code ? 1060 : 1560 });
			txt(col, s.title, 'st-h3', { display: 'block', fontSize: 30, whiteSpace: 'nowrap' }, 'div');
			if (s.text) {
				txt(col, s.text, 'st-small', { display: 'block', fontSize: 21, marginTop: 4, whiteSpace: 'nowrap' }, 'div');
			}
			let code = null;
			if (s.code) {
				code = el('div', 'st-abs', root, { left: 1300, width: 524, top: y + 2, height: 48, borderRadius: 10, background: C.surface, display: 'flex', alignItems: 'center', padding: '0 18px', overflow: 'hidden' });
				code.dataset.box = 'tile';
				txt(code, s.code, 'st-mono', { fontSize: 18, color: C.ink, whiteSpace: 'nowrap' });
			}
			return { dot, col, code };
		});
		return { h, rail, fill, rows, times: spread(ctx, steps, { lead: 0.8, tail: 1.2 }) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		enter(i.rail, t, s + 0.4, { dy: 0 });
		let reached = 0;
		i.rows.forEach((r, k) => {
			const at = i.times[k];
			enter(r.dot, t, at - 0.15, { dy: 0, scale: 0.4, dur: 0.4 });
			enter(r.col, t, at, { dx: -12, dy: 0 });
			if (r.code) {
				enter(r.code, t, at + 0.25, { dx: 12, dy: 0 });
			}
			r.dot.style.background = t >= at ? STEP[0] : C.faint;
			if (k > 0) {
				reached = Math.max(reached, (k - 1 + standard(prog(t, at - 0.5, at))) / Math.max(1, i.rows.length - 1));
			}
		});
		i.fill.style.transform = `scaleY(${reached})`;
	},
});
