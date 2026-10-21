// Layouts: slide content (plain data) -> HTML in the studio look. Static versions of the video catalog's
// treatments, plus a few that only slides need (section divider, term card, poll, agenda, quadrant, end card).
// Every text block carries data-t so the build can check it for overflow, overlap and the safe area.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { codeToTokens } from 'shiki';
import { ICON_NAMES, svgOf } from '../theme/icons.js';

/** The pr-studio checkout: icons and fonts are read from its node_modules. */
export const ROOT = path.resolve(import.meta.dirname, '..');

/** The deck being built: its folder (where `assets/` and `designs/` are) and the folder its HTML is written to.
 * build.mjs sets both before it draws the first slide. */
export const DECK = { dir: ROOT, out: path.join(ROOT, 'build') };

/** A file of the deck, from the path a slide gives (e.g. 'assets/review.png'), as an absolute path. */
export function deckFile(src) {
	return path.resolve(DECK.dir, src);
}

/** How the built HTML refers to a file (an <img src>): its path relative to the HTML. */
export function htmlRef(file) {
	return path.relative(DECK.out, file).split(path.sep).map(encodeURIComponent).join('/');
}
const STEP = ['blue', 'green', 'purple', 'orange'];
export const stepTone = i => STEP[i % STEP.length];
const W = 1728;
const r1 = v => Math.round(v * 10) / 10;

// ---------- text ----------

export function esc(value) {
	return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline markup: {{tone|marked words}}, **strong**, `code`, and \n for a line break. */
export function fmt(value) {
	return esc(value)
		.replace(/\{\{(blue|green|red|orange|purple|yellow|neutral)\|([^}]+)\}\}/g, (_, tone, text) => `<span class="mark t-${tone}">${text}</span>`)
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\n/g, '<br>');
}

