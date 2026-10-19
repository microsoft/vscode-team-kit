// need: status. Scope, tests and what is still open; where a reviewer should start reading.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { el, iconTile, tile, txt, badge, card } from '../theme/primitives.js';

const STEP_TONES = ['blue', 'purple', 'green', 'orange', 'neutral'];
import { decel, enter, lerp, prog, standard } from '../engine/motion.js';
import { label, path as pathText } from '../engine/text.js';
import { header, need, spread } from './kit.js';

function readRefs(parent, read, ctx, { width }) {
	txt(parent, read.label ?? label('Start reading here'), 'st-label', { display: 'block', color: C.blue }, 'div');
	const refs = read.refs ?? [];
	need(refs.length >= 1 && refs.length <= 3, 'read.refs: 1-3');
	return refs.map((r, k) => {
		const block = ctx.code(r.code);
		const row = el('div', '', parent, { marginTop: k ? 44 : 32, display: 'flex', gap: 22, alignItems: 'flex-start' });
		const dot = badge(row, { n: k + 1, size: 46, color: C.faint });
		const col = el('div', '', row, { minWidth: 0, maxWidth: width - 120 });
		txt(col, r.title, 'st-mono', { display: 'block', fontSize: 26, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' }, 'div');
		if (r.what) {
			txt(col, r.what, '', { display: 'block', marginTop: 6, fontSize: 21, color: C.body, whiteSpace: 'nowrap' }, 'div');
		}
		const loc = txt(col, [pathText(block.path), label(`:${block.startLine}`)], 'st-mono', { display: 'block', marginTop: 12, fontSize: 17, color: C.body, whiteSpace: 'nowrap' }, 'div');
		loc.lastChild.dataset.src = 'code';
		txt(col, pathText(block.path, { show: 'dir' }), 'st-foot', { display: 'block', marginTop: 4, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, 'div');
		return { row, dot, col, at: r.at };
	});
}

/** A reviewer's checklist (scope, follow-ups, tests, what's pending) and where to start reading. */
export const checklist = defineTreatment({
	id: 'status.checklist',
	need: 'status',
	name: 'Checklist + start here',
	when: 'The closing beat: what is in scope, what is left for later, how it is tested, and the 1-3 places to read first.',
	params: {
		eyebrow: 'label', title: 'label',
		items: '[{ icon, tone, title, sub, at }]  (2-5)',
		read: '{ label, refs: [{ code: code(file, { anchor }), title, what, at }] }  (optional, 1-3; without at, all the refs light up together a quarter of the way into the beat)',
	},
	demo: () => ({
		eyebrow: label('Scope and status'), title: label('What to know before reviewing'),
		items: [{ icon: 'shield', tone: 'blue', title: label('Windows only'), sub: label('macOS follows in a separate PR') }, { icon: 'beaker', tone: 'green', title: label('Unit tests included'), sub: label('three new cases') }, { icon: 'person', tone: 'orange', title: label('Manual test pending'), sub: label('per the author') }],
	}),
	mount(root, p, ctx) {
		const wrapH = header(root, p, ctx);
		const items = p.items ?? [];
		need(items.length >= 2 && items.length <= 5, 'status.checklist: 2-5 items');
		const hasRead = !!p.read;
		const width = hasRead ? 900 : 1728;
		const rowH = Math.min(118, 660 / items.length);
		const rows = items.map((it, k) => {
			const row = el('div', 'st-abs', root, { left: 96, top: 248 + k * rowH, width, height: rowH - 14, display: 'flex', alignItems: 'center', gap: 26 });
			iconTile(row, it.icon ?? 'checkmark', { tone: it.tone ?? STEP_TONES[k % STEP_TONES.length], size: 64, round: true });
			const col = el('div', '', row, { minWidth: 0 });
			txt(col, it.title, 'st-h3', { display: 'block', fontSize: 30, whiteSpace: 'nowrap' }, 'div');
			if (it.sub) {
				txt(col, it.sub, 'st-small', { display: 'block', fontSize: 21, marginTop: 2, whiteSpace: 'nowrap' }, 'div');
			}
			const line = k < items.length - 1 ? el('div', 'st-abs', root, { left: 96 + 90, top: 248 + k * rowH + rowH - 7, width: width - 90, height: 1.5, background: C.line, transformOrigin: '0 50%' }) : null;
			return { row, line };
		});
		const itemAt = spread(ctx, items, { lead: 0.3, tail: hasRead ? ctx.beat.duration * 0.6 : 1.5 });
		let read = null;
		if (hasRead) {
			const box = tile(root, 'neutral', { left: 1080, top: 248, width: 744, height: 452, padding: '32px 36px' });
			const refs = readRefs(box, p.read, ctx, { width: 744 - 72 });
			// Where to start reading is often said only on screen, in a short closing beat: every place comes forward early,
			// together, and stays, so a viewer can read them all once.
			const together = ctx.beat.start + ctx.beat.duration * 0.25;
			const refAt = refs.map(r => (r.at !== undefined && r.at !== null ? ctx.at(r.at) : together));
			read = { box, refs, refAt };
		}
		return { h: wrapH, rows, itemAt, read };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		// The whole list is there from the start (dimmed); each item comes forward when the narration reaches it.
		i.rows.forEach((r, k) => {
			const shown = enter(r.row, t, s + 0.25 + k * 0.08, { dy: 0, dx: -14 });
			const on = standard(prog(t, i.itemAt[k] - 0.1, i.itemAt[k] + 0.3));
			r.row.style.opacity = String(shown * lerp(0.35, 1, on));
			if (r.line) {
				r.line.style.opacity = '1';
				r.line.style.transform = `scaleX(${decel(prog(t, s + 0.45 + k * 0.08, s + 1.05 + k * 0.08))})`;
			}
		});
		if (i.read) {
			enter(i.read.box, t, s + 0.7, { dy: 16 });
			i.read.refs.forEach((r, k) => {
				const on = standard(prog(t, i.read.refAt[k] - 0.1, i.read.refAt[k] + 0.3));
				r.col.style.opacity = String(lerp(0.38, 1, on));
				r.dot.style.background = on > 0.5 ? C.blue : C.faint;
			});
		}
	},
});

/** Now / next / later: what this PR does, what follows, what is still open. */
export const board = defineTreatment({
	id: 'status.board',
	need: 'status',
	name: 'Now, next, later',
	when: 'The closing beat when the PR is one step of a larger plan: what lands now, what follows, what is open. Text only: places to start reading go in a column of their own, ident() names with their path() as the sub (status.checklist shows them as code).',
	params: { eyebrow: 'label', title: 'label', columns: '[{ title, tone, icon, items: [{ text, sub, at }] }]  (2-3 columns, 1-4 items each)' },
	demo: () => ({
		eyebrow: label('Status'), title: label('Where this leaves us'),
		columns: [{ title: label('In this PR'), tone: 'green', icon: 'check', items: [{ text: label('Entra ID sign-in') }, { text: label('Unit tests') }] }, { title: label('Follow-up'), tone: 'blue', icon: 'arrowRight', items: [{ text: label('GitHub sign-in') }] }, { title: label('Open'), tone: 'orange', icon: 'hourglass', items: [{ text: label('Manual test on a real server') }] }],
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const cols = p.columns ?? [];
		need(cols.length >= 2 && cols.length <= 3, 'status.board: 2-3 columns');
		const gap = 28, w = (1728 - gap * (cols.length - 1)) / cols.length;
		const colEls = cols.map((c, k) => {
			const tone = c.tone ?? ['green', 'blue', 'orange'][k];
			const x = 96 + k * (w + gap);
			const head = el('div', 'st-abs', root, { left: x, top: 252, width: w, display: 'flex', alignItems: 'center', gap: 14 });
			iconTile(head, c.icon ?? 'checkmark', { tone, size: 50, round: true, solid: true });
			txt(head, c.title, '', { fontSize: 30, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap' });
			const rule = el('div', 'st-abs', root, { left: x, top: 324, width: w, height: 4, borderRadius: 2, background: TONE[tone].fg, transformOrigin: '0 50%' });
			const items = c.items ?? [];
			need(items.length >= 1 && items.length <= 4, `column ${k + 1}: 1-4 items`);
			const cards = items.map((it, j) => {
				const cardEl = card(root, { left: x, top: 352 + j * 132, width: w, height: 114, padding: '22px 26px' });
				txt(cardEl, it.text, '', { display: 'block', fontSize: 25, fontWeight: 600, color: C.ink, lineHeight: 1.25 }, 'div');
				if (it.sub) {
					txt(cardEl, it.sub, 'st-small', { display: 'block', marginTop: 6, fontSize: 19 }, 'div');
				}
				return { cardEl, at: it.at };
			});
			return { head, rule, cards };
		});
		const all = colEls.flatMap(c => c.cards);
		return { h, colEls, all, times: spread(ctx, all, { lead: 0.8, tail: 1.2 }) };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		let n = 0;
		i.colEls.forEach((c, k) => {
			const first = i.times[n];
			enter(c.head, t, Math.min(first - 0.3, s + 0.4 + k * 0.4), { dy: 10 });
			c.rule.style.transform = `scaleX(${decel(prog(t, first - 0.2, first + 0.5))})`;
			c.cards.forEach(card => {
				enter(card.cardEl, t, i.times[n++], { dy: 14 });
			});
		});
	},
});

