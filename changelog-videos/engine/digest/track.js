// Where a recorded mark is in a frame of its recording: shared by `prs digest` (Node) and the player (the page).

/**
 * The mark's tracked box ([x, y, w, h], window pixels) at t (seconds of the recording): the nearest sample of the
 * window it is on screen in at t (a window lasts until it stops being on screen, or to the recording's end: its last
 * sample can be a few tenths of a second earlier), or null when it isn't on screen then.
 */
export function trackBoxAt(mark, t) {
	const w = mark?.visible?.find(([a, b]) => t >= a - 0.05 && t <= b + 0.05);
	if (!w) {
		return null;
	}
	let best = null;
	for (const s of mark.track ?? []) {
		if (s[0] >= w[0] - 0.05 && s[0] <= w[1] + 0.05 && (!best || Math.abs(s[0] - t) < Math.abs(best[0] - t))) {
			best = s;
		}
	}
	return best ? best.slice(1) : null;
}
