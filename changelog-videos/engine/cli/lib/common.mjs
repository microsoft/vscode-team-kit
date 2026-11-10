// Paths, settings and small shared helpers for the prs CLI of the changelog-videos engine.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * The plugin's home: settings, the voice environment, the GitHub cache, the builds of VS Code and the work (each engine
 * copy's videos/ links to its work/videos/). CHANGELOG_VIDEOS_HOME moves it.
 */
export const CACHE = process.env.CHANGELOG_VIDEOS_HOME ? path.resolve(process.env.CHANGELOG_VIDEOS_HOME) : path.join(os.homedir(), '.cache', 'changelog-videos');
export const CONFIG_FILE = path.join(CACHE, 'config.json');

export const DEFAULT_CONFIG = {
	voice: {
		provider: 'auto',
		// How much faster than its own pace the synthesized voice speaks (1 is the voice's pace).
		pace: 1.1,
		kokoro: { voice: 'am_michael', speed: 1.0 },
		mai: { voice: 'en-US-Grant:MAI-Voice-2', region: 'eastus2', azResource: null, azResourceGroup: null, azSubscription: null },
	},
	deliver: path.join(os.homedir(), 'Downloads', 'changelog-videos'),
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
	// Automated runs (a GitHub Actions job) deliver into their workspace, e.g. PRS_DELIVER=out.
	if (process.env.PRS_DELIVER) {
		config.deliver = path.resolve(process.env.PRS_DELIVER);
	}
	return config;
}

/** voice.pace from the settings: how much faster than its own pace the synthesized voice speaks. */
export function voicePace(config = loadConfig()) {
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

/** Prints how long a phase took (and logs it in the video's build/timings.jsonl). */
export async function timed(slug, phase, fn) {
	const t0 = performance.now();
	try {
		return await fn();
	} finally {
		const seconds = +((performance.now() - t0) / 1000).toFixed(2);
		if (slug && fs.existsSync(videoDir(slug))) {
			fs.mkdirSync(buildDir(slug), { recursive: true });
			fs.appendFileSync(path.join(buildDir(slug), 'timings.jsonl'), `${JSON.stringify({ phase, seconds, at: new Date().toISOString() })}\n`);
		}
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
 * Offline mode (PRS_OFFLINE=1), for agent sandboxes without network: GitHub data comes only from what `prs digest new`
 * downloaded before the run (the report, each PR and every file it changes), the voice is Kokoro, and Whisper loads
 * from disk.
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
 * Environment for voice/voice.py: the plugin's home (its settings and the Kokoro model), our ffmpeg, no telemetry, and
 * no Hugging Face lookups once the Whisper model is cached (an agent sandbox's firewall blocks huggingface.co).
 */
export function voiceEnv() {
	const hub = path.join(process.env.HF_HOME ?? path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
	const cached = fs.existsSync(path.join(hub, 'models--Systran--faster-whisper-small.en'));
	return { ...process.env, PRS_HOME: CACHE, PRS_FFMPEG: findFfmpeg(), HF_HUB_DISABLE_TELEMETRY: '1', ...((cached || isOffline()) && !process.env.HF_HUB_OFFLINE ? { HF_HUB_OFFLINE: '1' } : {}) };
}

/** Hash of everything in the storyboard that changes the narration audio or its cue times. */
export function storyboardVoiceHash(storyboard) {
	return sha256(JSON.stringify(storyboard.beats.map(b => [b.id, b.say, b.cues ?? {}, b.gapBefore ?? null])) + JSON.stringify(storyboard.pronounce ?? {}));
}
