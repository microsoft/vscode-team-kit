// A card for a change with no UI of its own, or none a demo can show (a default behind the scenes, telemetry, a
// policy applied in a signed-in session): the change in words, with its setting or command. It draws no UI: on the
// light backdrop, it can't be mistaken for VS Code.
import { esc, iconSlot, fillIcons, sceneRect, ramp, decel } from './chrome.js';

export default {
	name: 'card',
	doc: 'A plain card for a change with no UI to show (a behind-the-scenes default, telemetry, a signed-in-only behavior): the change in words, no fake UI.',
	params: {
		icon: 'a Fluent icon name for the change, e.g. "settings", "shield", "chart" (default "info")',
		title: 'the change for users, in a few words (about 40 characters)',
		lines: '[{ text, mono, icon }]: 1-3 short lines (about 44 characters); mono for a setting ID or a command, which must be the PR\'s',
		at: 'time the card appears (default: the chapter\'s start + 0.3)',
	},
	targets: ['card', 'title', 'line0', 'line1', 'line2'],
	windows(p, { start, end }) {
		const at = p.at ?? start + 0.3;
		return { card: [at, end], title: [at, end], ...Object.fromEntries((p.lines ?? []).slice(0, 3).map((_, i) => [`line${i}`, [at + 0.2 + 0.15 * i, end]])) };
	},
	/** Setting IDs and commands (the mono lines) must be the PR's: the rest is the change in words. */
	proofs: p => (p.lines ?? []).map((l, i) => ({ l, i })).filter(x => x.l.mono).map(({ l, i }) => ({ param: `lines[${i}].text`, text: l.text })),
	build(host, p, ctx) {
		host.classList.add('cd');
		const lines = (p.lines ?? []).slice(0, 3);
		host.innerHTML = `
			<div class="cd-glow"></div>
			<div class="cd-card">
				<div class="cd-head"><span class="cd-icon">${iconSlot(p.icon ?? 'info', 40, '#ffffff')}</span><div class="cd-title">${esc(p.title)}</div></div>
				<div class="cd-lines">${lines.map(l => `<div class="cd-line">${iconSlot(l.icon ?? (l.mono ? 'settings' : 'checkmark'), 26, '#0078d4')}<span class="${l.mono ? 'mono' : ''}">${esc(l.text)}</span></div>`).join('')}</div>
			</div>`;
		fillIcons(host);
		const card = host.querySelector('.cd-card');
		const rows = [...host.querySelectorAll('.cd-line')];
		const rects = { card: sceneRect(card, host, ctx.view), title: sceneRect(host.querySelector('.cd-title'), host, ctx.view) };
		rows.forEach((row, i) => {
			rects[`line${i}`] = sceneRect(row, host, ctx.view);
		});
		const at = p.at ?? ctx.start + 0.3;
		return {
			rects,
			render(t) {
				const q = ramp(t, at, 0.5);
				card.style.opacity = q.toFixed(3);
				card.style.transform = `translateY(${((1 - q) * 18).toFixed(1)}px)`;
				rows.forEach((row, i) => {
					const r = decel(Math.max(0, Math.min(1, (t - at - 0.2 - 0.15 * i) / 0.4)));
					row.style.opacity = r.toFixed(3);
					row.style.transform = `translateX(${((1 - r) * -14).toFixed(1)}px)`;
				});
			},
		};
	},
};
