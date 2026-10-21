// The changelog digest: its times (phrases of the narration, demo marks, steps) and the strip's height.
import test from 'node:test';
import assert from 'node:assert/strict';
import { changesADefault, unshownParts, valueChanges, fitZoom, focusShows, iconsOf, inProof, loadSceneDocs, orderStrip, planFocus, proofCorpus, resolveTime, resolveTimes, seenWindows, steadyFrom, stripHeight } from '../cli/lib/digest.mjs';

// A chapter that starts 10 s into the video: "Five. VS Code links can now add a plugin marketplace."
const words = ['Five.', 'VS', 'Code', 'links', 'can', 'now', 'add', 'a', 'plugin', 'marketplace.']
	.map((display, i) => ({ display, a: 10.5 + i * 0.3, b: 10.75 + i * 0.3 }));
const ctx = {
	start: 10, words,
	targets: { dialog: { rect: [415, 254, 450, 212], windows: [[12, 14.5], [16, 18]] } },
	steps: [{ label: 'dialog', at: 12.1 }],
};

test('a time is a phrase of the narration, seconds into the chapter, a mark on screen, or a step', () => {
	assert.deepStrictEqual([
		resolveTime('links', ctx),
		resolveTime('plugin marketplace', ctx),
		resolveTime(0.35, ctx),
		resolveTime({ cue: 'links', offset: -0.15 }, ctx),
		resolveTime({ mark: 'dialog' }, ctx),
		resolveTime({ mark: 'dialog', edge: 'end', nth: 1, offset: -0.2 }, ctx),
		resolveTime({ step: 'dialog', offset: 0.3 }, ctx),
	], [11.4, 12.9, 10.35, 11.25, 12, 17.8, 12.4]);
});

test('a time that is not in the chapter says where it was looked for', () => {
	assert.throws(() => resolveTime('install', ctx, ' (c5)'), /Cue "install" is not in the narration \(c5\)/);
	assert.throws(() => resolveTime({ mark: 'toast' }, ctx), /Mark "toast" is never on screen \(marks: dialog\)/);
	assert.throws(() => resolveTime({ step: 'done' }, ctx), /Step "done" is not in the demo/);
});

test('only time keys (at, from, until, *At) are resolved, at any depth', () => {
	assert.deepStrictEqual(resolveTimes({
		at: 'links',
		text: 'links',
		rows: [{ id: 'l1', text: 'Add a plugin marketplace', at: { mark: 'dialog' } }],
		params: { swapAt: 'add', label: 'Now', highlights: [{ entry: 1, at: 1 }] },
	}, ctx), {
		at: 11.4,
		text: 'links',
		rows: [{ id: 'l1', text: 'Add a plugin marketplace', at: 12 }],
		params: { swapAt: 12.3, label: 'Now', highlights: [{ entry: 1, at: 11 }] },
	});
});

test('the strip height counts every item and its gap, and a strip of E\'s last chapter fits', () => {
	const c5 = {
		eyebrow: 'VS Code links',
		before: { rows: [{ text: 'Add a plugin marketplace', sub: 'chat-plugin/add-marketplace' }, { text: 'Install a plugin', sub: 'chat-plugin/install' }] },
		now: { rows: [{ text: 'Add Marketplace' }, { text: 'Add Marketplace and Install' }, { text: 'Plugins can run code on your machine.', tone: 'orange' }] },
	};
	const withSetting = { now: { rows: [{ text: 'On by default' }] }, setting: { name: 'a.b', state: 'On by default' } };
	assert.deepStrictEqual([stripHeight(c5), stripHeight(withSetting)], [654, 64 + 76 + 16 + 128]);
});

test('a camera focused on a mark zooms as close as the mark still fits, between 1 and 2', () => {
	// A settings row (wide), a button (small), and a whole window (no zoom).
	assert.deepStrictEqual([fitZoom([353, 210, 774, 97.8]), fitZoom([742, 431, 114, 26]), fitZoom([0, 0, 1280, 720])], [1.41, 2, 1]);
});