/** Plain text of a value, for checks and notes. */
export function plain(value) {
	return String(value ?? '').replace(/\{\{[a-z]+\|([^}]+)\}\}/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

/** A short name for a slide, also when it has no title (hero, statement, quote). */
export function slideName(s) {
	const hero = s.value ? `${s.logoText ? `${s.logoText}: ` : ''}${s.value} ${s.label ?? ''}` : null;
	return plain(s.title ?? s.term ?? s.text ?? hero ?? s.eyebrow ?? s.layout).replace(/\s*\n\s*/g, ' ').trim();
}

// ---------- building blocks ----------

/** The pixel size of a PNG or JPEG (crop and pins need it). */
export function pngSize(file) {
	const b = fs.readFileSync(file);
	if (b.length >= 24 && b.readUInt32BE(12) === 0x49484452) {
		return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
	}
	if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
		// JPEG: walk the segments to the frame header (SOF0-SOF15, but not DHT, JPG or DAC).
		for (let i = 2; i + 9 < b.length;) {
			if (b[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = b[i + 1];
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
				return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
			}
			i += 2 + b.readUInt16BE(i + 2);
		}
	}
	throw new Error(`crop and pins need a PNG or JPEG file: ${file}`);
}

/** A picture of the deck (assets/*.png or .jpg) in a frame of at most maxW x maxH. crop: [x, y, w, h] shows only that
 * region; pins ([{ at: [x, y], n, tone }]) and rings ([{ box: [x, y, w, h], n, tone }]) point at places on it. All in
 * the picture's own pixels. Returns { html, w, h }. A missing file draws a placeholder (and the build warns); a picture
 * the build can't measure (not PNG or JPEG) is fitted whole, without crop or marks. */
export function picture(src, { crop, maxW, maxH, maxScale = Infinity, alt = '', placeholder, pins = [], rings = [] }) {
	const file = src ? deckFile(src) : null;
	if (!file || !fs.existsSync(file)) {
		const w = Math.round(maxW), h = Math.round(Math.min(maxH, maxW * 9 / 16));
		return { w, h, html: `<div class="shot missing" data-missing="${esc(src ?? '')}" style="width:${w}px;height:${h}px"><div class="ph">${ic('image', 56, 'var(--faint)')}<div style="margin-top:14px" data-t>${fmt(placeholder ?? `Screenshot: ${alt || src}`)}</div></div></div>` };
	}
	let natural;
	try {
		natural = pngSize(file);
	} catch (e) {
		if (crop || pins.length || rings.length) {
			throw e;
		}
		const w = Math.round(maxW), h = Math.round(maxH);
		return { w, h, html: `<div class="shot" style="width:${w}px;height:${h}px"><img src="${htmlRef(file)}" alt="${esc(alt)}"></div>` };
	}
	const [cx, cy, cw, ch] = crop ?? [0, 0, natural.width, natural.height];
	if (cx < 0 || cy < 0 || cw <= 0 || ch <= 0 || cx + cw > natural.width + 1 || cy + ch > natural.height + 1) {
		throw new Error(`crop [${crop.join(', ')}] is not inside the picture (${natural.width} x ${natural.height} px): ${src}`);
	}
	const scale = Math.min(maxW / cw, maxH / ch, maxScale);
	const w = Math.round(cw * scale), h = Math.round(ch * scale);
	const at = ([x, y], what) => {
		const px = (x - cx) * scale, py = (y - cy) * scale;
		if (px < -1 || py < -1 || px > w + 1 || py > h + 1) {
			throw new Error(`${what} [${x}, ${y}] is outside the picture${crop ? ' (after the crop)' : ''}: ${src}`);
		}
		return [Math.round(px), Math.round(py)];
	};
	let marks = '';
	for (const r of rings) {
		const [x, y] = at(r.box, 'a box corner');
		const [x2, y2] = at([r.box[0] + r.box[2], r.box[1] + r.box[3]], 'a box corner');
		marks += `<span class="pic-ring t-${r.tone ?? 'blue'}" style="left:${x}px;top:${y}px;width:${x2 - x}px;height:${y2 - y}px"></span>`;
		if (r.n) {
			// The number goes beside the ring, outside it (left, or right when the ring touches the left edge).
			const nx = x >= 44 ? x - 30 : x2 + 30;
			marks += `<span class="ring-n st-badge" style="left:${nx}px;top:${Math.round((y + y2) / 2)}px;background:var(--${r.tone ?? 'blue'})" data-t>${r.n}</span>`;
		}
	}
	// A pin stands above its spot on a short stem, so it doesn't hide what it points at (below it near the top edge).
	for (const pin of pins) {
		const [x, y] = at(pin.at, 'a pin');
		marks += `<span class="shot-pin${y < 80 ? ' down' : ''}" style="left:${x}px;top:${y}px;--pin:var(--${pin.tone ?? 'blue'})"><span class="st-badge" data-t>${pin.n}</span></span>`;
	}
	const img = `<img src="${htmlRef(file)}" alt="${esc(alt)}" style="position:absolute;left:${r1(-cx * scale)}px;top:${r1(-cy * scale)}px;width:${r1(natural.width * scale)}px;height:${r1(natural.height * scale)}px;max-width:none;object-fit:fill">`;
	return { w, h, html: `<div class="shot" style="width:${w}px;height:${h}px">${img}${marks}</div>` };
}

const svgCache = new Map();
function svgText(name) {
	const raw = svgOf(name);
	if (!raw) {
		throw new Error(`Unknown icon "${name}". Known icons: ${ICON_NAMES.join(', ')}`);
	}
	if (!svgCache.has(name)) {
		svgCache.set(name, raw.replace('<svg ', '<svg fill="currentColor" ').replace(/ width="\d+"/, '').replace(/ height="\d+"/, ''));
	}
	return svgCache.get(name);
}

export function ic(name, size = 28, color = null) {
	return `<span class="ic" style="width:${size}px;height:${size}px${color ? `;color:${color}` : ''}">${svgText(name)}</span>`;
}

export function iconTile(name, { tone = 'neutral', size = 52, round = false, solid = false } = {}) {
	const radius = round ? '50%' : `${Math.round(size * 0.24)}px`;
	return `<span class="ictile t-${tone}" style="width:${size}px;height:${size}px;border-radius:${radius};background:${solid ? 'var(--fg)' : 'var(--tint)'};color:${solid ? '#fff' : 'var(--fg)'}">${ic(name, Math.round(size * 0.56))}</span>`;
}

/** pill({ text, tone, icon, size: 's'|'m'|'l', solid, mono }) or pill('text'). A neutral pill has no fill: it is a plain
 * line with an icon (no gray boxes anywhere). */
export function pill(p) {
	const o = typeof p === 'string' ? { text: p } : p;
	const tone = o.tone ?? 'blue';
	const size = o.size ?? 'm';
	const bare = tone === 'neutral' && !o.solid && !o.white;
	const cls = (size === 's' ? ' st-pill--s' : size === 'l' ? ' st-pill--l' : '') + (bare ? ' st-pill--plain' : '');
	const iconSize = size === 's' ? 19 : size === 'l' ? 26 : 23;
	const bg = o.solid ? 'var(--fg)' : o.white ? '#fff' : bare ? 'transparent' : 'var(--tint)';
	const fg = o.solid ? '#fff' : 'var(--fg)';
	return `<span class="st-pill${cls} t-${tone}${o.mono ? ' st-mono' : ''}" data-t style="background:${bg};color:${fg}">${o.icon ? ic(o.icon, iconSize) : ''}<span>${fmt(o.text)}</span></span>`;
}

export function heading(s) {
	if (!s.title && !s.eyebrow) {
		return '';
	}
	const tag = s.tag ? `<div class="head-tag">${pill(s.tag)}</div>` : '';
	return `<div class="head">${s.eyebrow ? `<div class="st-eyebrow" data-t>${fmt(s.eyebrow)}</div>` : ''}${s.title ? `<div class="st-title" data-t data-autofit="${s.tag ? 1300 : W}">${fmt(s.title)}</div>` : ''}</div>${tag}`;
}

/** Height of the body region: shorter when the slide has a link badge (QR) in the bottom-right corner. */
export function bodyHeight(s, { full = false } = {}) {
	return (full ? 810 : 694) - (s.link ? 84 : 0);
}

export function body(inner, { vcenter = true, full = false } = {}) {
	return `<div class="body${vcenter ? ' vcenter' : ''}${full ? ' full' : ''}">${inner}</div>`;
}

export function msLogo() {
	const colors = ['#f25022', '#7fba00', '#00a4ef', '#ffb900'];
	return `<div class="ms-logo"><div class="grid">${colors.map(c => `<i style="background:${c}"></i>`).join('')}</div><span class="name" data-t>Microsoft</span></div>`;
}

export function qrSvg(text) {
	// Long addresses make dense codes; level L keeps their squares larger, so they still read from a projector or a PDF.
	const qr = QRCode.create(text, { errorCorrectionLevel: text.length > 120 ? 'L' : 'M' });
	const n = qr.modules.size;
	let d = '';
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (qr.modules.get(r, c)) {
				d += `M${c + 1} ${r + 1}h1v1h-1z`;
			}
		}
	}
	return `<svg viewBox="0 0 ${n + 2} ${n + 2}" data-qr="${esc(text)}"${n > 41 ? ' class="dense"' : ''}><path d="${d}" fill="#1b1b1f" shape-rendering="crispEdges"/></svg>`;
}

export const arrowSvg = (w = 64, color = 'var(--connector)') => `<svg width="${w}" height="24" viewBox="0 0 ${w} 24" style="overflow:visible"><path d="M8 12 H${w - 10}" stroke="${color}" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M${w - 20} 4 L${w - 10} 12 L${w - 20} 20" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

export function arrowHead(x2, y2, x1, y1, color, width = 3) {
	const ang = Math.atan2(y2 - y1, x2 - x1);
	const s = 9 + width * 1.6;
	const a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8;
	return `<path d="M ${x2 + Math.cos(a1) * s} ${y2 + Math.sin(a1) * s} L ${x2} ${y2} L ${x2 + Math.cos(a2) * s} ${y2 + Math.sin(a2) * s}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ---------- layouts ----------

/** Code with its notes beside the lines they explain (code layout, annotate: true): the window and the notes are centred as
 * one group, each explained line gets a coloured band, and a thin connector joins it to its note. No numbered dots. */
