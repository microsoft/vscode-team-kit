// The fixed first beat. Frame 0 is the thumbnail: the title is composed from the start; the
// "What changes" card slides in at the stats cue, or early in the beat when the narration doesn't say the numbers.
import { defineTreatment } from '../engine/scene.js';
import { C } from '../theme/tokens.js';
import { card, el, fit, microsoftLogo, pill, txt } from '../theme/primitives.js';
import { count, decel, enter, fmt, lerp, prog } from '../engine/motion.js';
import { fact, label } from '../engine/text.js';

/** Text computed by this template from PR facts (not authored), stamped as such for the linter. */
function factText(parent, text, factPath, cls, style, tag) {
	const node = txt(parent, label(text), cls, style, tag);
	node.dataset.src = `fact:${factPath}`;
	return node;
}

function fileRows(files, areas, budget) {
	// Areas by size; files by size inside an area. Rows: area head 40, file 30, gap 14; "more" rows 30.
	const order = [...areas].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
	const groups = [];
	let used = 0, hiddenFiles = 0, hiddenAreas = 0;
	for (const area of order) {
		const inArea = files.filter(f => f.area === area.name).sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
		const head = 40 + (groups.length ? 14 : 0);
		const fitsAll = used + head + inArea.length * 30 <= budget;
		const room = fitsAll ? inArea.length : Math.floor((budget - used - head - 30) / 30);
		if (room < 1) {
			hiddenFiles += inArea.length;
			hiddenAreas++;
			continue;
		}
		const shown = fitsAll ? inArea : inArea.slice(0, room);
		const more = inArea.length - shown.length;
		groups.push({ area, shown, more });
		used += (groups.length > 1 ? 14 : 0) + 40 + shown.length * 30 + (more ? 30 : 0);
	}
	return { groups, hiddenFiles, hiddenAreas };
}

