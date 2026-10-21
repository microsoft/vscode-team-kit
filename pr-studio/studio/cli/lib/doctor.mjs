// prs doctor: check and install what the pipeline needs. Safe to run again; it only adds what is missing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { CACHE, CONFIG_FILE, DEFAULT_CONFIG, ROOT, isOffline, loadConfig, sha256File, voicePace, writeJson } from './common.mjs';
import { chromePath } from './browser.mjs';

const KOKORO = {
	'kokoro-v1.0.int8.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx',
	'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
};
const APTOS = ['Microsoft Excel', 'Microsoft Word', 'Microsoft PowerPoint'].map(app => `/Applications/${app}.app/Contents/Resources/DFonts/Aptos.ttf`);

const ok = m => console.log(`  \u2713 ${m}`);
const warn = m => console.log(`  ! ${m}`);
const fail = m => console.log(`  \u2717 ${m}`);

function findPython() {
	for (const c of ['/opt/homebrew/bin/python3.12', '/opt/homebrew/bin/python3.11', '/opt/homebrew/bin/python3.13', '/usr/local/bin/python3.12', '/usr/local/bin/python3.11', 'python3.12', 'python3.11', 'python3.13', 'python3']) {
		const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[:2] >= (3, 10) and sys.version_info[:2] < (3, 14))'], { encoding: 'utf8' });
		if (r.status === 0 && r.stdout.trim() === 'True') {
			return c;
		}
	}
	return null;
}

async function download(url, file) {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`download failed (${res.status}): ${url}`);
	}
	const tmp = `${file}.part`;
	fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
	fs.renameSync(tmp, file);
}

/** An ffmpeg on the PATH with the encoders the videos need, or null. */
function systemFfmpeg() {
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		const exe = path.join(dir, 'ffmpeg');
		if (!dir || !fs.existsSync(exe)) {
			continue;
		}
		const r = spawnSync(exe, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
		const has = ['libx264', 'aac', 'libvpx-vp9', 'libopus'].every(e => new RegExp(`\\s${e}\\s`).test(r.stdout ?? ''));
		return has ? fs.realpathSync(exe) : null;
	}
	return null;
}

/** Whether the offline voice is needed from the start: no Azure Speech key or resource for MAI-Voice-2, no network, or
 * asked for. (With only a resource, `prs voice` installs it if the key lookup fails and the voice falls back to it.) */
function needsKokoro(config, forced) {
	return forced || config.voice.provider === 'kokoro' || isOffline() || !(process.env.AZURE_SPEECH_KEY || config.voice.mai?.azResource);
}

/** Installs the offline voice (Kokoro): its packages into the voice environment, and its model files. */
export async function installKokoro() {
	const venv = path.join(CACHE, 'venv');
	installRequirements(path.join(venv, 'bin', 'python'), venv, path.join(ROOT, 'voice', 'requirements-kokoro.txt'), 'kokoro_onnx');
	const kdir = path.join(CACHE, 'kokoro');
	fs.mkdirSync(kdir, { recursive: true });
	for (const [name, url] of Object.entries(KOKORO)) {
		if (!fs.existsSync(path.join(kdir, name))) {
			console.log(`  downloading ${name}...`);
			await download(url, path.join(kdir, name));
		}
	}
}

