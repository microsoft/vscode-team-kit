// The Settings editor showing one setting, searched by its ID. Its value flips (before → after) only when the PR changes
// its default ("now on by default"); otherwise it shows the setting as it is (a new setting, a new description).
import { esc, iconSlot, fillIcons, sceneRect, vscodeWindow, ramp, standard, clamp } from './chrome.js';

/** The title VS Code's Settings editor shows for a setting ID: chat.copilot.imageGeneration.enabled → "Chat › Copilot › Image Generation: Enabled". */
export function settingTitle(id) {
	const parts = String(id ?? '').split('.').map(s => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()));
	return parts.length > 1 ? `${parts.slice(0, -1).join(' › ')}: ${parts.at(-1)}` : parts[0] ?? '';
}

/** Whether the scene changes the setting's value: only with a before that differs from after. */
export function settingFlips(p) {
	return p.before !== undefined && (p.kind === 'text' ? String(p.before) !== String(p.after ?? '') : !!p.before !== !!p.after);
}

export default {
	name: 'setting',
	doc: 'The Settings editor with one setting: a default that changes (before → after), a new setting, or a new description.',
	params: {
		id: 'the setting ID, e.g. "chat.welcomePage.signIn.enabled"',
		description: 'its description (quote the PR exactly)',
		kind: '"checkbox" (default) or "text"',
		before: 'the default before, only when the PR changes the default (the value flips at flipAt); otherwise leave it out',
		after: 'the value shown (the default now)',
		flipAt: 'time the value changes (with before)',
	},
	targets: ['row', 'value', 'description'],
	windows(p, { start, end }) {
		return { row: [start, end], value: [start, end], description: [start, end] };
	},
	/** The setting's ID and its description (its title is VS Code's own, from the ID). */
	proofs: p => [{ param: 'id', text: p.id }, ...(p.description ? [{ param: 'description', text: p.description }] : [])],
	/** Whether the scene shows the setting's default changing: the PR must change a default. */
	changesDefault: settingFlips,
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: 'Settings', tabIcon: 'settings' });
		const title = settingTitle(p.id);
		const flips = settingFlips(p);
		const value = p.kind === 'text'
			? `<span class="st-text"><span class="old">${esc(flips ? p.before : '')}</span><span class="new">${esc(p.after ?? '')}</span></span>`
			: '<span class="st-check"><i></i></span>';
		page.innerHTML = `
			<div class="st-search">${iconSlot('search', 22, '#8b8b8b')}<span>${esc(p.id)}</span></div>
			<div class="st-tabs"><span class="on">User</span><span>Workspace</span></div>
			<div class="st-row"><div class="st-title">${esc(title)}</div>
				<div class="st-body">${p.kind === 'text' ? '' : value}<div class="st-desc">${esc(p.description ?? '')}</div></div>
				${p.kind === 'text' ? `<div class="st-input">${value}</div>` : ''}
				<div class="st-id">${esc(p.id)}</div></div>`;
		fillIcons(page);
		const row = page.querySelector('.st-row'), check = page.querySelector('.st-check'), text = page.querySelector('.st-text');
		// A checkbox's description is its label: the two are one line of the setting, ringed together.
		const rects = { row: sceneRect(row, host, ctx.view), description: sceneRect(check ? page.querySelector('.st-body') : page.querySelector('.st-desc'), host, ctx.view) };
		rects.value = sceneRect(check ?? page.querySelector('.st-input'), host, ctx.view);
		return {
			rects,
			render(t) {
				const q = !flips || p.flipAt === undefined ? 1 : standard(clamp((t - p.flipAt) / 0.35));
				if (check) {
					const v = flips ? (p.after ? q : 1 - q) : (p.after ? 1 : 0);
					check.style.background = v > 0.5 ? '#0078d4' : '#313131';
					check.style.borderColor = v > 0.5 ? '#0078d4' : '#5a5a5a';
					check.firstElementChild.style.opacity = v.toFixed(3);
				}
				if (text) {
					text.querySelector('.old').style.opacity = (1 - q).toFixed(3);
					text.querySelector('.new').style.opacity = q.toFixed(3);
				}
				row.style.boxShadow = !flips || p.flipAt === undefined ? 'none' : `inset 3px 0 0 rgba(0, 120, 212, ${(ramp(t, p.flipAt, 0.3)).toFixed(3)})`;
			},
		};
	},
};
