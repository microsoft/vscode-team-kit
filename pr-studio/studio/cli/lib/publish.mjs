// prs publish: encode, subtitles, sync gate, deliver to ~/Downloads/pr-videos/<slug>/ (the mp4, and a WebM copy that VS
// Code's chat can play), record in the history (and, in the repository, in the gallery).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CAP, IN_REPO, ROOT, buildDir, loadConfig, readJson, sha256File, venvPython, videoDir, voiceEnv, writeJson } from './common.mjs';
import { encode, encodeWebm } from './encode.mjs';
import { addToHistory } from './history.mjs';
import { launch } from './browser.mjs';
import { contactSheet, keyTimes } from './stills.mjs';

function verifyLock(bdir) {
	const lock = readJson(path.join(bdir, 'build.lock.json'));
	const info = readJson(path.join(bdir, 'frames', 'render.json'));
	const project = readJson(path.join(bdir, 'project.json'));
	if (project.estimated) {
		throw new Error('The frames use provisional timing. Run prs voice, then prs render, before publishing.');
	}
	if (sha256File(path.join(bdir, 'project.json')) !== lock.project || info.project !== lock.project || info.bundle !== lock.bundle) {
		throw new Error('The frames are stale (rendered from another project or bundle). Run prs render.');
	}
	if (lock.timeline !== sha256File(path.join(bdir, 'timeline.json')) || lock.narration !== sha256File(path.join(bdir, 'narration.wav'))) {
		throw new Error('The narration or timeline changed after prepare. Run prs render again.');
	}
	return { project, info };
}

/** Encode the rendered frames, write the captions file and run the sync gate. Returns the mp4, srt and timings. */
export async function encodeChecked(slug, { skipSync = false } = {}) {
	const bdir = buildDir(slug);
	const { project } = verifyLock(bdir);
	const out = path.join(bdir, `${slug}.mp4`);
	const seconds = {};
	let t0 = performance.now();
	await encode(slug, { out });
	seconds.encode = (performance.now() - t0) / 1000;
	console.log(`encoded in ${seconds.encode.toFixed(1)} s`);
	const py = venvPython();
	const env = voiceEnv();
	const srt = path.join(bdir, `${slug}.srt`);
	spawnSync(py, [path.join(ROOT, 'voice', 'voice.py'), 'srt', path.join(bdir, 'timeline.json'), srt], { stdio: 'inherit', env });
	const voiceInfo = readJson(path.join(bdir, 'voice.json'));
	if (!skipSync && voiceInfo.provider !== 'silent') {
		t0 = performance.now();
		const sync = spawnSync(py, [path.join(ROOT, 'voice', 'voice.py'), 'check-sync', out, path.join(bdir, 'project.json')], { stdio: ['ignore', 'pipe', 'inherit'], env, encoding: 'utf8' });
		process.stdout.write(sync.stdout);
		// Kept for the review pack: what the voice really said, beat by beat.
		fs.writeFileSync(path.join(bdir, 'sync.txt'), sync.stdout ?? '');
		seconds.sync = (performance.now() - t0) / 1000;
		if (sync.status !== 0) {
			throw new Error('SYNC GATE failed: the audio in the mp4 does not match the captions. Not delivered.');
		}
	}
	return { project, out, srt, voiceInfo, seconds };
}

