// Code, always the exact lines at the PR head commit (resolved and tokenized by prs prepare with Shiki Light+).
// block: { key, path, lang, startLine, endLine, lines: [{ n, text, tokens: [{ t, c, i, b }], changed }] }
// hunk:  { key, path, kind: 'diff', lines: [{ type: '+' | '-' | ' ', old, new, text, tokens }] }
import { el, txt } from './primitives.js';
import { C } from './tokens.js';
import { clamp, decel, enter, lerp, prog, standard } from '../engine/motion.js';
import { path as pathText } from '../engine/text.js';

/** Advance width of the code font in em, measured once (Menlo 0.602, JetBrains Mono 0.6, Cascadia 0.586...). */
let charEm = null;
function charWidth() {
	if (charEm === null) {
		const probe = el('span', 'st-mono', document.body, { position: 'absolute', left: '-9999px', top: '0', fontSize: '100px', whiteSpace: 'pre', visibility: 'hidden' }, 'M'.repeat(50));
		charEm = probe.getBoundingClientRect().width / 50 / 100 || 0.602;
		probe.remove();
	}
	return charEm;
}

function dedent(lines) {
	const indents = lines.filter(l => l.text.trim()).map(l => l.text.length - l.text.trimStart().length);
	return indents.length ? Math.min(...indents) : 0;
}

/** Renders tokens into `row`, dropping `cut` leading characters (dedent) and eliding after `maxChars`. */
function paintTokens(row, tokens, cut, maxChars) {
	let left = cut;
	let used = 0;
	let elided = false;
	for (const tk of tokens) {
		let text = tk.t;
		if (left > 0) {
			const drop = Math.min(left, text.length - text.trimStart().length, text.length);
			text = text.slice(drop);
			left -= drop;
			if (!text) {
				continue;
			}
		}
		if (used + text.length > maxChars) {
			text = text.slice(0, Math.max(0, maxChars - used - 1));
			elided = true;
		}
		if (text) {
			el('span', '', row, { color: tk.c ?? C.ink, fontStyle: tk.i ? 'italic' : 'normal', fontWeight: tk.b ? 700 : 400 }, text);
			used += text.length;
		}
		if (elided) {
			el('span', '', row, { color: C.muted }, '\u2026');
			break;
		}
	}
	return elided;
}

function pickFont(maxLen, width, wanted, min = 14) {
	const fitting = Math.floor(width / Math.max(1, maxLen) / charWidth() * 10) / 10;
	return Math.max(min, Math.min(wanted, fitting));
}

function linesOf(block, from, to) {
	const lines = block.lines.filter(l => l.n >= from && l.n <= to);
	if (!lines.length) {
		throw new Error(`Lines ${from}-${to} are not in ${block.path} (${block.startLine}-${block.endLine}). Widen the code() range.`);
	}
	return lines;
}

/** A caption row above a code element: function name + file path (+ optional note on the right). */
export function codeLabel(parent, { x, y, w, title, file, note }) {
	const row = el('div', 'st-abs', parent, { left: x, top: y, width: w, display: 'flex', alignItems: 'baseline', gap: 14, whiteSpace: 'nowrap' });
	if (title) {
		txt(row, title, 'st-mono', { fontSize: 19, fontWeight: 600, color: C.ink, flex: 'none' });
	}
	if (file) {
		txt(row, pathText(file, { show: 'full' }), '', { fontSize: 18, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 });
	}
	if (note) {
		txt(row, note, '', { fontSize: 18, color: C.muted, flex: 'none' });
	}
	return row;
}

/**
 * One full-width strip showing the exact lines of the current step; cross-fades step to step.
 * steps: [{ at: seconds, from, to }] (line numbers in the block).
 */
export function codeStrip(parent, block, { x, y, w, rows = 3, steps, revealAt, fontSize = 19 }) {
	const groups = steps.map(st => ({ st, lines: linesOf(block, st.from, st.to) }));
	for (const g of groups) {
		if (g.lines.length > rows) {
			throw new Error(`Code step ${g.st.from}-${g.st.to} has ${g.lines.length} lines; the strip shows ${rows}. Raise rows or split the step.`);
		}
	}
	const gutter = 78;
	const maxLen = Math.max(...groups.map(g => {
		const cut = dedent(g.lines);
		return Math.max(...g.lines.map(l => l.text.length - cut));
	}));
	const size = pickFont(maxLen, w - gutter - 28, fontSize);
	const ROW = Math.round(size * 1.7);
	const h = rows * ROW + 26;
	const root = el('div', 'st-code', parent, { left: x, top: y, width: w, height: h });
	root.dataset.box = 'code';
	root.dataset.src = 'code';
	const maxChars = Math.floor((w - gutter - 28) / (size * charWidth()));
	const nodes = groups.map(({ st, lines }) => {
		const cut = dedent(lines);
		const g = el('div', '', root, { position: 'absolute', left: 0, right: 0, top: 13 + Math.round((rows - lines.length) * ROW / 2) });
		for (const line of lines) {
			const row = el('div', 'st-code__row', g, { height: ROW, fontSize: size });
			el('div', 'st-code__gutter', row, { width: gutter, paddingRight: 22, fontSize: size - 2 }, String(line.n));
			const content = el('div', '', row, { minWidth: 0 });
			paintTokens(content, line.tokens, cut, maxChars);
		}
		return { g, st };
	});
	return {
		root, height: h,
		render(t) {
			enter(root, t, revealAt, { dy: 12 });
			nodes.forEach(({ g, st }, i) => {
				const next = steps[i + 1];
				const inP = i === 0 ? 1 : decel(prog(t, st.at + 0.06, st.at + 0.4));
				const outP = next ? prog(t, next.at - 0.14, next.at + 0.06) : 0;
				g.style.opacity = String(inP * (1 - outP));
				g.style.transform = `translateY(${(1 - inP) * 8}px)`;
			});
		},
	};
}

