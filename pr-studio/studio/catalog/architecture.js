// need: architecture. Where the change reaches: components, processes, layers.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { card, cardHead, connector, el, icon, iconTile, pill, svgLayer, tile, txt } from '../theme/primitives.js';
import { clamp, decel, enter, lerp, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/**
 * Source -> labeled lanes -> target across the top; below, an optional branch (a bus to 1-3 more places)
 * and an optional aside card (for example what the user sees now vs before).
 */
export const map = defineTreatment({
	id: 'architecture.map',
	need: 'architecture',
	name: 'Reach map',
	when: 'Something (a token, a setting, a cache) now flows to several request types or processes. Shows every place it reaches.',
	params: {
		eyebrow: 'label', title: 'label',
		source: '{ icon, title, sub, tone, chip: { icon, text } }',
		target: '{ icon, title, sub, tone }',
		lanes: '[{ title, sub, at, key: bool }]  (1-4 labeled arrows from source to target)',
		branch: '{ label, sub, at, nodes: [{ icon, title, sub, tone, at }] }  (optional, 1-3 nodes)',
		aside: '{ label, at, rows: [{ lead, value, text, tone, strikeAt }] }  (optional, 1-2 rows)',
	},
	demo: () => ({
		eyebrow: label('How far it reaches'), title: label('One setting, every request'),
		source: { icon: 'settings', title: label('Settings'), sub: label('read once'), tone: 'blue', chip: { icon: 'key', text: label('proxy') } },
		target: { icon: 'globe', title: label('Network'), sub: label('outgoing requests') },
		lanes: [{ title: label('Updates'), sub: label('check and download'), key: true }, { title: label('Extensions'), sub: label('gallery and VSIX'), key: true }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		need(p.source && p.target, 'architecture.map needs source and target');
		const lanes = p.lanes ?? [];
		need(lanes.length >= 1 && lanes.length <= 4, 'architecture.map: 1-4 lanes');
		const lower = !!(p.branch || p.aside);
		const top = lower ? 248 : 400;
		const box = (x, spec, extraH = 0) => {
			const c = card(root, { left: x, top, width: 380, height: 196 + extraH });
			const head = el('div', 'st-abs', c, { left: 28, top: 26, right: 28 });
			cardHead(head, { iconName: spec.icon, title: spec.title, sub: spec.sub, tone: spec.tone ?? 'neutral' });
			return c;
		};
		const src = box(96, p.source);
		let chip = null;
		if (p.source.chip) {
			chip = el('div', 'st-abs', src, { left: 28, top: 116 });
			pill(chip, { tone: p.source.tone ?? 'blue', iconName: p.source.chip.icon, text: p.source.chip.text, size: 'm' });
			ctx.anchor('chip', chip);
		}
		const dst = box(1444, p.target);
		const svg = svgLayer(root);
		const gap = Math.min(58, 150 / lanes.length);
		const y0 = top + 98 - ((lanes.length - 1) * gap) / 2;
		const laneEls = lanes.map((l, k) => {
			const y = y0 + k * gap;
			const a = connector(svg, [[492, y], [1430, y]], { color: C.connectorStrong, radius: 0 });
			const lb = el('div', 'st-abs', root, { left: 520, top: y - 32, display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap', background: '#fff', paddingRight: 12 });
			txt(lb, l.title, '', { fontSize: 22, fontWeight: 600, color: C.ink });
			if (l.sub) {
				txt(lb, l.sub, '', { fontSize: 18, color: C.body });
			}
			let key = null;
			if (l.key !== false && p.source.chip) {
				key = el('div', 'st-abs', root, { left: 1340, top: y - 17, width: 34, height: 34, borderRadius: 17, background: TONE[p.source.tone ?? 'blue'].tint, display: 'grid', placeItems: 'center' });
				icon(key, p.source.chip.icon ?? 'key', 20, TONE[p.source.tone ?? 'blue'].fg);
			}
			return { a, lb, key };
		});
		const laneAt = spread(ctx, lanes, { lead: 0.9, tail: Math.max(1.2, ctx.beat.duration * 0.55) });
		let branch = null;
		if (p.branch) {
			const nodes = p.branch.nodes ?? [];
			need(nodes.length >= 1 && nodes.length <= 3, 'branch.nodes: 1-3');
			const labelRow = el('div', 'st-abs', root, { left: 96, top: 478, display: 'flex', alignItems: 'baseline', gap: 14, whiteSpace: 'nowrap' });
			txt(labelRow, p.branch.label ?? label('Also'), 'st-label', { color: C.blue, fontSize: 17 });
			if (p.branch.sub) {
				txt(labelRow, p.branch.sub, 'st-mono', { fontSize: 17, color: C.body });
			}
			const nh = Math.min(104, (902 - 528 - 28 * (nodes.length - 1)) / nodes.length);
			const items = nodes.map((n, k) => {
				const y = 528 + k * (nh + 28);
				const c = card(root, { left: 226, top: y, width: 470, height: nh, display: 'flex', alignItems: 'center', padding: '0 28px' });
				cardHead(c, { iconName: n.icon, title: n.title, sub: n.sub, tone: n.tone ?? 'neutral' });
				const seg = el('div', 'st-abs', root, { left: 150, top: k === 0 ? 518 : 528 + (k - 1) * (nh + 28) + nh / 2, width: 2, height: k === 0 ? 10 + nh / 2 : nh + 28, background: '#b6c2d3', transformOrigin: '50% 0' });
				const arr = connector(svg, [[152, y + nh / 2], [214, y + nh / 2]], { color: '#b6c2d3', radius: 0 });
				return { c, seg, arr };
			});
			const times = spread(ctx, nodes, { lead: ctx.beat.duration * 0.4, tail: ctx.beat.duration * 0.25 });
			branch = { labelRow, items, times, at: p.branch.at !== undefined ? ctx.at(p.branch.at) : times[0] - 0.4 };
		}
		let aside = null;
		if (p.aside) {
			const rows = p.aside.rows ?? [];
			need(rows.length >= 1 && rows.length <= 2, 'aside.rows: 1-2');
			const left = p.branch ? 820 : 96;
			const c = card(root, { left, top: 528, width: 1824 - left, height: 236 });
			txt(c, p.aside.label ?? label('What changes for the user'), 'st-label st-abs', { left: 30, top: 24, fontSize: 16 }, 'div');
			const rowEls = rows.map((r, k) => {
				const tone = r.tone ?? (k === rows.length - 1 ? 'green' : 'neutral');
				const row = el('div', 'st-abs', c, { left: 30, right: 30, top: 64 + k * 82, height: 68, display: 'flex', alignItems: 'center', gap: 18, borderRadius: 12, background: TONE[tone].tint, padding: '0 22px' });
				row.dataset.box = 'tile';
				txt(row, r.lead, 'st-label', { fontSize: 15, width: 72, flex: 'none', color: tone === 'neutral' ? C.muted : TONE[tone].fg });
				const value = r.value ? txt(row, r.value, 'st-mono', { fontSize: 23, fontWeight: 600, color: tone === 'neutral' ? C.body : TONE[tone].fg, width: 230, flex: 'none', whiteSpace: 'nowrap' }) : null;
				if (r.text) {
					txt(row, r.text, '', { fontSize: 19, color: tone === 'neutral' ? C.body : C.ink, whiteSpace: 'nowrap' });
				}
				return { row, value, strikeAt: r.strikeAt !== undefined ? ctx.at(r.strikeAt) : null, at: r.at !== undefined ? ctx.at(r.at) : null };
			});
			aside = { c, rowEls, at: ctx.at(p.aside.at, Math.max(0.5, ctx.beat.duration - 3.5)) };
		}
		return { h, src, chip, dst, laneEls, laneAt, branch, aside };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		enter(i.src, t, s + 0.35, { dy: 14 });
		if (i.chip) {
			enter(i.chip, t, s + 0.7, { dy: 6 });
		}
		enter(i.dst, t, s + 0.5, { dy: 14 });
		i.laneEls.forEach((l, k) => {
			const at = Math.max(s + 0.8, i.laneAt[k]);
			l.a.render(t, at, 0.55);
			enter(l.lb, t, at + 0.05, { dy: 6 });
			if (l.key) {
				enter(l.key, t, at + 0.45, { dy: 0, scale: 0.4, dur: 0.4 });
			}
		});
		if (i.branch) {
			enter(i.branch.labelRow, t, i.branch.at, { dy: 6 });
			i.branch.items.forEach((it, k) => {
				const at = i.branch.times[k];
				it.seg.style.transform = `scaleY(${decel(prog(t, at - 0.4, at))})`;
				it.arr.render(t, at - 0.1, 0.35);
				enter(it.c, t, at, { dx: -10, dy: 0 });
			});
		}
		if (i.aside) {
			enter(i.aside.c, t, i.aside.at, { dy: 14 });
			i.aside.rowEls.forEach((r, k) => {
				if (r.at !== null) {
					enter(r.row, t, r.at, { dy: 8 });
				} else if (k === i.aside.rowEls.length - 1 && i.aside.rowEls.length > 1) {
					enter(r.row, t, i.aside.at + 1.5, { dy: 8 });
				}
				if (r.strikeAt !== null && r.value) {
					const k2 = standard(prog(t, r.strikeAt, r.strikeAt + 0.4));
					r.value.style.textDecoration = k2 > 0.5 ? 'line-through' : 'none';
					r.row.style.opacity = String(Number(r.row.style.opacity || 1) * lerp(1, 0.6, k2));
				}
			});
		}
	},
});

/**
 * Horizontal layers stacked top to bottom; the ones this PR touches light up with what changed there,
 * and an optional marker travels through them along the path a call takes.
 */
export const layers = defineTreatment({
	id: 'architecture.layers',
	need: 'architecture',
	name: 'Layer stack',
	when: 'The change sits at some levels of a layered system (for VS Code: base, platform, editor, workbench, extensions). Shows which layers move and how a call crosses them.',
	params: {
		eyebrow: 'label', title: 'label',
		layers: '[{ title, sub, icon, touched, note, at }]  (3-6, top to bottom; note = what changes there)',
		path: '{ text, icon, through: [layer numbers, 1-based], at }  (optional: a marker travels through these layers)',
	},
	demo: () => ({
		eyebrow: label('Where it lives'), title: label('Two layers change'),
		layers: [{ title: label('workbench'), sub: label('the UI'), icon: 'window', touched: true, note: label('new status item') }, { title: label('platform'), sub: label('services'), icon: 'stack', touched: true, note: label('new setting') }, { title: label('base'), sub: label('utilities'), icon: 'box' }],
		path: { text: label('setting change'), icon: 'settings', through: [2, 1] },
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const ls = p.layers ?? [];
		need(ls.length >= 2 && ls.length <= 6, 'architecture.layers: 2-6 layers');
		const top = 250, gap = 16, H = (880 - top - gap * (ls.length - 1)) / ls.length;
		const right = p.path ? 1500 : 1824;
		const bands = ls.map((l, k) => {
			const y = top + k * (H + gap);
			const band = tile(root, l.touched ? 'blue' : 'neutral', { left: 96, top: y, width: right - 96, height: H, display: 'flex', alignItems: 'center', gap: 24, padding: '0 34px' });
			const accent = el('div', 'st-abs', band, { left: 0, top: 0, bottom: 0, width: 6, borderRadius: '18px 0 0 18px', background: l.touched ? C.blue : 'transparent', transformOrigin: '50% 50%' });
			iconTile(band, l.icon ?? 'stack', { tone: l.touched ? 'blue' : 'neutral', size: Math.min(56, H - 24), solid: !!l.touched });
			const col = el('div', '', band, { minWidth: 0, flex: 1 });
			txt(col, l.title, 'st-mono', { display: 'block', fontSize: Math.min(28, H / 3.2), fontWeight: 600, color: l.touched ? C.ink : C.body, whiteSpace: 'nowrap' }, 'div');
			if (l.sub && H > 80) {
				txt(col, l.sub, '', { display: 'block', fontSize: 19, color: C.body, marginTop: 4, whiteSpace: 'nowrap' }, 'div');
			}
			const note = l.note ? pill(band, { tone: l.touched ? 'blue' : 'neutral', text: l.note, size: H > 90 ? 'm' : 's', style: { background: '#fff' } }) : null;
			return { band, accent, note, y, l };
		});
		const touchedAt = spread(ctx, ls.filter(l => l.touched), { lead: 1.2, tail: 2 });
		let k2 = 0;
		for (const b of bands) {
			b.at = b.l.touched ? (b.l.at !== undefined ? ctx.at(b.l.at) : touchedAt[k2++]) : null;
		}
		let path = null;
		if (p.path) {
			const through = p.path.through ?? [];
			need(through.length >= 2, 'path.through: at least two layers');
			const svg = svgLayer(root);
			const x = 1662;
			const pts = through.map(n => {
				need(bands[n - 1], `path.through: no layer ${n}`);
				return [x, bands[n - 1].y + H / 2];
			});
			const line = connector(svg, pts, { color: C.blue, width: 4, radius: 0 });
			const dots = pts.map(([px, py]) => {
				const d = el('div', 'st-abs', root, { left: px - 9, top: py - 9, width: 18, height: 18, borderRadius: 9, background: '#fff', border: `4px solid ${C.blue}` });
				return d;
			});
			const marker = el('div', 'st-carry', root);
			pill(marker, { tone: 'blue', iconName: p.path.icon ?? 'send', text: p.path.text ?? label('call'), solid: true, size: 's' });
			path = { line, dots, marker, pts, at: ctx.at(p.path.at, Math.max(1.5, ctx.beat.duration * 0.5)) };
		}
		return { h, bands, path };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.bands.forEach((b, k) => {
			enter(b.band, t, s + 0.4 + k * 0.12, { dx: -16, dy: 0 });
			if (b.at !== null) {
				const q = decel(prog(t, b.at, b.at + 0.5));
				b.accent.style.transform = `scaleY(${q})`;
				b.band.style.background = q > 0.5 ? C.blueTint : C.surface;
				if (b.note) {
					enter(b.note, t, b.at + 0.2, { dx: 12, dy: 0 });
				}
			} else if (b.note) {
				enter(b.note, t, s + 1, { dy: 0 });
			}
		});
		if (i.path) {
			const at = i.path.at;
			const dur = 0.6 * (i.path.pts.length - 1) + 0.4;
			i.path.line.render(t, at, dur);
			i.path.dots.forEach((d, k) => enter(d, t, at + k * 0.6, { dy: 0, scale: 0.5, dur: 0.3 }));
			const p = clamp(prog(t, at, at + dur));
			const pt = i.path.line.pointAt(standard(p));
			const w = i.path.marker.offsetWidth, hh = i.path.marker.offsetHeight;
			i.path.marker.style.transform = `translate(${Math.min(1824 - w, pt.x + 24)}px, ${pt.y - hh / 2}px)`;
			i.path.marker.style.opacity = String(clamp(prog(t, at - 0.1, at + 0.2)));
		}
	},
});

/**
 * Process or ownership zones side by side (for example window, shared process, remote server), each with the
 * pieces that live there, and the messages that cross between zones.
 */
export const zones = defineTreatment({
	id: 'architecture.zones',
	need: 'architecture',
	name: 'Process zones',
	when: 'The change spans processes, machines or owners, and what crosses the boundary (IPC, a protocol, a file) is the point.',
	params: {
		eyebrow: 'label', title: 'label',
		zones: '[{ title, sub, tone, items: [{ id, icon, title, sub, at }] }]  (2-3 zones, 1-3 items each)',
		links: '[{ from: itemId, to: itemId, label, mono, at, tone }]  (0-4; link items on the same row of neighbouring zones: a link between rows runs its label over other parts)',
	},
	demo: () => ({
		eyebrow: label('Where it runs'), title: label('The window hands it over'),
		zones: [{ title: label('Window'), sub: label('renderer'), tone: 'blue', items: [{ id: 'auth', icon: 'key', title: label('Sign-in') }] }, { title: label('Shared process'), sub: label('background'), tone: 'orange', items: [{ id: 'dl', icon: 'download', title: label('Downloads') }] }],
		links: [{ from: 'auth', to: 'dl', label: label('token over IPC') }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const zs = p.zones ?? [];
		need(zs.length >= 2 && zs.length <= 3, 'architecture.zones: 2-3 zones');
		const gap = zs.length === 2 ? 260 : 150;
		const zw = (1728 - gap * (zs.length - 1)) / zs.length;
		const most = Math.max(...zs.map(z => (z.items ?? []).length));
		const zh = Math.min(640, 90 + most * 108 + (most - 1) * 36 + 80);
		const top = 250 + (640 - zh) / 2;
		const pos = new Map();
		const zoneEls = zs.map((z, k) => {
			const x = 96 + k * (zw + gap);
			const zone = el('div', 'st-abs', root, { left: x, top, width: zw, height: zh, borderRadius: 26, border: `2px dashed ${TONE[z.tone ?? 'neutral'].fg}55`, background: `${TONE[z.tone ?? 'neutral'].tint}88` });
			zone.dataset.box = 'tile';
			const head = el('div', 'st-abs', zone, { left: 30, top: 24, right: 30, display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' });
			txt(head, z.title, '', { fontSize: 26, fontWeight: 600, color: TONE[z.tone ?? 'neutral'].fg });
			if (z.sub) {
				txt(head, z.sub, '', { fontSize: 19, color: C.body });
			}
			const items = z.items ?? [];
			need(items.length >= 1 && items.length <= 3, `zone ${k + 1}: 1-3 items`);
			const ih = 108, ig = 36;
			const y0 = top + 90 + (zh - 90 - items.length * ih - (items.length - 1) * ig) / 2;
			const itemEls = items.map((it, j) => {
				const y = y0 + j * (ih + ig);
				const c = card(root, { left: x + 34, top: y, width: zw - 68, height: ih, display: 'flex', alignItems: 'center', padding: '0 26px' });
				cardHead(c, { iconName: it.icon, title: it.title, sub: it.sub, tone: z.tone ?? 'neutral' });
				pos.set(it.id, { x0: x + 34, x1: x + zw - 34, y: y + ih / 2, zone: k });
				return { c, at: it.at };
			});
			return { zone, itemEls };
		});
		const svg = svgLayer(root);
		const links = (p.links ?? []).map(l => {
			const a = pos.get(l.from), b = pos.get(l.to);
			need(a && b, `link ${l.from} -> ${l.to}: unknown item`);
			const rightward = b.zone > a.zone || (b.zone === a.zone && b.y > a.y);
			const xA = rightward ? a.x1 : a.x0, xB = rightward ? b.x0 : b.x1;
			const midX = (xA + xB) / 2;
			const pts = a.y === b.y ? [[xA + (rightward ? 8 : -8), a.y], [xB + (rightward ? -10 : 10), b.y]] : [[xA + (rightward ? 8 : -8), a.y], [midX, a.y], [midX, b.y], [xB + (rightward ? -10 : 10), b.y]];
			const line = connector(svg, pts, { color: TONE[l.tone ?? 'blue'].fg, width: 3.5 });
			const lab = el('div', 'st-abs', root, { left: midX - 200, width: 400, top: Math.min(a.y, b.y) - 50, display: 'flex', justifyContent: 'center' });
			pill(lab, { tone: l.tone ?? 'blue', text: l.label, mono: !!l.mono, size: 's', style: { background: '#fff', border: `1.5px solid ${TONE[l.tone ?? 'blue'].fg}40` } });
			return { line, lab, at: l.at };
		});
		const linkAt = spread(ctx, p.links ?? [], { lead: 2.2, tail: 1.4 });
		const allItems = zoneEls.flatMap(z => z.itemEls);
		const itemAt = spread(ctx, allItems, { lead: 0.8, tail: Math.max(1.5, ctx.beat.duration * 0.5) });
		return { h, zoneEls, links, linkAt, allItems, itemAt };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.zoneEls.forEach((z, k) => enter(z.zone, t, s + 0.4 + k * 0.15, { dy: 18 }));
		i.allItems.forEach((it, k) => enter(it.c, t, i.itemAt[k], { dy: 12 }));
		i.links.forEach((l, k) => {
			l.line.render(t, i.linkAt[k], 0.7);
			enter(l.lab, t, i.linkAt[k] + 0.3, { dy: 6 });
		});
	},
});
