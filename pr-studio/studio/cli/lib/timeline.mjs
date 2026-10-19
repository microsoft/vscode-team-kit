// Narration text helpers shared by prs check, the provisional timeline and prepare.
// They mirror voice/voice.py so cues resolve the same way before and after the real voice exists.
import { getPath, formatFact } from '../../engine/text.js';

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
export const normalizeToken = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** {{facts.additions}} or {{facts.additions|n}} -> value from pr.json facts. */
export function resolvePlaceholders(text, facts) {
	return text.replace(PLACEHOLDER, (_, expr) => {
		const [p, fmt] = expr.trim().split('|');
		const parts = p.trim().split('.');
		if (parts[0] !== 'facts' || parts.length < 2) {
			throw new Error(`Invalid placeholder {{${expr}}}: use {{facts.<path>}}`);
		}
		const value = getPath(facts, parts.slice(1).join('.'));
		if (value === undefined) {
			throw new Error(`Placeholder {{${expr}}} is not in pr.json facts`);
		}
		return fmt === 'n' ? formatFact(value, 'n') : String(value);
	});
}

/** Display tokens of a beat's narration (what the captions show). */
export function displayTokens(say, facts) {
	return resolvePlaceholders(say, facts).split(/\s+/).filter(Boolean);
}

/** Index of the nth occurrence of a phrase among the tokens; throws with the beat's words when missing. */
export function findPhrase(tokens, phrase, nth = 0) {
	const want = String(phrase).split(/\s+/).map(normalizeToken).filter(Boolean);
	if (!want.length) {
		throw new Error(`Cue phrase "${phrase}" has no words`);
	}
	const hay = tokens.map((t, i) => [i, normalizeToken(t)]).filter(([, t]) => t);
	const hits = [];
	for (let s = 0; s + want.length <= hay.length; s++) {
		if (want.every((w, k) => hay[s + k][1] === w)) {
			hits.push(hay[s][0]);
		}
	}
	if (nth >= hits.length) {
		throw new Error(`Cue phrase "${phrase}" (occurrence ${nth}) is not in: ${tokens.join(' ')}`);
	}
	return hits[nth];
}

export function cueSpec(value, facts) {
	if (typeof value === 'string') {
		return { phrase: resolvePlaceholders(value, facts), nth: 0, offset: 0 };
	}
	if (value && typeof value.phrase === 'string') {
		return { phrase: resolvePlaceholders(value.phrase, facts), nth: value.nth ?? 0, offset: value.offset ?? 0 };
	}
	throw new Error(`Cue must be a phrase or { phrase, nth, offset }: ${JSON.stringify(value)}`);
}

/**
 * A provisional timeline from word lengths, so visuals can be built before the voice exists.
 * Same shape as build/timeline.json; replaced by the real one once `prs voice` finishes.
 * `pace` speeds up the words and their pauses as voice.pace does the takes; the gaps between beats stay.
 */
export function estimateTimeline(storyboard, facts, { leadIn = 0.6, gap = 0.35, tail = 2.5, pace = 1 } = {}) {
	let t = leadIn;
	const beats = storyboard.beats.map((beat, k) => {
		if (k) {
			t += beat.gapBefore ?? gap;
		}
		const tokens = displayTokens(beat.say, facts);
		const start = t;
		const words = tokens.map((display, i) => {
			const core = normalizeToken(display);
			const dur = (0.13 + 0.052 * Math.max(2, core.length) + (/\d/.test(core) ? 0.12 * core.length : 0)) / pace;
			const a = t;
			t += dur;
			const b = t;
			if (/[.!?;:]["')\u201d]*$/.test(display)) {
				t += 0.32 / pace;
			} else if (/,["')\u201d]*$/.test(display)) {
				t += 0.16 / pace;
			}
			return { i, display, spoken: display, a: +a.toFixed(3), b: +b.toFixed(3) };
		});
		// A hold keeps the beat on screen after its last word, in silence, so what it shows can be read.
		const end = words.at(-1).b + (beat.hold ?? 0);
		t = Math.max(t, end);
		const cues = {};
		for (const [name, value] of Object.entries(beat.cues ?? {})) {
			const spec = cueSpec(value, facts);
			cues[name] = +(words[findPhrase(tokens, spec.phrase, spec.nth)].a + spec.offset).toFixed(3);
		}
		return { id: beat.id, start: +start.toFixed(3), end: +end.toFixed(3), text: tokens.join(' '), words, cues };
	});
	return { total: +(t + tail).toFixed(3), estimated: true, beats };
}

/** Rough spoken length of a storyboard, for the length window check. */
export function estimateSeconds(storyboard, facts) {
	return estimateTimeline(storyboard, facts).total;
}