function annotatedCode(s, tokens, head) {
	const H = bodyHeight(s);
	const size = s.fontSize ?? 22;
	const lineH = Math.round(size * 1.82);
	const headH = s.file ? 58 : 0;
	const padY = 14;
	const from = s.from ?? 1;
	const notesW = s.calloutsWidth ?? 470;
	const gap = 150;
	// Wide enough for the longest line (a monospace character is about 0.61 em), but never wider than the space left.
	const longest = Math.max(...s.code.split('\n').map(l => l.length));
	const panelW = s.width ?? Math.min(W - notesW - gap, Math.ceil(longest * size * 0.61) + 74 + 40);
	const left = Math.max(0, (W - panelW - gap - notesW) / 2);
	const panelH = headH + padY * 2 + tokens.length * lineH;
	const top = Math.max(0, (H - panelH) / 2);
	const toneOf = k => s.callouts[k].tone ?? stepTone(k);
	const band = new Map();
	s.callouts.forEach((c, k) => {
		for (let l = c.lines[0]; l <= (c.lines[1] ?? c.lines[0]); l++) {
			band.set(l, toneOf(k));
		}
	});
	const rows = tokens.map((line, i) => {
		const n = from + i;
		const code = line.map(t => `<span style="color:${t.color ?? '#d4d4d4'}${t.fontStyle === 1 ? ';font-style:italic' : ''}">${esc(t.content)}</span>`).join('');
		return `<div class="cl${band.has(n) ? ` band t-${band.get(n)}` : ''}" style="height:${lineH}px"><span class="g">${n}</span><span data-t>${code || ' '}</span></div>`;
	}).join('');
	const panel = `<div class="code annot" data-fit style="left:${r1(left)}px;top:${r1(top)}px;width:${panelW}px;height:${panelH}px;--code-size:${size}px">${s.file ? head : ''}<div class="code-lines" style="padding:${padY}px 0">${rows}</div></div>`;
	// Notes next to their lines, pushed apart so they never overlap (like the file explorer).
	const noteH = s.noteHeight ?? 92;
	const ys = s.callouts.map(c => {
		const a = c.lines[0] - from, b = (c.lines[1] ?? c.lines[0]) - from;
		return top + headH + padY + ((a + b) / 2) * lineH + lineH / 2;
	});
	const ny = ys.map(y => y - noteH / 2);
	for (let i = 1; i < ny.length; i++) {
		ny[i] = Math.max(ny[i], ny[i - 1] + noteH + 16);
	}
	const over = ny.length ? ny[ny.length - 1] + noteH - H : 0;
	if (over > 0) {
		for (let i = 0; i < ny.length; i++) {
			ny[i] -= over;
		}
	}
	const nx = left + panelW + gap;
	let svg = '';
	const notes = s.callouts.map((c, k) => {
		const tone = toneOf(k);
		const y = Math.max(0, ny[k]);
		const sx = left + panelW + 4, sy = ys[k], ex = nx - 14, ey = y + noteH / 2;
		svg += `<path d="M ${r1(sx)} ${r1(sy)} C ${r1(sx + 70)} ${r1(sy)}, ${r1(ex - 70)} ${r1(ey)}, ${r1(ex)} ${r1(ey)}" fill="none" stroke="var(--${tone})" stroke-width="3" stroke-linecap="round"/><circle cx="${r1(sx)}" cy="${r1(sy)}" r="6" fill="var(--${tone})"/>`;
		return `<div class="cn-note t-${tone}" data-fit style="left:${r1(nx)}px;top:${r1(y)}px;width:${notesW}px;height:${noteH}px"><div class="t" data-t>${fmt(c.title)}</div>${c.text ? `<div class="s" data-t>${fmt(c.text)}</div>` : ''}</div>`;
	}).join('');
	return body(`<div class="code-annot" style="height:${H}px"><svg class="rd-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>${panel}${notes}</div>`, { vcenter: false });
}