test('a chapter\'s strings are the PR\'s: placeholders match the values shown, shortcuts and mnemonics don\'t count', () => {
	const corpus = proofCorpus([
		'+			message: localize(\'confirm\', "Add Marketplace \'{0}\' and Install Plugin \'{1}\'?"),',
		'+			primaryButton: localize({ key: \'installButton\' }, "&&Install"),',
		'+			markdownDescription: nls.localize(\'x\', "Includes the \\`copilot\\` command that ships with VS Code."),',
		'+	title: localize(\'newNested\', "New Nested Session"),',
	].join('\n'));
	assert.deepStrictEqual([
		"Add Marketplace 'github/awesome-copilot' and Install Plugin 'ai-ready'?",
		'Install',
		'Includes the copilot command that ships with VS Code',
		'New Nested Session (⌘T)',
		'New Nested Session (Ctrl+T)',
		'GPT-5',
		'Current-chat choice',
		'',
	].map(t => inProof(corpus, t)), [true, true, true, true, true, false, false, false]);
});

test('a drawn UI must be the PR\'s, and its one arrow goes up only once its row is in and its part is drawn', async () => {
	const kit = await loadSceneDocs();
	const corpus = proofCorpus('+	title: localize(\'newNested\', "New Nested Session"),');
	const sessions = { title: 'Sessions', rows: [{ label: 'Update the README' }], after: { icon: 'add', tooltip: 'New Nested Session' }, hoverAt: 11, tooltipAt: 12, child: { label: 'New Session', at: 14 } };
	const fake = { title: 'Model picker', rows: [{ label: 'Auto', sub: 'Org default' }], after: { icon: 'document', tooltip: 'Org default' }, hoverAt: 11 };
	const spec = (params, focus, extra = {}) => ({ now: { at: 11, rows: [{ id: 'new', text: 'x' }] }, scene: { name: 'list-actions', params }, focus, ...extra });
	const plan = s => planFocus('c2', s, { start: 10, end: 20, targets: {}, kit });
	assert.deepStrictEqual({
		proofs: [sessions, fake].map(p => kit['list-actions'].proofs(p).map(x => inProof(corpus, x.text))),
		// The row is in at 11.6; the tooltip shows 12-14: the arrow 12.25-14.
		tooltip: plan(spec(sessions, 'tooltip')).focus,
		child: plan(spec(sessions, 'child')).focus,
		// The old c4: a tooltip these params never draw rings nothing: no arrow.
		ringsNothing: plan(spec(fake, 'tooltip')).focusProblem !== null,
		card: plan({ now: { at: 11, rows: [{ id: 'new', text: 'x' }] }, scene: { name: 'card', params: { title: 'x' } }, focus: 'title' }).focusProblem !== null,
		noFocus: plan(spec(sessions, undefined)),
	}, {
		proofs: [[true], [false]],
		tooltip: [{ name: 'tooltip', row: 'new', from: 12.25, until: 14, tone: 'green' }],
		child: [{ name: 'child', row: 'new', from: 14.25, until: 20, tone: 'green' }],
		ringsNothing: true,
		card: true,
		noFocus: { focus: [], focusProblem: null, camera: [] },
	});
});