/**
 * A code panel with a file header and a focus band that moves (and scrolls) to each range at its time.
 * focus: [{ at, from, to }]. Lines added by the PR get a green mark in the gutter.
 */
export function codePanel(parent, block, { x, y, w, h, focus = [], revealAt, fontSize = 20, from, to, legend = true, fit = true }) {
	const lines = linesOf(block, from ?? block.startLine, to ?? block.endLine);
	const cut0 = dedent(lines);
	const size0 = pickFont(Math.max(...lines.map(l => l.text.length - cut0)), w - 74 - 30, fontSize);
	if (fit) {
		h = Math.min(h, 62 + 28 + lines.length * Math.round(size0 * 1.66));
	}
	const root = el('div', 'st-code', parent, { left: x, top: y, width: w, height: h });
	root.dataset.box = 'code';
	root.dataset.src = 'code';
	const head = el('div', '', root, { display: 'flex', alignItems: 'center', gap: 14, height: 62, padding: '0 26px', borderBottom: `1.5px solid ${C.line}`, background: '#fff' });
	txt(head, (block.lang ?? 'ts').toUpperCase().slice(0, 4), 'st-mono', { fontSize: 15, fontWeight: 700, color: '#fff', background: C.blue, borderRadius: 6, padding: '3px 7px', flex: 'none' });
	txt(head, pathText(block.path), '', { fontSize: 22, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', flex: 'none' });
	txt(head, pathText(block.path, { show: 'dir' }), 'st-mono', { fontSize: 16, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 });
	if (legend && lines.some(l => l.changed)) {
		const lg = el('div', '', head, { display: 'flex', alignItems: 'center', gap: 10, flex: 'none' });
		el('div', '', lg, { width: 4, height: 20, borderRadius: 2, background: C.green });
		txt(lg, 'added in this PR', '', { fontSize: 18, color: C.body, whiteSpace: 'nowrap' });
	}
	const cut = dedent(lines);
	const gutter = 74;
	const size = pickFont(Math.max(...lines.map(l => l.text.length - cut)), w - gutter - 30, fontSize);
	const ROW = Math.round(size * 1.66);
	const maxChars = Math.floor((w - gutter - 30) / (size * charWidth()));
	const viewTop = 62, viewH = h - viewTop;
	const view = el('div', '', root, { position: 'absolute', left: 0, right: 0, top: viewTop, height: viewH, overflow: 'hidden' });
	const inner = el('div', '', view, { position: 'absolute', left: 0, right: 0, top: 0, paddingTop: 14, paddingBottom: 14 });
	const band = el('div', '', inner, { position: 'absolute', left: 0, right: 0, background: C.blueTint, opacity: 0 });
	el('div', '', band, { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: C.blue });
	const rows = lines.map(line => {
		const row = el('div', 'st-code__row', inner, { height: ROW, fontSize: size });
		if (line.changed) {
			el('div', '', row, { position: 'absolute', left: 10, top: Math.round(ROW * 0.15), width: 4, height: Math.round(ROW * 0.7), borderRadius: 2, background: C.green, opacity: 0.85 });
		}
		el('div', 'st-code__gutter', row, { width: gutter, paddingRight: 22, fontSize: size - 2.5 }, String(line.n));
		const content = el('div', '', row, { minWidth: 0 });
		paintTokens(content, line.tokens, cut, maxChars);
		return row;
	});
	const idx = n => lines.findIndex(l => l.n === n);
	const ranges = focus.map(f => ({ ...f, i0: idx(f.from), i1: idx(f.to) }));
	for (const r of ranges) {
		if (r.i0 < 0 || r.i1 < r.i0) {
			throw new Error(`Focus ${r.from}-${r.to} is outside the panel (${lines[0].n}-${lines.at(-1).n})`);
		}
	}
	const contentH = 28 + rows.length * ROW;
	const maxScroll = Math.max(0, contentH - viewH);
	const scrollFor = r => (r ? clamp(14 + ((r.i0 + r.i1 + 1) / 2) * ROW - viewH * 0.45, 0, maxScroll) : 0);
	return {
		root,
		render(t) {
			enter(root, t, revealAt, { dy: 18, dur: 0.7 });
			let k = -1;
			ranges.forEach((r, i) => {
				if (t >= r.at) {
					k = i;
				}
			});
			const cur = ranges[k], prev = ranges[k - 1];
			const p = cur ? standard(prog(t, cur.at, cur.at + 0.5)) : 0;
			inner.style.transform = `translateY(${-(cur ? lerp(scrollFor(prev), scrollFor(cur), p) : 0)}px)`;
			if (cur) {
				const top0 = 14 + (prev ?? cur).i0 * ROW, h0 = ((prev ?? cur).i1 - (prev ?? cur).i0 + 1) * ROW;
				const top1 = 14 + cur.i0 * ROW, h1 = (cur.i1 - cur.i0 + 1) * ROW;
				band.style.top = `${lerp(top0, top1, prev ? p : 1)}px`;
				band.style.height = `${lerp(h0, h1, prev ? p : 1)}px`;
				band.style.opacity = String(prev ? 1 : p);
			} else {
				band.style.opacity = '0';
			}
			rows.forEach((row, i) => {
				const reveal = decel(prog(t, revealAt + 0.15 + i * 0.025, revealAt + 0.55 + i * 0.025));
				const inCur = cur && i >= cur.i0 && i <= cur.i1;
				const inPrev = prev && i >= prev.i0 && i <= prev.i1;
				const was = !cur ? 1 : prev ? (inPrev ? 1 : 0.42) : 1;
				const now = !cur ? 1 : inCur ? 1 : 0.42;
				row.style.opacity = String(reveal * lerp(was, now, p));
			});
		},
	};
}

/** A diff hunk: removed lines in red, added lines in green, with both line numbers. */
export function diffPanel(parent, hunk, { x, y, w, h, revealAt, fontSize = 19, stagger = 0.05 }) {
	const root = el('div', 'st-code', parent, { left: x, top: y, width: w, height: h });
	root.dataset.box = 'code';
	root.dataset.src = 'code';
	const head = el('div', '', root, { display: 'flex', alignItems: 'center', gap: 14, height: 58, padding: '0 24px', borderBottom: `1.5px solid ${C.line}`, background: '#fff' });
	txt(head, pathText(hunk.path), '', { fontSize: 21, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', flex: 'none' });
	txt(head, pathText(hunk.path, { show: 'dir' }), 'st-mono', { fontSize: 15, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 });
	const adds = hunk.lines.filter(l => l.type === '+').length, dels = hunk.lines.filter(l => l.type === '-').length;
	txt(head, `+${adds}`, 'st-mono', { fontSize: 18, color: C.green, fontWeight: 600, flex: 'none' });
	txt(head, `\u2212${dels}`, 'st-mono', { fontSize: 18, color: C.red, fontWeight: 600, flex: 'none' });
	// The counts are of the lines shown, not the whole file: say so, or a slice reads like the file's totals.
	txt(head, 'in these lines', '', { fontSize: 16, color: C.muted, whiteSpace: 'nowrap', flex: 'none' });
	const cut = dedent(hunk.lines);
	const gutter = 108;
	const size = pickFont(Math.max(...hunk.lines.map(l => l.text.length - cut)), w - gutter - 40, fontSize);
	const ROW = Math.round(size * 1.6);
	const maxChars = Math.floor((w - gutter - 40) / (size * charWidth()));
	const body = el('div', '', root, { position: 'absolute', left: 0, right: 0, top: 58, bottom: 0, overflow: 'hidden', paddingTop: 10 });
	const rows = hunk.lines.map(line => {
		const tint = line.type === '+' ? C.greenTint : line.type === '-' ? C.redTint : 'transparent';
		const row = el('div', 'st-code__row', body, { height: ROW, fontSize: size, background: tint });
		const nums = el('div', 'st-code__gutter', row, { width: gutter, display: 'flex', justifyContent: 'flex-end', gap: 10, paddingRight: 8, fontSize: size - 3 });
		el('span', '', nums, { width: 40, textAlign: 'right' }, line.old ? String(line.old) : '');
		el('span', '', nums, { width: 40, textAlign: 'right' }, line.new ? String(line.new) : '');
		el('div', '', row, { width: 26, flex: 'none', color: line.type === '+' ? C.green : line.type === '-' ? C.red : C.faint, fontWeight: 700, textAlign: 'center' }, line.type === ' ' ? '' : line.type === '-' ? '\u2212' : '+');
		const content = el('div', '', row, { minWidth: 0, opacity: line.type === '-' ? 0.85 : 1 });
		paintTokens(content, line.tokens, cut, maxChars);
		return row;
	});
	const need = 58 + 10 + rows.length * ROW + 16;
	if (need <= h) {
		root.style.height = `${need}px`;
	}
	const fits = 10 + rows.length * ROW <= h - 58;
	if (!fits) {
		throw new Error(`Diff hunk of ${hunk.path} has ${rows.length} lines; it needs ${10 + rows.length * ROW + 58}px, the panel is ${h}px. Narrow it with from/to.`);
	}
	return {
		root, rows, ROW,
		render(t) {
			enter(root, t, revealAt, { dy: 16, dur: 0.6 });
			rows.forEach((row, i) => {
				row.style.opacity = String(decel(prog(t, revealAt + 0.2 + i * stagger, revealAt + 0.55 + i * stagger)));
			});
		},
	};
}
