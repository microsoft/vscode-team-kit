// A list in the side bar (Sessions, Explorer, Source Control...) whose row actions change: the row is hovered, its
// first action button swaps from the old one to the new one, its tooltip shows, and optionally a child row opens.
import { esc, iconSlot, fillIcons, sceneRect, vscodeWindow, bars, ramp, standard, clamp } from './chrome.js';

export default {
	name: 'list-actions',
	doc: 'A side bar list whose row actions change (a new or moved button on a row, a hover action, a nested item).',
	params: {
		title: 'the list\'s title, e.g. "Sessions"',
		rows: '[{ label, sub }]: 2-5 rows (sub: a short second line, optional)',
		row: 'index of the row the change is about (default 0)',
		before: '{ icon, tooltip }: its first action before (optional: omit for a new action)',
		after: '{ icon, tooltip }: its first action now',
		others: 'icons of the row\'s other actions, e.g. ["check"] (optional)',
		hoverAt: 'time the row is hovered (actions show)',
		swapAt: 'time the first action changes (default: hoverAt)',
		tooltipAt: 'time its tooltip shows (optional)',
		child: '{ label, sub, at }: a row that opens under it, indented (optional)',
		tab: 'the editor tab (optional)',
	},
	targets: ['row', 'action', 'tooltip', 'child'],
	windows(p, { start, end }) {
		const w = { row: [start, end] };
		if (p.hoverAt !== undefined) {
			w.action = [p.hoverAt, end];
		}
		if (p.after?.tooltip && p.tooltipAt !== undefined) {
			w.tooltip = [p.tooltipAt, p.child?.at ?? end];
		}
		if (p.child && p.child.at !== undefined) {
			w.child = [p.child.at, end];
		}
		return w;
	},
	/** The new action's tooltip: what makes this the PR's action. */
	proofs: p => [{ param: 'after.tooltip', text: p.after?.tooltip }],
	build(host, p, ctx) {
		const { page, side } = vscodeWindow(host, { tab: p.tab ?? '', activity: ['chat', 'search', 'branch', 'extension'], sidebar: 400 });
		const rows = p.rows ?? [];
		const k = Math.max(0, Math.min(rows.length - 1, p.row ?? 0));
		side.innerHTML = `<div class="la-title">${esc(p.title ?? '')}</div>
			<div class="la-list">${rows.map((r, i) => `
				<div class="la-row${i === k ? ' target' : ''}"><span class="la-dot"></span><div class="la-text"><div class="la-label">${esc(r.label)}</div>${r.sub ? `<div class="la-sub">${esc(r.sub)}</div>` : ''}</div>
					${i === k ? `<div class="la-actions"><span class="la-act first"><span class="old">${iconSlot(p.before?.icon, 22)}</span><span class="new">${iconSlot(p.after?.icon, 22)}</span></span>${(p.others ?? []).map(n => `<span class="la-act">${iconSlot(n, 22)}</span>`).join('')}</div>` : ''}
				</div>
				${i === k && p.child ? `<div class="la-child"><span class="la-branch"></span><span class="la-dot"></span><div class="la-text"><div class="la-label">${esc(p.child.label)}</div>${p.child.sub ? `<div class="la-sub">${esc(p.child.sub)}</div>` : ''}</div></div>` : ''}`).join('')}
			</div>
			${p.after?.tooltip ? `<div class="la-tip">${esc(p.after.tooltip)}</div>` : ''}`;
		page.innerHTML = `<div class="la-main">${bars([520, 380, 460])}</div>`;
		fillIcons(host);
		const row = side.querySelector('.la-row.target'), actions = side.querySelector('.la-actions');
		const first = side.querySelector('.la-act.first'), oldIcon = first?.querySelector('.old'), newIcon = first?.querySelector('.new');
		const tip = side.querySelector('.la-tip'), child = side.querySelector('.la-child');
		if (tip && first) {
			const r = sceneRect(first, host, { x: 0, y: 0 });
			tip.style.left = `${Math.max(12, r.x + r.w / 2 - 40)}px`;
			tip.style.top = `${r.y + r.h + 8}px`;
		}
		const childH = child?.offsetHeight ?? 0;
		const rects = { row: sceneRect(row, host, ctx.view) };
		if (first) {
			rects.action = sceneRect(first, host, ctx.view);
		}
		if (tip) {
			rects.tooltip = sceneRect(tip, host, ctx.view);
		}
		if (child) {
			rects.child = sceneRect(child, host, ctx.view);
		}
		const swapAt = p.swapAt ?? p.hoverAt;
		return {
			rects,
			render(t) {
				const hover = ramp(t, p.hoverAt, 0.25);
				row.style.background = `rgba(255, 255, 255, ${(0.06 * hover).toFixed(3)})`;
				actions.style.opacity = hover.toFixed(3);
				const swap = p.before ? standard(clamp((t - swapAt) / 0.45)) : 1;
				if (oldIcon) {
					oldIcon.style.opacity = (1 - swap).toFixed(3);
					oldIcon.style.transform = `translateY(${(-10 * swap).toFixed(1)}px)`;
				}
				if (newIcon) {
					newIcon.style.opacity = swap.toFixed(3);
					newIcon.style.transform = `translateY(${(10 * (1 - swap)).toFixed(1)}px)`;
				}
				if (tip) {
					const q = p.tooltipAt === undefined ? 0 : ramp(t, p.tooltipAt, 0.25) * (child ? 1 - ramp(t, p.child.at, 0.2) : 1);
					tip.style.opacity = q.toFixed(3);
				}
				if (child) {
					const q = ramp(t, p.child.at, 0.45);
					child.style.opacity = q.toFixed(3);
					child.style.height = `${(childH * q).toFixed(1)}px`;
				}
			},
		};
	},
};
