// prs smoke: a short video of a made-up PR, made end to end (voice, prepare, lint, render, encode, captions,
// sync gate) with timings. It checks a machine (a laptop, CI, the cloud agent) and never touches the gallery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, buildDir, videoDir, writeJson } from './common.mjs';
import { DEMO_DIFF, DEMO_SOURCE, demoFacts } from './catalog.mjs';

const SLUG = '_smoke';

const STORYBOARD = {
	pr: { repo: 'contoso/example', number: 1234 },
	length: { seconds: [20, 45], words: [50, 110] },
	pronounce: { '1234': 'twelve thirty-four', octocat: 'octo cat' },
	beats: [
		{
			id: 'title', need: 'title',
			say: 'Pull request {{facts.number}}, by {{facts.authorLogin}}: cache the settings, and refresh them when the file changes. {{facts.additions}} lines in {{facts.changedFiles}} files.',
			cues: { author: 'by', stats: '{{facts.additions}}', state: '{{facts.changedFiles}}' }, claims: [],
		},
		{
			id: 'change', need: 'code',
			say: 'The key change is one condition. The cached value is returned only while the file is not stale, and the cache now remembers when the file last changed.',
			cues: { guard: 'not stale', version: 'remembers' }, claims: [],
		},
		{
			id: 'read', need: 'flow',
			say: 'So every read takes the same path: look in the cache, check the time stamp, and parse the file again only when it changed.',
			cues: { cache: 'look in the cache', stamp: 'time stamp', parse: 'parse the file' }, claims: [],
		},
		{
			id: 'status', need: 'status',
			say: 'Unit tests cover the cache. To review it, start with the guard in the get method.',
			cues: { tests: 'Unit tests', start: 'start with' }, claims: [],
		},
	],
};

const SCENES = `// The smoke test's video (prs smoke): a made-up PR, written by hand.
import { defineVideo } from '../../engine/scene.js';
import { label, code } from '../../engine/text.js';
import { code as codeT, flow, status, title } from '../../catalog/index.js';

export default defineVideo({
	motion: 'slides',
	beats: {
		title: title.frame({ headline: label('Cache Settings, Refresh on Change') }),
		change: codeT.diff({
			eyebrow: label('The change'), title: label('Return the cached value only while it is fresh'),
			hunk: code('demo/src/cache.ts', { diff: true, anchor: 'isStale' }),
			callouts: [{ line: 5, text: label('skip a stale value'), tone: 'green', at: 'guard' }, { line: 10, text: label('remember when the file changed'), tone: 'blue', at: 'version' }],
		}),
		read: flow.pipeline({
			eyebrow: label('Every read'), title: label('One path, and parsing only when needed'),
			stages: [{ icon: 'search', title: label('Look in the cache'), sub: label('the value in memory'), at: 'cache' }, { icon: 'clock', title: label('Check the time stamp'), sub: label('has the file changed?'), at: 'stamp' }, { icon: 'documentText', title: label('Parse again'), sub: label('only when it changed'), at: 'parse' }],
		}),
		status: status.checklist({
			eyebrow: label('Before you review'), title: label('Tested, and where to start'),
			items: [{ icon: 'beaker', tone: 'green', title: label('Unit tests'), sub: label('for the cache'), at: 'tests' }, { icon: 'checkmark', tone: 'blue', title: label('One file changes behavior'), sub: label('the rest is tests and wiring') }],
			read: { label: label('Start here'), refs: [{ code: code('demo/src/cache.ts', { anchor: 'isStale' }), title: label('The guard'), what: label('where a stale value is skipped'), at: 'start' }] },
		}),
	},
});
`;

/** Make the smoke video from scratch; returns { ok, mp4, seconds }. */
export async function smoke({ provider } = {}) {
	const vdir = videoDir(SLUG), bdir = buildDir(SLUG);
	fs.rmSync(vdir, { recursive: true, force: true });
	const facts = demoFacts();
	fs.mkdirSync(path.join(bdir, 'src', facts.headSha9, 'demo', 'src'), { recursive: true });
	fs.writeFileSync(path.join(bdir, 'src', facts.headSha9, 'demo', 'src', 'cache.ts'), DEMO_SOURCE);
	fs.writeFileSync(path.join(vdir, 'pr.diff'), DEMO_DIFF);
	writeJson(path.join(vdir, 'pr.json'), { facts, body: 'Caches settings in memory and refreshes them when the file changes.', symbols: [], tests: [], tier: { name: 'small', seconds: [20, 45], words: [50, 110], beats: 4, reasons: [] } });
	writeJson(path.join(vdir, 'storyboard.json'), STORYBOARD);
	fs.writeFileSync(path.join(vdir, 'scenes.js'), SCENES);

	const seconds = {};
	const step = async (name, fn) => {
		const t0 = performance.now();
		try {
			return await fn();
		} finally {
			seconds[name] = (performance.now() - t0) / 1000;
		}
	};
	const { voice } = await import('./voice.mjs');
	const { prepare } = await import('./prepare.mjs');
	const { lint } = await import('./lint.mjs');
	const { render } = await import('./render.mjs');
	const { encodeChecked } = await import('./publish.mjs');
	const timeline = await step('voice', () => voice(SLUG, { provider }));
	await step('prepare', () => prepare(SLUG, { quiet: true }));
	const lintOk = await step('lint', () => lint(SLUG));
	await step('render', () => render(SLUG, {}));
	const { out, seconds: checked } = await encodeChecked(SLUG);
	Object.assign(seconds, checked);

	const { launch } = await import('./browser.mjs');
	const { contactSheet, keyTimes } = await import('./stills.mjs');
	const { readJson } = await import('./common.mjs');
	const project = readJson(path.join(bdir, 'project.json'));
	const frames = path.join(bdir, 'frames');
	const images = keyTimes(project).map(k => ({ file: path.join(frames, `${String(Math.round(k.t * 30)).padStart(5, '0')}.png`), label: `${k.t.toFixed(1)} s \u00b7 ${k.why}` })).filter(x => fs.existsSync(x.file));
	const browser = await launch();
	try {
		await contactSheet(browser, frames, images, path.join(bdir, 'contact.png'), { cols: 4, width: 480 });
	} finally {
		await browser.close();
	}
	const total = Object.values(seconds).reduce((a, b) => a + b, 0);
	const report = {
		ok: lintOk, mp4: path.relative(ROOT, out), videoSeconds: +project.video.total.toFixed(1), voice: timeline?.voice ?? null,
		machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version },
		seconds: Object.fromEntries(Object.entries(seconds).map(([k, v]) => [k, +v.toFixed(1)])), total: +total.toFixed(1),
	};
	writeJson(path.join(bdir, 'smoke.json'), report);
	console.log(`\nsmoke: a ${report.videoSeconds} s video in ${report.total} s on ${report.machine.platform} (${report.machine.cpus} cores, voice: ${report.voice?.provider ?? '?'})`);
	for (const [k, v] of Object.entries(report.seconds)) {
		console.log(`  ${k.padEnd(8)} ${String(v).padStart(6)} s`);
	}
	console.log(`  ${lintOk ? 'lint clean' : 'LINT FOUND PROBLEMS (above)'} \u00b7 ${report.mp4} \u00b7 ${path.relative(ROOT, path.join(bdir, 'contact.png'))}`);
	return { ok: lintOk, mp4: out, seconds: report.seconds };
}