export async function publish(slug, { skipSync = false } = {}) {
	const vdir = videoDir(slug), bdir = buildDir(slug);
	const planned = readJson(path.join(bdir, 'project.json'));
	if (planned.video.total > CAP.fileSeconds) {
		throw new Error(`The video runs ${planned.video.total.toFixed(1)} s, past the ${CAP.fileSeconds} s cap: cut the narration (its last word ends by ${CAP.seconds} s), then prs voice, prs render and prs publish again. Not delivered.`);
	}
	const { project, out, srt, voiceInfo } = await encodeChecked(slug, { skipSync });
	// Deliver.
	const dest = path.join(loadConfig().deliver, slug);
	const earlier = fs.existsSync(path.join(dest, `${slug}.mp4`)) ? fs.statSync(path.join(dest, `${slug}.mp4`)).mtime : null;
	fs.mkdirSync(dest, { recursive: true });
	fs.copyFileSync(out, path.join(dest, `${slug}.mp4`));
	fs.copyFileSync(srt, path.join(dest, `${slug}.srt`));
	// VS Code's chat plays this one: its window decodes WebM but no MP4.
	const webm = await encodeWebm(out, path.join(dest, `${slug}.webm`));
	// A contact sheet of the key frames, delivered next to the mp4.
	const frames = path.join(bdir, 'frames');
	const images = keyTimes(project).filter((_, i, a) => a.length <= 12 || i % Math.ceil(a.length / 12) === 0).map(k => ({ file: path.join(frames, `${String(Math.round(k.t * 30)).padStart(5, '0')}.png`), label: `${k.t.toFixed(1)} s \u00b7 ${k.why}` })).filter(x => fs.existsSync(x.file));
	const browser = await launch();
	try {
		await contactSheet(browser, frames, images, path.join(bdir, 'contact.png'), { cols: 4, width: 480 });
	} finally {
		await browser.close();
	}
	fs.copyFileSync(path.join(bdir, 'contact.png'), path.join(dest, 'contact.png'));
	if (IN_REPO) {
		await addToGallery(slug, { vdir, bdir, mp4: out });
	}
	const meta = project.beats.map(b => b.id);
	const { loadScenes } = await import('./prepare.mjs');
	const { video } = await loadScenes(slug);
	const { textOf, fact } = await import('../../engine/text.js');
	const headline = textOf(video.beats[meta[0]].params?.headline ?? fact('title'), project.pr.facts);
	const facts = project.pr.facts;
	addToHistory({
		slug, repo: facts.repo, number: facts.number, title: facts.title, headline, date: new Date().toISOString(),
		seconds: +project.video.total.toFixed(1), motion: video.motion, layout: video.layout,
		treatments: Object.fromEntries(meta.map(id => [id, video.beats[id].treatment])),
		voice: voiceInfo.provider,
	});
	// What a job needs to post the video (to Slack): next to the mp4, so the delivery folder is self-contained.
	writeJson(path.join(dest, `${slug}.json`), {
		repo: facts.repo, number: facts.number, url: facts.url, title: facts.title, author: facts.authorLogin, headline,
		seconds: +project.video.total.toFixed(1), voice: voiceInfo.provider, mp4: `${slug}.mp4`, ...(webm ? { webm: `${slug}.webm` } : {}), srt: `${slug}.srt`, published: new Date().toISOString(),
		// What the video used, so the history (the variety of the next videos) can be rebuilt from the delivered files.
		motion: video.motion, treatments: Object.fromEntries(meta.map(id => [id, video.beats[id].treatment])),
	});
	console.log(`delivered: ${path.join(dest, `${slug}.mp4`)}${earlier ? ` (replacing the video delivered there on ${earlier.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })})` : ''}`);
	return path.join(dest, `${slug}.mp4`);
}

/** The repository's gallery: storyboard, direction and contact sheet (never the scene code: agents must not copy old
 * videos), and a short animated preview for the README. */
async function addToGallery(slug, { vdir, bdir, mp4 }) {
	const gdir = path.join(ROOT, 'gallery', slug);
	fs.mkdirSync(gdir, { recursive: true });
	fs.copyFileSync(path.join(vdir, 'storyboard.json'), path.join(gdir, 'storyboard.json'));
	if (fs.existsSync(path.join(vdir, 'direction.json'))) {
		fs.copyFileSync(path.join(vdir, 'direction.json'), path.join(gdir, 'direction.json'));
	}
	fs.copyFileSync(path.join(bdir, 'contact.png'), path.join(gdir, 'contact.png'));
	if (process.env.COPILOT_AGENT_SESSION_ID || process.env.CI) {
		console.log('(no gallery preview in an automated run: only the README gallery uses it)');
		return;
	}
	const { makePreview } = await import('./gallery.mjs');
	try {
		await makePreview(slug, { mp4, out: path.join(gdir, 'preview.webp') });
		console.log('for the README gallery: prs gallery --upload');
	} catch (error) {
		console.log(`(no gallery preview: ${String(error.message).split('\n')[0].slice(0, 120)})`);
	}
}

