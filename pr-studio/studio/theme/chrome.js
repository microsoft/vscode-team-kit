// Fixed chrome: the repo reference (top left), the beat counter (top right) and the progress line.
// The progress line is drawn by ffmpeg in the final render; here only for stills and lint (mode=all).
import { el, txt } from './primitives.js';
import { C } from './tokens.js';
import { decel, prog, clamp } from '../engine/motion.js';
import { fact, label } from '../engine/text.js';

export function chrome(parent, timing, { movingAt = () => 0 } = {}) {
	const root = el('div', 'st-chrome st-layer', parent);
	const ref = txt(root, [fact('repo'), label('  ·  PR #'), fact('number')], 'st-abs', { left: 96, top: 40, fontSize: 19, fontWeight: 600, color: C.muted, whiteSpace: 'pre' });
	const counter = txt(root, label('00 / 00'), 'st-abs', { right: 96, top: 40, fontSize: 18, fontWeight: 600, color: C.muted, letterSpacing: '.14em', whiteSpace: 'nowrap' });
	const track = el('div', 'st-progress', parent);
	const fill = el('div', 'st-progress__fill', track);
	const { beats, endAt, total } = timing;
	const count = beats.length;
	return {
		render(t) {
			const base = count > 1 ? decel(prog(t, beats[1].start - 0.1, beats[1].start + 0.5)) * (1 - decel(prog(t, endAt - 0.25, endAt + 0.2))) : 0;
			const show = base * (1 - Math.min(1, movingAt(t) * 3));
			ref.style.opacity = String(show);
			counter.style.opacity = String(show);
			let k = 0;
			for (let i = 0; i < count; i++) {
				if (t >= beats[i].start - 0.1) {
					k = i;
				}
			}
			counter.textContent = `${String(k + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`;
			fill.style.width = `${clamp(t / total) * 100}%`;
		},
	};
}