test('a recorded focus gets its arrow only while it shows the proof, once still, after the camera settles', () => {
	// A setting row that slides in (0.0-0.3), then stays; it shows the proof only in its second window (5-9 s).
	const track = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 6, 7, 8, 9].map(t => [t, 100, t < 0.3 ? 300 - t * 300 : 210, 300, 60]);
	const mark = { rect: [100, 210, 300, 60], visible: [[0, 1], [5, 9]], texts: ['Font Size', 'Generate images with GPT Image 2.5 Sunburst'], track };
	const recording = { toVideo: c => 20 + c, cEnd: 9, marks: { row: mark } };
	const spec = proof => ({ now: { at: 21, rows: [{ id: 'on', text: 'Image Generation' }] }, focus: 'row', proof });
	const plan = (s, r = recording) => planFocus('c2', s, { start: 20, end: 32, targets: { row: {} }, kit: {}, demo: {}, clip: {}, recording: r });
	const wholeEditor = { ...recording, marks: { row: { ...mark, rect: [0, 35, 1280, 650] } } };
	assert.deepStrictEqual({
		steady: [steadyFrom(track, 0, 1), steadyFrom(track, 5, 9)],
		withProof: plan(spec('GPT Image 2.5 Sunburst')),
		typedAwayProof: plan(spec('Not shown anywhere')).focusProblem !== null,
		ringsMostOfTheWindow: plan(spec('GPT Image 2.5 Sunburst'), wholeEditor).focusProblem !== null,
	}, {
		steady: [0.6, 5.2],
		// Shown at 25 s in the video, steady at 25.2; the camera zooms in once it is steady (25.1-26.0); the arrow waits
		// until 26.05, and holds to the chapter's end (the window lasts to the recording's end).
		withProof: { focus: [{ name: 'row', row: 'on', from: 26.05, until: 32, tone: 'green' }], focusProblem: null, camera: [{ at: 25.1, dur: 0.9, z: 1.5, fx: 250, fy: 240 }] },
		typedAwayProof: true,
		ringsMostOfTheWindow: true,
	});
});

test('up to three arrows, one at a time: each from its row when its phrase is spoken, in its row\'s color', async () => {
	const kit = await loadSceneDocs();
	// A dialog drawn 10-20 s: its title, its primary button, its highlighted line.
	const params = { title: 'Install Plugin?', detail: 'From github/awesome. **Plugins can run code on your machine.**', buttons: [{ label: 'Cancel' }, { label: 'Install', primary: true }], showAt: 10 };
	const rows = [{ id: 'ask', text: 'Asks first' }, { id: 'go', style: 'button', text: 'Install' }, { id: 'warn', tone: 'orange', text: 'Plugins can run code on your machine.' }];
	const spec = focus => ({ now: { at: 11, rows }, scene: { name: 'dialog', params }, focus });
	const plan = s => planFocus('c5', s, { start: 10, end: 20, targets: {}, kit });
	assert.deepStrictEqual({
		three: plan(spec([{ part: 'dialog', row: 'ask' }, { part: 'primary', row: 'go', at: 14 }, { part: 'highlight', row: 'warn', at: 16.5 }])).focus,
		// The second arrow's phrase comes 0.5 s after the first: the first would last under 1 s.
		tooClose: plan(spec([{ part: 'dialog', row: 'ask', at: 12 }, { part: 'primary', row: 'go', at: 12.5 }])).focusProblem !== null,
		four: plan(spec(['dialog', 'title', 'primary', 'highlight'])).focusProblem !== null,
	}, {
		// The rows are in at 11.6, 11.72, 11.84 (+0.6 each); the dialog is drawn from 10 (+0.25 settle).
		three: [
			{ name: 'dialog', row: 'ask', from: 11.6, until: 13.95, tone: 'green' },
			{ name: 'primary', row: 'go', from: 14, until: 16.45, tone: 'blue' },
			{ name: 'highlight', row: 'warn', from: 16.5, until: 20, tone: 'orange' },
		],
		tooClose: true,
		four: true,
	});
});

