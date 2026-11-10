// Helpers for the changelog digest's page (digest/player.js and the scenes), bundled by `prs digest` with esbuild;
// pr-studio's theme comes along. DATA = { meta, fps, total, segments: [...], words: [...] } (build/digest/timeline.json).
import { C, TONE, STEP, MS_LOGO, SAFE, CONTENT, tone } from '../theme/tokens.js';
import * as prim from '../theme/primitives.js';
import * as motion from '../engine/motion.js';
import { ICONS, ICON_NAMES } from '../theme/icons.js';

export { C, TONE, STEP, MS_LOGO, SAFE, CONTENT, tone, prim, motion, ICONS, ICON_NAMES };

export const W = 1920, H = 1080;
/** The recorded window: target rects are in these pixels. */
export const CLIP_W = 1280, CLIP_H = 720;

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** Cubic ease-out of a progress value. */
export const ease = x => 1 - Math.pow(1 - clamp(x), 3);
/** Progress of t through [a, a + dur], eased. */
export const prog = (t, a, dur = 0.4, fn = ease) => fn((t - a) / dur);

/** The segment on screen at t (intro, c1..c5, outro). */
export function segmentAt(DATA, t) {
	return DATA.segments.find(s => t >= s.start && t < s.end) ?? DATA.segments.at(-1);
}

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Absolute time of a phrase in a segment's narration (its first word). Throws when the phrase is missing. */
export function cueAt(DATA, segId, phrase, nth = 0) {
	const words = DATA.words.filter(w => w.seg === segId);
	const want = String(phrase).split(/\s+/).map(norm).filter(Boolean);
	let hits = 0;
	for (let i = 0; i + want.length <= words.length; i++) {
		if (want.every((w, j) => norm(words[i + j].display) === w) && hits++ === nth) {
			return words[i].a;
		}
	}
	throw new Error(`"${phrase}" is not in the narration of ${segId}`);
}

/**
 * The recording of a chapter. `layer.el` is an <img> you place and size (the frames are 2560x1440: zoom freely);
 * `await layer.show(seg, t)` puts the right frame in it for time t (and waits until it is decoded).
 */
export function clipLayer(parent, style = {}) {
	const img = document.createElement('img');
	img.alt = '';
	Object.assign(img.style, { position: 'absolute', display: 'block' }, style);
	parent.appendChild(img);
	let last = '';
	return {
		el: img,
		/** Frame number (1-based) shown at t. */
		frameAt(seg, t) {
			const k = Math.max(0, Math.min(seg.clip.map.length - 1, Math.floor((t - seg.start) * seg.clip.fps + 1e-6)));
			return seg.clip.map[k];
		},
		async show(seg, t) {
			if (!seg?.clip) {
				return 'none';
			}
			const f = this.frameAt(seg, t);
			const src = `${seg.clip.dir}/${String(f).padStart(5, '0')}.jpg`;
			if (src !== last) {
				last = src;
				img.src = src;
				await img.decode().catch(() => { });
			}
			return `${seg.id}:${f}`;
		},
	};
}

/**
 * Where a target of the recording (shared/targets.json: the "+", the /fork list, a dialog...) is on the page, given
 * where you draw the clip: box = { x, y, w, h } of the clip's 1280x720 frame on the page (after your own zoom).
 */
export function targetBox(seg, id, box) {
	const target = seg.targets?.[id];
	if (!target) {
		throw new Error(`No target ${id} in ${seg.id} (has: ${Object.keys(seg.targets ?? {}).join(', ')})`);
	}
	const [x, y, w, h] = target.rect;
	const sx = box.w / CLIP_W, sy = box.h / CLIP_H;
	return { x: box.x + x * sx, y: box.y + y * sy, w: w * sx, h: h * sy, cx: box.x + (x + w / 2) * sx, cy: box.y + (y + h / 2) * sy };
}

/**
 * Whether a target is on screen at t: { on, from, to, since, p } (absolute seconds; since = t - from; p = eased
 * appearance over `dur`, 0 when off). Windows come from the recording, mapped through the chapter's clip timing.
 */
