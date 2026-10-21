// Paths, config and small shared helpers for the prs CLI.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CACHE = path.join(os.homedir(), '.cache', 'pr-studio');
/** Settings and the variety history: outside the engine copy, which setup replaces on every update. PRS_HOME moves it. */
export const STATE = process.env.PRS_HOME ? path.resolve(process.env.PRS_HOME) : CACHE;
/** Running in the pr-studio repository, which has a gallery (the copy the plugin installs has none), and without
 * PRS_HOME: the repository keeps its own config file, history and gallery. */
export const IN_REPO = !process.env.PRS_HOME && fs.existsSync(path.join(ROOT, 'gallery'));
export const CONFIG_FILE = IN_REPO && fs.existsSync(path.join(ROOT, 'pr-studio.config.json')) ? path.join(ROOT, 'pr-studio.config.json') : path.join(STATE, 'config.json');

/** The most a video or a deck may take. There is no minimum: as short as covering the six answers allows. The last
 * word ends by 86 s, so the file, with the end card's 4 s, stays within 90 s; at the default pace that is about 190
 * words. */
export const CAP = { seconds: 86, fileSeconds: 90, words: 190, slides: 12 };

export const DEFAULT_CONFIG = {
	voice: {
		provider: 'auto',
		// How much faster than its own pace the synthesized voice speaks (1 is the voice's pace; recordings keep theirs).
		pace: 1.1,
		kokoro: { voice: 'am_michael', speed: 1.0 },
		mai: { voice: 'en-US-Grant:MAI-Voice-2', region: 'eastus2', azResource: null, azResourceGroup: null, azSubscription: null },
	},
	deliver: path.join(os.homedir(), 'Downloads', 'pr-videos'),
	deliverDecks: path.join(os.homedir(), 'Downloads', 'pr-decks'),
	render: { workers: 0 },
	novelty: { lookback: 3, maxRepeatShare: 0.5 },
};

export function loadConfig() {
	const user = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
	const merge = (a, b) => {
		const out = { ...a };
		for (const [k, v] of Object.entries(b ?? {})) {
			out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
		}
		return out;
	};
	const config = merge(DEFAULT_CONFIG, user);
	// Automated runs (a GitHub Actions job) deliver into the checkout, e.g. PRS_DELIVER=out.
	if (process.env.PRS_DELIVER) {
		config.deliver = path.resolve(ROOT, process.env.PRS_DELIVER);
	}
	return config;
}

/** voice.pace from the settings: how much faster than its own pace the synthesized voice speaks (a recording, or
 * silent captions, keep their own). */
export function voicePace(config = loadConfig()) {
	if (['recording', 'silent'].includes(config.voice?.provider)) {
		return 1;
	}
	const pace = Number(config.voice?.pace ?? 1);
	if (!(pace >= 0.5 && pace <= 2)) {
		throw new Error(`voice.pace in ${CONFIG_FILE} must be between 0.5 and 2 (it is ${config.voice?.pace})`);
	}
	return pace;
}

export function videoDir(slug) {
	return path.join(ROOT, 'videos', slug);
}

export function buildDir(slug) {
	return path.join(videoDir(slug), 'build');
}

/** Accepts a URL (https://github.com/o/r/pull/n), o/r#n or o/r n. */
export function parsePrRef(input, second) {
	const text = String(input ?? '').trim();
	let m = text.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
	if (!m) {
		m = text.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
	}
	if (!m && second && /^\d+$/.test(String(second))) {
		const r = text.match(/^([\w.-]+)\/([\w.-]+)$/);
		if (r) {
			m = [null, r[1], r[2], String(second)];
		}
	}
	if (!m) {
		throw new Error(`Not a pull request reference: "${text}". Use https://github.com/owner/repo/pull/123 or owner/repo#123.`);
	}
	return { owner: m[1], repo: m[2], number: Number(m[3]), full: `${m[1]}/${m[2]}`, slug: `${m[1]}-${m[2]}-${m[3]}`.toLowerCase() };
}

