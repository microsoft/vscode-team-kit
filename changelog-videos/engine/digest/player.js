// The changelog digest's page: the daily video in the "before → after" design. One frame per seek(t), driven by DATA
// (built by `prs digest` from digest.json, the narration and the demo recordings; every time already in seconds).
//
// A chapter: a Before → Now strip in a column on the left (pr-studio's compare look) and, on the right, the recording of
// a demo (with camera moves) or a drawn scene. While the changed UI is on screen, a thin arrow runs from a strip row to
// it and a soft ring marks it.
import { C, prim, motion, clamp, segmentAt, clipLayer, captions, progressLine, cutOpacity, CLIP_W, CLIP_H } from './kit.js';
import { trackBoxAt } from './track.js';
import { SCENES } from './scenes/index.js';
import { esc, make, svgEl, iconSlot, fillIcons, liveRect } from './scenes/chrome.js';

const { decel, standard, lerp, enter } = motion;

/** The recording or the drawn scene: a 16:9 window right of the strip column. */
export const VIEW = { x: 624, y: 226, w: 1200, h: 675 };
/** The strip column. Connectors leave a row at its right edge and turn at x = TURN, in the gap before the view. */
const COL = { x: 96, w: 480 };
const TURN = 600;
const TONE = { green: C.green, blue: C.blue, orange: C.orange, neutral: C.connectorStrong };