test('the camera moves on to a part out of its view, once the arrow before has had its second; a Before row\'s arrow is grey', () => {
	// A slash menu at the bottom (0-4 s of the recording), then the forked session at the top left (6 s to the end).
	const steady = (rect, from, to) => Array.from({ length: Math.round((to - from) * 10) + 1 }, (_, k) => [from + k / 10, ...rect]);
	const menu = { rect: [375, 641, 572, 20], visible: [[0, 4]], texts: [''], track: steady([375, 641, 572, 20], 0, 4) };
	const forked = { rect: [4, 212, 272, 56], visible: [[6, 9]], texts: [''], track: steady([4, 212, 272, 56], 6, 9) };
	const recording = { toVideo: c => 20 + c, cEnd: 9, marks: { menu, forked } };
	const spec = { before: { at: 20.1, rows: [{ id: 'old', text: '/fork' }] }, now: { at: 20.3, rows: [{ id: 'title', text: '/fork <title>' }] }, focus: [{ part: 'menu', row: 'old' }, { part: 'forked', row: 'title', at: 26 }] };
	const { focus, camera } = planFocus('c4', spec, { start: 20, end: 30, targets: {}, kit: {}, demo: {}, clip: {}, recording });
	// A tooltip, then the row it adds at the window's left edge: one view shows both, to the edge.
	const tooltip = { rect: [151.5, 186.5, 165.5, 25], visible: [[0, 4]], texts: [''], track: steady([151.5, 186.5, 165.5, 25], 0, 4) };
	const nested = { rect: [4, 212, 272, 56], visible: [[4.2, 9]], texts: [''], track: steady([4, 212, 272, 56], 4.2, 9) };
	const atTheEdge = planFocus('c2', { now: { at: 20.3, rows: [{ id: 'a', text: 'New Nested Session' }, { id: 'b', text: 'One click', at: 24 }] }, focus: [{ part: 'tooltip', row: 'a' }, { part: 'nested', row: 'b' }] }, { start: 20, end: 30, targets: {}, kit: {}, demo: {}, clip: {}, recording: { toVideo: c => 20 + c, cEnd: 9, marks: { tooltip, nested } } }).camera;
	assert.deepStrictEqual({ focus, camera, atTheEdge }, {
		// The menu's arrow waits for the camera (in on the menu at 20.2, settled at 21.15) and ends as it moves on, when the
		// menu leaves (24); it then frames the menu's place and the forked session together, and that arrow waits for
		// its phrase (26) and for the session to be still (26.45).
		focus: [
			{ name: 'menu', row: 'old', from: 21.15, until: 23.95, tone: 'neutral' },
			{ name: 'forked', row: 'title', from: 26.45, until: 30, tone: 'green' },
		],
		camera: [
			{ at: 20.2, dur: 0.9, z: 1.5, fx: 661, fy: 651 },
			{ at: 24, dur: 0.9, z: 1.154, fx: 475.5, fy: 436.5 },
		],
		atTheEdge: [{ at: 20.2, dur: 0.9, z: 1.5, fx: 160.5, fy: 227.25 }],
	});
});

test('a drawn picker gives a disabled entry\'s reason, and a drawn editor shows only lines of the PR', async () => {
	const kit = await loadSceneDocs();
	// The PR localizes the reason with a link ("[Learn why]({0})"); the scene shows it as text, with its codicon.
	const corpus = proofCorpus('description: localize(\'x\', "Disabled by policy · [Learn why]({0})"); paths.set(\'example.txt\', \'/home/john/Downloads/example.txt\');');
	const picker = kit.picker.proofs({ items: [{ label: 'Copilot' }, { label: 'Local', disabled: true, description: '$(briefcase) Disabled by policy · Learn why' }] });
	const noReason = kit.picker.proofs({ items: [{ label: 'Copilot' }, { label: 'Local', disabled: true }] });
	const editor = kit.editor.proofs({ insert: '/home/john/Downloads/example.txt\n/home/me/made-up.txt' });
	assert.deepStrictEqual({
		picker: picker.map(x => [x.param, inProof(corpus, x.text)]),
		noReason: noReason.map(x => [x.param, x.text]),
		editor: editor.map(x => [x.text, inProof(corpus, x.text)]),
		windows: kit.editor.windows({ insertAt: 12 }, { start: 10, end: 20 }),
	}, {
		picker: [['items[1].description', true]],
		noReason: [['items[1].description', undefined]],
		editor: [['/home/john/Downloads/example.txt', true], ['/home/me/made-up.txt', false]],
		windows: { editor: [10, 20], inserted: [12.05, 20] },
	});
});

