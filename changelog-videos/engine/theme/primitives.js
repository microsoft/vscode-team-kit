// Building blocks of the studio look. Rules:
//  - every visible string goes through txt(), which stamps data-src (where the text came from) for the linter;
//  - every box that text must stay inside carries data-box;
//  - nothing animates by itself: callers set styles from time t in render().
import { C, MS_LOGO, STEP, TONE, tone as toneOf } from './tokens.js';
import { ICONS } from './icons.js';
import { clamp, decel, enter, lerp, prog } from '../engine/motion.js';
import { textParts, textOf } from '../engine/text.js';

let FACTS = {};
/** Set once by the runtime so fact() text can resolve. */
export function setFacts(facts) {
	FACTS = facts ?? {};
}
export function factsContext() {
	return FACTS;
}

const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'flex', 'flexGrow', 'flexShrink', 'lineHeight', 'order']);

export function el(tag, cls, parent, style, text) {
	const node = document.createElement(tag);
	if (cls) {
		node.className = cls;
	}
	if (style) {
		for (const [key, value] of Object.entries(style)) {
			node.style[key] = typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : value;
		}
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	if (parent) {
		parent.appendChild(node);
	}
	return node;
}

/** Text with provenance. value: string | label() | fact() | quote() | ident() | path() | an array of those. */
export function txt(parent, value, cls = '', style = null, tag = 'span') {
	const parts = textParts(value, FACTS);
	const node = el(tag, cls, parent, style);
	if (parts.length === 1) {
		node.textContent = parts[0].text;
		node.dataset.src = parts[0].src;
	} else {
		for (const part of parts) {
			const span = el('span', '', node, null, part.text);
			span.dataset.src = part.src;
		}
	}
	return node;
}

export const say = value => textOf(value, FACTS);

export function icon(parent, name, size = 30, color = C.ink, style = {}) {
	const svg = ICONS[name];
	if (!svg) {
		throw new Error(`Unknown icon "${name}". See theme/icons.js for the list.`);
	}
	const wrap = el('div', '', parent, { width: size, height: size, flex: 'none', color, ...style });
	wrap.innerHTML = svg
		.replace('<svg ', '<svg fill="currentColor" style="display:block" ')
		.replace(/width="\d+"/, `width="${size}"`)
		.replace(/height="\d+"/, `height="${size}"`);
	return wrap;
}

/** Icon in a rounded tinted square (or circle). */
export function iconTile(parent, name, { tone = 'neutral', size = 48, iconSize, round = false, solid = false } = {}) {
	const t = toneOf(tone);
	const wrap = el('div', '', parent, {
		width: size, height: size, borderRadius: round ? size / 2 : size * 0.24, flex: 'none',
		background: solid ? t.fg : t.tint, display: 'grid', placeItems: 'center',
	});
	icon(wrap, name, iconSize ?? Math.round(size * 0.56), solid ? '#fff' : t.fg);
	return wrap;
}

export function pill(parent, { tone = 'blue', text, iconName, mono = false, size = 'm', style = {}, solid = false } = {}) {
	const t = toneOf(tone);
	const dims = { s: { height: 34, fontSize: 17, padding: '0 14px', icon: 20 }, m: { height: 44, fontSize: 21, padding: '0 18px', icon: 24 }, l: { height: 54, fontSize: 24, padding: '0 22px', icon: 26 } }[size];
	const node = el('div', `st-pill${mono ? ' st-mono' : ''}`, parent, {
		background: solid ? t.fg : t.tint, color: solid ? '#fff' : t.fg, height: dims.height, fontSize: mono ? dims.fontSize - 2 : dims.fontSize, padding: dims.padding, ...style,
	});
	node.dataset.box = 'pill';
	if (iconName) {
		icon(node, iconName, dims.icon, solid ? '#fff' : t.fg);
	}
	txt(node, text);
	return node;
}

/** Round numbered badge. n: 1-based step number (or any short text). */
export function badge(parent, { n, text, color, size = 40, style = {} } = {}) {
	const fill = color ?? STEP[((n ?? 1) - 1) % STEP.length];
	const node = el('div', 'st-badge', parent, { width: size, height: size, background: fill, fontSize: Math.round(size * 0.44), ...style });
	node.dataset.box = 'badge';
	txt(node, text ?? String(n));
	return node;
}

/** White card with a hairline border. flow: true for a card inside a flex/grid layout. */
export function card(parent, style = {}, { flow = false, tint } = {}) {
	const node = el('div', flow ? 'st-card st-card--flow' : 'st-card', parent, style);
	if (tint) {
		Object.assign(node.style, { background: toneOf(tint).tint, borderColor: 'transparent' });
	}
	node.dataset.box = 'card';
	return node;
}

/** Tinted tile without border. */
export function tile(parent, tone = 'neutral', style = {}, { flow = false } = {}) {
	const node = el('div', flow ? 'st-tile st-tile--flow' : 'st-tile', parent, { background: toneOf(tone).tint, ...style });
	node.dataset.box = 'tile';
	return node;
}

/** Card header: icon tile + title + optional subtitle. */
export function cardHead(parent, { iconName, title, sub, tone = 'neutral', size = 'm', mono = false } = {}) {
	const s = size === 'l' ? { icon: 52, title: 28, sub: 20, gap: 18 } : size === 's' ? { icon: 38, title: 21, sub: 16, gap: 12 } : { icon: 46, title: 24, sub: 18, gap: 16 };
	const row = el('div', '', parent, { display: 'flex', alignItems: 'center', gap: s.gap, minWidth: 0 });
	if (iconName) {
		iconTile(row, iconName, { tone, size: s.icon });
	}
	const col = el('div', '', row, { minWidth: 0 });
	txt(col, title, mono ? 'st-mono' : '', { display: 'block', fontSize: mono ? s.title - 3 : s.title, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', lineHeight: 1.2 });
	if (sub) {
		txt(col, sub, '', { display: 'block', fontSize: s.sub, color: C.body, whiteSpace: 'nowrap', marginTop: 3, lineHeight: 1.3 });
	}
	return row;
}

/** Slide heading: eyebrow + title (+ an optional tag pill on the right). Auto-fits the title to its width. */
export function heading(parent, { eyebrow, title, tag, tagTone = 'purple', tagMono = false }) {
	const wrap = el('div', 'st-abs', parent, { left: 96, top: 92, width: 1728 });
	wrap.dataset.head = '';
	const e = eyebrow ? txt(wrap, eyebrow, 'st-eyebrow', { display: 'block' }) : null;
	const h = txt(wrap, title, 'st-title', { display: 'block', marginTop: eyebrow ? 14 : 0, whiteSpace: 'nowrap' }, 'div');
	let tagNode = null;
	if (tag) {
		tagNode = el('div', 'st-abs', parent, { right: 96, top: 142 });
		tagNode.dataset.head = '';
		pill(tagNode, { tone: tagTone, text: tag, mono: tagMono });
	}
	return {
		wrap, e, h, tagNode,
		layout() {
			const room = tagNode ? 1728 - tagNode.getBoundingClientRect().width - 40 : 1728;
			fit(h, { width: room, min: 40 });
		},
		render(t, at, tagAt) {
			if (e) {
				enter(e, t, at, { dy: 8 });
			}
			enter(h, t, at + 0.08);
			if (tagNode) {
				enter(tagNode, t, tagAt ?? at + 0.3, { dy: 8 });
			}
		},
	};
}

/** Shrinks a single-line element's font until it fits `width` (never below `min`). Deterministic: runs once at mount. */
export function fit(node, { width, min = 14 }) {
	let size = parseFloat(getComputedStyle(node).fontSize);
	let guard = 0;
	while (node.scrollWidth > width + 0.5 && size > min && guard++ < 80) {
		size -= 1;
		node.style.fontSize = `${size}px`;
	}
	return size;
}

/** An SVG layer covering the whole frame, for connectors and diagram lines. */
export function svgLayer(parent, style = {}) {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 1920 1080');
	Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', overflow: 'visible', pointerEvents: 'none', ...style });
	parent.appendChild(svg);
	return svg;
}

function svgEl(parent, tag, attrs) {
	const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [key, value] of Object.entries(attrs)) {
		node.setAttribute(key, String(value));
	}
	parent.appendChild(node);
	return node;
}

/** Rounded polyline through points, drawn on over time. points: [[x,y], ...]. */
export function connector(svg, rawPoints, { color = C.connector, width = 3, head = true, radius = 18, dashed = false, opacity = 1 } = {}) {
	// Drop repeated points: a zero-length segment has no direction to round a corner with.
	const points = rawPoints.filter((p, i) => i === 0 || Math.hypot(p[0] - rawPoints[i - 1][0], p[1] - rawPoints[i - 1][1]) > 0.5);
	if (points.length < 2) {
		points.push([points[0][0] + 0.01, points[0][1]]);
	}
	let d = `M ${points[0][0]} ${points[0][1]}`;
	for (let i = 1; i < points.length; i++) {
		const [x, y] = points[i];
		if (i < points.length - 1 && radius > 0) {
			const [px, py] = points[i - 1];
			const [nx, ny] = points[i + 1];
			const inLen = Math.hypot(x - px, y - py), outLen = Math.hypot(nx - x, ny - y);
			const r = Math.min(radius, inLen / 2, outLen / 2);
			if (r < 0.5) {
				d += ` L ${x} ${y}`;
				continue;
			}
			const ax = x - ((x - px) / inLen) * r, ay = y - ((y - py) / inLen) * r;
			const bx = x + ((nx - x) / outLen) * r, by = y + ((ny - y) / outLen) * r;
			d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
		} else {
			d += ` L ${x} ${y}`;
		}
	}
	const g = svgEl(svg, 'g', { opacity });
	const path = svgEl(g, 'path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
	if (dashed) {
		path.setAttribute('stroke-dasharray', '2 10');
	}
	let headPath = null;
	if (head) {
		const [x2, y2] = points.at(-1);
		const [x1, y1] = points.at(-2);
		const ang = Math.atan2(y2 - y1, x2 - x1);
		const a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8, s = 9 + width * 1.6;
		headPath = svgEl(g, 'path', { d: `M ${x2 + Math.cos(a1) * s} ${y2 + Math.sin(a1) * s} L ${x2} ${y2} L ${x2 + Math.cos(a2) * s} ${y2 + Math.sin(a2) * s}`, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
	}
	const length = path.getTotalLength();
	return {
		g, path, length,
		/** Draw on from `at` over `dur` seconds. */
		render(t, at, dur = 0.55) {
			const p = decel(prog(t, at, at + dur));
			if (!dashed) {
				path.style.strokeDasharray = `${length}`;
				path.style.strokeDashoffset = `${length * (1 - p)}`;
			} else {
				g.style.opacity = String(opacity * p);
			}
			if (headPath) {
				headPath.style.opacity = String(prog(p, 0.8, 1));
			}
			return p;
		},
		setColor(color) {
			path.setAttribute('stroke', color);
			headPath?.setAttribute('stroke', color);
		},
		pointAt(p) {
			const pt = path.getPointAtLength(length * clamp(p));
			return { x: pt.x, y: pt.y };
		},
	};
}

/** Straight arrow. */
export function arrow(svg, x1, y1, x2, y2, opts = {}) {
	return connector(svg, [[x1, y1], [x2, y2]], { radius: 0, ...opts });
}

/** A dot or ring on an SVG layer. */
export function circle(svg, cx, cy, r, { fill = C.blue, stroke = 'none', width = 0 } = {}) {
	return svgEl(svg, 'circle', { cx, cy, r, fill, stroke, 'stroke-width': width });
}

/** Horizontal bar that grows on. */
export function bar(parent, { x, y, w, h = 14, color = C.blue, track = C.track, flow = false }) {
	const t0 = el('div', flow ? '' : 'st-abs', parent, flow ? { width: w, height: h, borderRadius: h, background: track, flex: 'none', position: 'relative', overflow: 'hidden' } : { left: x, top: y, width: w, height: h, borderRadius: h, background: track, overflow: 'hidden' });
	const fill = el('div', '', t0, { height: h, width: 0, borderRadius: h, background: color });
	return { track: t0, fill, render(t, at, frac, dur = 0.9) {
		fill.style.width = `${w * frac * decel(prog(t, at, at + dur))}px`;
	} };
}

export function microsoftLogo(parent, x, y, size = 32) {
	const wrap = el('div', 'st-abs', parent, { left: x, top: y, display: 'flex', alignItems: 'center', gap: 14 });
	const grid = el('div', '', wrap, { width: size, height: size, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: Math.max(2, size / 14) });
	for (const c of MS_LOGO) {
		el('div', '', grid, { background: c });
	}
	txt(wrap, 'Microsoft', '', { fontSize: size * 0.86, fontWeight: 600, color: '#737373', letterSpacing: '-.005em' });
	return wrap;
}

/** Bounding box of a node in frame coordinates (call after mount, when nothing is transformed). */
export function frameRect(node) {
	const r = node.getBoundingClientRect();
	return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

export { C, TONE, STEP, enter, lerp, clamp, prog, decel };
