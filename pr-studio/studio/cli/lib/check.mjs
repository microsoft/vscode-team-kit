// prs check: is the storyboard ready for the voice? Length cap, needs, cues, placeholders, evidence, pronunciation.
import path from 'node:path';
import { CAP, readJson, videoDir, voicePace } from './common.mjs';
import { displayTokens, estimateTimeline, findPhrase, cueSpec } from './timeline.mjs';
import { checkEvidence } from './evidence.mjs';
import { NEEDS } from '../../engine/scene.js';

const SPEAKABLE_HINT = /^[a-z]+[A-Z]\w*$|^[A-Z]{3,}s?$|^\w+\.\w+$/;

export async function checkStory(slug) {
	const vdir = videoDir(slug);
	const sb = readJson(path.join(vdir, 'storyboard.json'));
	const pr = readJson(path.join(vdir, 'pr.json'));
	const facts = pr.facts;
	const errors = [], warnings = [];
	const ids = new Set();
	sb.beats.forEach((b, k) => {
		if (!/^[A-Za-z][\w-]*$/.test(b.id ?? '')) {
			errors.push(`beat ${k + 1}: id must be a word (letters, digits, - or _)`);
		}
		if (ids.has(b.id)) {
			errors.push(`beat ${b.id}: duplicate id`);
		}
		ids.add(b.id);
		if (!Object.hasOwn(NEEDS, b.need ?? '')) {
			errors.push(`beat ${b.id}: need "${b.need}" is not one of ${Object.keys(NEEDS).join(', ')}`);
		}
		if (b.hold !== undefined && !(typeof b.hold === 'number' && b.hold > 0 && b.hold <= 5)) {
			errors.push(`beat ${b.id}: "hold" is the seconds the beat stays up after its last word, more than 0 and at most 5`);
		}
		if (!b.say || /TODO/.test(b.say)) {
			errors.push(`beat ${b.id}: write the narration ("say")`);
			return;
		}
		let tokens = [];
		try {
			tokens = displayTokens(b.say, facts);
		} catch (error) {
			errors.push(`beat ${b.id}: ${error.message}`);
			return;
		}
		for (const [name, value] of Object.entries(b.cues ?? {})) {
			try {
				const spec = cueSpec(value, facts);
				findPhrase(tokens, spec.phrase, spec.nth);
				// A phrase said twice cues the first time unless nth says otherwise (counted from 0).
				let times = 0;
				try {
					while (findPhrase(tokens, spec.phrase, times) !== undefined) {
						times++;
					}
				} catch {
					// No more.
				}
				if (times > 1 && typeof value === 'string') {
					warnings.push(`beat ${b.id}: cue "${name}": "${spec.phrase}" is said ${times} times and cues the first; for another, write { "phrase": "${spec.phrase}", "nth": 1 } (counted from 0)`);
				}
			} catch (error) {
				errors.push(`beat ${b.id}: cue "${name}": ${error.message}`);
			}
		}
		const pron = Object.keys(sb.pronounce ?? {});
		if (b.need === 'title' || b.need === 'status') {
			const sentences = tokens.filter(t => /[.!?]["')\u201d]*$/.test(t)).length;
			if (sentences > 1) {
				warnings.push(`beat ${b.id}: ${sentences} sentences; the ${b.need} beat says one, the screen carries the rest`);
			}
		}
		const shown = b.need === 'title' ? [...b.say.matchAll(/\{\{facts\.(number|additions|deletions|changedFiles|commitCount|authorName|authorLogin)\b/g)].map(m => m[1]) : [];
		if (shown.length) {
			warnings.push(`beat ${b.id}: the title card shows ${[...new Set(shown)].join(', ')}: say what the PR does instead`);
		}
		const odd = [...new Set(tokens.map(t => t.replace(/^[^\w]+|[^\w]+$/g, '')).filter(t => SPEAKABLE_HINT.test(t) && !pron.some(p => p.split(/\s+/).includes(t))))];
		if (odd.length) {
			warnings.push(`beat ${b.id}: check how these are spoken (add to "pronounce" if needed): ${odd.join(', ')}`);
		}
		if (k > 0 && k < sb.beats.length - 1 && !(b.claims ?? []).length) {
			warnings.push(`beat ${b.id}: no claims with evidence; the reviewer will ask where each statement comes from`);
		}
		if (b.claims !== undefined && !Array.isArray(b.claims)) {
			errors.push(`beat ${b.id}: claims is a list: [{ "text": "what is stated", "evidence": [...] }, ...]`);
			return;
		}
		for (const claim of b.claims ?? []) {
			if (typeof claim?.text !== 'string' || !Array.isArray(claim.evidence) || !claim.evidence.length) {
				errors.push(`beat ${b.id}: a claim is { "text": "what is stated", "evidence": [{ "file", "anchor" }, { "body" }, ...] }, with evidence: ${JSON.stringify(claim).slice(0, 100)}`);
				continue;
			}
			for (const ev of claim.evidence) {
				const issue = checkEvidence(slug, pr, ev);
				if (issue) {
					errors.push(`beat ${b.id}: ${issue}`);
				}
			}
		}
	});
	if (sb.beats[0]?.need !== 'title') {
		errors.push('the first beat must be the title beat (need: "title")');
	}
	if (sb.beats.at(-1)?.need !== 'status') {
		warnings.push('the last beat is usually the status beat (scope, tests, what is open, where to start reading)');
	}
	let seconds = null;
	if (!errors.length) {
		// Where the last word should end, as prs voice measures it (not the file's length, which adds the end card).
		const estimate = estimateTimeline(sb, facts, { pace: voicePace() });
		seconds = estimate.beats.at(-1)?.end ?? estimate.total;
		const words = sb.beats.reduce((a, b) => a + displayTokens(b.say, facts).length, 0);
		const msg = `the last word should end at about ${Math.round(seconds)} s (${words} words; an estimate: prs voice measures it)`;
		if (seconds > CAP.seconds) {
			errors.push(`${msg}, past the ${CAP.seconds} s cap (${CAP.fileSeconds} s with the end card): cut what answers none of the six questions, and what the screen already shows`);
		} else {
			console.log(`length: ${msg}, within the ${CAP.seconds} s cap`);
		}
	}
	for (const w of warnings) {
		console.log(`warning: ${w}`);
	}
	for (const e of errors) {
		console.log(`error: ${e}`);
	}
	console.log(errors.length ? `storyboard: ${errors.length} error${errors.length > 1 ? 's' : ''}` : 'storyboard: ready (next: prs direct, then prs voice)');
	return !errors.length;
}