test('every icon a chapter uses is found: in rows, heads and scene params', () => {
	assert.deepStrictEqual(iconsOf({
		before: { icon: 'history', rows: [{ id: 'a', icon: 'pin', text: 'Pin' }] },
		now: { rows: [{ id: 'b', style: 'chip', icon: 'github', text: 'Sign in' }, { id: 'c', text: 'No icon' }] },
		visual: { scene: { name: 'list-actions', params: { before: { icon: 'pin' }, after: { icon: 'pulse' }, others: ['check'], rows: [{ label: 'icon' }] } } },
	}), ['history', 'pin', 'github', 'pin', 'pulse', 'check']);
});


test('a drawn setting has VS Code\'s own title, and no invented badge', async () => {
	const kit = await loadSceneDocs();
	assert.deepStrictEqual({
		params: ['title', 'badge'].filter(k => k in kit.setting.params),
		proofs: kit.setting.proofs({ id: 'chat.copilot.ensemble.enabled', title: 'Fusion', description: 'When enabled, Auto is presented as Fusion' }).map(x => x.param),
	}, { params: [], proofs: ['id', 'description'] });
});

test('a toggle flips, and a drawn setting changes its value, only when the PR changes a default', async () => {
	const kit = await loadSceneDocs();
	const flips = p => kit.setting.changesDefault(p);
	const claims = ch => valueChanges(ch, kit).length;
	assert.deepStrictEqual({
		flips: [flips({ before: false, after: true }), flips({ after: true }), flips({ before: true, after: true }), flips({ kind: 'text', before: 'a', after: 'b' })],
		claims: [
			claims({ now: { rows: [{ text: 'On', toggle: 'flip' }] } }),
			claims({ before: { rows: [{ text: 'Off', toggle: 'off' }] }, now: { rows: [{ text: 'On', toggle: 'on' }] } }),
			claims({ now: { rows: [{ text: 'On', toggle: 'on' }] }, setting: { name: 'x', state: 'On', toggle: 'on' } }),
			claims({ now: { rows: [{ text: 'Fusion' }] }, setting: { name: 'x', state: 'Fusion', toggle: 'flip' } }),
			claims({ now: { rows: [{ text: 'Fusion' }] }, visual: { scene: { name: 'setting', params: { id: 'x', before: false, after: true } } } }),
		],
		defaults: [
			'+\t\tdefault: isImageGenerationEnabledByDefault(product.quality),',
			'+      "default": true,',
			'+export const SESSIONS_APPLICATION_BADGE_DEFAULT = true;',
			'+\t\tdefault: return getAutoModeTierLabel(tier);',
			'+\t\tdefault:',
			'+\tconst defaultChat = buildDefaultChatUri(session);',
			'-\t\tdefault: false,',
			' \t\tdefault: false,',
		].map(changesADefault),
	}, {
		flips: [true, false, false, true],
		claims: [1, 1, 0, 1, 1],
		// A setting's default added or changed, or a default constant, counts; a switch's default case, a variable that
		// merely starts with "default", a removed or unchanged line doesn't.
		defaults: [true, true, true, false, false, false, false, false],
	});
});

test('a demo chapter\'s Now rows say what the recording shows, not words of the PR it doesn\'t show', () => {
	const corpus = proofCorpus('"When enabled, Auto is presented as Fusion, optimizing for Lite, Balance, or Max."');
	const demo = { marks: { row: { texts: ['Chat › Copilot › Ensemble: Enabled When enabled, Copilot Agent Host sessions present Auto as Fusion, which optimizes for Standard, High, or Max.'] } } };
	const ch = { now: { rows: [{ id: 'new', text: 'Fusion' }, { id: 'tiers', text: 'Lite · Balance · Max', changed: false }, { id: 'on', text: 'On in Insiders' }] } };
	// "On in Insiders" isn't the PR's text (a summary): only the PR's words are held to the recording.
	assert.deepStrictEqual(unshownParts(ch, demo, corpus), ['Lite', 'Balance']);
});

