// prs prepare: storyboard + timeline (real or provisional) + PR facts + scenes.js -> build/project.json + build/bundle.js
// Every text and code reference in scenes.js is verified against the PR here, before anything renders.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { ROOT, buildDir, findFfmpeg, readJson, sha256, sha256File, storyboardVoiceHash, videoDir, voicePace, writeJson } from './common.mjs';
import { estimateTimeline } from './timeline.mjs';
import { parseDiff, resolveCode, fileAtHead } from './code.mjs';
import { checkEvidence, stripMarkdown } from './evidence.mjs';
import { codeKey, getPath, walkRefs } from '../../engine/text.js';

const norm = s => String(s).replace(/\s+/g, ' ').trim();

/** Bundles scenes.js for Node and imports it (SVG icons load as text; no DOM is touched at import time). */
export async function loadScenes(slug, file = 'scenes.js') {
	const out = path.join(buildDir(slug), `.${path.basename(file, '.js')}.node.mjs`);
	await esbuild.build({ preserveSymlinks: true,
		entryPoints: [path.join(videoDir(slug), file)], bundle: true, platform: 'node', format: 'esm', outfile: out,
		loader: { '.svg': 'text', '.css': 'empty' }, logLevel: 'silent', absWorkingDir: ROOT,
	});
	const mod = await import(`${pathToFileURL(out).href}?v=${Date.now()}`);
	const video = mod.default;
	if (!video?.$video) {
		throw new Error(`${file} must "export default defineVideo({ ... })"`);
	}
	return { video, concepts: mod.concepts ?? null };
}

/**
 * The frames of a recording shown by ui.footage: 30 a second from `from` to `to`, cropped, at most 1728 wide, extracted
 * once into build/footage/<beat>/<side>-<hash of the cut>/ (and again when the recording or these params change).
 */
function extractFootage(slug, beat, side, s) {
	if (!s?.src) {
		throw new Error('needs src: the recording, in footage/');
	}
	const src = path.resolve(videoDir(slug), s.src);
	if (!fs.existsSync(src)) {
		throw new Error(`${s.src} not found: record it into footage/ first`);
	}
	const from = Number(s.from ?? 0), to = s.to === undefined ? null : Number(s.to);
	if (!(from >= 0) || (to !== null && !(to > from))) {
		throw new Error(`from (${s.from}) and to (${s.to}) must be seconds of the recording, to after from`);
	}
	if (s.crop && !(Array.isArray(s.crop) && s.crop.length === 4 && s.crop.every(n => Number.isFinite(n) && n >= 0))) {
		throw new Error('crop must be [x, y, width, height] in the pixels of the recording');
	}
	const st = fs.statSync(src);
	const key = JSON.stringify({ src: s.src, size: st.size, mtime: st.mtimeMs, from, to, crop: s.crop ?? null });
	// The folder is named after what it was cut from: a new recording, trim or crop is a new address, so a render never
	// reuses frames it cached from the old cut.
	const name = `${side}-${sha256(key).slice(0, 10)}`;
	const parent = path.join(buildDir(slug), 'footage', beat);
	const dir = path.join(parent, name);
	const stamp = path.join(dir, '.src');
	if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== key) {
		for (const old of fs.existsSync(parent) ? fs.readdirSync(parent) : []) {
			if (old === side || old.startsWith(`${side}-`)) {
				fs.rmSync(path.join(parent, old), { recursive: true, force: true });
			}
		}
		fs.mkdirSync(dir, { recursive: true });
		const crop = s.crop ? `crop=${s.crop[2]}:${s.crop[3]}:${s.crop[0]}:${s.crop[1]},` : '';
		execFileSync(findFfmpeg(), ['-v', 'error', '-y', '-ss', String(from), ...(to !== null ? ['-t', String(to - from)] : []), '-i', src,
			'-vf', `${crop}fps=30,scale='min(1728,iw)':-2:flags=lanczos`, '-q:v', '2', path.join(dir, '%05d.jpg')]);
		fs.writeFileSync(stamp, key);
	}
	const frames = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
	if (!frames) {
		throw new Error(`no frames in ${s.src} between ${from} s and ${to ?? 'its end'}`);
	}
	const probe = (() => {
		try {
			execFileSync(findFfmpeg(), ['-hide_banner', '-i', path.join(dir, '00001.jpg')], { stdio: 'pipe' });
			return '';
		} catch (error) {
			return String(error.stderr);
		}
	})();
	const m = /, (\d{2,5})x(\d{2,5})/.exec(probe);
	if (!m) {
		throw new Error(`could not read the size of the frames of ${s.src}`);
	}
	return { dir: `footage/${beat}/${name}`, frames, w: Number(m[1]), h: Number(m[2]) };
}

