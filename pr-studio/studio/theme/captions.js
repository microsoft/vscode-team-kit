// Captions: one line per phrase, built from the aligned words. Spoken words turn from faint to ink.
// In the final render they are captured once per state and composited by ffmpeg (see cli/lib/render.mjs).
import { el } from './primitives.js';

/** Splits the aligned words into one-line phrases: break at punctuation, after at most 9 words (evenly), at a long
 * pause, or when too wide. */
export function buildChunks(beats, font = '600 34px Aptos, "Segoe UI", Inter', maxWidth = 1560) {
	const measure = document.createElement('canvas').getContext('2d');
	measure.font = font;
	const chunks = [];
	for (const beat of beats) {
		const words = beat.words ?? [];
		let chunk = [];
		const flush = () => {
			if (chunk.length) {
				chunks.push({ start: chunk[0].a, end: chunk.at(-1).b, words: chunk });
				chunk = [];
			}
		};
		const ends = word => /[.!?;:,]["')\u201d]*$/.test(word.display);
		// A phrase longer than 9 words splits evenly (10 words make 5 + 5, not 9 + 1): no one-word captions.
		let size = 9;
		for (const [index, word] of words.entries()) {
			if (typeof word.display !== 'string' || !Number.isFinite(word.a) || !Number.isFinite(word.b) || word.b < word.a) {
				throw new Error(`Invalid caption word in beat "${beat.id}" at index ${index}`);
			}
			if (!chunk.length) {
				let last = index;
				while (last < words.length - 1 && !ends(words[last])) {
					last++;
				}
				const run = last - index + 1;
				size = run > 9 ? Math.ceil(run / Math.ceil(run / 9)) : 9;
			}
			const candidate = [...chunk, word].map(item => item.display).join(' ');
			if (chunk.length && measure.measureText(candidate).width > maxWidth) {
				flush();
			}
			chunk.push(word);
			const next = words[index + 1];
			if (chunk.length >= size || ends(word) || !next || (chunk.length >= 6 && next.a - word.b > 0.28)) {
				flush();
			}
		}
	}
	for (const [index, chunk] of chunks.entries()) {
		chunk.end = Math.min(chunk.end + 0.18, chunks[index + 1]?.start ?? Infinity);
	}
	return chunks;
}

/** Number of words already said at time t (the same rule the renderer uses to enumerate caption states). */
export function saidCount(chunk, t) {
	let n = 0;
	for (const word of chunk.words) {
		if (t >= word.a - 0.02) {
			n++;
		}
	}
	return n;
}

export function captions(parent, chunks) {
	const layer = el('div', 'st-captions', parent);
	const pill = el('div', 'st-captions__pill', layer);
	pill.dataset.box = 'captions';
	pill.dataset.src = 'narration';
	const pool = Array.from({ length: 16 }, () => el('span', 'st-captions__w', pill));
	return {
		chunks,
		/** Shows chunk c with s words said; -1 hides the captions. */
		show(c, s) {
			const chunk = chunks[c];
			layer.style.opacity = chunk ? '1' : '0';
			if (!chunk) {
				return;
			}
			pool.forEach((node, i) => {
				const word = chunk.words[i];
				node.style.display = word ? 'inline' : 'none';
				if (word) {
					node.textContent = word.display;
					node.classList.toggle('is-said', i < s);
				}
			});
		},
		/** State (chunk index, words said) at time t. */
		stateAt(t) {
			const c = chunks.findIndex(chunk => t >= chunk.start && t < chunk.end);
			return c < 0 ? { c: -1, s: 0 } : { c, s: saidCount(chunks[c], t) };
		},
		render(t) {
			const { c, s } = this.stateAt(t);
			this.show(c, s);
		},
	};
}
