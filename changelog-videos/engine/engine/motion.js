// Easing and timing. Everything on screen is a pure function of time t (no CSS transitions, no requestAnimationFrame),
// so any frame can be rendered alone, in any order, and identical frames can be detected and skipped.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const prog = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

function cubicBezier(x1, y1, x2, y2) {
	const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
	const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
	const sx = u => ((ax * u + bx) * u + cx) * u;
	const sy = u => ((ay * u + by) * u + cy) * u;
	const dx = u => (3 * ax * u + 2 * bx) * u + cx;
	return x => {
		if (x <= 0) {
			return 0;
		}
		if (x >= 1) {
			return 1;
		}
		let u = x;
		for (let i = 0; i < 8; i++) {
			const d = dx(u);
			if (Math.abs(d) < 1e-6) {
				break;
			}
			u -= (sx(u) - x) / d;
		}
		return sy(clamp(u));
	};
}

/** Fluent motion curves: decelerate (entrances), standard (moves), accelerate (exits). */
export const decel = cubicBezier(0.1, 0.9, 0.2, 1);
export const standard = cubicBezier(0.8, 0, 0.2, 1);
export const accel = cubicBezier(0.9, 0.1, 1, 0.2);
export const easeInOutCubic = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Fade + slide in at `at`. Returns the eased progress (0..1). */
export function enter(node, t, at, { dur = 0.6, dy = 14, dx = 0, scale = 0, from = 0 } = {}) {
	const p = decel(prog(t, at, at + dur));
	node.style.opacity = String(lerp(from, 1, p));
	node.style.transform = `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px)${scale ? ` scale(${1 - (1 - p) * scale})` : ''}`;
	return p;
}

/** Fade out at `at` (multiplies the current opacity). */
export function leave(node, t, at, { dur = 0.4, to = 0 } = {}) {
	const p = standard(prog(t, at, at + dur));
	node.style.opacity = String(Number(node.style.opacity || 1) * lerp(1, to, p));
	return p;
}

/** A number that counts up with an ease-out. */
export function count(t, at, dur, to, from = 0) {
	return Math.round(lerp(from, to, decel(prog(t, at, at + dur))));
}

export const fmt = n => Number(n).toLocaleString('en-US');
