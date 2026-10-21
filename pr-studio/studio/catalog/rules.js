// need: rules. A rule applied to cases: validation, filtering, permissions.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { card, el, icon, pill, tile, txt } from '../theme/primitives.js';
import { codeLabel, codeStrip } from '../theme/code.js';
import { clamp, decel, enter, lerp, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { header, need, spread } from './kit.js';

/**
 * Comparison matrix: a reference row (what is allowed), the rule for each column, then test cases whose cells
 * turn green or red column by column, with a verdict per case. Optional code strip with the rule's code.
 */
export const matrix = defineTreatment({
	id: 'rules.matrix',
	need: 'rules',
	name: 'Comparison matrix',
	when: 'A rule that compares several fields of each case against a reference (origin, version, scope). Cases come from the PR\u2019s tests.',
	params: {
		eyebrow: 'label', title: 'label', tag: 'text (e.g. the function)', tagAt: 'time', tagMono: 'bool',
		columns: '[{ id, label, width }]  (2-4 data columns; widths in px, total about 1290)',
		verdictLabel: 'label for the verdict column',
		reference: '{ cells: { [column]: text }, verdict: text }',
		rules: '[{ column, text, tone, at }]',
		rows: '[{ cells: { [column]: text }, pass: { [column]: bool }, ok, verdict, why, at } | { whole: text, ok, verdict, why, at }]',
		code: '{ block: code(...), title, note, rows }  (optional)',
	},
	demo: () => ({
		eyebrow: label('The rule'), title: label('Which files get formatted?'), verdictLabel: label('Formatted'),
		columns: [{ id: 'folder', label: label('Folder'), width: 520 }, { id: 'ext', label: label('Extension'), width: 300 }],
		reference: { cells: { folder: label('src/'), ext: label('.ts') }, verdict: label('yes') },
		rules: [{ column: 'folder', text: label('inside src/') }, { column: 'ext', text: label('TypeScript only') }],
		rows: [
			{ cells: { folder: label('src/app'), ext: label('.ts') }, pass: { folder: true, ext: true }, ok: true, verdict: label('formatted'), why: label('both match') },
			{ cells: { folder: label('test/'), ext: label('.ts') }, pass: { folder: false, ext: true }, ok: false, verdict: label('skipped'), why: label('outside src/') },
			{ cells: { folder: label('src/'), ext: label('.json') }, pass: { folder: true, ext: false }, ok: false, verdict: label('skipped'), why: label('not TypeScript') },
		],
	}),
	mount(root, p, ctx) {
		const h = header(root, { tagTone: 'neutral', ...p }, ctx);
		const cols = p.columns ?? [];
		need(cols.length >= 1 && cols.length <= 4, 'rules.matrix: 1-4 columns');
		const totalData = 1290 - 18 * (cols.length - 1);
		const given = cols.reduce((a, c) => a + (c.width ?? 0), 0);
		const free = cols.filter(c => !c.width).length;
		let x = 96;
		const COL = {};
		for (const c of cols) {
			const w = c.width ?? Math.max(160, (totalData - given) / free);
			COL[c.id] = [x, w];
			x += w + 18;
		}
		const verdictX = 96 + 1290;
		const heads = [...cols.map(c => txt(root, c.label, 'st-label st-abs', { left: COL[c.id][0] + 16, top: 234, fontSize: 16 }, 'div')),
			txt(root, p.verdictLabel ?? label('Result'), 'st-label st-abs', { left: verdictX + 16, top: 234, fontSize: 16 }, 'div')];
		const cell = (parent, colX, w, text, style = {}) => txt(parent, text, 'st-abs st-mono', { left: colX - 96 + 16, width: w - 32, top: 0, height: '100%', display: 'flex', alignItems: 'center', fontSize: 23, whiteSpace: 'nowrap', overflow: 'hidden', ...style }, 'div');
		const ref = tile(root, 'blue', { left: 96, top: 262, width: 1728, height: 64 });
		for (const c of cols) {
			if (p.reference?.cells?.[c.id] !== undefined) {
				cell(ref, COL[c.id][0], COL[c.id][1], p.reference.cells[c.id], { color: C.ink, fontWeight: 600 });
			}
		}
		if (p.reference?.verdict) {
			cell(ref, verdictX, 438, p.reference.verdict, { fontFamily: 'var(--sans)', color: C.blue, fontSize: 21, fontWeight: 600 });
		}
		const chipRow = el('div', 'st-abs', root, { left: 0, top: 340, width: 1920, height: 44 });
		const rules = (p.rules ?? []).map(r => {
			need(COL[r.column], `rule for unknown column ${r.column}`);
			const w = el('div', 'st-abs', chipRow, { left: COL[r.column][0], top: 0 });
			pill(w, { tone: r.tone ?? 'blue', text: r.text, size: 's', style: { height: 40, fontSize: 19 } });
			return w;
		});
		el('div', 'st-abs', root, { left: 96, top: 402, width: 1728, height: 1.5, background: C.line });
		const hasCode = !!p.code;
		const rowsIn = p.rows ?? [];
		const maxRows = hasCode ? 5 : 8;
		need(rowsIn.length <= maxRows, `rules.matrix: at most ${maxRows} rows${hasCode ? ' with a code strip' : ''}`);
		const rows = rowsIn.map((r, n) => {
			const row = el('div', 'st-abs', root, { left: 96, top: 416 + n * 58, width: 1728, height: 50 });
			const tint = (colId, good) => el('div', 'st-abs', row, { left: COL[colId][0] - 96 + 4, width: COL[colId][1] - 8, top: 3, height: 44, borderRadius: 10, background: good ? C.greenTint : C.redTint });
			if (r.whole !== undefined) {
				el('div', 'st-abs', row, { left: 4, width: 1290 - 26, top: 3, height: 44, borderRadius: 10, background: C.redTint });
				cell(row, 96, 1290, r.whole, { color: C.red, fontSize: 22 });
			} else {
				for (const c of cols) {
					const pass = r.pass?.[c.id];
					if (pass !== undefined) {
						tint(c.id, pass);
					}
					if (r.cells?.[c.id] !== undefined) {
						cell(row, COL[c.id][0], COL[c.id][1], r.cells[c.id], { color: pass === undefined ? C.body : pass ? C.green : C.red, fontSize: 22, fontWeight: pass === undefined ? 400 : 600 });
					}
				}
			}
			const v = el('div', 'st-abs', row, { left: verdictX - 96 + 16, top: 0, height: 50, display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' });
			icon(v, r.ok ? 'check' : 'dismiss', 26, r.ok ? C.green : C.faint);
			txt(v, r.verdict ?? (r.ok ? label('yes') : label('no')), '', { fontSize: 21, fontWeight: 600, color: r.ok ? C.green : C.ink });
			if (r.why) {
				txt(v, r.why, '', { fontSize: 18, color: C.body });
			}
			return row;
		});
		const rowAt = spread(ctx, rowsIn, { lead: 2.2, tail: 1.2 });
		let code = null;
		if (hasCode) {
			const block = ctx.code(p.code.block);
			const labelRow = codeLabel(root, { x: 96, y: 748, w: 1728, title: p.code.title, file: block.path, note: p.code.note });
			const at = ctx.at(p.code.at, Math.max(1, (rowAt[0] ?? ctx.beat.start + 2) - ctx.beat.start - 0.4));
			const strip = codeStrip(root, block, { x: 96, y: 780, w: 1728, rows: p.code.rows ?? 3, steps: [{ at, from: block.startLine, to: block.endLine }], revealAt: at });
			code = { labelRow, strip, at };
		}
		return { h, heads, ref, rules, rows, code, rowAt, ruleAt: spread(ctx, p.rules ?? [], { lead: 1.6, tail: 2 }) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.heads.forEach((n, k) => enter(n, t, s + 0.6 + k * 0.05, { dy: 6 }));
		enter(i.ref, t, s + 0.7, { dy: 10 });
		i.rules.forEach((r, k) => enter(r, t, i.ruleAt[k], { dy: 6 }));
		i.rows.forEach((row, k) => enter(row, t, i.rowAt[k] + 0.25, { dy: 10, dur: 0.5 }));
		if (i.code) {
			enter(i.code.labelRow, t, i.code.at, { dy: 6 });
			i.code.strip.render(t);
		}
	},
});

/** Each case gets a verdict stamped onto it, one by one: allowed or blocked, with the reason. */
export const stamps = defineTreatment({
	id: 'rules.stamps',
	need: 'rules',
	name: 'Verdict stamps',
	when: 'A rule shown through 3-6 concrete cases that each get a clear yes or no.',
	params: { eyebrow: 'label', title: 'label', rule: '{ icon, text, at }  (the rule in one line)', cases: '[{ text, mono, sub, ok, verdict (2-3 words on the stamp), why (a few words beside it), at }]  (2-6)' },
	demo: () => ({
		eyebrow: label('The rule'), title: label('Only trusted folders run tasks'), rule: { icon: 'shield', text: label('Tasks run automatically only in a trusted workspace') },
		cases: [{ text: label('~/work/app'), mono: true, sub: label('trusted'), ok: true, verdict: label('runs') }, { text: label('~/Downloads/repo'), mono: true, sub: label('not trusted'), ok: false, verdict: label('asks first'), why: label('restricted mode') }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const cases = p.cases ?? [];
		need(cases.length >= 2 && cases.length <= 6, 'rules.stamps: 2-6 cases');
		const blockH = (p.rule ? 100 : 0) + cases.length * 108;
		let y = 250 + Math.max(0, (650 - blockH) / 2 - 20);
		let rule = null;
		if (p.rule) {
			rule = tile(root, 'blue', { left: 96, top: y, width: 1728, height: 76, display: 'flex', alignItems: 'center', gap: 18, padding: '0 30px' });
			icon(rule, p.rule.icon ?? 'shield', 32, C.blue);
			txt(rule, p.rule.text, '', { fontSize: 26, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' });
			y += 100;
		}
		const rowH = Math.min(96, (900 - y) / cases.length - 12);
		need(rowH >= 60, 'rules.stamps: too many cases for the frame');
		const rows = cases.map((c, k) => {
			const row = card(root, { left: 96, top: y + k * (rowH + 12), width: 1728, height: rowH, display: 'flex', alignItems: 'center', padding: '0 30px', gap: 24 });
			const col = el('div', '', row, { flex: 1, minWidth: 0 });
			txt(col, c.text, c.mono ? 'st-mono' : '', { display: 'block', fontSize: c.mono ? 23 : 25, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 'div');
			if (c.sub) {
				txt(col, c.sub, '', { display: 'block', fontSize: 19, color: C.body, marginTop: 4, whiteSpace: 'nowrap' }, 'div');
			}
			if (c.why) {
				txt(row, c.why, '', { fontSize: 19, color: C.body, whiteSpace: 'nowrap', flex: 'none' });
			}
			const stamp = el('div', '', row, { flex: 'none', width: 250, display: 'flex', justifyContent: 'flex-end' });
			const st = pill(stamp, { tone: c.ok ? 'green' : 'red', iconName: c.ok ? 'check' : 'dismiss', text: c.verdict ?? (c.ok ? label('allowed') : label('blocked')), size: 'l', solid: true });
			return { row, st };
		});
		return { h, rule, rows, times: spread(ctx, cases, { lead: 1.6, tail: 1.2 }), ruleAt: p.rule ? ctx.at(p.rule.at, 0.5) : 0 };
	},
	render(i, t, ctx) {
		i.h.render(t);
		if (i.rule) {
			enter(i.rule, t, i.ruleAt, { dy: 10 });
		}
		i.rows.forEach((r, k) => {
			const at = i.times[k];
			enter(r.row, t, at - 0.5, { dy: 10 });
			const p = decel(prog(t, at, at + 0.35));
			r.st.style.opacity = String(p);
			r.st.style.transform = `scale(${lerp(1.6, 1, p)}) rotate(${lerp(-8, 0, p)}deg)`;
		});
	},
});

/**
 * Cases travel left to right through gates; each stops (red) at the first gate it fails, and the ones that pass
 * every gate arrive in the green zone. Good for "only X gets through".
 */
export const sieve = defineTreatment({
	id: 'rules.sieve',
	need: 'rules',
	name: 'Gates',
	when: 'A series of checks that filter cases (2-3 gates, 2-5 cases): which ones make it through, and where the others stop.',
	params: {
		eyebrow: 'label', title: 'label',
		gates: '[{ label }]  (2-3, in order; short labels: they shrink together when the gates are close)',
		pass: '{ label, icon }  (the zone for cases that pass every gate)',
		cases: '[{ text, mono, stopsAt: gate number (1-based) or null when it passes, why, tone (a stopped case is red, a passing one green; set it when stopping is the intended outcome), at }]  (2-5)',
	},
	demo: () => ({
		eyebrow: label('The rule'), title: label('Two checks before a token is sent'),
		gates: [{ label: label('https only') }, { label: label('same host') }], pass: { label: label('token sent'), icon: 'key' },
		cases: [{ text: label('http://example.com'), mono: true, stopsAt: 1, why: label('cleartext') }, { text: label('https://example.com/a'), mono: true, stopsAt: null }, { text: label('https://cdn.example.com'), mono: true, stopsAt: 2, why: label('other host') }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const gates = p.gates ?? [];
		need(gates.length >= 1 && gates.length <= 3, 'rules.sieve: 1-3 gates');
		const cases = p.cases ?? [];
		need(cases.length >= 2 && cases.length <= 5, 'rules.sieve: 2-5 cases');
		const laneH = Math.min(104, 560 / cases.length);
		const laneTop = 330 + Math.max(0, (560 - cases.length * laneH) / 2);
		const gx = gates.length === 1 ? [1040] : gates.length === 2 ? [860, 1220] : [760, 1040, 1320];
		const zoneX = 1520;
		const gateEls = gates.map((g, k) => {
			const bar = el('div', 'st-abs', root, { left: gx[k] - 4, top: laneTop - 20, width: 8, height: cases.length * laneH + 20, borderRadius: 4, background: C.lineStrong, transformOrigin: '50% 0' });
			const lab = el('div', 'st-abs', root, { left: gx[k] - 160, width: 320, top: laneTop - 84, display: 'flex', justifyContent: 'center' });
			pill(lab, { tone: 'blue', text: g.label, size: 'm' });
			return { bar, lab };
		});
		const zone = tile(root, 'green', { left: zoneX, top: laneTop - 20, width: 1824 - zoneX, height: cases.length * laneH + 20 });
		const zoneHead = el('div', 'st-abs', root, { left: zoneX, width: 1824 - zoneX, top: laneTop - 84, display: 'flex', justifyContent: 'center' });
		pill(zoneHead, { tone: 'green', iconName: p.pass?.icon ?? 'check', text: p.pass?.label ?? label('passes'), size: 'm', solid: true });
		const caseEls = cases.map((c, k) => {
			const y = laneTop + k * laneH + laneH / 2;
			const lane = el('div', 'st-abs', root, { left: 96, width: 1728, top: y, height: 1.5, background: C.line });
			const chip = el('div', 'st-abs', root, { left: 96, top: y - 24, height: 48, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', borderRadius: 12, background: '#fff', border: `1.5px solid ${C.lineStrong}`, whiteSpace: 'nowrap' });
			chip.dataset.box = 'pill';
			txt(chip, c.text, c.mono ? 'st-mono' : '', { fontSize: c.mono ? 19 : 21, fontWeight: 600, color: C.ink });
			const tone = TONE[c.tone ?? (c.stopsAt ? 'red' : 'green')] ?? TONE.red;
			const why = c.why ? txt(root, c.why, 'st-abs', { left: 0, top: y + 27, fontSize: 18, color: tone.fg, whiteSpace: 'nowrap' }, 'div') : null;
			return { c, y, lane, chip, why, tone };
		});
		// The pass zone is as wide as the widest case that reaches it; the gates share the space left of it.
		const passW = Math.max(0, ...caseEls.filter(e => !e.c.stopsAt).map(e => e.chip.offsetWidth));
		const zoneW = Math.max(1824 - zoneX, passW + 48);
		const zx = 1824 - zoneW;
		const failW = Math.max(0, ...caseEls.filter(e => e.c.stopsAt === 1).map(e => e.chip.offsetWidth));
		const left = Math.max(700, 96 + failW + 40), right = zx - 110;
		need(right - left >= (gates.length - 1) * 220, 'rules.sieve: the cases are too wide for the gates; shorten their text');
		const gx2 = gates.length === 1 ? [(left + right) / 2] : gates.map((_, k) => left + (k * (right - left)) / (gates.length - 1));
		// Labels shrink a size when the gates are close; they must never touch.
		const spacing = gates.length > 1 ? (right - left) / (gates.length - 1) : 640;
		const labelW = spacing - 28;
		// One size for all the labels: if one must shrink, they all do.
		const small = gateEls.some(g => g.lab.firstChild.offsetWidth > labelW);
		gateEls.forEach((g, k) => {
			g.bar.style.left = `${gx2[k] - 4}px`;
			const pillEl = g.lab.firstChild;
			if (small) {
				Object.assign(pillEl.style, { fontSize: '17px', height: '34px', padding: '0 14px' });
			}
			if (pillEl.offsetWidth > labelW) {
				// Still too long: two lines, centered over the gate.
				Object.assign(pillEl.style, { whiteSpace: 'normal', height: 'auto', padding: '6px 14px', lineHeight: '1.2', textAlign: 'center', maxWidth: `${labelW}px` });
				g.lab.style.top = `${parseFloat(g.lab.style.top) - 16}px`;
			}
			Object.assign(g.lab.style, { left: `${gx2[k] - labelW / 2}px`, width: `${labelW}px` });
		});
		Object.assign(zone.style, { left: `${zx}px`, width: `${zoneW}px` });
		Object.assign(zoneHead.style, { left: `${zx}px`, width: `${zoneW}px` });
		return { h, gateEls, zone, zoneHead, caseEls, gx: gx2, zoneX: zx, times: spread(ctx, cases, { lead: 1.6, tail: 1.6 }) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.gateEls.forEach((g, k) => {
			g.bar.style.transform = `scaleY(${decel(prog(t, s + 0.6 + k * 0.15, s + 1.3 + k * 0.15))})`;
			enter(g.lab, t, s + 0.8 + k * 0.15, { dy: 6 });
		});
		enter(i.zone, t, s + 0.9, { dy: 0 });
		enter(i.zoneHead, t, s + 1.0, { dy: 6 });
		i.caseEls.forEach((e, k) => {
			const at = i.times[k];
			enter(e.lane, t, s + 0.5, { dy: 0 });
			const w = e.chip.offsetWidth;
			const stop = e.c.stopsAt ? Math.max(96, i.gx[e.c.stopsAt - 1] - 14 - w) : i.zoneX + (1824 - i.zoneX - w) / 2;
			const p = standard(prog(t, at, at + 1.1));
			const x = lerp(0, stop - 96, p);
			e.chip.style.transform = `translateX(${x}px)`;
			e.chip.style.opacity = String(clamp(prog(t, at - 0.6, at - 0.2)));
			const done = prog(t, at + 1.0, at + 1.3);
			const failed = !!e.c.stopsAt;
			e.chip.style.borderColor = done > 0.5 ? e.tone.fg : C.lineStrong;
			e.chip.style.background = done > 0.5 && failed ? e.tone.tint : '#fff';
			if (e.why) {
				// A stopped case's note ends where its chip ends, before the gate; a passing one starts with its chip.
				e.why.style.left = `${failed ? Math.max(96, stop + w - e.why.offsetWidth) : stop}px`;
				enter(e.why, t, at + 1.15, { dy: 6 });
			}
		});
	},
});

