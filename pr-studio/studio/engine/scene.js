// Authoring API for videos/<slug>/scenes.js and for catalog treatments. Pure (no DOM at definition time),
// so prs can import a scenes file in Node to verify its text and collect its code references.

/** What a beat has to explain. Every treatment serves one need; the direction picker matches beats to treatments by it. */
export const NEEDS = {
	title: 'the fixed opening frame (always the first beat)',
	concept: 'a problem, a mismatch or a few ideas side by side',
	exchange: 'messages between parties: a protocol, a handshake, a request and its reply',
	flow: 'steps in order: a pipeline, a process, a branch',
	rules: 'a rule applied to cases: validation, filtering, permissions',
	compare: 'behavior before and after the change',
	architecture: 'where the change reaches: components, processes, layers',
	code: 'the code itself: the key lines, a diff, old next to new',
	numbers: 'sizes and counts: files, lines, measurements',
	state: 'states and transitions: a lifecycle, a state machine',
	ui: 'something the user sees: a UI element, a message, a setting',
	status: 'scope, tests and what is still open',
};

export const MOTION_MODES = {
	slides: 'one slide per beat; the next appears after the last has gone',
	canvas: 'one big board; the camera flies from beat to beat (layout: row, column or grid)',
	morph: 'slides, plus one object (a token, a file, a request) that flies from beat to beat',
};

/** A video: beats keyed by the storyboard beat ids, the motion mode, and (for morph) the carried object. */
export function defineVideo(spec) {
	if (!spec || typeof spec !== 'object' || !spec.beats) {
		throw new Error('defineVideo({ motion, beats }) needs a beats object keyed by storyboard beat id');
	}
	const motion = spec.motion ?? 'slides';
	if (!Object.hasOwn(MOTION_MODES, motion)) {
		throw new Error(`Unknown motion mode "${motion}" (one of ${Object.keys(MOTION_MODES).join(', ')})`);
	}
	for (const [id, beat] of Object.entries(spec.beats)) {
		if (!beat || beat.$beat !== true) {
			throw new Error(`Beat "${id}" must be a catalog treatment call, for example exchange.lifelines({ ... })`);
		}
	}
	const layout = spec.layout ?? 'row';
	if (!['row', 'column', 'grid'].includes(layout)) {
		throw new Error(`Unknown canvas layout "${layout}" (row, column or grid)`);
	}
	if (motion === 'morph' && !spec.carry) {
		throw new Error('motion: "morph" needs carry: { text, icon, anchors: { beatId: anchorName } }');
	}
	return { $video: true, motion, layout, carry: spec.carry ?? null, beats: spec.beats };
}

/**
 * Defines a catalog treatment. Returns a factory: params -> beat spec.
 * def: { id, need, name, when, demo, region?: 'content'|'full', mount(root, params, ctx), render(instance, t, ctx) }
 */
export function defineTreatment(def) {
	for (const key of ['id', 'need', 'name', 'when', 'mount', 'render']) {
		if (!def[key]) {
			throw new Error(`Treatment ${def.id ?? '?'} is missing ${key}`);
		}
	}
	if (!Object.hasOwn(NEEDS, def.need)) {
		throw new Error(`Treatment ${def.id} has unknown need ${def.need}`);
	}
	const factory = (params = {}) => ({ $beat: true, treatment: def.id, need: def.need, params, impl: def });
	factory.meta = { id: def.id, need: def.need, name: def.name, when: def.when, demo: def.demo ?? null, params: def.params ?? null };
	return factory;
}

/** Timing references usable in any `at`: a cue name ('step1'), word('401'), cue('step1', 0.4), or seconds after the beat starts (1.2). */
export const word = (text, opts = {}) => ({ $word: String(text), nth: opts.nth ?? 0, offset: opts.offset ?? 0 });
export const cue = (name, offset = 0) => ({ $cue: String(name), offset });