export const frame = defineTreatment({
	id: 'title.frame',
	need: 'title',
	name: 'Title frame',
	when: 'Always the first beat. Fixed design: PR number, your short headline, the PR title, author, state, and a per-file "What changes" card.',
	params: {
		headline: 'label: what the PR does in 4-8 plain words (not the PR title)',
		at: '{ author, stats, state }: times; default to the cues of the same names',
	},
	demo: () => ({ headline: label('Show build status in the window title') }),
	mount(root, p, ctx) {
		const F = ctx.facts;
		const logo = microsoftLogo(root, 96, 82, 32);
		const eyebrow = txt(root, [label('Pull request #'), fact('number'), label('  \u00b7  '), fact('repo')], 'st-eyebrow st-abs', { left: 96, top: 300 }, 'div');
		const title = txt(root, p.headline ?? fact('title'), 'st-title-xl st-abs', { left: 96, top: 342, width: 880 }, 'div');
		const sub = txt(root, [label('\u201c'), fact('title'), label('\u201d')], 'st-sub st-abs', { left: 96, top: 540, width: 820, fontSize: 26 }, 'div');
		const by = el('div', 'st-abs', root, { left: 96, top: 660, display: 'flex', alignItems: 'center', gap: 16, whiteSpace: 'nowrap' });
		factText(by, F.authorLogin[0].toUpperCase(), 'authorLogin', '', { width: 46, height: 46, borderRadius: 23, background: C.blueTint, color: C.blue, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }, 'div');
		txt(by, fact('authorLogin', { prefix: '@' }), '', { fontSize: 26, fontWeight: 600, color: C.ink });
		txt(by, [label('opened '), fact('createdAt', { format: 'date' })], '', { fontSize: 23, color: C.body });
		const pills = el('div', 'st-abs', root, { left: 96, top: 744, display: 'flex', gap: 12 });
		const stateTone = { OPEN: 'green', MERGED: 'purple', CLOSED: 'red' }[F.state] ?? 'neutral';
		const p1 = pill(pills, { tone: F.isDraft ? 'neutral' : stateTone, text: F.isDraft ? label('Draft') : fact('state', { format: 'state' }) });
		const p2 = F.reviewDecision ? pill(pills, { tone: F.reviewDecision === 'APPROVED' ? 'green' : F.reviewDecision === 'CHANGES_REQUESTED' ? 'red' : 'orange', text: fact('reviewDecision', { format: 'review' }) }) : null;

		// "What changes": totals + per-file diffstat grouped by area
		const cardEl = card(root, { left: 1040, top: 170, width: 784, height: 730 });
		txt(cardEl, label('What changes'), 'st-label st-abs', { left: 34, top: 30, color: C.blue }, 'div');
		const totals = el('div', 'st-abs', cardEl, { left: 34, top: 64, display: 'flex', alignItems: 'baseline', gap: 22, whiteSpace: 'nowrap' });
		const addN = txt(totals, fact('additions', { prefix: '+', format: 'n' }), 'st-num', { fontSize: 60, color: C.green });
		const delN = txt(totals, fact('deletions', { prefix: '\u2212', format: 'n' }), 'st-num', { fontSize: 60, color: C.red });
		const meta = txt(totals, [fact('changedFiles', { format: 'n' }), label(F.changedFiles === 1 ? ' file  \u00b7  ' : ' files  \u00b7  '), fact('commitCount'), label(F.commitCount === 1 ? ' commit' : ' commits')], '', { fontSize: 22, color: C.body });
		el('div', 'st-abs', cardEl, { left: 0, right: 0, top: 150, height: 1.5, background: C.line });
		const { groups, hiddenFiles, hiddenAreas } = fileRows(F.files, F.areas, 730 - 172 - 20);
		const maxChange = Math.max(1, ...F.files.map(f => f.additions + f.deletions));
		const BARW = 170;
		let y = 172;
		const bars = [];
		groups.forEach(({ area, shown, more }, gi) => {
			if (gi) {
				y += 14;
			}
			const head = el('div', 'st-abs', cardEl, { left: 34, right: 34, top: y, height: 40, display: 'flex', alignItems: 'center' });
			factText(head, area.name, 'areas', 'st-mono', { fontSize: 19, fontWeight: 600, color: C.ink, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }, 'div');
			const sum = el('div', 'st-mono', head, { fontSize: 18, whiteSpace: 'nowrap', flex: 'none', marginLeft: 16 });
			factText(sum, `+${fmt(area.additions)}`, 'areas', '', { color: C.green });
			factText(sum, `\u2212${fmt(area.deletions)}`, 'areas', '', { color: C.red, marginLeft: 10 });
			y += 40;
			const base = f => f.path.split('/').pop();
			for (const f of shown) {
				const dup = shown.filter(g => base(g) === base(f)).length > 1;
				const name = dup ? f.path.split('/').slice(-2).join('/') : base(f);
				const row = el('div', 'st-abs', cardEl, { left: 34, right: 34, top: y, height: 30, display: 'flex', alignItems: 'center', gap: 14 });
				const nameNode = factText(row, name, 'files', 'st-mono', { fontSize: 16, color: f.isTest ? C.muted : C.body, width: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 'none' }, 'div');
				nameNode.dataset.path = f.path;
				const track = el('div', '', row, { width: BARW, height: 10, flex: 'none', display: 'flex', borderRadius: 5, background: '#f0f2f5', overflow: 'hidden' });
				const g = el('div', '', track, { height: 10, width: 0, background: C.green });
				const r = el('div', '', track, { height: 10, width: 0, background: C.red });
				factText(row, `+${fmt(f.additions)} \u2212${fmt(f.deletions)}`, 'files', 'st-mono', { fontSize: 15, color: C.body, flex: 1, textAlign: 'right', whiteSpace: 'nowrap' }, 'div');
				bars.push({ g, r, ga: BARW * f.additions / maxChange, rd: BARW * f.deletions / maxChange, k: bars.length });
				y += 30;
			}
			if (more) {
				factText(cardEl, `+ ${more} more ${more === 1 ? 'file' : 'files'}`, 'files', 'st-abs', { left: 34, top: y, height: 30, lineHeight: '30px', fontSize: 16, color: C.muted, whiteSpace: 'nowrap' }, 'div');
				y += 30;
			}
		});
		if (hiddenFiles) {
			y += 10;
			factText(cardEl, `+ ${hiddenFiles} more ${hiddenFiles === 1 ? 'file' : 'files'} in ${hiddenAreas} more ${hiddenAreas === 1 ? 'area' : 'areas'}`, 'files', 'st-abs', { left: 34, top: y, height: 30, lineHeight: '30px', fontSize: 16, color: C.muted, whiteSpace: 'nowrap' }, 'div');
			y += 30;
		}
		cardEl.style.height = `${Math.min(730, y + 30)}px`;
		cardEl.style.top = `${Math.max(150, 170 + (730 - Math.min(730, y + 30)) / 2)}px`;
		const at = p.at ?? {};
		// A one-sentence title beat is short: the author, the numbers and the state come in sooner, so all are up before it ends.
		const scale = Math.min(1, ctx.beat.duration / 11);
		const quick = Math.max(0.3, Math.min(1, scale * 2));
		const stats = ctx.at(at.stats ?? (ctx.has('stats') ? 'stats' : undefined), 5 * scale);
		const stateRef = at.state ?? (ctx.has('state') ? 'state' : undefined);
		const times = {
			author: ctx.at(at.author ?? (ctx.has('author') ? 'author' : undefined), 2.4 * scale),
			stats,
			// Without a time of their own, the state pills come after the numbers have been said, not before.
			state: stateRef !== undefined ? ctx.at(stateRef) : Math.max(ctx.at(undefined, 8 * scale), stats + 1.5 * scale),
		};
		return {
			logo, eyebrow, title, sub, by, p1, p2, cardEl, addN, delN, meta, bars, times, quick,
			totals: { additions: F.additions, deletions: F.deletions },
			layout() {
				// Headline: at most two lines; the stack below follows it and stays inside the frame.
				let size = 78;
				while (title.offsetHeight > size * 1.08 * 2 + 4 && size > 52) {
					size -= 2;
					title.style.fontSize = `${size}px`;
				}
				fit(sub, { width: 820 * 3, min: 20 });
				const subTop = 342 + title.offsetHeight + 34;
				sub.style.top = `${subTop}px`;
				const byTop = subTop + sub.offsetHeight + 50;
				by.style.top = `${byTop}px`;
				pills.style.top = `${byTop + 84}px`;
				const bottom = byTop + 84 + 44;
				if (bottom > 900) {
					const shift = bottom - 900;
					for (const n of [eyebrow, title, sub, by, pills]) {
						n.style.top = `${parseFloat(n.style.top) - shift}px`;
					}
				}
			},
		};
	},
	render(i, t) {
		// In a short title beat everything moves quicker, so it is all in place before the beat ends.
		const k = i.quick;
		i.title.style.transform = `translateY(${lerp(6, 0, decel(prog(t, 0, 2.2 * k)))}px)`;
		enter(i.by, t, i.times.author, { dur: 0.6 * k });
		enter(i.cardEl, t, i.times.stats - 0.45 * k, { dx: 28, dy: 0, dur: 0.6 * k });
		const tot = decel(prog(t, i.times.stats - 0.15 * k, i.times.stats + 0.25 * k));
		i.addN.style.opacity = i.delN.style.opacity = String(tot);
		i.meta.style.opacity = String(decel(prog(t, i.times.stats + 0.6 * k, i.times.stats + 1.0 * k)));
		i.addN.textContent = `+${fmt(count(t, i.times.stats - 0.1 * k, 0.9 * k, i.totals.additions))}`;
		i.delN.textContent = `\u2212${fmt(count(t, i.times.stats - 0.1 * k, 0.9 * k, i.totals.deletions))}`;
		for (const b of i.bars) {
			const q = decel(prog(t, i.times.stats + (0.4 + b.k * 0.05) * k, i.times.stats + (1.2 + b.k * 0.05) * k));
			b.g.style.width = `${b.ga * q}px`;
			b.r.style.width = `${b.rd * q}px`;
		}
		enter(i.p1, t, i.times.state, { dy: 8, dur: 0.6 * k });
		if (i.p2) {
			enter(i.p2, t, i.times.state + 0.15 * k, { dy: 8, dur: 0.6 * k });
		}
	},
});