/** The video folder for a slug, a PR reference, or the only video in progress. */
export function resolveSlug(arg) {
	if (arg) {
		if (fs.existsSync(videoDir(arg))) {
			return arg;
		}
		try {
			const ref = parsePrRef(arg);
			if (fs.existsSync(videoDir(ref.slug))) {
				return ref.slug;
			}
		} catch {
			// fall through
		}
		throw new Error(`No video "${arg}" in videos/. Start one with: prs new <PR URL>`);
	}
	const all = fs.existsSync(path.join(ROOT, 'videos')) ? fs.readdirSync(path.join(ROOT, 'videos')).filter(d => fs.existsSync(path.join(ROOT, 'videos', d, 'storyboard.json'))) : [];
	if (all.length === 1) {
		return all[0];
	}
	throw new Error(all.length ? `Several videos in progress (${all.join(', ')}); name one.` : 'No video in progress. Start one with: prs new <PR URL>');
}

export function readJson(file) {
	const text = fs.readFileSync(file, 'utf8');
	try {
		return JSON.parse(text);
	} catch (error) {
		const pos = Number(String(error.message).match(/position (\d+)/)?.[1] ?? -1);
		if (pos < 0) {
			throw new Error(`${path.basename(file)}: ${error.message}`);
		}
		const before = text.slice(0, pos);
		const line = before.split('\n').length;
		const lines = text.split('\n');
		throw new Error(`${path.basename(file)} line ${line}: ${error.message.replace(/ in JSON at position \d+.*$/, '')}\n  ${line - 1}| ${lines[line - 2] ?? ''}\n  ${line}| ${lines[line - 1] ?? ''}`);
	}
}

export function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, '\t')}\n`);
	fs.renameSync(tmp, file);
}

export function sha256(data) {
	return crypto.createHash('sha256').update(data).digest('hex');
}

export function sha256File(file) {
	return sha256(fs.readFileSync(file));
}

/** Prints how long a phase took. */
export async function timed(slug, phase, fn) {
	const t0 = performance.now();
	try {
		return await fn();
	} finally {
		const seconds = +((performance.now() - t0) / 1000).toFixed(2);
		if (process.env.PRS_QUIET !== '1') {
			console.error(`\u23f1  ${phase}: ${seconds}s`);
		}
	}
}

export function findFfmpeg() {
	const config = loadConfig();
	const candidates = [config.ffmpeg, path.join(CACHE, 'bin', 'ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
	for (const c of candidates) {
		if (c && fs.existsSync(c)) {
			return c;
		}
	}
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		const c = path.join(dir, 'ffmpeg');
		if (fs.existsSync(c)) {
			return c;
		}
	}
	throw new Error('ffmpeg not found. Run: prs doctor');
}

export function venvPython() {
	const py = path.join(CACHE, 'venv', 'bin', 'python');
	if (!fs.existsSync(py)) {
		throw new Error('The voice environment is missing. Run: prs doctor');
	}
	return py;
}

/**
 * Offline mode (PRS_OFFLINE=1), for agent sandboxes without network: GitHub data comes only from what `prs new`
 * downloaded before the run (the PR and every file it changes), the voice is Kokoro, and Whisper loads from disk.
 */
export function isOffline() {
	return !!process.env.PRS_OFFLINE && process.env.PRS_OFFLINE !== '0';
}

/** Offline, any network request this process still makes fails at once with a clear error instead of hanging. */
export function guardOffline() {
	if (!isOffline()) {
		return;
	}
	const original = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const url = String(input?.url ?? input);
		return /^https?:/i.test(url) ? Promise.reject(new Error(`Offline (PRS_OFFLINE): no network for ${url}`)) : original(input, init);
	};
}

/**
 * Environment for voice/voice.py: our ffmpeg, no telemetry, and no Hugging Face lookups once the Whisper model
 * is cached (the cloud agent's firewall blocks huggingface.co; the model is downloaded in the setup steps).
 */
export function voiceEnv() {
	const hub = path.join(process.env.HF_HOME ?? path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
	const cached = fs.existsSync(path.join(hub, 'models--Systran--faster-whisper-small.en'));
	return { ...process.env, PRS_FFMPEG: findFfmpeg(), HF_HUB_DISABLE_TELEMETRY: '1', ...((cached || isOffline()) && !process.env.HF_HUB_OFFLINE ? { HF_HUB_OFFLINE: '1' } : {}) };
}

/** Hash of everything in the storyboard that changes the narration audio or its cue times. (A hold counts only when
 * set, so videos voiced before holds existed stay current.) */
export function storyboardVoiceHash(storyboard) {
	return sha256(JSON.stringify(storyboard.beats.map(b => [b.id, b.say, b.cues ?? {}, b.gapBefore ?? null, ...(b.hold ? [b.hold] : [])])) + JSON.stringify(storyboard.pronounce ?? {}));
}
