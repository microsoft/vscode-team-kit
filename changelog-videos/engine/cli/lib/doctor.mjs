// prs doctor: check and install what a changelog video needs (Chrome for Testing to render, the voice environment: Kokoro,
// Whisper, ffmpeg). Safe to run again; it only adds what is missing. The npm packages come with the plugin's setup.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { CACHE, CONFIG_FILE, DEFAULT_CONFIG, ROOT, isOffline, loadConfig, sha256File, voicePace, writeJson } from './common.mjs';
import { freeGb } from './build.mjs';
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

export async function doctor({ samples = false } = {}) {
	let problems = 0;
	console.log('changelog-videos doctor');
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
		fail('node packages missing: run the plugin\'s scripts/setup.mjs');
		problems++;
	} else {
		ok('node packages');
	}
	if (!chromePath()) {
		console.log('  installing Chrome for Testing...');
		const withDeps = process.platform === 'linux' && process.env.CI ? ['--with-deps'] : [];
		execFileSync('npx', ['playwright-core', 'install', ...withDeps, 'chromium'], { cwd: ROOT, stdio: 'inherit' });
	}
	chromePath() ? ok('Chrome for Testing') : (fail('Chrome for Testing could not be installed'), problems++);

	{
		// Voice environment: Kokoro (offline voice), faster-whisper (word timing, sync gate), ffmpeg.
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
			// Pinned versions; installed again whenever voice/requirements.txt changes.
			const requirements = path.join(ROOT, 'voice', 'requirements.txt');
			const stamp = path.join(venv, '.prs-requirements');
			const installed = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
			const check = spawnSync(py, ['-c', 'import kokoro_onnx, faster_whisper, soundfile, numpy, imageio_ffmpeg'], { encoding: 'utf8' });
			if (check.status !== 0 || installed !== sha256File(requirements)) {
				console.log('  installing voice packages (voice/requirements.txt)...');
				execFileSync(py, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip'], { stdio: 'inherit' });
				execFileSync(py, ['-m', 'pip', 'install', '-q', '-r', requirements], { stdio: 'inherit' });
				fs.writeFileSync(stamp, sha256File(requirements));
			}
			ok('voice environment');
			const bin = path.join(CACHE, 'bin', 'ffmpeg');
			if (!fs.existsSync(bin)) {
				const exe = execFileSync(py, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
				fs.mkdirSync(path.dirname(bin), { recursive: true });
				fs.symlinkSync(exe, bin);
			}
			ok(`ffmpeg (${fs.realpathSync(bin)})`);
			const kdir = path.join(CACHE, 'kokoro');
			fs.mkdirSync(kdir, { recursive: true });
			for (const [name, url] of Object.entries(KOKORO)) {
				if (!fs.existsSync(path.join(kdir, name))) {
					console.log(`  downloading ${name}...`);
					await download(url, path.join(kdir, name));
				}
			}
			ok('Kokoro voice model (Apache-2.0)');
			const w = spawnSync(py, ['-c', 'from faster_whisper import WhisperModel; WhisperModel("small.en", compute_type="int8")'], { encoding: 'utf8', env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1', ...(isOffline() ? { HF_HUB_OFFLINE: '1' } : {}) } });
			w.status === 0 ? ok('Whisper small.en (word timing and the sync gate)') : (fail(`Whisper model: ${w.stderr.trim().split('\n').at(-1)}`), problems++);
			if (samples) {
				const out = path.join(loadConfig().deliver, 'voice-samples');
				spawnSync(py, [path.join(ROOT, 'voice', 'voice.py'), 'samples', '--out', out], { stdio: 'inherit', env: { ...process.env, PRS_HOME: CACHE, PRS_FFMPEG: bin } });
			}
		}
	}
	APTOS.some(f => fs.existsSync(f)) ? ok('Aptos (from Microsoft Office; read in place, never copied)') : warn('Aptos not found (Microsoft Office): videos use Segoe UI or Inter instead');
	const free = freeGb(CACHE);
	if (free !== null) {
		free >= 12 ? ok(`${free} GB free in ${CACHE} (a build of VS Code from main, in a release week, takes about 8 GB)`) : warn(`${free} GB free in ${CACHE}: a release week's build of VS Code from main needs about 12 GB (PRS_BUILDS puts builds elsewhere)`);
	}
	const config = loadConfig();
	if (!fs.existsSync(CONFIG_FILE)) {
		writeJson(CONFIG_FILE, DEFAULT_CONFIG);
		ok(`wrote ${CONFIG_FILE} (your settings)`);
	}
	const mai = config.voice.mai;
	const pace = voicePace(config);
	const faster = pace === 1 ? '' : `; ${pace}\u00d7 its own pace (voice.pace)`;
	if (process.env.AZURE_SPEECH_KEY) {
		ok(`voice: MAI-Voice-2 (${mai.voice}) via AZURE_SPEECH_KEY${faster}`);
	} else if (mai.azResource) {
		ok(`voice: MAI-Voice-2 via az lookup of ${mai.azResource}, Kokoro when that fails${faster}`);
	} else {
		ok(`voice: Kokoro ${config.voice.kokoro.voice} (offline)${faster}. For MAI-Voice-2, set AZURE_SPEECH_KEY, or voice.mai.azResource and voice.mai.azResourceGroup in ${CONFIG_FILE}`);
	}
	console.log(problems ? `${problems} problem${problems > 1 ? 's' : ''} to fix` : 'ready');
	return !problems;
}
