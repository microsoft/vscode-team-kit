// need: concept. A problem, a mismatch, or a few ideas side by side.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE, STEP } from '../theme/tokens.js';
import { card, cardHead, connector, el, icon, pill, svgLayer, tile, txt, badge } from '../theme/primitives.js';
import { decel, enter, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/**
 * What you have vs what is required: a card with properties (each ok or not), a link with a verdict,
 * a card with the requirement. Optional footer: a row of related cards (for "and it can't simply be ...").
 */
export const mismatch = defineTreatment({
	id: 'concept.mismatch',
	need: 'concept',
	name: 'Have vs need',
	when: 'The problem is a mismatch: what something is vs what is required (a token, a format, a permission, a version). The requirement (need) shows first, by default 0.4 s in, then what there is (have) and its rows: narrate the requirement first, or time need.at to its words.',
	params: {
		eyebrow: 'label', title: 'label',
		have: '{ icon, title, rows: [{ key, value, ok, at }] }  (2-3 rows)',
		link: '{ label, verdict: { text, tone }, at }',
		need: '{ icon, title, sub, tone, requirement: { label, text }, at }',
		footer: '{ lead, note, at, items: [{ icon, title, mono, label, value, sub, chip, tone, at }] }  (optional, 1-4 items)',
	},
	demo: () => ({
		eyebrow: label('The problem'), title: label('A cached file isn\u2019t the file on disk'),
		have: { icon: 'document', title: label('Cached copy'), rows: [{ key: label('Path'), value: label('the same path'), ok: true }, { key: label('Version'), value: label('read an hour ago'), ok: false }] },
		link: { label: label('compared'), verdict: { text: label('stale'), tone: 'red' } },
		need: { icon: 'database', title: label('Editor'), sub: label('expects the latest content'), tone: 'blue', requirement: { label: label('Needs'), text: label('the version on disk now') } },
	}),
	mount(root, p, ctx) {
		need(p.have && p.need, 'concept.mismatch needs have and need');
		const h = header(root, p, ctx);
		const hasFooter = !!p.footer?.items?.length;
		const top = hasFooter ? 250 : 330;
		const rows = p.have.rows ?? [];
		need(rows.length <= 3, 'have.rows: at most 3');
		const haveH = 102 + rows.length * 70 + 2;
		const have = card(root, { left: 96, top, width: 620, height: haveH });
		const hh = el('div', 'st-abs', have, { left: 32, top: 26, right: 32 });
		cardHead(hh, { iconName: p.have.icon, title: p.have.title, tone: p.have.tone ?? 'blue' });
		ctx.anchor('have', hh);
		el('div', 'st-abs', have, { left: 0, right: 0, top: 102, height: 1.5, background: C.line });
		const rowNodes = rows.map((r, i) => {
			const row = el('div', 'st-abs', have, { left: 32, right: 32, top: 102 + i * 70, height: 70, display: 'flex', alignItems: 'center', gap: 20, borderTop: i ? `1.5px solid ${C.line}` : 'none' });
			txt(row, r.key, 'st-label', { minWidth: 64, flex: 'none' });
			txt(row, r.value, '', { fontSize: 23, color: r.ok === false ? C.red : C.ink, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 });
			const mark = r.ok === undefined ? null : icon(row, r.ok ? 'check' : 'dismiss', 28, r.ok ? C.green : C.red);
			return { row, mark, r };
		});
		const needCard = card(root, { left: 1180, top, width: 644, height: Math.max(haveH, 254) });
		const nh = el('div', 'st-abs', needCard, { left: 32, top: 30, right: 32 });
		ctx.anchor('need', nh);
		cardHead(nh, { iconName: p.need.icon, title: p.need.title, sub: p.need.sub, tone: p.need.tone ?? 'blue' });
		let req = null;
		if (p.need.requirement) {
			req = tile(needCard, p.need.tone ?? 'blue', { left: 32, right: 32, top: 132, height: 92, padding: '16px 24px' });
			txt(req, p.need.requirement.label ?? label('Requires'), 'st-label', { display: 'block', color: TONE[p.need.tone ?? 'blue'].fg, fontSize: 15 }, 'div');
			txt(req, p.need.requirement.text, '', { display: 'block', fontSize: 23, color: C.ink, marginTop: 8, whiteSpace: 'nowrap' }, 'div');
		}
		const svg = svgLayer(root);
		const midY = top + Math.min(haveH, 254) / 2;
		const link = connector(svg, [[744, midY], [1160, midY]], { color: C.connectorStrong, radius: 0 });
		const linkLabel = p.link?.label ? txt(root, p.link.label, 'st-abs', { left: 744, width: 416, top: midY - 46, textAlign: 'center', fontSize: 19, color: C.body }, 'div') : null;
		let verdict = null;
		if (p.link?.verdict) {
			verdict = el('div', 'st-abs', root, { left: 744, width: 416, top: midY + 22, display: 'flex', justifyContent: 'center' });
			pill(verdict, { tone: p.link.verdict.tone ?? 'red', iconName: p.link.verdict.tone === 'green' ? 'check' : 'dismiss', text: p.link.verdict.text, size: 's' });
		}
		let footer = null;
		if (hasFooter) {
			const items = p.footer.items;
			need(items.length <= 4, 'footer.items: at most 4');
			footer = { lead: p.footer.lead ? txt(root, p.footer.lead, 'st-abs', { left: 96, top: 572, fontSize: 25, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' }, 'div') : null };
			footer.note = p.footer.note ? txt(root, p.footer.note, 'st-abs', { right: 96, top: 576, fontSize: 21, fontWeight: 600, color: C.blue, whiteSpace: 'nowrap' }, 'div') : null;
			const first = items[0];
			const wide = !!(first.value || first.label);
			const firstW = wide ? 560 : 0;
			const rest = wide ? items.slice(1) : items;
			const restW = rest.length ? (1728 - firstW - (wide ? 24 : 0) - (rest.length - 1) * 24) / rest.length : 0;
			let x = 96;
			footer.cards = items.map((it, i) => {
				const w = wide && i === 0 ? firstW : restW;
				const c = card(root, { left: x, top: 630, width: w, height: 236 });
				x += w + 24;
				const head = el('div', 'st-abs', c, { left: 28, top: 26, right: 28 });
				cardHead(head, { iconName: it.icon, title: it.title, tone: it.tone ?? 'neutral', size: 's', mono: it.mono });
				if (it.label) {
					txt(c, it.label, 'st-label st-abs', { left: 28, top: 96, fontSize: 14 }, 'div');
				}
				if (it.value) {
					const box = el('div', 'st-abs', c, { left: 28, right: 28, top: 128, height: 56, borderRadius: 12, background: C.surface, display: 'flex', alignItems: 'center', padding: '0 20px' });
					box.dataset.box = 'tile';
					txt(box, it.value, 'st-mono', { fontSize: 18, color: C.body, whiteSpace: 'nowrap' });
				}
				if (it.sub) {
					txt(c, it.sub, 'st-abs', { left: 28, right: 28, top: it.label ? 132 : 92, fontSize: 18, lineHeight: 1.45, color: C.body }, 'div');
				}
				if (it.chip) {
					const chip = el('div', 'st-abs', c, { left: 28, right: 28, bottom: 22, height: 40, borderRadius: 10, background: TONE[it.tone ?? 'blue'].tint, display: 'flex', alignItems: 'center', padding: '0 16px' });
					chip.dataset.box = 'tile';
					txt(chip, it.chip, 'st-mono', { fontSize: 16, color: TONE[it.tone ?? 'blue'].fg, whiteSpace: 'nowrap' });
				}
				return c;
			});
			footer.times = spread(ctx, items, { lead: 3 });
			footer.at = ctx.at(p.footer.at, footer.times[0] - ctx.beat.start - 0.2);
		}
		const rowAt = spread(ctx, rows, { lead: 1.6, tail: 4 });
		return {
			h, have, rowNodes, needCard, req, link, linkLabel, verdict, footer, rowAt,
			needAt: ctx.at(p.need.at, 0.4),
			linkAt: p.link?.at !== undefined ? ctx.at(p.link.at) : (rowAt.at(-1) ?? ctx.beat.start + 2) + 0.8,
		};
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		enter(i.needCard, t, i.needAt, { dx: 18, dy: 0 });
		if (i.req) {
			enter(i.req, t, i.needAt + 0.3, { dy: 8 });
		}
		enter(i.have, t, Math.min(i.rowAt[0] ?? s + 1, i.needAt + 1.4) - 0.6, { dx: -18, dy: 0 });
		i.rowNodes.forEach((r, k) => {
			enter(r.row, t, i.rowAt[k] - 0.2, { dy: 6 });
			if (r.mark) {
				enter(r.mark, t, i.rowAt[k] + 0.1, { dy: 0, scale: 0.4, dur: 0.4 });
			}
		});
		const la = i.linkAt;
		i.link.render(t, la - 0.6, 0.6);
		if (i.linkLabel) {
			enter(i.linkLabel, t, la - 0.5, { dy: 6 });
		}
		if (i.verdict) {
			enter(i.verdict, t, la, { dy: 0, scale: 0.3, dur: 0.45 });
		}
		if (i.footer) {
			if (i.footer.lead) {
				enter(i.footer.lead, t, i.footer.at, { dy: 8 });
			}
			i.footer.cards.forEach((c, k) => enter(c, t, i.footer.times[k], { dy: 14 }));
			if (i.footer.note) {
				enter(i.footer.note, t, i.footer.times.at(-1) + 0.9, { dx: -10, dy: 0 });
			}
		}
	},
});

/** Two to four numbered ideas side by side; each appears when the narration reaches it. */
export const pillars = defineTreatment({
	id: 'concept.pillars',
	need: 'concept',
	name: 'Numbered pillars',
	when: 'Two to four ideas, parts or reasons of equal weight ("three things change").',
	params: { eyebrow: 'label', title: 'label', items: '[{ icon, title (about 3 words), text, code (a short code name under the text, drawn as code: ident() or quote(), not code()), at }]  (2-4)' },
	demo: () => ({ eyebrow: label('The idea'), title: label('Three things change'), items: [
		{ icon: 'search', title: label('Find'), text: label('Look up the setting once, at startup') },
		{ icon: 'flash', title: label('Cache'), text: label('Keep it in memory instead of reading it per call') },
		{ icon: 'sync', title: label('Refresh'), text: label('Reload it when the file changes') },
	] }),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const items = p.items ?? [];
		need(items.length >= 2 && items.length <= 4, 'concept.pillars: 2-4 items');
		const gap = 28, w = (1728 - gap * (items.length - 1)) / items.length, top = 286, height = 520;
		const cards = items.map((it, k) => {
			const c = tile(root, 'neutral', { left: 96 + k * (w + gap), top, width: w, height, padding: '40px 38px' });
			const row = el('div', '', c, { display: 'flex', alignItems: 'center', justifyContent: 'space-between' });
			badge(row, { n: k + 1, text: String(k + 1).padStart(2, '0'), size: 58, style: { borderRadius: 14 } });
			if (it.icon) {
				icon(row, it.icon, 44, STEP[k % STEP.length]);
			}
			txt(c, it.title, 'st-h3', { display: 'block', marginTop: 64, fontSize: items.length === 4 ? 30 : 34 }, 'div');
			if (it.text) {
				txt(c, it.text, 'st-body', { display: 'block', marginTop: 16, fontSize: items.length === 4 ? 22 : 24 }, 'div');
			}
			if (it.code) {
				const box = el('div', '', c, { position: 'absolute', left: 38, right: 38, bottom: 38, height: 56, borderRadius: 12, background: '#fff', border: `1.5px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 18px' });
				box.dataset.box = 'tile';
				txt(box, it.code, 'st-mono', { fontSize: 18, color: C.ink, whiteSpace: 'nowrap' });
			}
			const bar = el('div', '', c, { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, borderRadius: '18px 0 0 18px', background: STEP[k % STEP.length], transformOrigin: '50% 0' });
			return { c, bar };
		});
		return {
			h, cards, times: spread(ctx, items, { lead: 0.9, tail: 1.5 }),
			layout() {
				const content = Math.max(...cards.map(({ c }) => [...c.children].filter(n => getComputedStyle(n).position !== 'absolute').reduce((a, n) => Math.max(a, n.offsetTop + n.offsetHeight), 0)));
				const hh = Math.min(560, Math.max(320, content + 40 + (items.some(it => it.code) ? 70 : 0)));
				for (const { c } of cards) {
					c.style.height = `${hh}px`;
					c.style.top = `${250 + (650 - hh) / 2}px`;
				}
			},
		};
	},
	render(i, t) {
		i.h.render(t);
		i.cards.forEach(({ c, bar }, k) => {
			enter(c, t, i.times[k], { dy: 22 });
			bar.style.transform = `scaleY(${decel(prog(t, i.times[k] + 0.2, i.times[k] + 0.8))})`;
		});
	},
});

/** One big statement with the key phrase highlighted, and supporting chips underneath. */
export const statement = defineTreatment({
	id: 'concept.statement',
	need: 'concept',
	name: 'Statement',
	when: 'The point fits in one sentence ("the bug: X happens because Y"). Good for small PRs and for the problem beat.',
	params: { eyebrow: 'label', parts: '[text | { text, mark: tone, at }]  (the sentence; marked parts highlight at their time)', chips: '[{ icon, text, tone, at }]  (0-4; they wrap onto a second row past the width, so keep them short)' },
	demo: () => ({ eyebrow: label('The bug'), parts: [label('Saving a file '), { text: label('twice in a row'), mark: 'orange' }, label(' could '), { text: label('drop the second edit'), mark: 'red' }], chips: [{ icon: 'save', text: label('two saves within 50 ms') }, { icon: 'warning', text: label('one write lost'), tone: 'red' }] }),
	mount(root, p, ctx) {
		const parts = p.parts ?? [];
		need(parts.length, 'concept.statement needs parts');
		const eyebrow = p.eyebrow ? txt(root, p.eyebrow, 'st-eyebrow st-abs', { left: 160, top: 250 }, 'div') : null;
		const box = el('div', 'st-abs', root, { left: 160, top: 300, width: 1600, fontSize: 64, fontWeight: 600, lineHeight: 1.22, letterSpacing: '-.015em', color: C.ink });
		const marks = [];
		for (const part of parts) {
			if (part && part.mark) {
				const span = txt(box, part.text, '', { position: 'relative', whiteSpace: 'nowrap' });
				const hl = el('span', '', span, { position: 'absolute', left: -6, right: -6, bottom: 4, height: '0.36em', borderRadius: 6, background: TONE[part.mark].tint, zIndex: -1, transformOrigin: '0 50%' });
				span.style.zIndex = '0';
				marks.push({ span, hl, at: part.at, color: TONE[part.mark].fg });
			} else {
				txt(box, part);
			}
		}
		const chips = el('div', 'st-abs', root, { left: 160, top: 0, display: 'flex', gap: 16, flexWrap: 'wrap', width: 1600 });
		const chipNodes = (p.chips ?? []).map(c => pill(chips, { tone: c.tone ?? 'neutral', iconName: c.icon, text: c.text, size: 'l' }));
		return {
			eyebrow, box, marks, chips, chipNodes,
			markAt: spread(ctx, marks, { lead: 1.2, tail: 2 }),
			chipAt: spread(ctx, p.chips ?? [], { lead: 2.5, tail: 1 }),
			layout() {
				const bottom = box.offsetTop + box.offsetHeight;
				const offset = Math.max(0, (900 - (bottom + 60 + (chipNodes.length ? 60 : 0)) - 250) / 2);
				for (const n of [eyebrow, box].filter(Boolean)) {
					n.style.top = `${parseFloat(n.style.top) + offset}px`;
				}
				chips.style.top = `${box.offsetTop + box.offsetHeight + 56}px`;
			},
		};
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		if (i.eyebrow) {
			enter(i.eyebrow, t, s, { dy: 8 });
		}
		enter(i.box, t, s + 0.1, { dy: 16, dur: 0.8 });
		i.marks.forEach((m, k) => {
			const p = standard(prog(t, i.markAt[k], i.markAt[k] + 0.5));
			m.hl.style.transform = `scaleX(${p})`;
			m.span.style.color = p > 0.5 ? m.color : C.ink;
		});
		i.chipNodes.forEach((c, k) => enter(c, t, i.chipAt[k], { dy: 10 }));
	},
});
