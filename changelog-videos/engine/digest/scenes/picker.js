// A picker and its entries: a dropdown opened from a button of the chat input, or a quick pick at the top. An entry
// can be new, or disabled with the reason it gives.
import { esc, fillIcons, iconSlot, sceneRect, vscodeWindow, bars, ramp } from './chrome.js';

const MAX = 6;

export default {
	name: 'picker',
	doc: 'A picker and its entries: a dropdown opened from a button of the chat input, or a quick pick at the top (a new entry, a disabled one and its reason).',
	params: {
		place: '"input": a dropdown over the chat input, opened from its button (default); "top": a quick pick',
		button: 'place "input": the button that opens it, { label, icon }, e.g. { "label": "Copilot", "icon": "sparkle" }',
		title: 'place "top": the quick pick\'s title or placeholder (optional)',
		items: '[{ label, icon, description, disabled, isNew }]: the entries in order (2-6); description: the text at its right (a disabled entry\'s reason: quote the PR); isNew: an entry the PR adds',
		openAt: 'time the picker opens',
		highlights: '[{ item: index, at }]: the entry selected over time (optional; default the first one not disabled)',
		tab: 'the editor tab behind it (optional)',
	},
	targets: ['picker', 'button', 'item0', 'item1', 'item2', 'item3', 'item4', 'item5'],
	windows(p, { start, end }) {
		const openAt = p.openAt ?? start + 0.5;
		const items = (p.items ?? []).slice(0, MAX);
		return {
			picker: [openAt + 0.1, end],
			...(p.place === 'top' ? {} : { button: [start, end] }),
			...Object.fromEntries(items.map((_, i) => [`item${i}`, [openAt + 0.1, end]])),
		};
	},
	/** A disabled entry's reason and a new entry's label are the PR's (or, with neither, the first entry's label). */
	proofs: p => {
		const items = (p.items ?? []).slice(0, MAX).map((it, i) => ({ it, i }));
		const out = [];
		for (const { it, i } of items) {
			if (it.disabled) {
				out.push({ param: `items[${i}].description`, text: it.description });
			}
			if (it.isNew) {
				out.push({ param: `items[${i}].label`, text: it.label });
			}
		}
		return out.length ? out : items.slice(0, 1).map(({ it, i }) => ({ param: `items[${i}].label`, text: it.label }));
	},
	build(host, p, ctx) {
		const top = p.place === 'top';
		const { page } = vscodeWindow(host, { tab: p.tab ?? '', activity: top ? undefined : ['chat', 'search', 'branch', 'extension'] });
		const items = (p.items ?? []).slice(0, MAX);
		const list = `<div class="pk-list${top ? ' pk-top' : ''}">${top && p.title ? `<div class="pk-title">${esc(p.title)}</div>` : ''}${items.map((it, i) => `
			<div class="pk-item${it.disabled ? ' off' : ''}" data-i="${i}">${it.icon ? iconSlot(it.icon, 24) : '<span class="pk-gap"></span>'}<span class="pk-label">${esc(it.label)}</span>${it.description ? `<span class="pk-desc">${esc(it.description)}</span>` : ''}</div>`).join('')}</div>`;
		page.innerHTML = top
			? `<div class="pk-under">${bars([520, 380, 460, 300, 420])}</div>${list}`
			: `<div class="sm-chat">${bars([480, 620, 360], 'vsw-bar-line')}</div>
				<div class="pk-box">${list}
					<div class="pk-input"><span class="pk-ph">Ask anything</span>
						<div class="pk-tools"><span class="pk-button">${iconSlot(p.button?.icon, 22)}<span>${esc(p.button?.label ?? '')}</span><span class="pk-chev">⌄</span></span></div></div>
				</div>`;
		fillIcons(page);
		const box = page.querySelector('.pk-list');
		const rows = [...page.querySelectorAll('.pk-item')];
		const rects = { picker: sceneRect(box, host, ctx.view) };
		const button = page.querySelector('.pk-button');
		if (button) {
			rects.button = sceneRect(button, host, ctx.view);
		}
		rows.forEach((row, i) => {
			rects[`item${i}`] = sceneRect(row, host, ctx.view);
		});
		const openAt = p.openAt ?? ctx.start + 0.5;
		const first = Math.max(0, items.findIndex(it => !it.disabled));
		const highlights = [...(p.highlights ?? [])].sort((a, b) => a.at - b.at);
		return {
			rects,
			render(t) {
				const q = ramp(t, openAt, 0.2);
				box.style.opacity = q.toFixed(3);
				box.style.transform = `translateY(${((1 - q) * (top ? -8 : 8)).toFixed(1)}px)`;
				button?.classList.toggle('open', t >= openAt);
				const on = highlights.filter(h => t >= h.at).at(-1)?.item ?? first;
				rows.forEach((row, i) => row.classList.toggle('sel', i === on));
			},
		};
	},
};
