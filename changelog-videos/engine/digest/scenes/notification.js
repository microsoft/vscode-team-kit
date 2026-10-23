// A notification toast in the corner of the window: a new message, a changed message, new actions on it.
import { esc, iconSlot, fillIcons, sceneRect, vscodeWindow, bars, ramp } from './chrome.js';

export default {
	name: 'notification',
	doc: 'A notification toast (a new or changed message, new actions on a notification).',
	params: {
		severity: 'info, warning or error (default info)',
		message: 'the notification\'s text (quote the PR exactly)',
		source: 'its source line, e.g. "Source: GitHub Copilot Chat" (optional)',
		actions: '[label, ...]: its buttons, primary first (optional)',
		showAt: 'time it slides in (default: the chapter\'s start + 0.6)',
		tab: 'the editor tab behind it (optional)',
	},
	targets: ['toast', 'message', 'action0', 'action1', 'action2'],
	windows(p, { start, end }) {
		const at = p.showAt ?? start + 0.6;
		return { toast: [at, end], message: [at, end], ...Object.fromEntries((p.actions ?? []).slice(0, 3).map((_, i) => [`action${i}`, [at, end]])) };
	},
	/** The message and its actions. */
	proofs: p => [{ param: 'message', text: p.message }, ...(p.actions ?? []).map((a, i) => ({ param: `actions[${i}]`, text: a }))],
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: p.tab ?? '' });
		const sev = { info: ['info', '#3794ff'], warning: ['warning', '#cca700'], error: ['error', '#f14c4c'] }[p.severity ?? 'info'] ?? ['info', '#3794ff'];
		page.innerHTML = `<div class="nt-under">${bars([520, 380, 460, 300, 420])}</div>
			<div class="nt-toast"><div class="nt-row">${iconSlot(sev[0], 28, sev[1])}<div class="nt-msg">${esc(p.message)}</div></div>
				${p.source ? `<div class="nt-src">${esc(p.source)}</div>` : ''}
				${p.actions?.length ? `<div class="nt-actions">${p.actions.map((a, i) => `<span class="nt-btn${i === 0 ? ' primary' : ''}">${esc(a)}</span>`).join('')}</div>` : ''}</div>`;
		fillIcons(page);
		const toast = page.querySelector('.nt-toast');
		const rects = { toast: sceneRect(toast, host, ctx.view), message: sceneRect(page.querySelector('.nt-msg'), host, ctx.view) };
		[...page.querySelectorAll('.nt-btn')].forEach((b, i) => {
			rects[`action${i}`] = sceneRect(b, host, ctx.view);
		});
		const showAt = p.showAt ?? ctx.start + 0.6;
		return {
			rects,
			render(t) {
				const q = ramp(t, showAt, 0.4);
				toast.style.opacity = q.toFixed(3);
				toast.style.transform = `translateY(${((1 - q) * 24).toFixed(1)}px)`;
			},
		};
	},
};
