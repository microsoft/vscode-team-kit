// A modal dialog over a dimmed window: confirmations, warnings, permission prompts. One sentence of its detail can be
// marked (**like this**) and highlighted on cue.
import { esc, iconSlot, fillIcons, sceneRect, vscodeWindow, bars, ramp } from './chrome.js';

export default {
	name: 'dialog',
	doc: 'A modal dialog (a confirmation, a warning, a permission prompt) over the window.',
	params: {
		icon: 'shield, warning, info or question (default shield)',
		title: 'the dialog\'s message (quote the PR\'s string exactly)',
		detail: 'its detail text; wrap one sentence in **...** to make it the "highlight" target',
		buttons: '[{ label, primary }]: right to left as in VS Code: Cancel first, the primary last',
		showAt: 'time the dialog opens (default: the chapter\'s start + 0.6)',
		highlightAt: 'time the marked sentence gets highlighted (optional)',
		tab: 'the editor tab behind it (optional)',
	},
	targets: ['dialog', 'title', 'highlight', 'primary', 'cancel'],
	windows(p, { start, end }) {
		const at = p.showAt ?? start + 0.6;
		const w = { dialog: [at, end], title: [at, end] };
		if ((p.buttons ?? []).some(b => b.primary)) {
			w.primary = [at, end];
		}
		if ((p.buttons ?? []).some(b => !b.primary)) {
			w.cancel = [at, end];
		}
		if (/\*\*(.+?)\*\*/.test(p.detail ?? '')) {
			w.highlight = [at, end];
		}
		return w;
	},
	/** The dialog's message, its marked sentence and its primary button. */
	proofs: p => [
		{ param: 'title', text: p.title },
		...(/\*\*(.+?)\*\*/.test(p.detail ?? '') ? [{ param: 'detail (**marked**)', text: p.detail.match(/\*\*(.+?)\*\*/)[1] }] : []),
		...(p.buttons ?? []).filter(b => b.primary).map(b => ({ param: 'buttons[primary].label', text: b.label })),
	],
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: p.tab ?? '' });
		const detail = esc(p.detail ?? '').replace(/\*\*(.+?)\*\*/, '<span class="dl-mark">$1</span>');
		page.innerHTML = `<div class="dl-under">${bars([520, 380, 460, 300, 420])}</div><div class="dl-dim"></div>
			<div class="dl-box">
				<div class="dl-head">${iconSlot(p.icon ?? 'shield', 30, p.icon === 'warning' ? '#cca700' : '#d7ba7d')}<div class="dl-title">${esc(p.title)}</div></div>
				${detail ? `<div class="dl-detail">${detail}</div>` : ''}
				<div class="dl-buttons">${(p.buttons ?? []).map(b => `<span class="dl-btn${b.primary ? ' primary' : ''}">${esc(b.label)}</span>`).join('')}</div>
			</div>`;
		fillIcons(page);
		const box = page.querySelector('.dl-box'), dim = page.querySelector('.dl-dim'), mark = page.querySelector('.dl-mark');
		const rects = { dialog: sceneRect(box, host, ctx.view), title: sceneRect(page.querySelector('.dl-title'), host, ctx.view) };
		if (mark) {
			rects.highlight = sceneRect(mark, host, ctx.view);
		}
		const primary = page.querySelector('.dl-btn.primary'), cancel = page.querySelector('.dl-btn:not(.primary)');
		if (primary) {
			rects.primary = sceneRect(primary, host, ctx.view);
		}
		if (cancel) {
			rects.cancel = sceneRect(cancel, host, ctx.view);
		}
		const showAt = p.showAt ?? ctx.start + 0.6;
		return {
			rects,
			render(t) {
				const q = ramp(t, showAt, 0.35);
				box.style.opacity = q.toFixed(3);
				box.style.transform = `translate(-50%, ${((1 - q) * 14).toFixed(1)}px) scale(${(0.97 + 0.03 * q).toFixed(3)})`;
				dim.style.opacity = (0.45 * q).toFixed(3);
				if (mark) {
					const h = ramp(t, p.highlightAt, 0.5);
					mark.style.backgroundSize = `${(100 * h).toFixed(1)}% 100%`;
				}
			},
		};
	},
};