/** Installs a requirements file into the voice environment when its pins changed (or a module is missing). */
function installRequirements(py, venv, file, probe) {
	const stamp = path.join(venv, `.prs-${path.basename(file, '.txt')}`);
	const installed = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
	const check = spawnSync(py, ['-c', `import ${probe}`], { encoding: 'utf8' });
	if (check.status !== 0 || installed !== sha256File(file)) {
		console.log(`  installing voice packages (voice/${path.basename(file)})...`);
		execFileSync(py, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip'], { stdio: 'inherit' });
		execFileSync(py, ['-m', 'pip', 'install', '-q', '-r', file], { stdio: 'inherit' });
		fs.writeFileSync(stamp, sha256File(file));
	}
}

/** Installs what a command needs the first time it is missing (the browser; for videos also the voice and ffmpeg). */
export async function ensureTools({ voice = false } = {}) {
	const venv = path.join(CACHE, 'venv');
	const stamp = path.join(venv, '.prs-requirements');
	const voiceReady = () => fs.existsSync(path.join(venv, 'bin', 'python')) && fs.existsSync(path.join(CACHE, 'bin', 'ffmpeg'))
		&& fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === sha256File(path.join(ROOT, 'voice', 'requirements.txt'));
	if (chromePath() && (!voice || voiceReady())) {
		return;
	}
	console.log('First use of this engine: installing what it needs...');
	if (!(await doctor({ deck: !voice }))) {
		throw new Error('the setup above is not complete: fix what it lists, then run the command again');
	}
}

export async function doctor({ samples = false, deck = false, kokoro = false } = {}) {
	let problems = 0;
	console.log('pr-studio doctor');
	const major = Number(process.versions.node.split('.')[0]);
	major >= 20 ? ok(`node ${process.versions.node}`) : (fail(`node ${process.versions.node}: needs 20 or newer`), problems++);
	if (isOffline()) {
		ok('GitHub: offline (PRS_OFFLINE), from what prs new downloaded before this run');
	} else {
		try {
			// A repos/ call, not /rate_limit: the cloud agent's firewall rule may allow only https://api.github.com/repos/.
			const { request, githubToken } = await import('./github.mjs');
			const { headers, blocked } = await request('https://api.github.com/repos/microsoft/vscode');
			const source = process.env.PRS_GITHUB_TOKEN ? 'PRS_GITHUB_TOKEN' : process.env.GH_TOKEN ? 'GH_TOKEN' : process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : githubToken() ? 'gh' : 'no token';
			const limit = Number(headers.get('x-ratelimit-limit') ?? 0), remaining = Number(headers.get('x-ratelimit-remaining') ?? 0);
			blocked ? warn('GitHub API blocked by the agent firewall: only the PRs named in the request (prefetched by the setup steps) can be read; allow https://api.github.com/repos/ for the rest')
				: limit > 60 || !limit ? ok(`GitHub API (${source}${limit ? `, ${remaining}/${limit} requests left this hour` : ''})`) : warn(`GitHub API without a token: ${remaining}/60 requests left this hour (enough for a few PRs; set PRS_GITHUB_TOKEN or sign in with gh for more)`);
		} catch (error) {
			fail(`GitHub API: ${error.message}`);
			problems++;
		}
	}
	if (!fs.existsSync(path.join(ROOT, 'node_modules', 'esbuild'))) {
		console.log('  installing node packages...');
		execFileSync('npm', ['install', '--silent'], { cwd: ROOT, stdio: 'inherit' });
	}
	ok('node packages');
	if (!chromePath()) {
		console.log('  installing Chrome for Testing...');
		const withDeps = process.platform === 'linux' && process.env.CI ? ['--with-deps'] : [];
		execFileSync('npx', ['playwright-core', 'install', ...withDeps, 'chromium'], { cwd: ROOT, stdio: 'inherit' });
	}
	chromePath() ? ok('Chrome for Testing') : (fail('Chrome for Testing could not be installed'), problems++);

	// Slides need only the packages and the browser; videos also need the voice.
	if (!deck) {
		// Voice environment: faster-whisper (word timing, sync gate) and ffmpeg; Kokoro (offline voice) only when needed.
		const venv = path.join(CACHE, 'venv');
		const py = path.join(venv, 'bin', 'python');
		if (!fs.existsSync(py)) {
			const base = findPython();
			if (!base) {
				fail('Python 3.10-3.13 not found (brew install python@3.12)');
				problems++;
			} else {
				console.log(`  creating the voice environment with ${base}...`);
				fs.mkdirSync(CACHE, { recursive: true });
				execFileSync(base, ['-m', 'venv', venv], { stdio: 'inherit' });
			}
		}
		if (fs.existsSync(py)) {
			// Pinned versions; installed again whenever a requirements file changes.
			installRequirements(py, venv, path.join(ROOT, 'voice', 'requirements.txt'), 'faster_whisper, soundfile, numpy');
			ok('voice environment');
			const bin = path.join(CACHE, 'bin', 'ffmpeg');
			if (!fs.existsSync(bin)) {
				// The system's ffmpeg when it has the encoders pr-studio uses, else one from pip.
				let exe = systemFfmpeg();
				if (!exe) {
					installRequirements(py, venv, path.join(ROOT, 'voice', 'requirements-ffmpeg.txt'), 'imageio_ffmpeg');
					exe = execFileSync(py, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
				}
				fs.mkdirSync(path.dirname(bin), { recursive: true });
				fs.rmSync(bin, { force: true });
				fs.symlinkSync(exe, bin);
			}
			ok(`ffmpeg (${fs.realpathSync(bin)})`);
			if (needsKokoro(loadConfig(), kokoro || samples)) {
				await installKokoro();
				ok('Kokoro voice model (Apache-2.0)');
			} else {
				ok('Kokoro not needed: MAI-Voice-2 is set up (prs voice installs the offline voice if it falls back to it)');
			}
			const w = spawnSync(py, ['-c', 'from faster_whisper import WhisperModel; WhisperModel("small.en", compute_type="int8")'], { encoding: 'utf8', env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1', ...(isOffline() ? { HF_HUB_OFFLINE: '1' } : {}) } });
			w.status === 0 ? ok('Whisper small.en (word timing and the sync gate)') : (fail(`Whisper model: ${w.stderr.trim().split('\n').at(-1)}`), problems++);
			if (samples) {
				const out = path.join(loadConfig().deliver, 'voice-samples');
				spawnSync(py, [path.join(ROOT, 'voice', 'voice.py'), 'samples', '--out', out], { stdio: 'inherit', env: { ...process.env, PRS_FFMPEG: bin } });
			}
		}
	}
	APTOS.some(f => fs.existsSync(f)) ? ok('Aptos (from Microsoft Office; read in place, never copied)') : warn('Aptos not found (Microsoft Office): videos use Segoe UI or Inter instead');
	const config = loadConfig();
	if (!fs.existsSync(CONFIG_FILE)) {
		writeJson(CONFIG_FILE, DEFAULT_CONFIG);
		ok(`wrote ${CONFIG_FILE} (your settings)`);
	}
	const mai = config.voice.mai;
	const pace = deck ? 1 : voicePace(config);
	const faster = pace === 1 ? '' : `; ${pace}\u00d7 its own pace (voice.pace)`;
	if (deck) {
		// Slides have no voice.
	} else if (process.env.AZURE_SPEECH_KEY) {
		ok(`voice: MAI-Voice-2 (${mai.voice}) via AZURE_SPEECH_KEY${faster}`);
	} else if (mai.azResource) {
		ok(`voice: MAI-Voice-2 via az lookup of ${mai.azResource}, Kokoro when that fails${faster}`);
	} else {
		ok(`voice: Kokoro ${config.voice.kokoro.voice} (offline)${faster}. For MAI-Voice-2, set AZURE_SPEECH_KEY or voice.mai.azResource in ${CONFIG_FILE}`);
	}
	console.log(problems ? `${problems} problem${problems > 1 ? 's' : ''} to fix` : deck ? 'ready for slides' : 'ready');
	return !problems;
}
