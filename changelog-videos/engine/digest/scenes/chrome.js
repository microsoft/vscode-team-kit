// Shared pieces of the digest's drawn scenes: DOM helpers and a dark VS Code window (title bar, activity bar, tabs).
//
// A scene module (digest/scenes/<name>.js) default-exports
//   { name, doc, params, targets, build(host, params, ctx) }
// build() draws into `host` (the 1200x675 view; dark VS Code look) and returns
//   { rects: { name: { x, y, w, h } (page pixels) }, lane?, render(t, svg) }
// Times in params (keys `at` or ending in `At`) arrive resolved: absolute seconds of the video.
import { prim, motion, clamp } from '../kit.js';

export const { decel, standard, lerp, enter } = motion;
export { prim, clamp };

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The GitHub mark (Octicons, MIT), as on VS Code's sign-in buttons. */
export const GITHUB = '<svg width="26" height="26" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

export function make(parent, cls, html = '', style = null) {
	const node = document.createElement('div');
	node.className = cls;
	node.innerHTML = html;
	if (style) {
		Object.assign(node.style, style);
	}
	parent.appendChild(node);
	return node;
}

export function svgEl(parent, tag, attrs) {
	const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, String(value));
	}
	parent.appendChild(node);
	return node;
}

/** An icon slot: `<span data-icon="name" data-size data-color>` (filled by fillIcons); "github" is the GitHub mark. */
export const iconSlot = (name, size = 24, color = '') => !name ? '' : name === 'github' ? `<span class="gh">${GITHUB}</span>` : `<span data-icon="${esc(name)}" data-size="${size}"${color ? ` data-color="${color}"` : ''}></span>`;

/** Replaces every icon slot with pr-studio's Fluent icon. */
export function fillIcons(node) {
	for (const slot of node.querySelectorAll('[data-icon]')) {
		prim.icon(slot, slot.dataset.icon, Number(slot.dataset.size || 24), slot.dataset.color || 'currentColor');
		slot.removeAttribute('data-icon');
	}
}

/**
 * Where a node sits on the page: `view` is where the scene's host is drawn. Measured as laid out when the scene is
 * built (before any frame animates it), so centering transforms count, and a sentence that wraps gets the box of its
 * lines.
 */
export function sceneRect(node, host, view) {
	const a = node.getBoundingClientRect(), b = host.getBoundingClientRect();
	const k = host.offsetWidth ? b.width / host.offsetWidth : 1;
	const r = { x: view.x + (a.left - b.left) / k, y: view.y + (a.top - b.top) / k, w: a.width / k, h: a.height / k };
	// The player measures the node again in each frame (liveRect): it moves as it animates in, and with the fonts.
	Object.defineProperty(r, 'el', { value: node, enumerable: false });
	return r;
}

/** Where a node is on the page now, or null when it isn't really showing (mostly transparent, or not laid out). */
export function liveRect(node) {
	let opacity = 1;
	for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
		const style = getComputedStyle(n);
		if (style.display === 'none' || style.visibility === 'hidden') {
			return null;
		}
		opacity *= Number(style.opacity);
	}
	const a = node.getBoundingClientRect();
	return opacity >= 0.5 && a.width > 1 && a.height > 1 ? { x: a.left, y: a.top, w: a.width, h: a.height } : null;
}

/**
 * A dark VS Code window filling the host: title bar (with the command center), activity bar, one editor tab.
 * Returns the content element (left 56, top 92: 1144x583) to draw the page in.
 */
export function vscodeWindow(host, { tab = '', tabIcon = 'code', activity = ['document', 'search', 'branch', 'extension'], sidebar = null } = {}) {
	host.classList.add('vsw');
	host.innerHTML = `
		<div class="vsw-bar"><i></i><i></i><i></i><div class="vsw-cmd"></div></div>
		<div class="vsw-act">${activity.map(n => iconSlot(n, 28)).join('')}</div>
		${sidebar ? `<div class="vsw-side" style="width:${sidebar}px"></div>` : ''}
		<div class="vsw-tabs" style="left:${56 + (sidebar ?? 0)}px">${tab ? `<div class="vsw-tab">${iconSlot(tabIcon, 22, '#3794ff')}${esc(tab)}</div>` : ''}</div>
		<div class="vsw-page" style="left:${56 + (sidebar ?? 0)}px"></div>`;
	fillIcons(host);
	return { page: host.querySelector('.vsw-page'), side: host.querySelector('.vsw-side'), tabs: host.querySelector('.vsw-tabs') };
}

/** Placeholder text lines (grey bars) for the parts of a drawn page the change is not about. */
export const bars = (widths, cls = 'vsw-bar-line') => widths.map(w => `<b class="${cls}" style="width:${w}px"></b>`).join('');

/** 0 → 1 over [at, at + dur], eased; 0 when `at` is undefined. */
export const ramp = (t, at, dur = 0.4, ease = decel) => at === undefined || at === null ? 0 : ease(clamp((t - at) / dur));