export function targetAt(seg, id, t, dur = 0.35) {
	const windows = seg.targets?.[id]?.windows ?? [];
	const w = windows.find(([a, b]) => t >= a && t < b);
	if (!w) {
		return { on: false, from: null, to: null, since: -1, p: 0 };
	}
	return { on: true, from: w[0], to: w[1], since: t - w[0], p: ease((t - w[0]) / dur) };
}

/** First window of a target: [from, to] absolute seconds, or null. */
export function targetWindow(seg, id, nth = 0) {
	return seg.targets?.[id]?.windows?.[nth] ?? null;
}

/**
 * pr-studio's captions (one line per phrase; spoken words go from faint to ink): the .st-captions pill of
 * studio.css. Restyle it with CSS in your style.css, or build your own from DATA.words.
 */
export function captions(parent, DATA, { maxWidth = 1560, font = '600 34px Aptos, "Segoe UI", Inter' } = {}) {
	const measure = document.createElement('canvas').getContext('2d');
	measure.font = font;
	const ends = w => /[.,;:?!]$/.test(w.display);
	const words = DATA.words;
	const groups = [];
	let chunk = [], size = 9;
	words.forEach((word, index) => {
		if (!chunk.length) {
			let last = index;
			while (last < words.length - 1 && !ends(words[last]) && words[last + 1].seg === word.seg) {
				last++;
			}
			const n = last - index + 1;
			size = n > 9 ? Math.ceil(n / Math.ceil(n / 9)) : 9;
		}
		if (chunk.length && measure.measureText([...chunk, word].map(w => w.display).join(' ')).width > maxWidth) {
			groups.push(chunk);
			chunk = [];
		}
		chunk.push(word);
		const next = words[index + 1];
		if (chunk.length >= size || ends(word) || !next || next.seg !== word.seg || (chunk.length >= 6 && next.a - word.b > 0.28)) {
			groups.push(chunk);
			chunk = [];
		}
	});
	const chunks = groups.map((ws, i, all) => ({ words: ws, start: ws[0].a, end: Math.min(ws.at(-1).b + 0.18, all[i + 1]?.[0].a ?? Infinity) }));
	const layer = document.createElement('div');
	layer.className = 'st-captions';
	const pill = document.createElement('div');
	pill.className = 'st-captions__pill';
	layer.appendChild(pill);
	parent.appendChild(layer);
	const pool = Array.from({ length: 16 }, () => {
		const s = document.createElement('span');
		s.className = 'st-captions__w';
		pill.appendChild(s);
		return s;
	});
	return {
		el: layer,
		chunks: () => chunks.map(c => ({ start: c.start, end: c.end, text: c.words.map(w => w.display).join(' ') })),
		/** Shows the phrase at t; returns a key of the caption state. */
		render(t) {
			const c = chunks.findIndex(ch => t >= ch.start && t < ch.end);
			layer.style.opacity = c < 0 ? '0' : '1';
			if (c < 0) {
				return 'none';
			}
			const chunk = chunks[c];
			const said = chunk.words.filter(w => t >= w.a - 0.02).length;
			pool.forEach((node, i) => {
				const w = chunk.words[i];
				node.style.display = w ? 'inline' : 'none';
				if (w) {
					node.textContent = w.display;
					node.classList.toggle('is-said', i < said);
				}
			});
			return `${c}-${said}`;
		},
	};
}

/** pr-studio's progress line at the bottom (.st-progress of studio.css). */
export function progressLine(parent, DATA) {
	const track = document.createElement('div');
	track.className = 'st-progress';
	const fill = document.createElement('div');
	fill.className = 'st-progress__fill';
	track.appendChild(fill);
	parent.appendChild(track);
	return { el: track, render(t) { fill.style.width = `${(t / DATA.total * 100).toFixed(3)}%`; } };
}

/** Opacity of a white cut at segment boundaries (0 = none): fades in from white and out to white. */
export function cutOpacity(DATA, seg, t, dur = DATA.timing?.fade ?? 0.2) {
	const local = t - seg.start, left = seg.end - t;
	const first = seg === DATA.segments[0], last = seg === DATA.segments.at(-1);
	return Math.max(first ? 0 : 1 - ease(local / dur), last ? 0 : left < dur ? ease((dur - left) / dur) : 0);
}

/** A file URL of a shared asset (shared/assets/<name>). */
export function asset(DATA, name) {
	return `${DATA.assets}/${name}`;
}