function msLogo(size = 11) {
	return `<span style="display:grid;grid-template-columns:${size}px ${size}px;gap:2px">${['#f25022', '#7fba00', '#00a4ef', '#ffb900'].map(c => `<i style="width:${size}px;height:${size}px;background:${c}"></i>`).join('')}</span>`;
}

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
function mix(a, b, p) {
	const [x, y] = [hex(a), hex(b)];
	return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], p))).join(',')})`;
}

const inflate = (r, pad) => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });

/** The page box of the recording's 1280x720 frame at t: the whole window, then camera moves to { z, fx, fy }. */
function cameraBox(moves, t) {
	let z = 1, fx = CLIP_W / 2, fy = CLIP_H / 2;
	for (const m of moves ?? []) {
		const p = standard(clamp((t - m.at) / (m.dur ?? 1)));
		if (p <= 0) {
			break;
		}
		z = lerp(z, m.z, p);
		fx = lerp(fx, m.fx, p);
		fy = lerp(fy, m.fy, p);
	}
	fx = clamp(fx, CLIP_W / 2 / z, CLIP_W - CLIP_W / 2 / z);
	fy = clamp(fy, CLIP_H / 2 / z, CLIP_H - CLIP_H / 2 / z);
	const k = VIEW.w / CLIP_W * z;
	return { x: VIEW.x + VIEW.w / 2 - fx * k, y: VIEW.y + VIEW.h / 2 - fy * k, w: CLIP_W * k, h: CLIP_H * k };
}

// ---------------------------------------------------------------------------------------------------------------
// The Before → Now strip. Heights must match cli/lib/digest.mjs (stripHeight), which checks that a strip fits.

export const GAP_AFTER = { eyebrow: 14, head: 12, row: 10, arrow: 10, setting: 0 };

export function heightOf(it) {
	switch (it.kind) {
		case 'eyebrow': return 28;
		case 'head': return 52;
		case 'arrow': return 40;
		case 'setting': return it.state ? 128 : 84;
		default: return it.sub || it.tone === 'orange' ? 84 : 66;
	}
}

function rowHtml(it) {
	const parts = [];
	if (it.tone === 'green') {
		parts.push(`<span class="ba-go">${iconSlot('arrowRight', 24)}</span>`);
	}
	if (it.toggle) {
		parts.push('<span class="ba-toggle"><i></i></span>');
	}
	if (it.icon && it.style !== 'chip') {
		parts.push(`<span class="ba-ic">${iconSlot(it.icon, it.tone === 'orange' ? 28 : 24)}</span>`);
	}
	if (it.style === 'chip') {
		parts.push(`<span class="ba-chip">${iconSlot(it.icon, 22)}${esc(it.text)}</span>`);
	} else if (it.style === 'button') {
		parts.push(`<span class="ba-btn">${esc(it.text)}</span>`);
	} else {
		parts.push(`<span class="ba-text"><span class="${it.mono ? 'mono' : ''}">${esc(it.text)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span>`);
	}
	if (it.kbd) {
		parts.push(`<span class="kbd">${esc(it.kbd)}</span>`);
	}
	return parts.join('');
}

function buildStrip(host, items) {
	host.innerHTML = '';
	const placed = [], rows = {};
	let y = VIEW.y;
	for (const it of items) {
		if (it.kind === 'setting') {
			y += 16;
		}
		const h = heightOf(it);
		let node = null;
		if (it.kind !== 'arrow') {
			node = make(host, '');
			Object.assign(node.style, { left: `${COL.x}px`, top: `${y}px`, width: `${COL.w}px`, height: `${h}px`, opacity: '0' });
			if (it.kind === 'eyebrow') {
				node.className = 'ba-eyebrow';
				node.textContent = it.text;
			} else if (it.kind === 'head') {
				node.className = `ba-head ${it.tone}`;
				node.innerHTML = `${iconSlot(it.icon, 26)}<span>${esc(it.text)}</span>`;
			} else if (it.kind === 'setting') {
				node.className = 'ba-setting';
				node.innerHTML = `<div class="lbl">${iconSlot('settings', 24)}Setting</div><code>${esc(it.name)}</code>${it.state ? `<div class="state">${it.toggle ? '<span class="ba-toggle"><i></i></span>' : ''}${esc(it.state)}</div>` : ''}`;
				// A long setting ID shrinks to fit its card, on one line.
				const code = node.querySelector('code'), room = COL.w - 40;
				if (code.scrollWidth > room) {
					code.style.fontSize = `${Math.max(14, 22 * room / code.scrollWidth).toFixed(2)}px`;
				}
			} else {
				node.className = `ba-row ${it.tone ?? 'plain'}`;
				node.innerHTML = rowHtml(it);
			}
			fillIcons(node);
		}
		const entry = { it, node, x: COL.x, y, w: COL.w, h, cy: y + h / 2 };
		placed.push(entry);
		if (it.id) {
			rows[it.id] = entry;
		}
		y += h + (GAP_AFTER[it.kind] ?? 10);
	}
	return { placed, rows };
}

function setToggle(tog, v) {
	tog.style.background = mix('#c4c9d1', C.blue, v);
	tog.firstElementChild.style.transform = `translateX(${(v * 22).toFixed(1)}px)`;
}

function renderStrip(strip, t) {
	for (const { it, node } of strip.placed) {
		if (!node) {
			continue;
		}
		const q = enter(node, t, it.at, it.kind === 'row' ? { dur: 0.55, dx: -18, dy: 0 } : { dur: 0.5, dy: 10 });
		let opacity = q;
		if (it.dimAt !== undefined && it.dimAt !== null) {
			opacity *= lerp(1, 0.5, standard(clamp((t - it.dimAt) / 0.5)));
		}
		node.style.opacity = opacity.toFixed(3);
		if (it.pulseAt !== undefined && it.pulseAt !== null) {
			const u = clamp((t - it.pulseAt) / 0.9);
			node.style.boxShadow = u > 0 && u < 1 ? `0 0 0 ${(decel(u) * 12).toFixed(1)}px rgba(0, 120, 212, ${(0.32 * (1 - u)).toFixed(3)})` : 'none';
		}
		const tog = node.querySelector('.ba-toggle');
		if (tog) {
			const flip = it.toggle === 'flip' ? it.flipAt ?? it.at + (it.kind === 'setting' ? 0.3 : 0.25) : undefined;
			setToggle(tog, flip !== undefined ? standard(clamp((t - flip) / 0.35)) : it.toggle === 'on' ? 1 : 0);
		}
	}
}

function drawStripArrows(svg, strip, t) {
	for (const p of strip.placed) {
		if (p.it.kind === 'arrow' && t >= p.it.at) {
			const x = COL.x + COL.w / 2;
			prim.arrow(svg, x, p.y + 2, x, p.y + p.h - 2, { color: C.connectorStrong, width: 3 }).render(t, p.it.at, 0.4);
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Links: a thin arrow from a strip row to the changed UI, and a soft ring around it, while it is on screen.

function drawRing(g, r, color, q, { round = false, thin = false } = {}) {
	if (q <= 0) {
		return;
	}
	if (thin) {
		// A sentence inside a paragraph: a highlighter band that stays within its own line.
		svgEl(g, 'rect', { x: r.x, y: r.y, width: r.w * decel(q), height: r.h, rx: 4, fill: color, 'fill-opacity': 0.24, stroke: color, 'stroke-width': 2 });
		return;
	}
	const grow = (1 - q) * 12;
	const x = r.x - grow, y = r.y - grow, w = r.w + 2 * grow, h = r.h + 2 * grow;
	const base = { x, y, width: w, height: h, rx: round ? Math.min(w, h) / 2 : Math.min(10, h / 2), fill: 'none' };
	svgEl(g, 'rect', { ...base, stroke: color, 'stroke-width': 12, 'stroke-opacity': (0.22 * q).toFixed(3) });
	svgEl(g, 'rect', { ...base, stroke: '#fff', 'stroke-width': 5.5, 'stroke-opacity': (0.92 * q).toFixed(3) });
	svgEl(g, 'rect', { ...base, stroke: color, 'stroke-width': 3, 'stroke-opacity': q.toFixed(3) });
}

/** The connector's points from the row's right edge (S) to the ring (R), by route. */
function route(link, S, R, endY, stopRect, lane) {
	const kind = link.route ?? 'h';
	if (kind === 'up' || kind === 'down') {
		const x = R.x + R.w / 2;
		return [[S.x, S.y], [x, S.y], [x, endY ?? (kind === 'up' ? R.y + R.h + 3 : R.y - 3)]];
	}
	if (kind === 'lane') {
		const x = R.x + R.w / 2;
		const y = link.lane ?? lane ?? VIEW.y + 120;
		return [[S.x, S.y], [TURN, S.y], [TURN, y], [x, y], [x, y > R.y ? R.y + R.h + 3 : R.y - 3]];
	}
	// 'h': into the ring's left side, or to the left edge of the box that holds it (a dialog, the chat input).
	const y = R.y + R.h / 2;
	const stopX = stopRect ? stopRect.x - 4 : R.x - 3;
	return [[S.x, S.y], [TURN, S.y], [TURN, y], [stopX, y]];
}

export default function createPlayer(root, DATA) {
	const chapters = DATA.segments.filter(s => s.kind === 'chapter');
	make(root, 'brand', `${msLogo()}<span>${esc(DATA.meta.title)} · ${esc(DATA.meta.dateShort)}</span>`);
	const dots = make(root, 'dots', chapters.map(s => `<div class="dot" data-rank="${s.spec.rank}">${s.spec.rank}</div>`).join(''));
	const intro = make(root, 'section intro', `<h1>${esc(DATA.meta.title)}</h1><div class="date">${esc(DATA.meta.date)} · ${esc(DATA.meta.subtitle)}</div>
		<div class="rows">${chapters.map(s => `<div class="row"><div class="rank">${s.spec.rank}</div><div><div class="t">${esc(s.spec.headline)}</div><div class="s">#${s.spec.number} · @${esc(s.spec.author)}</div></div></div>`).join('')}</div>`);
	const chapter = make(root, 'section chapter', '<header><div class="rank"></div><div><h2></h2><div class="sub"></div></div></header>');
	const header = chapter.querySelector('header');
	const view = make(chapter, 'view');
	const clip = clipLayer(view);
	const sceneHost = make(view, 'scene');
	const stripHost = make(chapter, 'strip');
	const svg = prim.svgLayer(chapter);
	const outro = make(root, 'section outro', `<h1>That's today's changelog.</h1><div class="line">The full list, with links, is in <b>${esc(DATA.meta.channel)}</b>.</div>
		<div class="recap">${chapters.map(s => {
		const pair = s.spec.recap, cls = pair.mono ? ' mono' : '';
		return `<div class="r"><span class="pr">#${s.spec.number}</span>${pair.before ? `<span class="b${cls}">${esc(pair.before)}</span><span class="go">${iconSlot('arrowRight', 26)}</span>` : '<span class="b"><span class="new">New</span></span><span class="go"></span>'}<span class="n${cls}">${esc(pair.now)}</span></div>`;
	}).join('')}</div><div class="made">${esc(DATA.meta.made)}</div>`);
	fillIcons(outro);
	const caps = captions(root, DATA);
	const progress = progressLine(root, DATA);
	const cut = make(root, 'cut');
	const scenes = SCENES;

	/** The strip items, links and camera of a chapter, from its spec (digest.json, times resolved). */
	function planOf(seg, scene) {
		const s = seg.spec, b = s.before, n = s.now;
		const items = [];
		if (s.eyebrow) {
			items.push({ kind: 'eyebrow', text: s.eyebrow, at: (b ?? n).at - 0.1 });
		}
		if (b) {
			items.push({ kind: 'head', tone: 'neutral', icon: b.icon ?? 'history', text: b.head ?? 'Before', at: b.at });
			b.rows.forEach((r, i) => items.push({ ...r, kind: 'row', at: r.at ?? b.at + 0.15 + 0.12 * i, tone: r.tone, dimAt: r.dimAt ?? (b.dim === false ? undefined : n.at + 0.4) }));
			items.push({ kind: 'arrow', at: n.at - 0.2 });
		}
		items.push({ kind: 'head', tone: n.tone ?? 'blue', icon: n.icon ?? 'sparkle', text: n.head ?? 'Now', at: n.at - 0.1, pulseAt: n.pulseAt });
		n.rows.forEach((r, i) => items.push({ ...r, kind: 'row', at: r.at ?? n.at + 0.12 * i, tone: r.tone ?? (r.changed === false ? undefined : 'green') }));
		if (s.setting) {
			items.push({ kind: 'setting', name: s.setting.name, state: s.setting.state, toggle: s.setting.toggle, flipAt: s.setting.flipAt, at: s.setting.at ?? n.at + 0.35 });
		}
		const strip = buildStrip(stripHost, items);
		return { strip, camera: seg.camera ?? [], scene };
	}

	/**
	 * Where a part is on the page at t, or null when it isn't on screen then. A demo's mark: its box as recorded in the
	 * frame shown at t, through the camera. A scene's part: measured now (fonts, animations), while it is drawn and
	 * opaque.
	 */
	function focusRect(seg, plan, name, t, box) {
		if (seg.clip) {
			const k = Math.max(0, Math.min(seg.clip.map.length - 1, Math.floor((t - seg.start) * seg.clip.fps + 1e-6)));
			const at = trackBoxAt(seg.targets[name], (seg.clip.map[k] - 1) / seg.clip.clipFps);
			if (!at) {
				return null;
			}
			const [x, y, w, h] = at;
			const sx = box.w / CLIP_W, sy = box.h / CLIP_H;
			return { x: box.x + x * sx, y: box.y + y * sy, w: w * sx, h: h * sy };
		}
		const w = plan.scene?.windows?.[name];
		const r = plan.scene?.rects?.[name];
		if (!w || !r || t < w[0] || t >= w[1]) {
			return null;
		}
		return r.el ? liveRect(r.el) : r;
	}

	/** The chapter's arrows, one at a time: each from its row to its part, with a ring around it, while both are there. */
	function drawFocus(seg, plan, t, box) {
		for (const f of seg.focus ?? []) {
			if (t < f.from || t >= f.until) {
				continue;
			}
			const row = plan.strip.rows[f.row];
			const raw = row ? focusRect(seg, plan, f.name, t, box) : null;
			if (!raw) {
				continue;
			}
			const color = TONE[f.tone] ?? TONE.green;
			const ring = inflate(raw, 6);
			const g = svgEl(svg, 'g', { opacity: clamp((f.until - t) / 0.25).toFixed(3) });
			drawRing(g, ring, color, decel(clamp((t - f.from - 0.2) / 0.4)));
			const pts = route({}, { x: COL.x + COL.w + 2, y: row.cy }, ring);
			prim.connector(g, pts, { color: '#fff', width: 7.5, radius: 14 }).render(t, f.from, 0.5);
			prim.connector(g, pts, { color, width: 3, radius: 14 }).render(t, f.from, 0.5);
		}
	}

	let current = null, plan = null;
	function open(seg) {
		current = seg;
		for (const [kind, node] of [['intro', intro], ['chapter', chapter], ['outro', outro]]) {
			node.classList.toggle('hide', kind !== seg.kind);
		}
		if (seg.kind !== 'chapter') {
			return;
		}
		const s = seg.spec;
		header.querySelector('.rank').textContent = s.rank;
		header.querySelector('h2').textContent = s.headline;
		header.querySelector('.sub').textContent = `#${s.number} · @${s.author}${seg.clip ? ` · recorded in ${DATA.meta.build}` : ''}`;
		clip.el.classList.toggle('hide', !seg.clip);
		sceneHost.innerHTML = '';
		sceneHost.className = 'scene';
		let scene = null;
		if (s.scene) {
			const kind = scenes[s.scene.name];
			if (!kind) {
				throw new Error(`Unknown scene "${s.scene.name}" in ${seg.id} (scenes: ${Object.keys(scenes).join(', ')})`);
			}
			scene = kind.build(sceneHost, s.scene.params ?? {}, { view: VIEW, start: seg.start, end: seg.end });
			scene.windows = kind.windows(s.scene.params ?? {}, { start: seg.start, end: seg.end });
		}
		plan = planOf(seg, scene);
	}

	return {
		chunks: () => caps.chunks(),
		async seek(t) {
			const seg = segmentAt(DATA, t);
			if (seg !== current) {
				open(seg);
			}
			const local = t - seg.start;
			cut.style.opacity = cutOpacity(DATA, seg, t).toFixed(3);
			progress.render(t);
			const rank = seg.kind === 'chapter' ? seg.spec.rank : seg.kind === 'outro' ? 99 : 0;
			for (const d of dots.children) {
				const r = Number(d.dataset.rank);
				d.className = `dot${r === rank ? ' on' : r < rank ? ' done' : ''}`;
			}
			dots.style.opacity = seg.kind === 'chapter' ? '1' : '0';
			let key = seg.id;
			if (seg.kind === 'intro') {
				[...intro.querySelectorAll('.row')].forEach((row, i) => {
					const p = decel(clamp((local - 0.6 - i * 0.25) / 0.5));
					row.style.opacity = p.toFixed(3);
					row.style.transform = `translateX(${((1 - p) * 40).toFixed(1)}px)`;
				});
			} else if (seg.kind === 'outro') {
				const rows = [...outro.querySelectorAll('.recap .r')];
				[...outro.children].filter(n => !n.classList.contains('recap')).forEach((node, i) => {
					const p = decel(clamp((local - 0.15 - (i === 2 ? 1.05 + rows.length * 0.15 : i * 0.35)) / 0.55));
					node.style.opacity = p.toFixed(3);
					node.style.transform = `translateY(${((1 - p) * 18).toFixed(1)}px)`;
				});
				rows.forEach((row, i) => {
					const p = decel(clamp((local - 0.95 - i * 0.15) / 0.5));
					row.style.opacity = p.toFixed(3);
					row.style.transform = `translateX(${((1 - p) * -24).toFixed(1)}px)`;
				});
			} else {
				const h = decel(clamp((local - 0.05) / 0.45)), v = decel(clamp((local - 0.15) / 0.55));
				header.style.cssText = `opacity:${h.toFixed(3)};transform:translateY(${((1 - h) * 14).toFixed(1)}px)`;
				view.style.cssText = `opacity:${v.toFixed(3)};transform:translateY(${((1 - v) * 18).toFixed(1)}px)`;
				svg.innerHTML = '';
				let box = null;
				if (seg.clip) {
					box = cameraBox(plan.camera, t);
					Object.assign(clip.el.style, { left: `${(box.x - VIEW.x).toFixed(2)}px`, top: `${(box.y - VIEW.y).toFixed(2)}px`, width: `${box.w.toFixed(2)}px`, height: `${box.h.toFixed(2)}px` });
					key += `:${await clip.show(seg, t)}`;
				}
				plan.scene?.render(t, svg);
				renderStrip(plan.strip, t);
				drawStripArrows(svg, plan.strip, t);
				drawFocus(seg, plan, t, box);
			}
			return `${key}|${caps.render(t)}`;
		},
	};
}