test('the strip comes in top to bottom: Before ahead of Now, even when the narration names it after', () => {
	const times = spec => {
		orderStrip(spec);
		const r2 = x => Math.round(x * 100) / 100;
		return { before: r2(spec.before.at), old: spec.before.rows.map(r => r2(r.at)), now: spec.now.rows.map(r => r2(r.at)), setting: spec.setting && r2(spec.setting.at) };
	};
	assert.deepStrictEqual([
		// "Fusion, instead of Ensemble": Before's phrase (30 s) is after Now's (25 s); a row and the setting named early.
		times({ before: { at: 30, rows: [{ id: 'old' }] }, now: { at: 25, rows: [{ id: 'new' }, { id: 'n2', at: 24 }] }, setting: { at: 20 } }),
		times({ before: { at: 21, rows: [{ id: 'old' }] }, now: { at: 25, rows: [{ id: 'new' }] } }),
	], [
		{ before: 24.4, old: [24.55], now: [25, 25], setting: 25.2 },
		{ before: 21, old: [21.15], now: [25], setting: undefined },
	]);
});

test('a recording starts 1.2 s before its focus first shows the proof: how the demo got there is cut', () => {
	const demo = { marks: { row: { visible: [[0.5, 1], [7.03, 11]], texts: ['Commonly Used', 'Enable image generation with GPT Image 2.5 Sunburst'] } } };
	assert.deepStrictEqual([
		focusShows(demo, { focus: 'row', proof: 'GPT Image 2.5 Sunburst' }),
		focusShows(demo, { focus: 'row' }),
		focusShows(demo, { focus: 'missing' }),
	], [5.83, 0, 0]);
});


test('an arrow ends where its mark was last seen: its ring never stays on a picker that closed at the clip\'s end', () => {
	const seen = (rect, from, to) => Array.from({ length: Math.round((to - from) * 10) + 1 }, (_, k) => [Math.round((from + k / 10) * 100) / 100, ...rect]);
	const rect = [100, 100, 300, 40];
	// As recordings were logged before: the closing picker's window ends at the first sample that missed it (9.1).
	const demo = seenWindows({
		duration: 10.37, marks: {
			closing: { rect, visible: [[3, 9.1]], texts: [''], track: seen(rect, 3, 9) },
			staying: { rect, visible: [[3, 10.37]], texts: [''], track: seen(rect, 3, 10.3) },
		},
	});
	const plan = part => planFocus('c5', { now: { at: 21, rows: [{ id: 'on', text: 'Copilot Global' }] }, focus: part }, { start: 20, end: 31, targets: {}, kit: {}, demo: {}, clip: {}, recording: { toVideo: c => 20 + c, cEnd: 9.05, marks: demo.marks } });
	assert.deepStrictEqual({
		windows: [demo.marks.closing.visible, demo.marks.staying.visible],
		// The clip ends at 9.05 s: the closing picker was last seen at 9.0 s, so its arrow ends there (29 s), not in the
		// hold on the last frame; the one still there at the end is held to the chapter's end (31 s).
		until: [plan('closing').focus[0]?.until, plan('staying').focus[0]?.until],
	}, {
		windows: [[[3, 9]], [[3, 10.37]]],
		until: [29, 31],
	});
});

test('a recorded mark on screen to the recording\'s end keeps its last box through the hold on the last frame', async () => {
	const { trackBoxAt } = await import('../digest/track.js');
	// On screen 7-11.23 s; the last sample is at 10.8 s (the recorder stops sampling a few tenths before the end).
	const mark = { visible: [[7, 11.23]], track: [[7, 1, 2, 3, 4], [10.8, 5, 6, 7, 8]] };
	assert.deepStrictEqual([trackBoxAt(mark, 11.2), trackBoxAt(mark, 6.5), trackBoxAt(mark, 7.1)], [[5, 6, 7, 8], null, [1, 2, 3, 4]]);
});
