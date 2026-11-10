// The app icon in the dock (macOS) / launcher (Linux) / taskbar (Windows), with a red count badge popping in.
import { esc, iconSlot, fillIcons, svgEl, enter, decel, clamp } from './chrome.js';
import { C } from '../kit.js';

export default {
	name: 'app-badge',
	doc: 'The VS Code app icon in a dock with a count badge (application badges, attention counts, dock/taskbar behavior).',
	params: {
		app: 'the label under the icon (default "VS Code")',
		count: 'the number on the badge (an example: say so in the narration if it matters; default 1)',
		places: 'labels along the top, e.g. ["Dock on macOS", "Launcher on Linux", "Taskbar on Windows"] (optional)',
		legend: 'what the badge counts, under the dock (optional)',
		inAt: 'time the dock slides in (default: the chapter\'s start)',
		badgeAt: 'time the badge pops in',
		legendAt: 'time the legend appears',
	},
	targets: ['badge', 'tile'],
	windows(p, { start, end }) {
		const inAt = p.inAt ?? start + 0.3;
		return { tile: [inAt, end], badge: [p.badgeAt ?? inAt, end] };
	},
	/** A count on the app icon: no string to prove. */
	proofs: () => [],
	build(host, p, ctx) {
		host.classList.add('ab');
		const view = ctx.view;
		const sizes = [108, 140, 196, 140, 108];
		const glyphs = ['folder', 'globe', null, 'mail', 'settings'];
		const gap = 18, padX = 28, barH = 150, base = 458;
		const barW = sizes.reduce((sum, v) => sum + v, 0) + gap * (sizes.length - 1) + 2 * padX;
		const barX = (view.w - barW) / 2;
		let x = barX + padX;
		const tiles = sizes.map((s, i) => {
			const tile = { x, y: base - s, s, glyph: glyphs[i] };
			x += s + gap;
			return tile;
		});
		const app = tiles[2];
		const badge = { x: app.x + app.s - 48, y: app.y - 20, d: 66 };
		host.innerHTML = `
			<div class="ab-glow"></div>
			${p.places?.length ? `<div class="ab-places">${p.places.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
			<div class="ab-dock">
				<div class="dock" style="left:${barX}px;top:${base + 18 - barH}px;width:${barW}px;height:${barH}px"></div>
				${tiles.map(tile => `<div class="app${tile.glyph ? '' : ' vsc'}" style="left:${tile.x}px;top:${tile.y}px;width:${tile.s}px;height:${tile.s}px;border-radius:${Math.round(tile.s * 0.23)}px">${tile.glyph ? iconSlot(tile.glyph, Math.round(tile.s * 0.42), '#a7afba') : iconSlot('code', 100, '#ffffff')}</div>`).join('')}
				<div class="run-dot" style="left:${app.x + app.s / 2 - 4}px;top:${base + 6}px"></div>
				<div class="app-name" style="left:${app.x + app.s / 2}px;top:${base + 32}px">${esc(p.app ?? 'VS Code')}</div>
				<div class="app-badge" style="left:${badge.x}px;top:${badge.y}px;width:${badge.d}px;height:${badge.d}px">${esc(p.count ?? 1)}</div>
			</div>
			${p.legend ? `<div class="legend" style="left:${view.w / 2}px;top:${base + 92}px"><span class="mini">${esc(p.count ?? 1)}</span><span>${esc(p.legend)}</span></div>` : ''}`;
		fillIcons(host);
		const dockEl = host.querySelector('.ab-dock'), placesEl = host.querySelector('.ab-places');
		const badgeEl = host.querySelector('.app-badge'), legendEl = host.querySelector('.legend');
		const badgeRect = { x: view.x + badge.x, y: view.y + badge.y, w: badge.d, h: badge.d };
		const inAt = p.inAt ?? ctx.start + 0.3;
		return {
			rects: { badge: badgeRect, tile: { x: view.x + app.x, y: view.y + app.y, w: app.s, h: app.s } },
			/** The page y where an arrow can cross the scene above the dock (link route "lane"). */
			lane: view.y + 190,
			render(t, svg) {
				enter(dockEl, t, inAt, { dur: 0.7, dy: 40 });
				if (placesEl) {
					enter(placesEl, t, inAt + 0.35, { dur: 0.6, dy: 10 });
				}
				const u = p.badgeAt === undefined ? 1 : t - p.badgeAt;
				// A spring: overshoots to ~1.2 and settles within ~0.6 s.
				const s = u <= 0 ? 0 : 1 - Math.exp(-6 * u) * Math.cos(12 * u);
				badgeEl.style.opacity = u <= 0 ? '0' : '1';
				badgeEl.style.transform = `scale(${s.toFixed(3)})`;
				if (u > 0 && u < 0.9) {
					const q = u / 0.9;
					svgEl(svg, 'circle', { cx: badgeRect.x + badge.d / 2, cy: badgeRect.y + badge.d / 2, r: badge.d / 2 + 54 * decel(q), fill: 'none', stroke: C.red, 'stroke-width': 3, 'stroke-opacity': (0.5 * (1 - q)).toFixed(3) });
				}
				if (legendEl) {
					const q = p.legendAt === undefined ? 1 : decel(clamp((t - p.legendAt) / 0.5));
					legendEl.style.opacity = q.toFixed(3);
					legendEl.style.transform = `translate(-50%, ${((1 - q) * 14).toFixed(1)}px)`;
				}
			},
		};
	},
};
