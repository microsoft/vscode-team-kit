// Shared helpers for catalog treatments.
import { heading } from '../theme/primitives.js';
import { lerp } from '../engine/motion.js';

/** Slide heading from params { eyebrow, title, tag, tagAt, tagTone, tagMono }. */
export function header(root, p, ctx) {
	if (!p.title) {
		throw new Error('title is required');
	}
	const h = heading(root, { eyebrow: p.eyebrow, title: p.title, tag: p.tag, tagTone: p.tagTone ?? 'purple', tagMono: p.tagMono ?? false });
	h.layout();
	const tagAt = p.tag ? ctx.at(p.tagAt, 0.5) : undefined;
	return {
		...h,
		render(t) {
			h.render(t, ctx.beat.start, tagAt);
		},
	};
}

/**
 * Times for a list of items: an item's own `at` when given, otherwise spread evenly over the beat
 * (from `lead` seconds after it starts to `tail` seconds before it ends).
 */
export function spread(ctx, items, { lead = 0.8, tail = 1.2, key = 'at' } = {}) {
	const s = ctx.beat.start + lead;
	const e = Math.max(s + 0.4, ctx.beat.end - tail);
	return items.map((item, i) => (item?.[key] !== undefined && item?.[key] !== null
		? ctx.at(item[key])
		: items.length === 1 ? s : lerp(s, e, i / (items.length - 1))));
}

/** Optional time: the param's time when present, else the fallback (seconds after the beat starts, or a ref). */
export function when(ctx, ref, fallback) {
	return ctx.at(ref ?? undefined, fallback);
}

export function need(cond, message) {
	if (!cond) {
		throw new Error(message);
	}
}

/** Even x positions for n items between x0 and x1 (centers). */
export function columnsX(n, x0, x1) {
	if (n === 1) {
		return [(x0 + x1) / 2];
	}
	return Array.from({ length: n }, (_, i) => x0 + (i * (x1 - x0)) / (n - 1));
}