export const LAYOUTS = {
	/** Opening frame: logo, eyebrow, big title, quote, speaker, pills, and a "today" card on the right.
	 * card: { label, big, sub, rows: [{ title, value, note, tone }] }, or rows: 'blocks' to list the blocks of this deck with
	 * their Core minutes (computed by the build, so the card never goes stale); labels: { 'Block name': 'shorter label' }. */
	title(s, ctx = {}) {
		const sp = s.speaker ? `<div class="tf-speaker"><span class="tf-avatar" data-t>${esc(s.speaker.initials)}</span><span class="tf-name" data-t>${fmt(s.speaker.name)}</span><span class="tf-role" data-t>${fmt(s.speaker.role)}</span></div>` : '';
		const pills = s.pills ? `<div class="tf-pills">${s.pills.map(pill).join('')}</div>` : '';
		const left = `<div class="tf-left"><div class="st-eyebrow" data-t>${fmt(s.eyebrow)}</div><div class="st-title-xl tf-title" data-t>${fmt(s.title)}</div>${s.quote ? `<div class="tf-quote" data-t>“${fmt(s.quote)}”</div>` : ''}${s.sub ? `<div class="tf-quote" data-t>${fmt(s.sub)}</div>` : ''}${sp}${pills}</div>`;
		let card = '';
		if (s.card) {
			const auto = s.card.rows === 'blocks';
			const list = auto ? (ctx.blocks ?? []).map(b => ({ title: s.card.labels?.[b.block] ?? b.block, value: b.minutes, note: `${Math.round(b.minutes)} min` })) : s.card.rows;
			const big = auto ? `~${Math.round(ctx.coreTotal ?? 0)} min` : s.card.big;
			const sub = auto ? `${list.length} blocks${ctx.hasBreak ? '  \u00b7  1 break' : ''}` : s.card.sub;
			const max = Math.max(...list.map(r => r.value), 1);
			const rows = list.map((r, i) => `<div class="tf-row t-${r.tone ?? stepTone(i)}"><span class="t" data-t>${fmt(r.title)}</span><span class="bar"><i style="width:${(r.value / max) * 100}%"></i></span><span class="v" data-t>${esc(r.note ?? r.value)}</span></div>`).join('');
			card = `<div class="tf-right"><div class="st-card tf-card" data-fit><div class="tf-card-head"><div class="lbl" style="color:var(--blue)" data-t>${fmt(s.card.label)}</div><div class="tf-card-big"><span class="st-num num" data-t>${fmt(big)}</span><span class="sub" data-t>${fmt(sub)}</span></div></div><div class="tf-card-rows">${rows}</div></div></div>`;
		}
		return msLogo() + left + card;
	},

	/** One sentence with marked phrases, chips under it. */
	statement(s) {
		const chips = s.chips ? `<div class="chips">${s.chips.map(c => pill({ tone: 'neutral', ...(typeof c === 'string' ? { text: c } : c) })).join('')}</div>` : '';
		return `<div class="stmt">${s.eyebrow ? `<div class="st-eyebrow" data-t>${fmt(s.eyebrow)}</div>` : ''}<div class="stmt-text" data-t>${fmt(s.text)}</div>${chips}${s.note ? `<div class="stmt-note" data-t>${fmt(s.note)}</div>` : ''}</div>`;
	},

	quote(s) {
		const who = s.who ? `<div class="quote-who"><span class="av" data-t>${esc(s.who.initials ?? '')}</span><span><div class="name" data-t>${fmt(s.who.name)}</div>${s.who.role ? `<div class="role" data-t>${fmt(s.who.role)}</div>` : ''}</span></div>` : '';
		// note: a short plain-words explanation under the quote (a string, or one line per item).
		const lines = s.note ? (Array.isArray(s.note) ? s.note : [s.note]) : [];
		const note = lines.length ? `<div class="quote-note">${lines.map(l => `<div data-t>${fmt(l)}</div>`).join('')}</div>` : '';
		return `<div class="quote">${s.eyebrow ? `<div class="st-eyebrow" data-t style="margin-bottom:34px">${fmt(s.eyebrow)}</div>` : ''}<div class="quote-mark">“</div><div class="quote-text" data-t>${fmt(s.text)}</div>${who}${note}</div>`;
	},

	/** 2-4 numbered cards. items: [{ icon, title, text, example, exampleLabel, tone }] */
	pillars(s) {
		const n = s.items.length;
		const cards = s.items.map((it, k) => {
			const tone = it.tone ?? stepTone(k);
			const ex = it.example ? `<div class="pillar-ex"><div data-fit><span class="lbl" data-t>${fmt(it.exampleLabel ?? s.exampleLabel ?? 'Example')}</span><span data-t>${fmt(it.example)}</span></div></div>` : '';
			return `<div class="pillar t-${tone}" data-fit style="min-height:${s.height ?? 430}px"><div class="pillar-top"><span class="pillar-badge" data-t>${String(k + 1).padStart(2, '0')}</span>${it.icon ? ic(it.icon, 36) : ''}</div><div class="pillar-title" data-t>${fmt(it.title)}</div>${it.text ? `<div class="pillar-text" data-t>${fmt(it.text)}</div>` : ''}${ex}</div>`;
		}).join('');
		return heading(s) + body(`<div class="pillars${n === 4 ? ' four' : ''}" style="grid-template-columns:repeat(${n},1fr)">${cards}</div>`);
	},

	/** 1-3 big numbers on tinted tiles. items: [{ value, label, sub, tone }] */
	counters(s) {
		const tiles = s.items.map((it, k) => `<div class="counter t-${it.tone ?? ['blue', 'green', 'purple'][k % 3]}" data-fit><div class="counter-num" data-t data-autofit="${Math.floor((W - 28 * (s.items.length - 1)) / s.items.length) - 72}">${fmt(it.value)}</div><div class="counter-label" data-t>${fmt(it.label)}</div>${it.sub ? `<div class="counter-sub" data-t>${fmt(it.sub)}</div>` : ''}</div>`).join('');
		return heading(s) + body(`<div class="counters" style="grid-template-columns:repeat(${s.items.length},1fr)">${tiles}</div>${s.note ? `<div class="counters-note" data-t>${fmt(s.note)}</div>` : ''}`);
	},

	/** Rows with a round icon, a title and a line under it. items: [{ icon, tone, title, sub }] */
	checklist(s) {
		const cols = s.columns ?? (s.items.length > 5 ? 2 : 1);
		const perCol = Math.ceil(s.items.length / cols);
		const rows = s.items.map((it, i) => `<div class="check-row${i % perCol === 0 ? ' first' : ''}">${iconTile(it.icon ?? 'check', { tone: it.tone ?? 'blue', size: s.dense ? 48 : 56, round: true })}<div><div class="check-title" data-t>${fmt(it.title)}</div>${it.sub ? `<div class="check-sub" data-t>${fmt(it.sub)}</div>` : ''}</div></div>`).join('');
		return heading(s) + body(`<div class="checklist${s.dense ? ' dense' : ''}" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${perCol},auto);grid-auto-flow:column">${rows}</div>`, { vcenter: s.vcenter ?? true });
	},

	/** Numbered steps on the left, an optional card on the right. steps: [{ title, text, tone }], aside: { label, title, text, prompt, mono } */
	steps(s) {
		const steps = s.steps.map((st, k) => `<div class="step t-${st.tone ?? stepTone(k)}"><span class="step-badge" data-t>${k + 1}</span><div><div class="step-title" data-t>${fmt(st.title)}</div>${st.text ? `<div class="step-text" data-t>${fmt(st.text)}</div>` : ''}</div></div>`).join('');
		let aside = '';
		if (s.aside) {
			const a = s.aside;
			aside = `<div class="aside"><div class="st-card aside-card" data-fit>${a.label ? `<div class="lbl" data-t>${fmt(a.label)}</div>` : ''}${a.title ? `<div class="aside-title" data-t>${fmt(a.title)}</div>` : ''}${a.text ? `<div class="aside-body" data-t>${fmt(a.text)}</div>` : ''}${a.prompt ? `<div class="prompt${a.mono ? ' mono' : ''}" style="margin-top:16px" data-t>${a.mono ? esc(a.prompt) : fmt(a.prompt)}</div>` : ''}</div></div>`;
		}
		return heading(s) + body(`<div class="steps-wrap"><div class="steps">${steps}</div>${aside}</div>`);
	},

	/** Stages left to right, an optional loop back and an optional failure branch under one stage. */
	pipeline(s) {
		const n = s.stages.length;
		const gap = s.arrow ?? 64;
		const sw = (W - gap * (n - 1)) / n;
		const stageH = s.stageHeight ?? 236;
		const top = s.loop || s.branch ? 40 : 0;
		const cx = i => i * (sw + gap) + sw / 2;
		const stages = s.stages.map((st, i) => {
			const tone = st.tone ?? stepTone(i);
			const chip = st.chip ? `<div class="stage-chip">${pill({ text: st.chip, tone, size: 's', mono: st.chipMono ?? true })}</div>` : '';
			const el = `<div class="stage t-${tone}${st.on ? ' on' : ''}" data-fit style="width:${sw}px;height:${stageH}px"><div class="stage-top"><span class="st-badge" style="width:40px;height:40px;font-size:18px;background:var(--fg)" data-t>${i + 1}</span>${st.icon ? iconTile(st.icon, { tone, size: 46 }) : ''}</div><div class="stage-title" data-t>${fmt(st.title)}</div>${st.sub ? `<div class="stage-sub" data-t>${fmt(st.sub)}</div>` : ''}${chip}</div>`;
			return i < n - 1 ? el + `<div class="pipe-arrow" style="width:${gap}px">${arrowSvg(gap)}</div>` : el;
		}).join('');
		let svg = '';
		let extra = '';
		const yBottom = top + stageH;
		if (s.loop) {
			const { from, to, label } = s.loop;
			const x1 = cx(from), x2 = cx(to), y = yBottom + 92;
			const d = `M ${x1} ${yBottom + 6} L ${x1} ${y - 18} Q ${x1} ${y} ${x1 - 18} ${y} L ${x2 + 18} ${y} Q ${x2} ${y} ${x2} ${y - 18} L ${x2} ${yBottom + 10}`;
			svg += `<path d="${d}" fill="none" stroke="var(--blue)" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>${arrowHead(x2, yBottom + 10, x2, yBottom + 40, 'var(--blue)')}`;
			extra += `<div class="pipe-label" data-t style="left:${(x1 + x2) / 2}px;top:${y - 14}px;color:var(--blue)">${fmt(label)}</div>`;
		}
		if (s.branch) {
			const b = s.branch;
			const tone = b.tone ?? 'orange';
			const x = cx(b.from);
			const by = yBottom + (s.loop ? 170 : 90);
			svg += `<path d="M ${x} ${yBottom + 6} L ${x} ${by - 12}" fill="none" stroke="var(--${tone})" stroke-width="3" stroke-linecap="round"/>${arrowHead(x, by - 12, x, yBottom, `var(--${tone})`)}`;
			if (b.label) {
				extra += `<div class="pipe-label t-${tone}" data-t style="left:${x + 16}px;top:${yBottom + (by - yBottom) / 2 - 14}px;transform:none;color:var(--fg)">${fmt(b.label)}</div>`;
			}
			const bw = Math.min(Math.max(sw, 420), 620);
			const left = Math.min(Math.max(x - bw / 2, 0), W - bw);
			extra += `<div class="branch t-${tone}" data-fit style="left:${left}px;top:${by}px;width:${bw}px">${ic(b.icon ?? 'warning', 30, 'var(--fg)')}<div><div class="bt" data-t>${fmt(b.title)}</div>${b.sub ? `<div class="bs" data-t>${fmt(b.sub)}</div>` : ''}</div></div>`;
		}
		const height = s.branch ? yBottom + (s.loop ? 170 : 90) + 110 : s.loop ? yBottom + 120 : yBottom;
		const inner = `<div class="pipeline" style="height:${height}px"><div class="stages" style="position:absolute;left:0;top:${top}px">${stages}</div><svg class="pipe-svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">${svg}</svg>${extra}</div>`;
		return heading(s) + body(inner + (s.note ? `<div class="counters-note" data-t>${fmt(s.note)}</div>` : ''));
	},

	/** Parties as lifelines, messages between them. parties: [{ icon, title, sub, tone }], steps: [{ from, to, text, mono, reply, replyTone }] */
	sequence(s) {
		const n = s.parties.length;
		const margin = 190;
		const px = i => margin + (i * (W - 2 * margin)) / (n - 1);
		const top = 150;
		// Each step needs room for its message label, and for its reply label when there is one.
		const want = s.steps.map(st => (s.rowHeight ?? 100) + (st.reply ? 62 : 0));
		const k = Math.min(1, (680 - top) / want.reduce((a, b) => a + b, 0));
		const rows = [];
		let y = top;
		s.steps.forEach((st, i) => {
			rows.push({ st, line: y + 44 * k, i });
			y += want[i] * k;
		});
		const h = y + 10;
		let svg = '';
		let html = '';
		s.parties.forEach((p, i) => {
			const tone = p.tone ?? stepTone(i);
			html += `<div class="seq-party t-${tone}" style="left:${px(i)}px">${iconTile(p.icon ?? 'person', { tone, size: 44 })}<div><div class="t" data-t>${fmt(p.title)}</div>${p.sub ? `<div class="s" data-t>${fmt(p.sub)}</div>` : ''}</div></div>`;
			svg += `<line x1="${px(i)}" y1="90" x2="${px(i)}" y2="${h}" stroke="var(--line-strong)" stroke-width="2" stroke-dasharray="6 8"/>`;
		});
		for (const { st, line, i } of rows) {
			const a = px(st.from), b = px(st.to);
			const dir = Math.sign(b - a) || 1;
			const tone = st.tone ?? 'blue';
			svg += `<path d="M ${a + dir * 8} ${line} L ${b - dir * 10} ${line}" stroke="var(--ink)" stroke-width="2.5" fill="none" stroke-linecap="round"/>${arrowHead(b - dir * 10, line, a, line, 'var(--ink)', 2.5)}`;
			html += `<span class="seq-n t-${tone}" data-t style="top:${line}px">${i + 1}</span>`;
			html += `<div class="seq-msg${st.mono ? ' mono' : ''}" data-t style="left:${(a + b) / 2}px;top:${line - 42}px">${st.mono ? esc(st.text) : fmt(st.text)}</div>`;
			if (st.reply) {
				const ry = line + 40;
				const rt = st.replyTone ?? 'green';
				svg += `<path d="M ${b - dir * 8} ${ry} L ${a + dir * 10} ${ry}" stroke="var(--${rt})" stroke-width="2.5" fill="none" stroke-dasharray="7 7" stroke-linecap="round"/>${arrowHead(a + dir * 10, ry, b, ry, `var(--${rt})`, 2.5)}`;
				html += `<div class="seq-reply t-${rt}" data-t style="left:${(a + b) / 2}px;top:${ry + 8}px">${fmt(st.reply)}</div>`;
			}
		}
		return heading(s) + body(`<div class="seq" style="height:${h}px"><svg width="${W}" height="${h}" style="position:absolute;left:0;top:0;overflow:visible">${svg}</svg>${html}</div>`);
	},

	/** Something travelling across 3-5 stops. nodes: [{ icon, title, sub, tone, result, resultTone }], hops: [label] */
	journey(s) {
		const n = s.nodes.length;
		const margin = 170;
		const x = i => margin + (i * (W - 2 * margin)) / (n - 1);
		// Centre the drawing in the body: arcs and hop labels above the nodes, titles, subs and results below.
		const H = bodyHeight(s);
		const above = s.packet ? 190 : s.hops?.some(Boolean) ? 186 : 160;
		const below = 102 + (s.nodes.some(nd => nd.sub) ? 62 : 0) + (s.nodes.some(nd => nd.result) ? 48 : 0);
		const cy = Math.round((H - above - below) / 2 + above);
		let svg = '';
		let html = '';
		for (let i = 0; i < n - 1; i++) {
			const x1 = x(i) + 60, x2 = x(i + 1) - 60;
			const mid = (x1 + x2) / 2;
			const lift = 130;
			svg += `<path d="M ${x1} ${cy - 30} Q ${mid} ${cy - 30 - lift * 2} ${x2} ${cy - 30}" fill="none" stroke="var(--connector)" stroke-width="3" stroke-linecap="round"/>${arrowHead(x2, cy - 30, x2 - 30, cy - 80, 'var(--connector)')}`;
			if (s.hops?.[i]) {
				html += `<div class="j-hop" data-t style="left:${mid}px;top:${cy - 30 - lift - 26}px">${fmt(s.hops[i])}</div>`;
			}
		}
		s.nodes.forEach((nd, i) => {
			const tone = nd.tone ?? stepTone(i);
			html += `<div class="j-node t-${tone}" style="left:${x(i)}px;top:${cy - 52}px"><div class="circ">${ic(nd.icon ?? 'circle', 46)}</div><div class="t" data-t>${fmt(nd.title)}</div>${nd.sub ? `<div class="s" data-t>${fmt(nd.sub)}</div>` : ''}${nd.result ? `<div class="r">${pill({ text: nd.result, tone: nd.resultTone ?? 'green', size: 's' })}</div>` : ''}</div>`;
		});
		if (s.packet) {
			html += `<div style="position:absolute;left:${x(0) - 150}px;top:${cy - 190}px">${pill({ tone: 'blue', solid: true, ...s.packet })}</div>`;
		}
		return heading(s) + body(`<div class="journey" style="height:${H}px"><svg width="${W}" height="${H}" style="position:absolute;left:0;top:0;overflow:visible">${svg}</svg>${html}</div>`, { vcenter: false });
	},

	/** Stacked bands. layers: [{ icon, title, sub, tone, chips: [], callout }] */
	layers(s) {
		const n = s.layers.length;
		const h = s.height ?? Math.min(130, (694 - 16 * (n - 1)) / n);
		const rows = s.layers.map((l, i) => {
			const tone = l.tone ?? stepTone(i);
			const chips = l.chips?.length ? `<div class="lchips">${l.chips.map(c => pill({ text: c, tone, size: 's', white: true })).join('')}</div>` : '';
			const callout = l.callout ? `<div style="margin-left:${chips ? 16 : 'auto'}">${pill({ text: l.callout, tone, solid: true, size: 's' })}</div>` : '';
			return `<div class="layer t-${tone}" data-fit style="height:${h}px">${iconTile(l.icon ?? 'layers', { tone, size: 56 })}<div><div class="lt" data-t>${fmt(l.title)}</div>${l.sub ? `<div class="ls" data-t>${fmt(l.sub)}</div>` : ''}</div>${chips}${callout}</div>`;
		}).join('');
		return heading(s) + body(`<div class="layers">${rows}</div>`);
	},

	/** Table. columns: [{ label, width }], rows: [[cell, ...]] where cell = text | { text, ok, tone, icon, mono } */
	matrix(s) {
		const cols = s.columns.map(c => c.width ?? '1fr').join(' ');
		let html = s.columns.map(c => `<div class="mx-h" data-t>${fmt(c.label)}</div>`).join('');
		s.rows.forEach(row => {
			const cells = Array.isArray(row) ? row : row.cells;
			const tint = !Array.isArray(row) && row.tone ? ` mx-row-tint t-${row.tone}` : '';
			cells.forEach((cell, j) => {
				const c = typeof cell === 'object' && cell !== null ? cell : { text: cell };
				let iconHtml = '';
				if (c.ok === true) {
					iconHtml = ic('check', 26, 'var(--green)');
				} else if (c.ok === false) {
					iconHtml = ic('dismiss', 26, 'var(--red)');
				} else if (c.icon) {
					iconHtml = ic(c.icon, 26, c.tone ? `var(--${c.tone})` : 'var(--body)');
				}
				const content = c.pill ? pill({ text: c.text, tone: c.tone ?? 'blue', size: 's' }) : `<span data-t${c.tone && !c.pill ? ` style="color:var(--${c.tone})"` : ''}>${c.mono ? esc(c.text) : fmt(c.text)}</span>`;
				html += `<div class="mx-c${j === 0 ? ' first' : ''}${c.mono ? ' mono' : ''}${tint}">${iconHtml}${content}</div>`;
			});
		});
		// A short table gets taller rows and bigger type, so it fills the page instead of floating in the middle of it.
		const roomy = s.rows.length <= 4 ? ' roomy' : '';
		return heading(s) + body(`<div class="matrix${roomy}" style="grid-template-columns:${cols}">${html}</div>${s.note ? `<div class="counters-note" data-t>${fmt(s.note)}</div>` : ''}`);
	},

	/** Three (or more) columns of cards. columns: [{ title, icon, tone, items: [text | { title, sub }] }] */
	board(s) {
		const cols = s.columns.map((c, i) => {
			const tone = c.tone ?? stepTone(i);
			const items = c.items.map(it => {
				const o = typeof it === 'string' ? { title: it } : it;
				return `<div class="bitem" data-fit><div class="t" data-t>${fmt(o.title)}</div>${o.sub ? `<div class="s" data-t>${fmt(o.sub)}</div>` : ''}</div>`;
			}).join('');
			return `<div class="t-${tone}"><div class="bcol-head">${iconTile(c.icon ?? 'circle', { tone, size: 40, round: true, solid: true })}<span class="t" data-t>${fmt(c.title)}</span></div><div class="bcol-items">${items}</div></div>`;
		}).join('');
		return heading(s) + body(`<div class="board" style="grid-template-columns:repeat(${s.columns.length},1fr)">${cols}</div>`, { vcenter: s.vcenter ?? true });
	},

	/** Before / after. left/right: { label, tone, icon, title, prompt | text | lines: [text | { text, ok }] | image, notes: [{ text, tone }], on },
	 * verdict: { text, tone, icon }. A side with image: 'assets/x.png' shows that picture (crop: [x, y, w, h]; box: a
	 * region to ring, or a list of them; in the picture's own pixels), scaled the same on both sides for equal crops. */
	split(s) {
		const pictured = !!(s.left.image || s.right.image);
		const H = bodyHeight(s);
		const side = (p, fallbackTone) => {
			const tone = p.tone ?? fallbackTone;
			let content = '';
			if (p.image) {
				const boxes = p.box ? (Array.isArray(p.box[0]) ? p.box : [p.box]) : [];
				const room = H - 140 - (s.verdict ? 104 : 0) - (p.notes?.length ? 64 : 0);
				content = picture(p.image, { crop: p.crop, alt: p.alt ?? p.title ?? p.label, maxW: (W - 36) / 2 - 68, maxH: room, maxScale: 3, rings: boxes.map(box => ({ box, tone })) }).html;
			} else if (p.prompt) {
				content = `<div class="prompt${p.mono ? ' mono' : ''}" data-t>${p.mono ? esc(p.prompt) : fmt(p.prompt)}</div>`;
			} else if (p.lines) {
				content = `<div class="split-lines">${p.lines.map(l => {
					const o = typeof l === 'string' ? { text: l } : l;
					const mark = o.ok === true ? ic('check', 26, 'var(--green)') : o.ok === false ? ic('dismiss', 26, 'var(--red)') : o.icon ? ic(o.icon, 26, `var(--${o.tone ?? 'body'})`) : '';
					return `<div>${mark}<span data-t>${fmt(o.text)}</span></div>`;
				}).join('')}</div>`;
			} else if (p.text) {
				content = `<div class="split-text" data-t>${fmt(p.text)}</div>`;
			}
			const notes = p.notes?.length ? `<div class="split-notes">${p.notes.map(nt => pill({ size: 's', tone: tone, ...(typeof nt === 'string' ? { text: nt } : nt) })).join('')}</div>` : '';
			return `<div class="split-card t-${tone}${p.on ? ' on' : ''}" data-fit style="min-height:${s.height ?? (pictured ? 0 : 420)}px"><div class="split-head">${pill({ text: p.label, tone, icon: p.icon, size: 's' })}${p.title ? `<span class="t" data-t>${fmt(p.title)}</span>` : ''}</div><div class="split-body${p.image ? ' split-pic' : ''}">${content}</div>${notes}</div>`;
		};
		const verdict = s.verdict ? `<div class="split-verdict t-${s.verdict.tone ?? 'green'}" data-fit>${ic(s.verdict.icon ?? 'check', 30)}<span data-t>${fmt(s.verdict.text)}</span></div>` : '';
		// Short sides get bigger type, so a few lines fill the cards instead of floating at the top of them.
		const short = p => p.lines ? p.lines.length <= 4 && p.lines.every(l => plain(typeof l === 'string' ? l : l.text).length <= 44) : plain(p.text ?? p.prompt ?? '').length <= 150;
		return heading(s) + body(`<div class="split${!pictured && short(s.left) && short(s.right) ? ' roomy' : ''}">${side(s.left, 'blue')}${side(s.right, 'green')}${verdict}</div>`);
	},

	/** Code with highlighted lines (or a diff) and numbered notes. code: string, from: first line number, lang, file, dir,
	 * highlight: [n...], diff: true (lines start with '+', '-' or ' '), callouts: [{ lines: [a, b], title, text }].
	 * Callout lines count from `from`; a diff shows no line numbers, so its callouts show only their badge on the row.
	 * gutter: false hides the line numbers of plain code too (hideLines hides only the callouts' "line N"). */
	async code(s) {
		// A tab is two spaces here: the window is sized by characters, and a tab drawn eight wide would run out of it.
		s = { ...s, code: String(s.code).replace(/\t/g, '  ') };
		const raw = s.code.replace(/\n$/, '').split('\n');
		const diffKinds = s.diff ? raw.map(l => l[0]) : null;
		const src = s.diff ? raw.map(l => l.slice(1)).join('\n') : raw.join('\n');
		const { tokens } = await codeToTokens(src, { lang: s.lang ?? 'ts', theme: 'dark-plus' });
		const from = s.from ?? 1;
		const marks = new Map();
		(s.callouts ?? []).forEach((nt, k) => marks.set(nt.lines[0], k));
		// A callout's colour: its own tone, else the step colour of its number.
		const toneOf = k => s.callouts[k].tone ?? stepTone(k);
		const highlight = new Set(s.highlight ?? []);
		const rows = tokens.map((line, i) => {
			const n = from + i;
			const kind = diffKinds?.[i];
			const cls = kind === '+' ? ' add' : kind === '-' ? ' del' : highlight.has(n) ? ' hl' : '';
			const pm = s.diff ? `<span class="pm">${kind === '+' ? '+' : kind === '-' ? '\u2212' : ' '}</span>` : '';
			const mark = marks.has(n) ? `<span class="m" style="background:var(--${toneOf(marks.get(n))})">${marks.get(n) + 1}</span>` : '';
			const code = line.map(t => `<span style="color:${t.color ?? '#d4d4d4'}${t.fontStyle === 1 ? ';font-style:italic' : ''}">${esc(t.content)}</span>`).join('');
			return `<div class="cl${cls}">${mark}<span class="g">${s.diff || s.gutter === false ? '' : n}</span>${pm}<span data-t>${code || ' '}</span></div>`;
		}).join('');
		const head = `<div class="code-head"><span class="lang">${esc((s.lang ?? 'ts').toUpperCase().slice(0, 4))}</span><span class="file" data-t>${esc(s.file ?? '')}</span><span class="dir" data-t>${esc(s.dir ?? '')}</span></div>`;
		if (s.annotate && s.callouts?.length) {
			return heading(s) + annotatedCode(s, tokens, head);
		}
		const panel = `<div class="code" data-fit style="--code-size:${s.fontSize ?? 22}px">${s.file ? head : ''}<div class="code-lines">${rows}</div></div>`;
		const notes = s.callouts?.length ? `<div class="code-notes" style="width:${s.calloutsWidth ?? 640}px">${s.callouts.map((nt, k) => `<div class="cnote" data-fit><span class="st-badge" style="width:36px;height:36px;font-size:16px;background:var(--${toneOf(k)})" data-t>${k + 1}</span><div><div class="t" data-t>${fmt(nt.title)}</div>${nt.text ? `<div class="s" data-t>${fmt(nt.text)}</div>` : ''}${nt.lines && !s.hideLines && !s.diff ? `<div class="ln" data-t>${nt.lines[0] === nt.lines[1] || nt.lines.length === 1 ? `line ${nt.lines[0]}` : `lines ${nt.lines[0]}\u2013${nt.lines[1]}`}</div>` : ''}</div></div>`).join('')}</div>` : '';
		return heading(s) + body(`<div class="code-wrap">${panel}${notes}</div>`);
	},

	/** A window mock (chat, tool calls, approvals) with callouts on the right. window: { title, width, blocks: [...] }, callouts: [{ title, text, tone }] */
	ui(s) {
		const w = s.window;
		const blocks = w.blocks.map(b => {
			switch (b.kind) {
				case 'user': return `<div class="ub-user" data-t>${fmt(b.text)}</div>`;
				case 'agent': return `<div class="ub-agent">${iconTile('bot', { tone: 'purple', size: 36, round: true })}<span data-t>${fmt(b.text)}</span></div>`;
				case 'tool': return `<div class="ub-tool t-${b.tone ?? 'blue'}">${ic(b.icon ?? 'wrench', 24, 'var(--fg)')}<span class="tx" data-t>${esc(b.text)}</span>${b.status ? pill({ text: b.status, tone: b.statusTone ?? 'green', size: 's' }) : ''}</div>`;
				case 'approve': return `<div class="ub-approve"><div class="tx" data-t>${fmt(b.text)}</div>${b.cmd ? `<div class="cmd" data-t>${esc(b.cmd)}</div>` : ''}<div class="ub-btns">${(b.buttons ?? ['Allow', 'Skip']).map((x, i) => `<span class="ub-btn${i === 0 ? ' primary' : ''}" data-t>${esc(x)}</span>`).join('')}</div></div>`;
				case 'toast': return `<div class="ub-toast t-${b.tone ?? 'green'}">${ic(b.icon ?? 'check', 24, 'var(--fg)')}<span data-t>${fmt(b.text)}</span></div>`;
				default: return `<div class="ub-text" data-t>${fmt(b.text)}</div>`;
			}
		}).join('');
		const win = `<div class="win" style="width:${w.width ?? 980}px"><div class="win-bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span class="wt" data-t>${esc(w.title ?? '')}</span></div><div class="win-body">${blocks}</div></div>`;
		const notes = s.callouts?.length ? `<div class="ui-notes">${s.callouts.map((nt, k) => `<div class="unote t-${nt.tone ?? stepTone(k)}"><span class="st-badge" style="width:40px;height:40px;font-size:18px;background:var(--fg)" data-t>${k + 1}</span><div><div class="t" data-t>${fmt(nt.title)}</div>${nt.text ? `<div class="s" data-t>${fmt(nt.text)}</div>` : ''}</div></div>`).join('')}</div>` : '';
		return heading(s) + body(`<div class="ui-wrap">${win}${notes}</div>`);
	},

	/** Screenshot (assets/*.png or .jpg) with optional callouts. crop: [x, y, w, h] in the picture's own pixels shows only
	 * that region. A callout points at the picture with at: [x, y] (its numbered pin there) or box: [x, y, w, h] (a ring
	 * around that region, numbered at its corner), in the picture's own pixels like crop. A missing file renders a
	 * placeholder and a lint warning. */
	image(s) {
		const callouts = s.callouts ?? [];
		const { html: shot } = picture(s.src, {
			crop: s.crop, alt: s.alt, placeholder: s.placeholder,
			maxW: s.width ?? (callouts.length ? 1100 : W), maxH: s.height ?? bodyHeight(s),
			pins: callouts.flatMap((c, k) => c.at ? [{ at: c.at, n: k + 1, tone: c.tone ?? stepTone(k) }] : []),
			rings: callouts.flatMap((c, k) => c.box ? [{ box: c.box, n: c.at ? 0 : k + 1, tone: c.tone ?? stepTone(k) }] : []),
		});
		const notes = callouts.length ? `<div class="shot-notes">${callouts.map((nt, k) => `<div class="unote t-${nt.tone ?? stepTone(k)}"><span class="st-badge" style="width:40px;height:40px;font-size:18px;background:var(--fg)" data-t>${k + 1}</span><div><div class="t" data-t>${fmt(nt.title)}</div>${nt.text ? `<div class="s" data-t>${fmt(nt.text)}</div>` : ''}</div></div>`).join('')}</div>` : '';
		return heading(s) + body(`<div class="shot-wrap">${shot}${notes}</div>`);
	},

	/** Closing card: link + QR, like pr-studio's end card. */
	end(s) {
		const metaTop = 470 + (s.titleLines ?? 1) * 45 + 18;
		return `${msLogo()}<div class="st-eyebrow end-eyebrow" data-t>${fmt(s.eyebrow ?? 'Take it with you')}</div><a class="end-url" href="${esc(s.url)}" data-t data-autofit="1280">${esc(s.url.replace(/^https?:\/\//, ''))}</a><div class="end-title" data-t>${fmt(s.title)}</div>${s.meta ? `<div class="end-meta" style="top:${metaTop}px" data-t>${fmt(s.meta)}</div>` : ''}<div class="end-rule" style="top:${metaTop + (s.meta ? 82 : 20)}px"></div><a class="st-card end-qr" href="${esc(s.qr ?? s.url)}">${qrSvg(s.qr ?? s.url)}<div class="cap" data-t>${fmt(s.qrCaption ?? 'scan or click to open')}</div></a>`;
	},

};
