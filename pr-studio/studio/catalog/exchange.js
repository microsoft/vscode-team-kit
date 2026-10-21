// need: exchange. Messages between parties: a protocol, a handshake, a request and its reply.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { arrow, badge, card, cardHead, connector, el, iconTile, pill, svgLayer, txt } from '../theme/primitives.js';
import { codeLabel, codeStrip } from '../theme/code.js';
import { clamp, decel, enter, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { columnsX, header, need, spread } from './kit.js';

/**
 * Sequence diagram: parties as lifelines, numbered request/reply pairs that draw on with the narration,
 * an optional "only if" note that dims the conditional steps, and an optional code strip synced to the steps.
 */
export const lifelines = defineTreatment({
	id: 'exchange.lifelines',
	need: 'exchange',
	name: 'Sequence diagram',
	when: 'A protocol or handshake with 2-4 parties and 2-5 ordered messages; best when the order of calls is the point.',
	params: {
		eyebrow: 'label', title: 'label', tag: 'label (e.g. the spec name)', tagAt: 'time',
		parties: '[{ id, icon, title, sub, tone }]  (2-4, left to right)',
		steps: '[{ from, to, request, requestSub, mono, reply, replyTone, at, replyAt, badgeAt }]  (2-5)',
		skip: '{ at, note, from: stepNumber (default 2), alt: { step, text } }  (optional: later steps are conditional)',
		code: '{ block: code(...), title, rows (default 3), steps: [{ at, from, to }] }  (optional)',
	},
	demo: () => ({
		eyebrow: label('The fix'), title: label('The client asks before it retries'), tag: label('RFC 6750'),
		parties: [{ id: 'app', icon: 'laptop', title: label('App'), sub: label('the client'), tone: 'blue' }, { id: 'api', icon: 'server', title: label('API'), sub: label('the resource') }, { id: 'auth', icon: 'key', title: label('Sign-in'), sub: label('the issuer') }],
		steps: [
			{ from: 'app', to: 'api', request: label('GET /items'), requestSub: label('with an old token'), reply: label('401'), replyTone: 'red' },
			{ from: 'app', to: 'auth', request: label('refresh the token'), reply: label('new token'), replyTone: 'green' },
			{ from: 'app', to: 'api', request: label('GET /items'), requestSub: label('with the new token'), reply: label('200 \u00b7 items'), replyTone: 'green' },
		],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const parties = p.parties ?? [];
		need(parties.length >= 2 && parties.length <= 4, 'exchange.lifelines: 2-4 parties');
		const steps = p.steps ?? [];
		need(steps.length >= 1 && steps.length <= 5, 'exchange.lifelines: 1-5 steps');
		const xs = columnsX(parties.length, 280, 1640);
		const X = Object.fromEntries(parties.map((q, k) => [q.id, xs[k]]));
		for (const st of steps) {
			need(X[st.from] !== undefined && X[st.to] !== undefined, `step ${st.from} -> ${st.to}: unknown party`);
		}
		const hasCode = !!p.code;
		const areaTop = 352, areaEnd = hasCode ? 720 : 880;
		const rowH = Math.min(118, (areaEnd - areaTop) / steps.length);
		const laneW = Math.min(340, (1360 / Math.max(1, parties.length - 1)) - 40);
		const svg = svgLayer(root);
		const lanes = parties.map((q, k) => {
			const c = card(root, { left: xs[k] - laneW / 2, top: 226, width: laneW, height: 80, display: 'flex', alignItems: 'center', padding: '0 22px' });
			cardHead(c, { iconName: q.icon, title: q.title, sub: q.sub, tone: q.tone ?? 'neutral', size: parties.length > 3 ? 's' : 'm' });
			const line = el('div', 'st-abs', root, { left: xs[k] - 1, top: 306, width: 2, height: areaTop + steps.length * rowH - 306 + 10, backgroundImage: `linear-gradient(${C.lineStrong} 55%, transparent 0)`, backgroundSize: '2px 12px', transformOrigin: '50% 0' });
			return { c, line };
		});
		const leftX = Math.min(...xs);
		const nodes = steps.map((st, k) => {
			const y = areaTop + k * rowH;
			const x1 = X[st.from], x2 = X[st.to];
			const dir = Math.sign(x2 - x1) || 1;
			const req = arrow(svg, x1 + dir * 4, y, x2 - dir * 6, y, { color: C.connectorStrong });
			const rep = st.reply ? arrow(svg, x2 - dir * 4, y + 40, x1 + dir * 6, y + 40, { color: TONE[st.replyTone ?? 'neutral'].fg }) : null;
			const b = badge(root, { n: k + 1, size: 38, style: { position: 'absolute', left: leftX - 74, top: y + 20 - 19 } });
			const lx = Math.min(x1, x2) + 22;
			const rl = el('div', 'st-abs', root, { left: lx, top: y - 34, display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' });
			txt(rl, st.request, st.mono ? 'st-mono' : '', { fontSize: st.mono ? 19 : 21, fontWeight: 600, color: C.ink });
			if (st.requestSub) {
				txt(rl, st.requestSub, '', { fontSize: 18, color: C.body });
			}
			const pl = st.reply ? txt(root, st.reply, 'st-abs', { left: lx, top: y + 8, whiteSpace: 'nowrap', fontSize: 19, fontWeight: 600, color: TONE[st.replyTone ?? 'neutral'].fg }, 'div') : null;
			if (pl) {
				ctx.anchor(`reply${k + 1}`, pl);
			}
			ctx.anchor(`request${k + 1}`, rl);
			return { y, req, rep, b, rl, pl, span: [Math.min(x1, x2), Math.max(x1, x2)] };
		});
		const reqAt = spread(ctx, steps, { lead: 1.2, tail: 2 });
		const repAt = steps.map((st, k) => (st.replyAt !== undefined ? ctx.at(st.replyAt) : reqAt[k] + 0.7));
		const badgeAt = steps.map((st, k) => (st.badgeAt !== undefined ? ctx.at(st.badgeAt) : reqAt[k]));
		let skip = null;
		if (p.skip) {
			const from = (p.skip.from ?? 2) - 1;
			const y0 = nodes[from].y - 44, y1 = nodes.at(-1).y + 60;
			const veil = el('div', 'st-abs', root, { left: 86, right: 86, top: y0, height: y1 - y0, background: 'rgba(255,255,255,.78)', borderRadius: 16 });
			// Put the note in the first conditional step's row, in the widest stretch no arrow of that row crosses;
			// if it doesn't fit there, put it below the steps.
			const rowSpan = nodes[from].span;
			const marks = [...new Set([...xs, 96, 1824])].sort((a, b) => a - b);
			let best = null;
			for (let g = 0; g < marks.length - 1; g++) {
				const a = marks[g], b2 = marks[g + 1];
				if (!(rowSpan[0] < b2 - 1 && rowSpan[1] > a + 1) && (!best || b2 - a > best[1] - best[0])) {
					best = [a, b2];
				}
			}
			const note = el('div', 'st-abs', root, { display: 'flex', justifyContent: 'center' });
			const notePill = pill(note, { tone: 'green', iconName: 'check', text: p.skip.note ?? label('These steps only run if needed'), size: 'l' });
			const place = () => {
				if (best && notePill.offsetWidth <= best[1] - best[0] - 40) {
					Object.assign(note.style, { left: `${best[0] + 20}px`, width: `${best[1] - best[0] - 40}px`, top: `${nodes[from].y - 7}px` });
				} else {
					Object.assign(note.style, { left: '96px', width: '1728px', top: `${nodes.at(-1).y + 70}px` });
				}
			};
			place();
			let alt = null;
			if (p.skip.alt) {
				const n = nodes[(p.skip.alt.step ?? 1) - 1];
				const leftAlt = (n.pl ? n.pl.offsetLeft + n.pl.offsetWidth : n.span[0] + 22) + 64;
				alt = txt(root, p.skip.alt.text, 'st-abs', { left: leftAlt, top: n.y + 8, whiteSpace: 'nowrap', fontSize: 19, fontWeight: 600, color: C.green }, 'div');
			}
			skip = { veil, note, alt, at: ctx.at(p.skip.at, Math.max(0, ctx.beat.duration - 2.5)) };
		}
		let code = null;
		if (hasCode) {
			const block = ctx.code(p.code.block);
			const labelRow = codeLabel(root, { x: 96, y: 752, w: 1728, title: p.code.title, file: block.path });
			const csteps = (p.code.steps ?? [{ at: reqAt[0] - ctx.beat.start, from: block.startLine, to: Math.min(block.endLine, block.startLine + (p.code.rows ?? 3) - 1) }]).map(st => ({ ...st, at: ctx.at(st.at) }));
			const strip = codeStrip(root, block, { x: 96, y: 784, w: 1728, rows: p.code.rows ?? 3, steps: csteps, revealAt: csteps[0].at - 0.3 });
			code = { labelRow, strip, at: csteps[0].at - 0.3 };
		}
		return { h, lanes, nodes, reqAt, repAt, badgeAt, skip, code };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.lanes.forEach((l, k) => {
			enter(l.c, t, s + 0.45 + k * 0.12, { dy: 12 });
			l.line.style.transform = `scaleY(${decel(prog(t, s + 0.8 + k * 0.12, s + 1.6 + k * 0.12))})`;
		});
		const skipAt = i.skip?.at ?? Infinity;
		i.nodes.forEach((n, k) => {
			n.req.render(t, i.reqAt[k], 0.55);
			enter(n.rl, t, i.reqAt[k] + 0.05, { dy: 6 });
			enter(n.b, t, i.badgeAt[k] - 0.1, { dy: 0, scale: 0.3, dur: 0.45 });
			if (n.rep) {
				n.rep.render(t, i.repAt[k], 0.55);
			}
			if (n.pl) {
				enter(n.pl, t, i.repAt[k] + 0.1, { dy: 6 });
			}
			// The current step is in full color; finished steps settle back until the summary.
			const nextAt = k < i.nodes.length - 1 ? i.reqAt[k + 1] : skipAt;
			const dim = t >= nextAt && t < skipAt ? 0.5 : 1;
			for (const node of [n.rl, n.pl].filter(Boolean)) {
				node.style.opacity = String(Number(node.style.opacity) * dim);
			}
		});
		if (i.skip) {
			const v = decel(prog(t, i.skip.at, i.skip.at + 0.5));
			i.skip.veil.style.opacity = String(v);
			i.skip.note.style.opacity = String(v);
			i.skip.note.style.transform = `translateY(${(1 - v) * 8}px)`;
			if (i.skip.alt) {
				enter(i.skip.alt, t, i.skip.at + 0.2, { dy: 6 });
			}
		}
		if (i.code) {
			enter(i.code.labelRow, t, i.code.at, { dy: 6 });
			i.code.strip.render(t);
		}
	},
});

/**
 * A packet travels between nodes laid out on one line; each hop draws an arc, the packet rides it,
 * and the hop's label appears. Reads as "what happens to one request", left to right.
 */
export const journey = defineTreatment({
	id: 'exchange.journey',
	need: 'exchange',
	name: 'Packet journey',
	when: 'One request or value moving through 3-5 places, where what happens at each stop matters more than strict call order.',
	params: {
		eyebrow: 'label', title: 'label',
		packet: '{ text, icon, tone }  (what travels)',
		nodes: '[{ id, icon, title, sub, tone }]  (3-5, left to right)',
		hops: '[{ from, to, label, result, resultTone, at }]  (each a curve between two nodes; result shows on the arrival node)',
	},
	demo: () => ({
		eyebrow: label('How it travels'), title: label('One request, three stops'),
		packet: { text: label('request'), icon: 'send' },
		nodes: [{ id: 'ui', icon: 'window', title: label('Editor'), tone: 'blue' }, { id: 'ext', icon: 'extension', title: label('Extension host') }, { id: 'srv', icon: 'server', title: label('Language server'), tone: 'purple' }],
		hops: [{ from: 'ui', to: 'ext', label: label('over IPC') }, { from: 'ext', to: 'srv', label: label('LSP request'), result: label('answers in 40 ms'), resultTone: 'green' }, { from: 'srv', to: 'ui', label: label('result shown') }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const nodes = p.nodes ?? [];
		need(nodes.length >= 2 && nodes.length <= 5, 'exchange.journey: 2-5 nodes');
		const hops = p.hops ?? [];
		need(hops.length >= 1 && hops.length <= 6, 'exchange.journey: 1-6 hops');
		const xs = columnsX(nodes.length, 260, 1660);
		const X = Object.fromEntries(nodes.map((n, k) => [n.id, xs[k]]));
		const Y = 560;
		const svg = svgLayer(root);
		const base = connector(svg, [[xs[0], Y], [xs.at(-1), Y]], { color: C.line, width: 2, head: false, radius: 0 });
		const nodeEls = nodes.map((n, k) => {
			const wrap = el('div', 'st-abs', root, { left: xs[k] - 130, width: 260, top: Y - 52, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 });
			iconTile(wrap, n.icon ?? 'box', { tone: n.tone ?? 'neutral', size: 104, round: true, iconSize: 48 });
			txt(wrap, n.title, 'st-h4', { fontSize: 25, textAlign: 'center', whiteSpace: 'nowrap' }, 'div');
			if (n.sub) {
				txt(wrap, n.sub, 'st-small', { fontSize: 18, textAlign: 'center', marginTop: -8, whiteSpace: 'nowrap' }, 'div');
			}
			const result = el('div', 'st-abs', root, { left: xs[k] - 160, width: 320, top: Y + 128, display: 'flex', justifyContent: 'center' });
			return { wrap, result, x: xs[k] };
		});
		const results = new Map();
		const hopEls = hops.map((hp, k) => {
			need(X[hp.from] !== undefined && X[hp.to] !== undefined, `hop ${hp.from} -> ${hp.to}: unknown node`);
			const x1 = X[hp.from], x2 = X[hp.to];
			// Forward hops arc above the nodes; hops going back arc below their labels and results.
			const back = x2 < x1;
			const yy = back ? Y + 196 : Y - 74;
			const lift = back ? Y + 300 : Y - 230 - (Math.abs(x2 - x1) > 800 ? 30 : 0);
			const pts = [[x1, yy], [x1, (yy + lift) / 2], [x1 + (x2 - x1) * 0.15, lift], [x2 - (x2 - x1) * 0.15, lift], [x2, (yy + lift) / 2], [x2, yy + (back ? 8 : -8)]];
			const arc = connector(svg, pts, { color: back ? C.connector : C.connectorStrong, radius: 60 });
			const lbl = txt(root, hp.label, 'st-abs', { left: Math.min(x1, x2) + 60, width: Math.abs(x2 - x1) - 120, top: lift + (back ? 12 : -40), textAlign: 'center', fontSize: 20, fontWeight: 600, color: C.body, whiteSpace: 'nowrap' }, 'div');
			if (hp.result) {
				const target = nodeEls[nodes.findIndex(n => n.id === hp.to)];
				const r = pill(target.result, { tone: hp.resultTone ?? 'neutral', text: hp.result, size: 's' });
				results.set(k, r);
			}
			return { arc, lbl };
		});
		const packet = el('div', 'st-carry', root);
		pill(packet, { tone: p.packet?.tone ?? 'blue', iconName: p.packet?.icon ?? 'send', text: p.packet?.text ?? label('request'), solid: true, size: 'm', style: { boxShadow: '0 8px 24px rgba(0, 95, 184, .22)' } });
		return { h, base, nodeEls, hopEls, results, packet, times: spread(ctx, hops, { lead: 1.4, tail: 1.6 }) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.base.render(t, s + 0.4, 0.9);
		i.nodeEls.forEach((n, k) => enter(n.wrap, t, s + 0.5 + k * 0.15, { dy: 14 }));
		let active = -1;
		i.hopEls.forEach((hp, k) => {
			const at = i.times[k];
			hp.arc.render(t, at, 0.8);
			enter(hp.lbl, t, at + 0.2, { dy: 6 });
			if (t >= at) {
				active = k;
			}
			const r = i.results.get(k);
			if (r) {
				enter(r, t, at + 0.85, { dy: 0, scale: 0.3, dur: 0.45 });
			}
		});
		if (active < 0) {
			i.packet.style.opacity = '0';
			return;
		}
		const hp = i.hopEls[active];
		const p = standard(prog(t, i.times[active], i.times[active] + 0.8));
		const pt = hp.arc.pointAt(p);
		const w = i.packet.offsetWidth, hh = i.packet.offsetHeight;
		i.packet.style.transform = `translate(${pt.x - w / 2}px, ${pt.y - hh / 2}px)`;
		i.packet.style.opacity = String(clamp(prog(t, i.times[0] - 0.05, i.times[0] + 0.2)));
	},
});

