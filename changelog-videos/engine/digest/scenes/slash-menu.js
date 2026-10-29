// A chat input where a slash command is typed and its suggestions open; new entries are marked, and the narration
// can point at each one in turn.
import { esc, fillIcons, sceneRect, vscodeWindow, bars, ramp, clamp } from './chrome.js';

export default {
	name: 'slash-menu',
	doc: 'A chat input with a slash command typed and its suggestion list (new commands, new forms of a command).',
	params: {
		placeholder: 'the input\'s placeholder, e.g. "Chat with Copilot"',
		typed: 'what is typed, e.g. "/fork"',
		typeAt: 'time the typing starts',
		entries: '[{ label, description, isNew }]: the suggestions, in order (2-5); isNew marks the ones the PR adds (checked against it)',
		listAt: 'time the list opens (default: when the typing ends)',
		highlights: '[{ entry: index, at }]: the selected entry over time (optional)',
		tab: 'the editor tab (optional)',
	},
	targets: ['input', 'list', 'entry0', 'entry1', 'entry2', 'entry3', 'entry4'],
	windows(p, { start, end }) {
		const listAt = p.listAt ?? (p.typeAt ?? start) + String(p.typed ?? '').length * 0.07;
		return { input: [start, end], list: [listAt, end], ...Object.fromEntries((p.entries ?? []).slice(0, 5).map((_, i) => [`entry${i}`, [listAt, end]])) };
	},
	/** The new entries: their description (as the PR localizes it), or their label. */
	proofs: p => {
		const fresh = (p.entries ?? []).map((e, i) => ({ e, i })).filter(x => x.e.isNew);
		return fresh.length ? fresh.map(({ e, i }) => ({ param: `entries[${i}].${e.description ? 'description' : 'label'}`, text: e.description ?? e.label })) : [{ param: 'entries[].isNew', text: undefined }];
	},
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: p.tab ?? '', activity: ['chat', 'search', 'branch', 'extension'] });
		const entries = p.entries ?? [];
		page.innerHTML = `
			<div class="sm-chat">${bars([480, 620, 360], 'vsw-bar-line')}</div>
			<div class="sm-box">
				<div class="sm-list">${entries.map((e, i) => `<div class="sm-entry" data-i="${i}"><span class="sm-label">${esc(e.label)}</span><span class="sm-desc">${esc(e.description ?? '')}</span></div>`).join('')}</div>
				<div class="sm-input"><span class="sm-typed"></span><span class="sm-caret"></span><span class="sm-ph">${esc(p.placeholder ?? 'Ask anything')}</span></div>
			</div>`;
		fillIcons(page);
		const list = page.querySelector('.sm-list'), input = page.querySelector('.sm-input');
		const typedEl = page.querySelector('.sm-typed'), ph = page.querySelector('.sm-ph'), caret = page.querySelector('.sm-caret');
		const rows = [...page.querySelectorAll('.sm-entry')];
		const typed = String(p.typed ?? '');
		const typeDur = typed.length * 0.07;
		const listAt = p.listAt ?? (p.typeAt ?? ctx.start) + typeDur;
		const rects = { input: sceneRect(input, host, ctx.view), list: sceneRect(list, host, ctx.view) };
		rows.forEach((row, i) => {
			rects[`entry${i}`] = sceneRect(row, host, ctx.view);
		});
		const highlights = [...(p.highlights ?? [])].sort((a, b) => a.at - b.at);
		return {
			rects,
			render(t) {
				const n = p.typeAt === undefined ? typed.length : Math.max(0, Math.min(typed.length, Math.floor((t - p.typeAt) / 0.07)));
				typedEl.textContent = typed.slice(0, n);
				ph.style.display = n ? 'none' : '';
				caret.style.opacity = Math.floor(t * 2) % 2 === 0 ? '1' : '0.15';
				const q = ramp(t, listAt, 0.25);
				list.style.opacity = q.toFixed(3);
				list.style.transform = `translateY(${((1 - q) * 10).toFixed(1)}px)`;
				const on = highlights.filter(h => t >= h.at).at(-1)?.entry ?? 0;
				rows.forEach((row, i) => row.classList.toggle('sel', i === on));
			},
		};
	},
};
