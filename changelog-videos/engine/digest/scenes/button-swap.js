// A page in a VS Code window with one button whose label changes (the Welcome page's call to action, a banner,
// an empty state). A wipe labelled "Now" sweeps the page and turns the old button into the new one.
import { esc, iconSlot, fillIcons, sceneRect, vscodeWindow, standard, clamp } from './chrome.js';

export default {
	name: 'button-swap',
	doc: 'A page (Welcome page, banner, empty view) whose button changes: the before button, then a wipe to the after button.',
	params: {
		tab: 'the editor tab, e.g. "Welcome"',
		before: '{ text, icon }: the button before (icon: a Fluent icon name or "github")',
		after: '{ text, icon }: the button now',
		swapAt: 'time: when the wipe starts (usually the cue that names the new button)',
		label: 'the wipe\'s handle (default "Now")',
	},
	targets: ['before', 'after'],
	/** When each part is on screen (seconds of the video), for the parts these params draw. */
	windows(p, { start, end }) {
		return p.swapAt === undefined ? { before: [start, end] } : { before: [start, p.swapAt + 0.45], after: [p.swapAt + 0.45, end] };
	},
	/** The strings that must come from the PR: what the new button says. */
	proofs: p => [{ param: 'after.text', text: p.after?.text }],
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: p.tab ?? 'Welcome' });
		const content = btn => `
			<div class="bs-hero"></div><div class="bs-sub"></div>
			<div class="bs-btn">${iconSlot(btn?.icon, 26)}${esc(btn?.text)}</div>
			<div class="bs-cols">
				<div class="bs-col"><div class="bs-h"></div>${[230, 190, 250, 170].map(w => `<div class="bs-item"><i></i><b style="width:${w}px"></b></div>`).join('')}</div>
				<div class="bs-col"><div class="bs-h"></div>${[0, 1, 2].map(() => '<div class="bs-card"><i></i><b></b></div>').join('')}</div>
			</div>`;
		page.innerHTML = `<div class="bs-layer before">${content(p.before)}</div><div class="bs-layer after">${content(p.after)}</div><div class="bs-line"><div class="bs-handle">${esc(p.label ?? 'Now')}</div></div>`;
		fillIcons(page);
		const before = page.querySelector('.before'), after = page.querySelector('.after'), line = page.querySelector('.bs-line');
		const handle = page.querySelector('.bs-handle');
		const width = page.offsetWidth, half = handle.offsetWidth / 2;
		return {
			rects: {
				before: sceneRect(before.querySelector('.bs-btn'), host, ctx.view),
				after: sceneRect(after.querySelector('.bs-btn'), host, ctx.view),
			},
			render(t) {
				const edge = p.swapAt === undefined ? 0 : standard(clamp((t - p.swapAt) / 0.9)) * width;
				after.style.clipPath = `inset(0 ${(width - edge).toFixed(1)}px 0 0)`;
				before.style.clipPath = `inset(0 0 0 ${edge.toFixed(1)}px)`;
				line.style.opacity = p.swapAt === undefined ? '0' : (clamp((t - p.swapAt + 0.15) / 0.15) * (1 - clamp((t - p.swapAt - 0.9) / 0.3))).toFixed(3);
				line.style.transform = `translateX(${(edge - 2).toFixed(1)}px)`;
				// The handle rides the line but stays inside the page: at the edges it slides along, never cut in half.
				const shift = Math.max(0, half - edge) - Math.max(0, edge + half - width + 4);
				handle.style.transform = `translateX(calc(-50% + ${shift.toFixed(1)}px))`;
			},
		};
	},
};