export function prCorpus(slug, pr) {
	const diff = fs.readFileSync(path.join(videoDir(slug), 'pr.diff'), 'utf8');
	const diffText = diff.split('\n').filter(l => /^[+\- ]/.test(l) && !/^(\+\+\+|---) /.test(l)).map(l => l.slice(1)).join('\n');
	const f = pr.facts;
	return {
		diff,
		quote: norm([f.title, pr.body ?? '', stripMarkdown(pr.body ?? ''), ...(f.commits ?? []).map(c => c.message ?? c.headline), diffText, ...(f.linkedIssues ?? []).map(i => i.title), ...(pr.tests ?? []).flatMap(t => t.names), ...(pr.discussion ?? []).flatMap(d => [d.body, stripMarkdown(d.body)])].join('\n')),
		idents: [diffText, f.files.map(x => x.path).join('\n'), pr.body ?? ''].join('\n'),
		paths: f.files.map(x => x.path),
	};
}

function verifyText(ref, corpus, facts, codeTexts) {
	if (/\bTODO\b/.test(ref.text ?? '')) {
		return { error: `still a TODO: "${ref.text}"` };
	}
	switch (ref.$text) {
		case 'label':
			return /\d{3,}/.test(ref.text) ? `label "${ref.text}" contains a number: if it comes from the PR, use fact() or quote()` : null;
		case 'fact':
			return getPath(facts, ref.path) === undefined ? `fact('${ref.path}') is not in pr.json facts` : false;
		case 'quote':
			return corpus.quote.includes(norm(ref.text)) ? false : `quote("${ref.text}") is not in the PR (title, body, commits, diff, tests or review discussion). Quote exactly or use label()`;
		case 'ident': {
			const bare = ref.text.replace(/\(\)$/, '').replace(/^[.#@]/, '');
			if (corpus.idents.includes(bare) || codeTexts.some(t => t.includes(bare)) || corpus.inChangedFiles(bare)) {
				return false;
			}
			return `ident("${ref.text}") is not in the PR's diff or its changed files at the head commit`;
		}
		case 'path': {
			const ok = corpus.paths.some(p => p === ref.path || p.includes(`${ref.path}/`) || p.endsWith(`/${ref.path}`) || p.includes(`/${ref.path}/`) || p.startsWith(`${ref.path}/`));
			return ok ? false : `path("${ref.path}") is not a file (or folder) changed by this PR`;
		}
		default:
			return `unknown text kind ${ref.$text}`;
	}
}

export async function prepare(slug, { quiet = false } = {}) {
	const vdir = videoDir(slug), bdir = buildDir(slug);
	fs.mkdirSync(bdir, { recursive: true });
	const pr = readJson(path.join(vdir, 'pr.json'));
	const storyboard = readJson(path.join(vdir, 'storyboard.json'));
	const facts = pr.facts;
	const real = fs.existsSync(path.join(bdir, 'timeline.json'));
	const timeline = real ? readJson(path.join(bdir, 'timeline.json')) : estimateTimeline(storyboard, facts, { pace: voicePace() });
	if (real) {
		const voiced = readJson(path.join(bdir, 'voice.json'));
		if (voiced.storyboard !== storyboardVoiceHash(storyboard)) {
			throw new Error('storyboard.json changed after the voice was made. Run: prs voice (or delete build/timeline.json to use provisional timing)');
		}
	}
	const { video, concepts } = await loadScenes(slug);
	const ids = storyboard.beats.map(b => b.id);
	const sceneIds = Object.keys(video.beats);
	const missing = ids.filter(id => !sceneIds.includes(id));
	const extra = sceneIds.filter(id => !ids.includes(id));
	if (missing.length || extra.length) {
		throw new Error(`scenes.js and storyboard.json disagree. ${missing.length ? `Missing in scenes.js: ${missing.join(', ')}. ` : ''}${extra.length ? `Not in the storyboard: ${extra.join(', ')}.` : ''}`);
	}
	if (video.beats[ids[0]].treatment !== 'title.frame') {
		throw new Error(`The first beat ("${ids[0]}") must use title.frame`);
	}

	// Collect and verify every reference.
	const corpus = prCorpus(slug, pr);
	// Names that aren't in the diff may still be in the changed files (a class whose method changed): look there last.
	let changedTexts = null;
	corpus.inChangedFiles = name => {
		changedTexts ??= facts.files.filter(f => f.status !== 'removed').map(f => {
			try {
				return fileAtHead(slug, facts, f.path);
			} catch {
				return '';
			}
		});
		return changedTexts.some(t => t.includes(name));
	};
	const diffFiles = parseDiff(corpus.diff);
	const problems = [], warnings = [];
	const codeRefs = new Map();
	const textRefs = [];
	const allSpecs = { ...video.beats };
	for (const [name, spec] of Object.entries(concepts?.options ?? {})) {
		allSpecs[`concept:${name}`] = spec;
	}
	for (const [id, spec] of Object.entries(allSpecs)) {
		for (const { ref, trail } of walkRefs(spec.params)) {
			if (ref.$code) {
				codeRefs.set(codeKey(ref), { ref, where: `${id}.${trail}` });
			} else {
				textRefs.push({ ref, where: `${id}.${trail}` });
			}
		}
	}
	if (video.carry) {
		for (const { ref, trail } of walkRefs(video.carry)) {
			textRefs.push({ ref, where: `carry.${trail}` });
		}
	}
	const code = {};
	for (const [key, { ref, where }] of codeRefs) {
		try {
			code[key] = await resolveCode(slug, facts, diffFiles, ref);
		} catch (error) {
			problems.push(`${where}: ${error.message}`);
		}
	}
	const codeTexts = Object.values(code).map(b => b.lines.map(l => l.text).join('\n'));
	for (const { ref, where } of textRefs) {
		const issue = verifyText(ref, corpus, facts, codeTexts);
		if (issue?.error) {
			problems.push(`${where}: ${issue.error}`);
		} else if (issue && ref.$text === 'label') {
			warnings.push(`${where}: ${issue}`);
		} else if (issue) {
			problems.push(`${where}: ${issue}`);
		}
	}
	// Every claim's evidence must hold against the PR.
	for (const beat of storyboard.beats) {
		for (const claim of beat.claims ?? []) {
			for (const ev of claim.evidence ?? []) {
				const issue = checkEvidence(slug, pr, ev);
				if (issue) {
					problems.push(`storyboard ${beat.id}: ${issue}`);
				}
			}
		}
	}
	// The frames of the recordings that ui.footage beats show.
	const footage = {};
	for (const [id, spec] of Object.entries(video.beats)) {
		if (spec.treatment !== 'ui.footage') {
			continue;
		}
		footage[id] = {};
		for (const side of ['before', 'after']) {
			if (spec.params?.[side]) {
				try {
					footage[id][side] = extractFootage(slug, id, side, spec.params[side]);
				} catch (error) {
					problems.push(`${id}.${side}: ${error.message}`);
				}
			}
		}
	}
	if (problems.length) {
		throw new Error(`prepare found ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n  - ${problems.join('\n  - ')}`);
	}

	// Timing of the whole video: the end card follows the last word; then a 3.4 s hold.
	const beats = storyboard.beats.map((sb, k) => {
		const tb = timeline.beats.find(b => b.id === sb.id);
		if (!tb) {
			throw new Error(`Beat "${sb.id}" is missing from the timeline; run prs voice`);
		}
		return { id: sb.id, need: sb.need, start: k === 0 ? 0 : tb.start, end: tb.end, words: tb.words, cues: tb.cues };
	});
	const lastWord = beats.at(-1).words.at(-1).b;
	const endAt = +(lastWord + 0.45).toFixed(3);
	const total = +Math.max(timeline.total, endAt + 3.4).toFixed(3);
	const project = {
		id: slug, estimated: !real,
		pr: { facts },
		video: { fps: 30, endAt, total, motion: video.motion },
		beats, code, footage,
	};
	writeJson(path.join(bdir, 'project.json'), project);
	await bundle(slug);
	const lock = {
		project: sha256File(path.join(bdir, 'project.json')),
		bundle: sha256(fs.readFileSync(path.join(bdir, 'bundle.js')) + fs.readFileSync(path.join(bdir, 'bundle.css'))),
		timeline: real ? sha256File(path.join(bdir, 'timeline.json')) : null,
		narration: real && fs.existsSync(path.join(bdir, 'narration.wav')) ? sha256File(path.join(bdir, 'narration.wav')) : null,
	};
	writeJson(path.join(bdir, 'build.lock.json'), lock);
	if (!quiet) {
		console.log(`prepared ${slug}: ${beats.length} beats, ${total.toFixed(1)} s${real ? '' : ' (provisional timing: run prs voice for the real one)'}, ${Object.keys(code).length} code blocks, ${textRefs.length} text references verified`);
		for (const w of warnings) {
			console.log(`  warning: ${w}`);
		}
	}
	return { project, video, warnings, lock };
}

export async function bundle(slug, { entry = null } = {}) {
	const bdir = buildDir(slug);
	const entryFile = path.join(bdir, 'entry.js');
	const rel = p => path.relative(bdir, p).split(path.sep).join('/');
	fs.writeFileSync(entryFile, entry ?? [
		`import video, * as scenes from '${rel(path.join(videoDir(slug), 'scenes.js'))}';`,
		"import project from './project.json';",
		`import { start } from '${rel(path.join(ROOT, 'engine', 'runtime.js'))}';`,
		'const concept = new URLSearchParams(location.search).get(\'concept\');',
		'const chosen = concept && scenes.concepts ? { ...video, beats: { ...video.beats, [scenes.concepts.beat]: scenes.concepts.options[concept] } } : video;',
		'start(chosen, project).catch(error => console.error(error && error.stack || String(error)));',
		'',
	].join('\n'));
	await esbuild.build({ preserveSymlinks: true,
		entryPoints: { bundle: entryFile }, bundle: true, format: 'iife', platform: 'browser', outdir: bdir,
		loader: { '.svg': 'text', '.json': 'json', '.woff2': 'file' }, external: ['file:*'], assetNames: 'assets/[name]-[hash]',
		logLevel: 'silent', absWorkingDir: ROOT, target: 'chrome120',
	});
	fs.writeFileSync(path.join(bdir, 'index.html'), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"></head>\n<body><div id="app"></div><script src="bundle.js"></script></body></html>\n');
}
