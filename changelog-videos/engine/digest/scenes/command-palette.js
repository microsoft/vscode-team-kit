// The Command Palette: a query typed, the matching commands listed (new ones marked), one selected.
import { esc, fillIcons, sceneRect, vscodeWindow, bars, ramp } from './chrome.js';

export default {
	name: 'command-palette',
	doc: 'The Command Palette with a query and matching commands (a new command, a renamed one, a new keybinding).',
	params: {
		query: 'what is typed after ">", e.g. "Chat: Fork"',
		typeAt: 'time the typing starts',
		items: '[{ label, keybinding, isNew }]: the commands listed, in order (2-6); label as "Category: Title"; isNew marks the ones the PR adds (their titles are checked against it)',
		highlights: '[{ item: index, at }]: the selected item over time (optional; default the first)',
		tab: 'the editor tab behind it (optional)',
	},
	targets: ['input', 'list', 'item0', 'item1', 'item2', 'item3', 'item4', 'item5'],
	windows(p, { start, end }) {
		const typeAt = p.typeAt ?? start + 0.5;
		const listAt = typeAt + String(p.query ?? '').length * 0.06;
		return { input: [typeAt - 0.3, end], list: [listAt, end], ...Object.fromEntries((p.items ?? []).slice(0, 6).map((_, i) => [`item${i}`, [listAt, end]])) };
	},
	/** The new commands (or the first one): their title, without the category ("Chat: Fork" proves "Fork"). */
	proofs: p => {
		const items = (p.items ?? []).map((it, i) => ({ it, i }));
		const fresh = items.filter(x => x.it.isNew);
		return (fresh.length ? fresh : items.slice(0, 1)).map(({ it, i }) => ({ param: `items[${i}].label`, text: String(it.label ?? '').split(': ').at(-1) }));
	},
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: p.tab ?? '' });
		const items = p.items ?? [];
		page.innerHTML = `<div class="cp-under">${bars([520, 380, 460, 300, 420])}</div>
			<div class="cp-box"><div class="cp-input">&gt;<span class="cp-typed"></span><span class="cp-caret"></span></div>
				<div class="cp-list">${items.map((it, i) => `<div class="cp-item" data-i="${i}"><span class="cp-label">${esc(it.label)}</span>${it.keybinding ? `<span class="cp-kb">${esc(it.keybinding)}</span>` : ''}</div>`).join('')}</div></div>`;
		fillIcons(page);
		const box = page.querySelector('.cp-box'), input = page.querySelector('.cp-input'), list = page.querySelector('.cp-list');
		const typedEl = page.querySelector('.cp-typed'), caret = page.querySelector('.cp-caret');
		const rows = [...page.querySelectorAll('.cp-item')];
		const query = String(p.query ?? '');
		const rects = { input: sceneRect(input, host, ctx.view), list: sceneRect(list, host, ctx.view) };
		rows.forEach((row, i) => {
			rects[`item${i}`] = sceneRect(row, host, ctx.view);
		});
		const highlights = [...(p.highlights ?? [])].sort((a, b) => a.at - b.at);
		const typeAt = p.typeAt ?? ctx.start + 0.5;
		const listAt = typeAt + query.length * 0.06;
		return {
			rects,
			render(t) {
				box.style.opacity = ramp(t, typeAt - 0.3, 0.25).toFixed(3);
				const n = Math.max(0, Math.min(query.length, Math.floor((t - typeAt) / 0.06)));
				typedEl.textContent = query.slice(0, n);
				caret.style.opacity = Math.floor(t * 2) % 2 === 0 ? '1' : '0.15';
				list.style.opacity = ramp(t, listAt, 0.2).toFixed(3);
				const on = highlights.filter(h => t >= h.at).at(-1)?.item ?? 0;
				rows.forEach((row, i) => row.classList.toggle('sel', i === on));
			},
		};
	},
};
